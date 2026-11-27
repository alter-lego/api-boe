-- Fase 1 · Migración 1/4 · Extensión, tablas e índices
-- Aplicar en Supabase → SQL Editor. Orden: 1, 2, 3, 4.

-- unaccent se instala en el esquema `extensions` (el estándar de Supabase),
-- de forma explícita para que f_unaccent no dependa de dónde caiga por defecto.
-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261113100000_tablas') then
      raise exception 'La migración 20261113100000_tablas ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent no es IMMUTABLE: este envoltorio permite usarla en columnas generadas e índices.
create or replace function public.f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- ───────────────────────── Tablas ─────────────────────────

create table public.boletines (
  codigo text primary key,
  nombre text not null,
  ambito text
);

insert into public.boletines (codigo, nombre, ambito)
values ('BOE', 'Boletín Oficial del Estado', 'estatal');

create table public.sumarios (
  id bigserial primary key,
  boletin text not null references public.boletines (codigo),
  fecha date not null,
  numero text not null,
  url_pdf text,
  hash text,
  ingerido_en timestamptz not null default now(),
  unique (boletin, fecha, numero)
);

create table public.publicaciones (
  id text primary key,                       -- 'BOE-A-2026-12345'
  sumario_id bigint references public.sumarios (id) on delete set null,
  boletin text not null references public.boletines (codigo),
  fecha date not null,
  seccion text,
  seccion_nombre text,
  departamento_codigo text,
  departamento text,
  epigrafe text,
  titulo text not null,
  rango text,
  url_html text,
  url_pdf text,
  url_xml text,
  -- Ficha generada por IA (nula en el nivel restringido)
  resumen text,
  temas text[],
  tipo_acto text,
  ficha_modelo text,
  ficha_version int,
  -- Privacidad y vigencia
  nivel_privacidad text not null default 'restringido'
    check (nivel_privacidad in ('publico', 'restringido')),
  -- Sin clave foránea a propósito: una corrección puede referirse a una publicación
  -- anterior al histórico cargado (12 meses) y no existir aquí.
  corrige_a text,
  referencias jsonb,                         -- normas anteriores, del bloque <analisis>
  tsv tsvector generated always as (
    setweight(to_tsvector('spanish', public.f_unaccent(coalesce(titulo, ''))), 'A') ||
    setweight(to_tsvector('spanish', public.f_unaccent(coalesce(resumen, ''))), 'B')
  ) stored,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);

create index on public.publicaciones (fecha desc);
create index on public.publicaciones (seccion, fecha);
create index on public.publicaciones (departamento_codigo, fecha);
create index on public.publicaciones (tipo_acto, fecha);
create index on public.publicaciones (corrige_a) where corrige_a is not null;
create index on public.publicaciones using gin (tsv);
create index on public.publicaciones using gin (temas);

create function public.tg_actualizado_en() returns trigger
  language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger publicaciones_actualizado_en
  before update on public.publicaciones
  for each row execute function public.tg_actualizado_en();

create table public.ingestas (
  id bigserial primary key,
  boletin text references public.boletines (codigo),
  fecha date,
  inicio timestamptz,
  fin timestamptz,
  estado text check (estado in ('ok', 'sin_boletin', 'fuente_caida', 'error')),
  n_nuevas int,
  n_actualizadas int,
  n_fichas int,
  error text
);
create index on public.ingestas (fin desc) where estado in ('ok', 'sin_boletin');

-- Lista de acceso del piloto. Se rellena a mano; el correo va siempre en minúsculas.
create table public.periodistas (
  email text primary key check (email = lower(email)),
  nombre text,
  limite_diario int not null default 30,
  activo boolean not null default true
);

-- Coste y calidad. Se borra a los 90 días (ver purgar_consultas, migración 4).
create table public.consultas (
  id bigserial primary key,
  usuario text not null,
  pregunta text not null,
  modelo text,
  rondas int,
  tokens_entrada int,
  tokens_salida int,
  tokens_cache int,
  coste_usd numeric(10, 5),
  citas text[],
  sin_resultados boolean,
  creado_en timestamptz not null default now()
);
create index on public.consultas (usuario, creado_en desc);
create index on public.consultas (creado_en);
