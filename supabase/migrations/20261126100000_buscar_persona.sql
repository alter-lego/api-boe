-- Migración 15 · Búsqueda de personas por nombre (sin índice nuevo y sin cambiar la privacidad)
--
-- Problema: el índice usa el diccionario de español, que reduce las palabras a su raíz. Un apellido como
-- «Herrero» se guarda como «herrer» y coincide con «Herrera», «herreros»…; buscar a una persona da cientos
-- de resultados mezclados y el periodista solo ve los 100 primeros.
--
-- Solución sin ocupar espacio: el TÍTULO y el RESUMEN sí están guardados como texto, así que en ellos se
-- puede comprobar el nombre EXACTO (palabras completas, sin distinguir tildes ni mayúsculas). buscar_persona()
-- usa el índice actual para encontrar candidatos y los clasifica:
--   1 'titulo'  → todas las palabras del nombre están, exactas, en el título oficial (público siempre).
--   2 'resumen' → están, exactas, en el resumen (solo publicaciones públicas: las restringidas no tienen).
--   3 'texto'   → coincide en el texto completo según el índice (puede ser otra persona o una palabra parecida).
-- Ordena por ese grupo y después por fecha, y devuelve cuántos hay en cada grupo (aunque no quepan en el límite).
--
-- Privacidad: igual que buscar_publicaciones. Lo que se muestra sale de _ficha() (restringidas: solo título,
-- metadatos y enlace). En el cuerpo de las restringidas se busca sin posiciones (todas las palabras, en
-- cualquier orden). Saber si un nombre está en el título o solo en el texto ya se podía deducir buscando.

create or replace function public.buscar_persona(
  p_nombre text,
  p_desde date default null,
  p_hasta date default null,
  p_seccion text default null,
  p_limite int default 100
) returns table (coincidencia text, total_grupo bigint, ficha public.ficha_publicacion)
  language plpgsql stable security definer
  set search_path = public, extensions
  set statement_timeout = '5s'
as $$
declare
  v_norm text;
  v_palabras text[];
  v_q tsquery;
begin
  perform public.exigir_periodista();

  -- Normalización: sin tildes, en minúsculas, los puntos («J.») como espacios y espacios colapsados.
  v_norm := btrim(regexp_replace(regexp_replace(lower(public.f_unaccent(coalesce(p_nombre, ''))), '\.', ' ', 'g'), '\s+', ' ', 'g'));
  if length(v_norm) not between 2 and 100 then
    raise exception 'escribe un nombre de entre 2 y 100 caracteres' using errcode = '22023';
  end if;
  -- Solo letras, espacios, guiones y apóstrofos: así cada palabra se puede usar sin riesgo en una expresión regular.
  if v_norm !~ '^[a-z'' -]+$' then
    raise exception 'el nombre solo puede llevar letras, espacios, guiones y apóstrofos' using errcode = '22023';
  end if;
  v_palabras := string_to_array(v_norm, ' ');
  if cardinality(v_palabras) > 6 then
    raise exception 'escribe como máximo 6 palabras' using errcode = '22023';
  end if;
  if not exists (select 1 from unnest(v_palabras) w where length(w) >= 3) then
    raise exception 'escribe al menos un nombre o apellido de 3 letras o más' using errcode = '22023';
  end if;
  v_q := plainto_tsquery('spanish', v_norm);
  if numnode(v_q) = 0 then
    raise exception 'el nombre no contiene palabras útiles; prueba con el apellido' using errcode = '22023';
  end if;

  return query
  with candidatas as (
    select p as pub,
           case
             when not exists (select 1 from unnest(v_palabras) w
                               where lower(public.f_unaccent(p.titulo)) !~ ('\m' || w || '\M')) then 1
             when p.nivel_privacidad = 'publico' and p.resumen is not null
                  and not exists (select 1 from unnest(v_palabras) w
                                   where lower(public.f_unaccent(p.resumen)) !~ ('\m' || w || '\M')) then 2
             else 3
           end as grupo
      from public.publicaciones p
     where (p_desde is null or p.fecha >= p_desde)
       and (p_hasta is null or p.fecha <= p_hasta)
       and (p_seccion is null or p.seccion = p_seccion)
       and (p.tsv @@ v_q or p.tsv_texto @@ v_q)   -- v_q solo tiene «y»: vale también en el índice sin posiciones
  ), elegidas as (
    select c.pub, c.grupo, count(*) over (partition by c.grupo) as n
      from candidatas c
     order by c.grupo, (c.pub).fecha desc, (c.pub).id
     limit greatest(1, least(coalesce(p_limite, 100), 100))
  )
  select case e.grupo when 1 then 'titulo' when 2 then 'resumen' else 'texto' end,
         e.n,
         f
    from elegidas e
   cross join lateral public._ficha(e.pub) f
   order by e.grupo, (e.pub).fecha desc, (e.pub).id;
end;
$$;

revoke all on function public.buscar_persona(text, date, date, text, int) from public, anon;
grant execute on function public.buscar_persona(text, date, date, text, int) to authenticated;
