-- Fase 2 · Migración 9 · Vigencia, avisos y filtro por rango en la API de lectura
--
-- 1. ficha_publicacion incorpora: aviso_fuente, ficha_revisar, estatus_derogacion,
--    judicialmente_anulada, vigencia_agotada, vigencia_actualizada.
--    Privacidad (todo en _ficha): la vigencia es metadato oficial y sale también de las restringidas;
--    aviso_fuente y ficha_revisar solo de las públicas. ficha_motivo_revision NO se expone (es interno).
-- 2. buscar_publicaciones y contar_publicaciones aceptan p_rango (al final de la lista de parámetros,
--    para no romper llamadas por nombre). Las firmas antiguas se eliminan para no dejar sobrecargas.

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261114110000_vigencia_y_rango') then
      raise exception 'La migración 20261114110000_vigencia_y_rango ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

alter type public.ficha_publicacion
  add attribute aviso_fuente text,
  add attribute ficha_revisar boolean,
  add attribute estatus_derogacion text,
  add attribute judicialmente_anulada boolean,
  add attribute vigencia_agotada boolean,
  add attribute vigencia_actualizada timestamptz;

create or replace function public._ficha(p public.publicaciones)
  returns public.ficha_publicacion
  language sql immutable
as $$
  select row(
    p.id, p.fecha, p.seccion, p.seccion_nombre, p.departamento_codigo, p.departamento,
    p.epigrafe, p.titulo, p.rango, p.url_html, p.url_pdf, p.url_xml,
    case when p.nivel_privacidad = 'publico' then p.resumen end,
    case when p.nivel_privacidad = 'publico' then p.temas end,
    case when p.nivel_privacidad = 'publico' then p.tipo_acto end,
    p.nivel_privacidad,
    p.corrige_a,
    case when p.nivel_privacidad = 'publico' then p.referencias end,
    case when p.nivel_privacidad = 'publico' then p.aviso_fuente end,
    case when p.nivel_privacidad = 'publico' then p.ficha_revisar end,
    p.estatus_derogacion,
    p.judicialmente_anulada,
    p.vigencia_agotada,
    p.vigencia_actualizada
  )::public.ficha_publicacion;
$$;

drop function public.buscar_publicaciones(date, date, text, text, text[], text, text, int);
drop function public.contar_publicaciones(date, date, text, text, text[], text, text, text);

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


revoke all on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int, text) from public, anon;
revoke all on function public.contar_publicaciones(date, date, text, text, text[], text, text, text, text) from public, anon;
grant execute on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int, text) to authenticated;
grant execute on function public.contar_publicaciones(date, date, text, text, text[], text, text, text, text) to authenticated;
