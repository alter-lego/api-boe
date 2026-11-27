-- Migración 24 · Privacidad y permisos (auditoría del 26/11/2026, 2.16, 2.17 y 2.18)
--
-- 1) buscar_publicaciones / contar_publicaciones: el cuerpo de las restringidas (índice sin orden de palabras) solo
--    se consulta con búsquedas sencillas: sin «or», sin exclusiones y con 6 palabras como mucho. Con esas
--    herramientas y filtros estrechos se podía sacar la «bolsa de palabras» de un edicto en unos cientos de
--    búsquedas, sin conocer el nombre. El resto de la consulta no cambia (títulos y texto de las públicas).
-- 2) service_role (la clave de la ingesta, en GitHub Secrets) solo puede lo que la ingesta usa: leer y escribir
--    publicaciones, sumarios, ingestas, gasto y resumen; sin DELETE ni TRUNCATE, y nada sobre las preguntas
--    (consultas) ni la lista de periodistas. Las tablas nuevas ya no le dan permisos por defecto.
-- 3) Registro de migraciones aplicadas (public.migraciones) y una guarda al principio de cada migración: volver a
--    aplicar una antigua por error se para con un mensaje claro, en vez de deshacer el endurecimiento sin avisar.

do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261128140000_privacidad_y_permisos') then
      raise exception 'La migración 20261128140000_privacidad_y_permisos ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

-- ───────────── 1) Búsquedas sencillas en el cuerpo de las restringidas ─────────────
create or replace function public.buscar_publicaciones(
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_departamento text default null,
  p_temas text[] default null,
  p_tipo_acto text default null,
  p_q text default null,
  p_limite int default 20,
  p_rango text default null            -- Ley, Real Decreto, Orden, Resolución… (sin distinguir tildes ni mayúsculas)
) returns setof public.ficha_publicacion
  language plpgsql stable security definer
  set search_path = public, extensions
  set statement_timeout = '5s'
as $$
declare
  v_q tsquery;
  v_q_y tsquery;   -- misma consulta sin frases (<->), para el cuerpo de las restringidas
begin
  perform public.exigir_periodista();

  if p_q is not null and btrim(p_q) <> '' then
    v_q := websearch_to_tsquery('spanish', public.f_unaccent(left(p_q, 500)));
    if numnode(v_q) = 0 then
      raise exception 'la búsqueda no contiene palabras útiles; reformúlala con otros términos'
        using errcode = '22023';
    end if;
    -- solo exclusiones («-palabra») no usarían el índice y recorrerían toda la tabla
    if querytree(v_q)::text = 'T' then
      raise exception 'la búsqueda necesita al menos una palabra que deba aparecer'
        using errcode = '22023';
    end if;
    v_q_y := regexp_replace(v_q::text, '<-?[0-9]*>', '&', 'g')::tsquery;
    -- Canal de deducción (auditoría, 2.16): en el cuerpo de las restringidas solo se busca con consultas sencillas.
    -- Con «or», exclusiones o más de 6 palabras se podía reconstruir por búsqueda binaria la lista de palabras de un
    -- edicto; esas consultas siguen buscando en títulos y en el texto de las públicas, pero no en ese cuerpo.
    if position('|' in v_q::text) > 0 or position('!' in v_q::text) > 0
       or (length(v_q::text) - length(replace(v_q::text, '''', ''))) / 2 > 6 then
      v_q_y := null;
    end if;
  end if;

  return query
  select f.*
  from public.publicaciones p
  cross join lateral public._ficha(p) f
  where (p_desde is null or p.fecha >= p_desde)
    and (p_hasta is null or p.fecha <= p_hasta)
    and (p_seccion is null or p.seccion = p_seccion)
    and (p_departamento is null
         or p.departamento_codigo = p_departamento
         or public.f_unaccent(coalesce(p.departamento, '')) ilike '%' || public.f_unaccent(left(p_departamento, 200)) || '%')
    and (p_rango is null
         or public.f_unaccent(lower(coalesce(p.rango, ''))) = public.f_unaccent(lower(btrim(left(p_rango, 100)))))
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null
         or p.tsv @@ v_q
         or (p.nivel_privacidad = 'publico' and p.tsv_texto @@ v_q)
         or (p.nivel_privacidad = 'restringido' and p.tsv_texto @@ v_q_y))
  order by case when v_q is null then 0 else ts_rank(p.tsv, v_q) end desc,
           p.fecha desc, p.id
  limit greatest(1, least(coalesce(p_limite, 20), 100));
end;
$$;

create or replace function public.contar_publicaciones(
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_departamento text default null,
  p_temas text[] default null,
  p_tipo_acto text default null,
  p_q text default null,
  p_agrupar text default 'total',
  p_rango text default null
) returns table (grupo text, n bigint)
  language plpgsql stable security definer
  set search_path = public, extensions
  set statement_timeout = '5s'
as $$
declare
  v_q tsquery;
  v_q_y tsquery;   -- misma consulta sin frases (<->), para el cuerpo de las restringidas
begin
  perform public.exigir_periodista();

  if p_agrupar is null or p_agrupar not in ('total', 'mes', 'departamento', 'tipo_acto') then
    raise exception 'agrupar no válido: %', p_agrupar using errcode = '22023';
  end if;

  if p_q is not null and btrim(p_q) <> '' then
    v_q := websearch_to_tsquery('spanish', public.f_unaccent(left(p_q, 500)));
    if numnode(v_q) = 0 then
      raise exception 'la búsqueda no contiene palabras útiles; reformúlala con otros términos'
        using errcode = '22023';
    end if;
    -- solo exclusiones («-palabra») no usarían el índice y recorrerían toda la tabla
    if querytree(v_q)::text = 'T' then
      raise exception 'la búsqueda necesita al menos una palabra que deba aparecer'
        using errcode = '22023';
    end if;
    v_q_y := regexp_replace(v_q::text, '<-?[0-9]*>', '&', 'g')::tsquery;
    -- Canal de deducción (auditoría, 2.16): en el cuerpo de las restringidas solo se busca con consultas sencillas.
    -- Con «or», exclusiones o más de 6 palabras se podía reconstruir por búsqueda binaria la lista de palabras de un
    -- edicto; esas consultas siguen buscando en títulos y en el texto de las públicas, pero no en ese cuerpo.
    if position('|' in v_q::text) > 0 or position('!' in v_q::text) > 0
       or (length(v_q::text) - length(replace(v_q::text, '''', ''))) / 2 > 6 then
      v_q_y := null;
    end if;
  end if;

  return query
  select
    case p_agrupar
      when 'mes' then to_char(p.fecha, 'YYYY-MM')
      when 'departamento' then coalesce(p.departamento, '(sin departamento)')
      when 'tipo_acto' then case when p.nivel_privacidad = 'publico'
                                 then coalesce(p.tipo_acto, 'sin clasificar')
                                 else 'sin clasificar' end
      else 'total'
    end as grupo,
    count(*) as n
  from public.publicaciones p
  where (p_desde is null or p.fecha >= p_desde)
    and (p_hasta is null or p.fecha <= p_hasta)
    and (p_seccion is null or p.seccion = p_seccion)
    and (p_departamento is null
         or p.departamento_codigo = p_departamento
         or public.f_unaccent(coalesce(p.departamento, '')) ilike '%' || public.f_unaccent(left(p_departamento, 200)) || '%')
    and (p_rango is null
         or public.f_unaccent(lower(coalesce(p.rango, ''))) = public.f_unaccent(lower(btrim(left(p_rango, 100)))))
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null
         or p.tsv @@ v_q
         or (p.nivel_privacidad = 'publico' and p.tsv_texto @@ v_q)
         or (p.nivel_privacidad = 'restringido' and p.tsv_texto @@ v_q_y))
  group by 1
  order by case when p_agrupar = 'mes' then null else count(*) end desc nulls last, 1
  limit 1000;
end;
$$;

revoke all on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int, text) from public, anon, service_role;
revoke all on function public.contar_publicaciones(date, date, text, text, text[], text, text, text, text) from public, anon, service_role;
grant execute on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int, text) to authenticated;
grant execute on function public.contar_publicaciones(date, date, text, text, text[], text, text, text, text) to authenticated;

