-- Fase 2 · Migración 8 · Endurecimiento del índice de texto completo (revisión de seguridad del 13/11/2026)
--
-- 1. Restringidas: el índice del cuerpo se guarda SIN posiciones ni frecuencias (strip), para que
--    búsquedas de frase («"Fulanito X"») no permitan reconstruir el texto palabra a palabra. Su
--    cuerpo se busca con la misma consulta cambiando las frases (<->) por «y» (&).
-- 2. Restringidas: no se indexan grupos de 3 o más dígitos/asteriscos (DNI enmascarados, números de
--    edicto), para no poder confirmar a una persona con «Nombre 1234».
-- 3. El orden por relevancia usa solo título y resumen (el texto completo encarecía cada consulta).
-- 4. Una búsqueda sin ninguna palabra positiva (solo exclusiones) se rechaza; tiempo máximo de 5 s.
-- 5. indexar_texto devuelve false si el id no existe.
-- Las restringidas ya indexadas se vacían: hay que reindexarlas (node ingesta/fichas.js --restringidas).

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261114100000_endurecer_indice_texto') then
      raise exception 'La migración 20261114100000_endurecer_indice_texto ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

drop function public.indexar_texto(text, text);

create function public.indexar_texto(p_id text, p_texto text) returns boolean
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_nivel text;
begin
  select nivel_privacidad into v_nivel from public.publicaciones where id = p_id;
  if not found then return false; end if;

  if v_nivel = 'restringido' then
    update public.publicaciones
       set tsv_texto = strip(to_tsvector('spanish', public.f_unaccent(
             left(regexp_replace(coalesce(p_texto, ''), '[0-9*]{3,}[A-Za-z]?', ' ', 'g'), 300000))))
     where id = p_id;
  else
    update public.publicaciones
       set tsv_texto = to_tsvector('spanish', public.f_unaccent(left(coalesce(p_texto, ''), 300000)))
     where id = p_id;
  end if;
  return true;
end;
$$;

revoke all on function public.indexar_texto(text, text) from public, anon, authenticated;
grant execute on function public.indexar_texto(text, text) to service_role;

-- Una restringida (también si se reclasifica una pública) nunca conserva posiciones.
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
    new.aviso_fuente := null;
    new.ficha_motivo_revision := null;
    if new.tsv_texto is not null then new.tsv_texto := strip(new.tsv_texto); end if;
  end if;
  return new;
end;
$$;

-- Reindexar las restringidas con las reglas nuevas.
update public.publicaciones set tsv_texto = null where nivel_privacidad = 'restringido';

-- medir_indice no necesita security definer (lo ejecuta service_role, que ya lee la tabla).
create or replace function public.medir_indice()
  returns table (filas bigint, con_indice bigint, bytes_tsv_texto bigint, bytes_indice_gin bigint,
                 bytes_tabla_total bigint, bytes_base_datos bigint)
  language sql stable
  set search_path = public, extensions
as $$
  select count(*), count(tsv_texto), coalesce(sum(pg_column_size(tsv_texto)), 0)::bigint,
         pg_relation_size('public.publicaciones_tsv_texto_idx'::regclass),
         pg_total_relation_size('public.publicaciones'::regclass),
         pg_database_size(current_database())
  from public.publicaciones;
$$;

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
  p_agrupar text default 'total'
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

-- create or replace conserva los permisos de la migración 3.
