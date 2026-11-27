-- Fase 1 · Migración 3/4 · Funciones de lectura (security definer)
-- Cada función comprueba que el correo de la sesión está en `periodistas` y activo,
-- y aplica el nivel de privacidad en UN solo sitio: _ficha().
-- Todas se crean sin permisos y se conceden de forma explícita al final.

-- ───────────────────── Auxiliares (nadie las llama desde fuera) ─────────────────────

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261113100200_funciones_lectura') then
      raise exception 'La migración 20261113100200_funciones_lectura ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

create or replace function public.es_periodista() returns boolean
  language sql stable security definer
  set search_path = public, extensions
as $$
  select exists (
    select 1 from public.periodistas p
    where p.activo
      and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.exigir_periodista() returns void
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  if not public.es_periodista() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
end;
$$;

-- Forma de lo que ven los periodistas y, por tanto, Claude.
create type public.ficha_publicacion as (
  id text,
  fecha date,
  seccion text,
  seccion_nombre text,
  departamento_codigo text,
  departamento text,
  epigrafe text,
  titulo text,
  rango text,
  url_html text,
  url_pdf text,
  url_xml text,
  resumen text,
  temas text[],
  tipo_acto text,
  nivel_privacidad text,
  corrige_a text,
  referencias jsonb
);

-- ÚNICO punto donde se aplica la privacidad: de una publicación restringida solo salen
-- título, metadatos y enlaces. Lo que no sale de aquí, Claude no puede citarlo.
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
    case when p.nivel_privacidad = 'publico' then p.referencias end
  )::public.ficha_publicacion;
$$;

-- ───────────────────── buscar_publicaciones ─────────────────────

create or replace function public.buscar_publicaciones(
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_departamento text default null,   -- código o fragmento del nombre
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
    v_q := websearch_to_tsquery('spanish', public.f_unaccent(p_q));
  end if;

  return query
  select (public._ficha(p)).*
  from public.publicaciones p
  where (p_desde is null or p.fecha >= p_desde)
    and (p_hasta is null or p.fecha <= p_hasta)
    and (p_seccion is null or p.seccion = p_seccion)
    and (p_departamento is null
         or p.departamento_codigo = p_departamento
         or public.f_unaccent(coalesce(p.departamento, '')) ilike '%' || public.f_unaccent(p_departamento) || '%')
    -- Los filtros por tema y tipo solo alcanzan fichas públicas: las restringidas no tienen ficha.
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null or p.tsv @@ v_q)
  order by case when v_q is null then 0 else ts_rank(p.tsv, v_q) end desc,
           p.fecha desc, p.id
  limit greatest(1, least(coalesce(p_limite, 20), 100));
end;
$$;

-- ───────────────────── contar_publicaciones ─────────────────────

create or replace function public.contar_publicaciones(
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_departamento text default null,
  p_temas text[] default null,
  p_tipo_acto text default null,
  p_q text default null,
  p_agrupar text default 'total'      -- total | mes | departamento | tipo_acto
) returns table (grupo text, n bigint)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_q tsquery;
begin
  perform public.exigir_periodista();

  if p_agrupar not in ('total', 'mes', 'departamento', 'tipo_acto') then
    raise exception 'agrupar no válido: %', p_agrupar using errcode = '22023';
  end if;

  if p_q is not null and btrim(p_q) <> '' then
    v_q := websearch_to_tsquery('spanish', public.f_unaccent(p_q));
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
         or public.f_unaccent(coalesce(p.departamento, '')) ilike '%' || public.f_unaccent(p_departamento) || '%')
    and (p_temas is null or (p.nivel_privacidad = 'publico' and p.temas && p_temas))
    and (p_tipo_acto is null or (p.nivel_privacidad = 'publico' and p.tipo_acto = p_tipo_acto))
    and (v_q is null or p.tsv @@ v_q)
  group by 1
  order by case when p_agrupar = 'mes' then null else count(*) end desc nulls last, 1
  limit 200;
end;
$$;

-- ───────────────────── sumario_del_dia y publicacion ─────────────────────

create or replace function public.sumario_del_dia(p_fecha date)
  returns setof public.ficha_publicacion
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  perform public.exigir_periodista();
  return query
  select (public._ficha(p)).*
  from public.publicaciones p
  where p.fecha = p_fecha
  order by p.seccion, p.departamento, p.id
  limit 2000;
end;
$$;

create or replace function public.publicacion(p_id text)
  returns setof public.ficha_publicacion
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  perform public.exigir_periodista();
  return query
  select (public._ficha(p)).*
  from public.publicaciones p
  where p.id = p_id;
end;
$$;

-- ───────────────────── Estado de la ingesta (para /v1/health) ─────────────────────
-- Única función abierta a anon: solo devuelve una fecha, sin contenido.

create or replace function public.ultima_ingesta()
  returns table (fecha date, fin timestamptz)
  language sql stable security definer
  set search_path = public, extensions
as $$
  select i.fecha, i.fin
  from public.ingestas i
  where i.estado in ('ok', 'sin_boletin')
  order by i.fin desc nulls last
  limit 1;
$$;

-- ───────────────────── Permisos ─────────────────────
-- Todo cerrado por defecto (migración 2). Se concede solo lo que usa la API.

revoke all on function public.es_periodista()       from public, anon, authenticated;
revoke all on function public.exigir_periodista()   from public, anon, authenticated;
revoke all on function public._ficha(public.publicaciones) from public, anon, authenticated;

revoke all on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int) from public, anon;
revoke all on function public.contar_publicaciones(date, date, text, text, text[], text, text, text) from public, anon;
revoke all on function public.sumario_del_dia(date) from public, anon;
revoke all on function public.publicacion(text)     from public, anon;
revoke all on function public.ultima_ingesta()      from public;

grant execute on function public.buscar_publicaciones(date, date, text, text, text[], text, text, int) to authenticated;
grant execute on function public.contar_publicaciones(date, date, text, text, text[], text, text, text) to authenticated;
grant execute on function public.sumario_del_dia(date) to authenticated;
grant execute on function public.publicacion(text)     to authenticated;
grant execute on function public.ultima_ingesta()      to anon, authenticated;
