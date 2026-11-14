-- Migración 11 · Endurecer el rol admin y la sesión (tras la revisión independiente de la migración 10)
-- Aplicar en Supabase → SQL Editor DESPUÉS de la 10. Se puede ejecutar más de una vez.
--
-- 1) Tope de sesión en la propia base de datos (sesion_vigente): 24 h desde el inicio de sesión.
-- 2) service_role ya no puede tocar `periodistas` ni la auditoría; TRUNCATE bloqueado en ambas.
-- 3) Las funciones admin comprueban admin otra vez tras el bloqueo (carrera).
-- 4) «Siempre queda un admin activo» también por SQL directo (constraint trigger diferible).
-- 5) El actor del log distingue el rol cuando no hay correo.
-- 6) Correo del alta: solo ASCII.
-- 7) Dar de baja a alguien le quita también el rol de admin.

-- ───────────── 1) Sesión vigente ─────────────
-- El JWT de Supabase lleva `amr`: lista de {method, timestamp}. Se exige un método de enlace por correo
-- (otp / magiclink) y que la marca MÁS ANTIGUA tenga ≤ 24 h. Sin `amr` o ilegible = falso.
-- (Se aceptan marcas en el futuro: el token va firmado por Supabase, no se puede falsear.)
create or replace function public.sesion_vigente() returns boolean
  language plpgsql stable
  set search_path = public, extensions
as $$
declare
  v_amr jsonb := auth.jwt() -> 'amr';
  v_min bigint;
begin
  if v_amr is null or jsonb_typeof(v_amr) <> 'array' then
    return false;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_amr) e
     where jsonb_typeof(e) = 'object' and e ->> 'method' in ('otp', 'magiclink')
  ) then
    return false;
  end if;
  select min((e ->> 'timestamp')::bigint) into v_min
    from jsonb_array_elements(v_amr) e
   where jsonb_typeof(e) = 'object' and e ? 'timestamp';
  return v_min is not null
     and extract(epoch from now()) - v_min <= 24 * 3600;
exception when others then
  return false;     -- marca ilegible
end;
$$;
revoke all on function public.sesion_vigente() from public, anon, authenticated;

-- es_periodista / es_admin exigen sesión vigente: también las usan las políticas RLS.
create or replace function public.es_periodista() returns boolean
  language sql stable security definer
  set search_path = public, extensions
as $$
  select public.sesion_vigente()
     and exists (
       select 1 from public.periodistas p
       where p.activo
         and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     );
$$;

create or replace function public.es_admin() returns boolean
  language sql stable security definer
  set search_path = public, extensions
as $$
  select public.sesion_vigente()
     and exists (
       select 1 from public.periodistas p
       where p.activo and p.es_admin
         and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     );
$$;

-- Orden de comprobaciones: PRIMERO la sesión (para cualquiera, sea o no periodista: así un token sin
-- sesión válida no averigua si su correo está en la lista), DESPUÉS la lista.
-- 'PT401' → PostgREST responde HTTP 401 (sesión caducada: la web vuelve a pedir el enlace);
-- 42501 → HTTP 403 (no autorizado).
create or replace function public.exigir_periodista() returns void
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  if not public.sesion_vigente() then
    raise exception 'sesión caducada' using errcode = 'PT401';
  end if;
  if not public.es_periodista() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.exigir_admin() returns void
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  if not public.sesion_vigente() then
    raise exception 'sesión caducada' using errcode = 'PT401';
  end if;
  if not public.es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
end;
$$;

-- ───────────── 2) service_role fuera de periodistas y del log ─────────────
-- La ingesta no toca `periodistas` (comprobado con grep en ingesta/, .github/ y api/). Las altas y bajas se
-- hacen con admin_* (desde la web) o por el SQL Editor (rol postgres, que sigue pudiendo).
revoke all on public.periodistas     from service_role;
revoke all on public.periodistas_log from service_role;
grant select on public.periodistas     to service_role;
grant select on public.periodistas_log to service_role;
-- El trigger de auditoría es security definer: no necesita nada de la secuencia.
revoke all on sequence public.periodistas_log_id_seq from service_role;

-- Funciones que service_role no necesita (la ingesta solo usa indexar_texto, medir_indice y purgar_consultas).
revoke execute on function public.es_admin() from service_role;
revoke execute on function public.exigir_admin() from service_role;
revoke execute on function public.sesion_vigente() from service_role;
revoke execute on function public.admin_listar_periodistas() from service_role;
revoke execute on function public.admin_alta_periodista(text, text, int, boolean) from service_role;
revoke execute on function public.admin_modificar_periodista(text, text, int, boolean, boolean) from service_role;
revoke execute on function public.admin_ver_log(int) from service_role;

