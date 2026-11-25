-- Migración 18 · buscar_persona: fuera las «palabras sueltas» de las públicas; restringidas en su propio grupo
--
-- Decidido el 25/11/2026 con un caso real: en una búsqueda por nombre, las publicaciones PÚBLICAS donde las
-- palabras salen sueltas (un nombre en una línea de la lista y un apellido en otra) no aportan: el índice
-- guarda las posiciones y ya se ha comprobado que el nombre NO va seguido. Se descartan.
-- Las RESTRINGIDAS no guardan posiciones (privacidad), así que no se puede comprobar: pueden ser la persona
-- buscada (listas de oposiciones, edictos, expropiaciones) y se devuelven en su propio grupo.
-- Grupos:
--   1 'titulo'      → exacto en el título.
--   2 'resumen'     → exacto en el resumen (públicas).
--   3 'seguido'     → públicas con el nombre seguido en el texto (con una sola palabra, basta con que esté).
--   4 'restringida' → restringidas con las palabras en el texto (no se puede comprobar si van seguidas).
--   (públicas con las palabras sueltas: no se devuelven)
-- Si el BOE escribe el nombre con algo en medio («Eladio José Santos Martínez»), se pierde: la web
-- recomienda probar solo con los apellidos.

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
  v_frase tsquery;   -- OR de las rotaciones del nombre como frase; null con una sola palabra
  i int;
begin
  perform public.exigir_periodista();

  v_norm := btrim(regexp_replace(regexp_replace(lower(public.f_unaccent(coalesce(p_nombre, ''))), '\.', ' ', 'g'), '\s+', ' ', 'g'));
  if length(v_norm) not between 2 and 100 then
    raise exception 'escribe un nombre de entre 2 y 100 caracteres' using errcode = '22023';
  end if;
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

  -- Rotaciones: [a b c], [b c a], [c a b]. Solo si hay al menos dos palabras con contenido.
  if numnode(v_q) >= 3 then   -- dos lexemas y un «&» como mínimo
    for i in 0 .. cardinality(v_palabras) - 1 loop
      v_frase := case when v_frase is null then phraseto_tsquery('spanish', array_to_string(v_palabras[i + 1:] || v_palabras[:i], ' '))
                      else v_frase || phraseto_tsquery('spanish', array_to_string(v_palabras[i + 1:] || v_palabras[:i], ' ')) end;
    end loop;
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
             -- Públicas: el nombre seguido en el texto (con una sola palabra basta con que esté)
             when p.nivel_privacidad = 'publico' and (v_frase is null or p.tsv_texto @@ v_frase) then 3
             -- Restringidas: sin posiciones, no se puede comprobar; se muestran aparte
             when p.nivel_privacidad = 'restringido' then 4
             -- Públicas con las palabras sueltas: casi nunca es esa persona; se descartan
             else 5
           end as grupo
      from public.publicaciones p
     where (p_desde is null or p.fecha >= p_desde)
       and (p_hasta is null or p.fecha <= p_hasta)
       and (p_seccion is null or p.seccion = p_seccion)
       and (p.tsv @@ v_q or p.tsv_texto @@ v_q)   -- v_q solo tiene «y»: vale también en el índice sin posiciones
  ), elegidas as (
    select c.pub, c.grupo, count(*) over (partition by c.grupo) as n
      from candidatas c
     where c.grupo < 5
     order by c.grupo, (c.pub).fecha desc, (c.pub).id
     limit greatest(1, least(coalesce(p_limite, 100), 100))
  )
  select case e.grupo when 1 then 'titulo' when 2 then 'resumen' when 3 then 'seguido' else 'restringida' end,
         e.n,
         f
    from elegidas e
   cross join lateral public._ficha(e.pub) f
   order by e.grupo, (e.pub).fecha desc, (e.pub).id;
end;
$$;

revoke all on function public.buscar_persona(text, date, date, text, int) from public, anon;
grant execute on function public.buscar_persona(text, date, date, text, int) to authenticated;
