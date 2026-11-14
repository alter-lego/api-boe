-- Fase 2 · Migración 7 · Índice de búsqueda sobre el texto completo (el texto NO se guarda)
--
-- Decisión del 13/11/2026: un periodista que busca un nombre debe encontrar la publicación aunque el
-- nombre solo esté en el cuerpo del texto, y también en las restringidas (de las que solo se muestra
-- título, metadatos y enlace). Por eso se guarda un tsvector del texto completo de TODAS las
-- publicaciones, públicas y restringidas.
--
-- Qué NO cambia: de una restringida nunca sale resumen, temas, tipo ni texto (lo sigue haciendo
-- _ficha()). Lo que cambia es que una palabra del cuerpo de una restringida ahora la encuentra.
-- Riesgo asumido: probando palabras, un periodista autorizado puede deducir qué contiene el texto
-- de una restringida. Aceptable con 20 usuarios identificados; revisar si se abre a más gente.

alter table public.publicaciones add column tsv_texto tsvector;

create index publicaciones_tsv_texto_idx on public.publicaciones using gin (tsv_texto);

-- Cola de publicaciones cuyo texto aún no se ha indexado.
create index publicaciones_texto_pendiente_idx
  on public.publicaciones (fecha desc) where tsv_texto is null;

-- Solo la ingesta (service_role). Recibe el texto, guarda únicamente sus lexemas y lo descarta.
-- Se limita el tamaño: un tsvector no puede pasar de 1 MB.
create or replace function public.indexar_texto(p_id text, p_texto text) returns void
  language sql volatile security definer
  set search_path = public, extensions
as $$
  update public.publicaciones
     set tsv_texto = to_tsvector('spanish', public.f_unaccent(left(coalesce(p_texto, ''), 300000)))
   where id = p_id;
$$;

-- Cuánto espacio ocupa el índice (para decidir si cabe en el plan gratuito).
create or replace function public.medir_indice()
  returns table (filas bigint, con_indice bigint, bytes_tsv_texto bigint, bytes_indice_gin bigint,
                 bytes_tabla_total bigint, bytes_base_datos bigint)
  language sql stable security definer
  set search_path = public, extensions
as $$
  select count(*),
         count(tsv_texto),
         coalesce(sum(pg_column_size(tsv_texto)), 0)::bigint,
         pg_relation_size('public.publicaciones_tsv_texto_idx'::regclass),
         pg_total_relation_size('public.publicaciones'::regclass),
         pg_database_size(current_database())
  from public.publicaciones;
$$;

revoke all on function public.indexar_texto(text, text) from public, anon, authenticated;
revoke all on function public.medir_indice() from public, anon, authenticated;
grant execute on function public.indexar_texto(text, text) to service_role;
grant execute on function public.medir_indice() to service_role;

-- ───────────── La búsqueda mira también el texto completo ─────────────
-- Sigue devolviendo siempre _ficha(): de una restringida solo título, metadatos y enlaces.
-- Una coincidencia en el título o el resumen pesa más que una solo en el cuerpo.

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
    and (v_q is null or p.tsv @@ v_q or p.tsv_texto @@ v_q)
  order by case when v_q is null then 0
                else ts_rank(p.tsv, v_q) + 0.2 * ts_rank(coalesce(p.tsv_texto, ''::tsvector), v_q) end desc,
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
    and (v_q is null or p.tsv @@ v_q or p.tsv_texto @@ v_q)
  group by 1
  order by case when p_agrupar = 'mes' then null else count(*) end desc nulls last, 1
  limit 1000;
end;
$$;

-- create or replace conserva los permisos de la migración 3.
