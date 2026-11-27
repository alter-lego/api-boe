-- Fase 1 · Migración 2/4 · Seguridad: RLS cerrada y permisos mínimos
-- Nadie lee las tablas directamente, tampoco un usuario con sesión.
-- Todo el acceso de los periodistas pasa por funciones (migraciones 3 y 4).
-- La ingesta usa service_role, que se salta RLS pero necesita permisos de tabla.

-- 1) RLS activada en todas las tablas y SIN políticas.
-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261113100100_seguridad') then
      raise exception 'La migración 20261113100100_seguridad ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

alter table public.boletines     enable row level security;
alter table public.sumarios      enable row level security;
alter table public.publicaciones enable row level security;
alter table public.ingestas      enable row level security;
alter table public.periodistas   enable row level security;
alter table public.consultas     enable row level security;

-- 2) Ningún permiso de tabla para los roles de la API pública.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- 3) Lo que se cree en el futuro tampoco se expone por defecto.
alter default privileges in schema public revoke all on tables    from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- 4) service_role (solo ingesta, vive en GitHub Secrets) necesita acceso explícito.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