-- TRUNCATE no dispara los triggers de fila: se bloquea con uno propio, también para el dueño.
create or replace function public.tg_bloquear_truncate() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'TRUNCATE bloqueado en %', tg_table_name using errcode = '23001';
end;
$$;
revoke all on function public.tg_bloquear_truncate() from public, anon, authenticated;

drop trigger if exists periodistas_sin_truncate on public.periodistas;
create trigger periodistas_sin_truncate
  before truncate on public.periodistas
  for each statement execute function public.tg_bloquear_truncate();

drop trigger if exists periodistas_log_sin_truncate on public.periodistas_log;
create trigger periodistas_log_sin_truncate
  before truncate on public.periodistas_log
  for each statement execute function public.tg_bloquear_truncate();

-- La política de lectura de `periodistas` debe exigir también sesión vigente en la rama «mi propia fila»
-- (las demás políticas ya pasan por es_admin()/es_periodista(), que la incluyen).
drop policy if exists periodistas_select on public.periodistas;
create policy periodistas_select on public.periodistas for select to authenticated
  using (
    (select public.es_admin())
    or (
      activo
      and email = (select lower(coalesce(auth.jwt() ->> 'email', '')))
      and (select public.es_periodista())
    )
  );

-- ───────────── 4) «Siempre queda un admin activo», también por SQL directo ─────────────
-- Se comprueba al final de la transacción, y solo cuando se toca a quien era admin activo.
create or replace function public.tg_exigir_admin_activo() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if not exists (select 1 from public.periodistas p where p.activo and p.es_admin) then
    raise exception 'debe quedar al menos un administrador activo' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.tg_exigir_admin_activo() from public, anon, authenticated;

drop trigger if exists periodistas_ultimo_admin on public.periodistas;
create constraint trigger periodistas_ultimo_admin
  after update or delete on public.periodistas
  deferrable initially deferred
  for each row
  when (old.es_admin and old.activo)
  execute function public.tg_exigir_admin_activo();

-- ───────────── 5) Actor del log ─────────────
create or replace function public.tg_auditar_periodistas() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_actor text := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), nullif(auth.jwt() ->> 'role', ''), session_user);
  v_detalle jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.periodistas_log (actor, accion, email, detalle) values (v_actor, tg_op, new.email, to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.periodistas_log (actor, accion, email, detalle) values (v_actor, tg_op, old.email, to_jsonb(old));
    return old;
  end if;

  select jsonb_object_agg(o.key, jsonb_build_object('antes', o.value, 'despues', n.value))
    into v_detalle
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
   where o.value is distinct from n.value;
  if v_detalle is not null then
    insert into public.periodistas_log (actor, accion, email, detalle) values (v_actor, tg_op, new.email, v_detalle);
  end if;
  return new;
end;
$$;

-- ───────────── 3, 6 y 7) Funciones admin: segunda comprobación tras el bloqueo, correo ASCII, baja = sin rol ─────────────
create or replace function public.admin_alta_periodista(
  p_email text,
  p_nombre text default null,
  p_limite_diario int default 30,
  p_es_admin boolean default false
) returns table (email text, nombre text, limite_diario int, activo boolean, es_admin boolean)
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
begin
  perform public.exigir_admin();
  perform pg_advisory_xact_lock(hashtext('periodistas_admin'));
  perform public.exigir_admin();     -- otra vez: el rol pudo quitarse mientras esperábamos el bloqueo

  if char_length(v_email) > 254
     or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    raise exception 'correo no válido' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 200 then
    raise exception 'nombre demasiado largo (máximo 200)' using errcode = '22023';
  end if;
  if p_limite_diario is null or p_limite_diario not between 1 and 1000 then
    raise exception 'límite diario no válido (1 a 1000)' using errcode = '22023';
  end if;
  if exists (select 1 from public.periodistas x where x.email = v_email) then
    raise exception 'ya existe un periodista con ese correo (usa admin_modificar_periodista)' using errcode = '23505';
  end if;

  return query
  insert into public.periodistas as p (email, nombre, limite_diario, es_admin, activo)
  values (v_email, v_nombre, p_limite_diario, coalesce(p_es_admin, false), true)
  returning p.email, p.nombre, p.limite_diario, p.activo, p.es_admin;
end;
$$;

-- Los parámetros null significan «no cambiar». La baja es activo = false y quita también el rol de admin
-- (reactivar a alguien no le devuelve el rol: hay que dárselo aparte).
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

  if not exists (select 1 from public.periodistas x where x.activo and x.es_admin) then
    raise exception 'debe quedar al menos un administrador activo' using errcode = '23514';
  end if;

  return query
  select p.email, p.nombre, p.limite_diario, p.activo, p.es_admin
    from public.periodistas p where p.email = v_email;
end;
$$;