-- ───────────── 2) service_role, solo lo que usa la ingesta ─────────────
revoke all on table public.boletines, public.sumarios, public.publicaciones, public.ingestas, public.periodistas, public.periodistas_log, public.consultas, public.gasto_ingesta, public.resumenes_dia from service_role;
grant select, insert, update on table public.publicaciones, public.sumarios, public.resumenes_dia to service_role;
grant select, insert on table public.ingestas, public.gasto_ingesta to service_role;
grant select on table public.boletines to service_role;
revoke all on all sequences in schema public from service_role;
grant usage, select on sequence public.sumarios_id_seq, public.ingestas_id_seq, public.gasto_ingesta_id_seq to service_role;
alter default privileges in schema public revoke all on tables from service_role;
alter default privileges in schema public revoke all on sequences from service_role;

-- ───────────── 3) Registro de migraciones ─────────────
create table if not exists public.migraciones (
  nombre text primary key,
  aplicada_en timestamptz not null default now()
);
alter table public.migraciones enable row level security;
revoke all on table public.migraciones from public, anon, authenticated, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'respaldo') then
    grant select on table public.migraciones to respaldo;   -- la copia vuelca todas las tablas de public salvo consultas
  end if;
end $$;

insert into public.migraciones (nombre) values
  ('20261113100000_tablas'),
  ('20261113100100_seguridad'),
  ('20261113100200_funciones_lectura'),
  ('20261113100300_funciones_consultas'),
  ('20261113110000_correcciones_revision'),
  ('20261113120000_fichas_y_vigencia'),
  ('20261113130000_indice_texto_completo'),
  ('20261114100000_endurecer_indice_texto'),
  ('20261114110000_vigencia_y_rango'),
  ('20261114120000_rls_y_admin'),
  ('20261114130000_endurecer_admin'),
  ('20261114140000_reservar_consulta'),
  ('20261121100000_cache_y_gasto'),
  ('20261125100000_gasto_ingesta'),
  ('20261126100000_buscar_persona'),
  ('20261126110000_restringir_ocupaciones'),
  ('20261126120000_persona_nombre_seguido'),
  ('20261126130000_persona_sin_sueltas'),
  ('20261127100000_resumen_dia'),
  ('20261128100000_vaciar_indice_y_reclasificar'),
  ('20261128110000_respaldo_minimo'),
  ('20261128120000_limites_consultas'),
  ('20261128130000_sesion_real'),
  ('20261128140000_privacidad_y_permisos')
on conflict (nombre) do nothing;
