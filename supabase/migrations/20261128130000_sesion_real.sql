-- Migración 23 · La sesión tiene que seguir existiendo en Supabase Auth y entrar solo por enlace (auditoría, 2.11, 2.12 y 2.14)
--
-- 1) Sesión cerrada = token inútil. Hasta ahora bastaba con un token firmado de menos de 24 h: tras «salir» (en todos
--    los dispositivos) un token robado seguía valiendo hasta que caducaba (1 h). Ahora, si el token lleva
--    `session_id`, esa sesión tiene que existir en auth.sessions, ser del mismo usuario (`sub`) y no haber pasado su
--    `not_after`. Los tokens de usuario de Supabase siempre llevan `session_id`; los que no lo llevan solo pueden
--    ser de pruebas (las de supabase/tests) o de herramientas del propio Supabase.
-- 2) Solo enlace del correo. Se aceptaba un `amr` con contraseña si además traía `otp`; ahora cualquier método que
--    no sea otp/magiclink invalida la sesión (como dice docs: «con contraseña nunca vale»). Igual en el Worker.
-- 3) La baja corta el acceso de verdad (auditoría, 2.14): admin_modificar_periodista con activo = false cierra todas
--    sus sesiones (con el punto 1, sus tokens dejan de valer al instante) y bloquea su usuario de Auth, para que
--    no pueda pedir más enlaces (que gastan el cupo de correo). Al reactivarlo se desbloquea.
--
-- security definer: lee auth.sessions, que el rol authenticated no puede leer. Sigue sin EXECUTE para nadie: la
-- usan es_periodista/es_admin/exigir_*.

do $$
begin
  if not has_table_privilege(current_user, 'auth.sessions', 'select') then
    raise exception 'el rol % no puede leer auth.sessions: no se aplica (dejaría a todos sin acceso)', current_user;
  end if;
  if not has_table_privilege(current_user, 'auth.sessions', 'delete') or not has_table_privilege(current_user, 'auth.users', 'update') then
    raise exception 'el rol % no puede cerrar sesiones ni bloquear usuarios de Auth: no se aplica', current_user;
  end if;
end $$;

create or replace function public.sesion_vigente() returns boolean
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_jwt jsonb := auth.jwt();
  v_amr jsonb := v_jwt -> 'amr';
  v_min bigint;
  v_sesion text := v_jwt ->> 'session_id';
begin
  if v_amr is null or jsonb_typeof(v_amr) <> 'array' or jsonb_array_length(v_amr) = 0 then
    return false;
  end if;
  -- Todas las entradas tienen que ser de enlace por correo (ninguna contraseña, teléfono, TOTP…).
  if exists (
    select 1 from jsonb_array_elements(v_amr) e
     where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'method', '') not in ('otp', 'magiclink')
  ) then
    return false;
  end if;
  select min((e ->> 'timestamp')::bigint) into v_min
    from jsonb_array_elements(v_amr) e
   where e ? 'timestamp';
  if v_min is null or extract(epoch from now()) - v_min > 24 * 3600 then
    return false;
  end if;
  -- La sesión sigue abierta en Supabase Auth (no se ha cerrado ni dado de baja).
  if v_sesion is not null and not exists (
    select 1 from auth.sessions s
     where s.id = v_sesion::uuid
       and s.user_id = (v_jwt ->> 'sub')::uuid
       and (s.not_after is null or s.not_after > now())
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;     -- marca, sesión o usuario ilegibles
end;
$$;
revoke all on function public.sesion_vigente() from public, anon, authenticated, service_role;

-- ───────────── 3) La baja cierra sesiones y bloquea el usuario de Auth ─────────────
create or replace function public.admin_modificar_periodista(
  p_email text,
  p_nombre text default null,
  p_limite_diario int default null,
  p_activo boolean default null,
  p_es_admin boolean default null
) returns table (email text, nombre text, limite_diario int, activo boolean, es_admin boolean)
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.exigir_admin();
  perform pg_advisory_xact_lock(hashtext('periodistas_admin'));
  perform public.exigir_admin();     -- otra vez: el rol pudo quitarse mientras esperábamos el bloqueo

  if char_length(btrim(p_nombre)) > 200 then
    raise exception 'nombre demasiado largo (máximo 200)' using errcode = '22023';
  end if;
  if p_limite_diario is not null and p_limite_diario not between 1 and 1000 then
    raise exception 'límite diario no válido (1 a 1000)' using errcode = '22023';
  end if;

  update public.periodistas p
     set nombre = case when p_nombre is null then p.nombre else nullif(btrim(p_nombre), '') end,
         limite_diario = coalesce(p_limite_diario, p.limite_diario),
         activo = coalesce(p_activo, p.activo),
         es_admin = case when p_activo is false then false else coalesce(p_es_admin, p.es_admin) end
   where p.email = v_email;
  if not found then
    raise exception 'no existe ese periodista' using errcode = 'P0002';
  end if;

  -- Baja: fuera sus sesiones y su usuario de Auth bloqueado; reactivación: desbloqueado.
  if p_activo is false then
    delete from auth.sessions s using auth.users u where s.user_id = u.id and lower(u.email) = v_email;
    update auth.users u set banned_until = '2999-12-31 00:00:00+00' where lower(u.email) = v_email;
  elsif p_activo is true then
    update auth.users u set banned_until = null where lower(u.email) = v_email and u.banned_until is not null;
  end if;

  if not exists (select 1 from public.periodistas x where x.activo and x.es_admin) then
    raise exception 'debe quedar al menos un administrador activo' using errcode = '23514';
  end if;

  return query
  select p.email, p.nombre, p.limite_diario, p.activo, p.es_admin
    from public.periodistas p where p.email = v_email;
end;
$$;
