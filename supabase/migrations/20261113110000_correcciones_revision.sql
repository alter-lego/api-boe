-- Fase 1 · Migración 5 · Correcciones de la revisión de seguridad
-- Las migraciones 1-4 ya están aplicadas, por eso las correcciones van en una nueva.

-- ───────────── 1) El resumen de una restringida NO puede entrar en la búsqueda ─────────────
-- Antes, tsv indexaba el resumen sin mirar el nivel: filtrar, contar u ordenar por palabras
-- permitía deducir el texto oculto. Ahora solo el nivel 'publico' aporta resumen al índice.

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261113110000_correcciones_revision') then
      raise exception 'La migración 20261113110000_correcciones_revision ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

alter table public.publicaciones drop column tsv;   -- arrastra su índice GIN
alter table public.publicaciones add column tsv tsvector generated always as (
  setweight(to_tsvector('spanish', public.f_unaccent(coalesce(titulo, ''))), 'A') ||
  setweight(to_tsvector('spanish', public.f_unaccent(
    case when nivel_privacidad = 'publico' then coalesce(resumen, '') else '' end)), 'B')
) stored;
create index publicaciones_tsv_idx on public.publicaciones using gin (tsv);

-- Defensa en profundidad: una restringida no guarda ficha, aunque la ingesta se equivoque
-- o se reclasifique después. (BEFORE: se ejecuta antes de calcular las columnas generadas.)
create or replace function public.tg_vaciar_restringida() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.nivel_privacidad = 'restringido' then
    new.resumen := null;
    new.temas := null;
    new.tipo_acto := null;
    new.referencias := null;
  end if;
  return new;
end;
$$;

create trigger publicaciones_vaciar_restringida
  before insert or update on public.publicaciones
  for each row execute function public.tg_vaciar_restringida();

revoke all on function public.tg_vaciar_restringida() from public, anon, authenticated;
alter function public.tg_actualizado_en() set search_path = '';

-- ───────────── 2) Funciones futuras: sin EXECUTE para PUBLIC ─────────────
-- Un REVOKE «in schema» no puede quitar el EXECUTE que PUBLIC tiene por defecto en toda función
-- nueva (es un privilegio global). Hay que hacerlo para el rol que crea los objetos.
alter default privileges for role postgres revoke execute on functions from public;

-- ───────────── 5) ultima_ingesta: último día de BOE realmente cargado ─────────────
create or replace function public.ultima_ingesta()
  returns table (fecha date, fin timestamptz)
  language sql stable security definer
  set search_path = public, extensions
as $$
  select i.fecha, i.fin
  from public.ingestas i
  where i.estado = 'ok' and i.boletin = 'BOE'
  order by i.fecha desc, i.fin desc nulls last
  limit 1;
$$;

-- ───────────── 6) Límites de tamaño en lo que escribe un periodista ─────────────
alter table public.consultas
  add constraint consultas_pregunta_len check (char_length(pregunta) <= 4000),
  add constraint consultas_citas_len check (citas is null or cardinality(citas) <= 100);

-- ───────────── 7 y 8) Búsqueda: palabras vacías, agrupar nulo, límite de grupos ─────────────

create or replace function public.buscar_publicaciones(
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_departamento text default null,
  p_temas text[] default null,
  p_tipo_acto text default null,
  p_q text default null,
  p_limite int default 20
) returns setof public.ficha_publicacion
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_q tsquery;
begin
  perform public.exigir_periodista();

  if p_q is not null and btrim(p_q) <> '' then
    v_q := websearch_to_tsquery('spanish', public.f_unaccent(left(p_q, 500)));
    if numnode(v_q) = 0 then
      raise exception 'la búsqueda no contiene palabras útiles; reformúlala con otros términos'
        using errcode = '22023';
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
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null or p.tsv @@ v_q)
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
  p_agrupar text default 'total'
) returns table (grupo text, n bigint)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_q tsquery;
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
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null or p.tsv @@ v_q)
  group by 1
  order by case when p_agrupar = 'mes' then null else count(*) end desc nulls last, 1
  limit 1000;
end;
$$;

-- create or replace conserva los permisos concedidos en la migración 3.
