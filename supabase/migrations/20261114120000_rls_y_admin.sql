-- Migración 10 · RLS como segunda barrera + rol admin para gestionar periodistas
-- Aplicar en Supabase → SQL Editor (después de las 9 anteriores). Se puede ejecutar más de una vez.
--
-- Qué hace:
--   1) Columna periodistas.es_admin y tabla de auditoría periodistas_log (trigger sobre periodistas).
--   2) Funciones admin_* (alta, modificación/baja, listado, log) que solo ejecuta un admin activo.
--   3) Políticas RLS por fila en todas las tablas. Son SEGUNDA barrera: hoy ningún rol de la API
--      tiene permisos de tabla (migración 2), así que no cambian lo que ve nadie; actúan si un
--      GRANT por error abriera una tabla.
--
-- Qué NO toca: las funciones de lectura (security definer, el dueño salta RLS), la ingesta
-- (service_role salta RLS) ni los permisos de tabla.
--
-- ARRANQUE (a mano, una sola vez, con TU correo; el trigger lo anota en el log como «postgres»):
--   insert into public.periodistas (email, nombre, es_admin) values ('tu.correo@dominio', 'Tu nombre', true)
--   on conflict (email) do update set es_admin = true, activo = true;

-- ───────────── 1) Rol admin y auditoría ─────────────

alter table public.periodistas add column if not exists es_admin boolean not null default false;

create table if not exists public.periodistas_log (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  actor text not null,          -- correo del admin, o el rol de base de datos si fue a mano
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  email text not null,          -- periodista afectado
  detalle jsonb                 -- INSERT/DELETE: la fila; UPDATE: solo campos cambiados {antes, despues}
);
create index if not exists periodistas_log_creado_en_idx on public.periodistas_log (creado_en desc);

alter table public.periodistas_log enable row level security;
revoke all on public.periodistas_log from public, anon, authenticated;
revoke all on sequence public.periodistas_log_id_seq from public, anon, authenticated;
grant all on public.periodistas_log to service_role;
grant all on sequence public.periodistas_log_id_seq to service_role;

-- El trigger cubre TODA vía de escritura (funciones admin, SQL Editor, service_role).
create or replace function public.tg_auditar_periodistas() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_actor text := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), session_user);
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
revoke all on function public.tg_auditar_periodistas() from public, anon, authenticated;

drop trigger if exists periodistas_auditoria on public.periodistas;
create trigger periodistas_auditoria
  after insert or update or delete on public.periodistas
  for each row execute function public.tg_auditar_periodistas();

-- ───────────── 2) Comprobación de admin y funciones admin_* ─────────────

create or replace function public.es_admin() returns boolean
  language sql stable security definer
  set search_path = public, extensions
as $$
  select exists (
    select 1 from public.periodistas p
    where p.activo and p.es_admin
      and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.exigir_admin() returns void
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  if not public.es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_listar_periodistas()
  returns table (email text, nombre text, limite_diario int, activo boolean, es_admin boolean, consultas_hoy bigint)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  perform public.exigir_admin();
  return query
  select p.email, p.nombre, p.limite_diario, p.activo, p.es_admin,
         (select count(*) from public.consultas c
           where c.usuario = p.email
             and c.creado_en >= (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'))
    from public.periodistas p
   order by p.activo desc, p.email;
end;
$$;

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

  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
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

-- Los parámetros null significan «no cambiar». La baja es activo = false (no se borra a nadie).
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
  -- Serializa los cambios: dos admins quitándose el rol a la vez no pueden dejar el sistema sin admin.
  perform pg_advisory_xact_lock(hashtext('periodistas_admin'));

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
         es_admin = coalesce(p_es_admin, p.es_admin)
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

create or replace function public.admin_ver_log(p_limite int default 100)
  returns table (id bigint, creado_en timestamptz, actor text, accion text, email text, detalle jsonb)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  perform public.exigir_admin();
  return query
  select l.id, l.creado_en, l.actor, l.accion, l.email, l.detalle
    from public.periodistas_log l
   order by l.creado_en desc, l.id desc
   limit greatest(1, least(coalesce(p_limite, 100), 500));
end;
$$;

revoke all on function public.es_admin() from public, anon;
revoke all on function public.exigir_admin() from public, anon, authenticated;
revoke all on function public.admin_listar_periodistas() from public, anon;
revoke all on function public.admin_alta_periodista(text, text, int, boolean) from public, anon;
revoke all on function public.admin_modificar_periodista(text, text, int, boolean, boolean) from public, anon;
revoke all on function public.admin_ver_log(int) from public, anon;

-- es_periodista y es_admin devuelven solo un booleano sobre la propia sesión; las necesitan las
-- políticas (se evalúan con los permisos de quien consulta) y la web para mostrar el menú de admin.
grant execute on function public.es_periodista() to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.admin_listar_periodistas() to authenticated;
grant execute on function public.admin_alta_periodista(text, text, int, boolean) to authenticated;
grant execute on function public.admin_modificar_periodista(text, text, int, boolean, boolean) to authenticated;
grant execute on function public.admin_ver_log(int) to authenticated;

-- ───────────── 3) Políticas RLS (segunda barrera) ─────────────
-- Todas son «to authenticated»: anon no tiene ninguna política, así que no ve nada.
-- (select ...) envuelve cada llamada para que Postgres la evalúe UNA vez por consulta (initPlan)
-- y no una vez por fila. Los índices que usan ya existen: periodistas(email) y consultas(usuario, creado_en).
-- No hay políticas de INSERT/UPDATE/DELETE en publicaciones, sumarios, boletines, ingestas ni consultas:
-- escribir solo lo hace la ingesta (service_role) o las funciones.

drop policy if exists periodistas_select on public.periodistas;
create policy periodistas_select on public.periodistas for select to authenticated
  using (
    (select public.es_admin())
    or (activo and email = (select lower(coalesce(auth.jwt() ->> 'email', ''))))
  );

drop policy if exists periodistas_insert on public.periodistas;
create policy periodistas_insert on public.periodistas for insert to authenticated
  with check ((select public.es_admin()));

drop policy if exists periodistas_update on public.periodistas;
create policy periodistas_update on public.periodistas for update to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

drop policy if exists periodistas_log_select on public.periodistas_log;
create policy periodistas_log_select on public.periodistas_log for select to authenticated
  using ((select public.es_admin()));

-- Cada periodista, solo sus consultas (ni siquiera un admin ve las de otros).
drop policy if exists consultas_select on public.consultas;
create policy consultas_select on public.consultas for select to authenticated
  using (
    usuario = (select lower(coalesce(auth.jwt() ->> 'email', '')))
    and (select public.es_periodista())
  );

-- Publicaciones: por vía directa solo las PÚBLICAS, y solo para periodistas activos.
-- Una RLS no puede ocultar columnas, así que las restringidas no se ven por completo (ni su
-- tsv_texto); lo que se lee de una restringida (título, metadatos, enlaces) sale por _ficha().
drop policy if exists publicaciones_select on public.publicaciones;
create policy publicaciones_select on public.publicaciones for select to authenticated
  using (nivel_privacidad = 'publico' and (select public.es_periodista()));

drop policy if exists boletines_select on public.boletines;
create policy boletines_select on public.boletines for select to authenticated
  using ((select public.es_periodista()));

drop policy if exists sumarios_select on public.sumarios;
create policy sumarios_select on public.sumarios for select to authenticated
  using ((select public.es_periodista()));

-- ingestas: sin política a propósito (el campo `error` puede contener detalles internos);
-- la web usa ultima_ingesta().
