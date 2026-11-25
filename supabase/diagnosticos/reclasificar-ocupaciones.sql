-- Diagnóstico previo a la migración 16: qué publicaciones de V.B pasarían a restringidas.
-- SOLO LECTURA. Pegar en Supabase → SQL Editor. Los títulos son públicos (salen igual en el BOE).
-- Primero el recuento; después, una muestra de títulos para comprobar que no se cuela nada que no deba.
-- También cuenta los anuncios de «utilidad pública» (proyectos de energía), que NO se reclasifican,
-- para valorarlos aparte.

with c as (
  select p.id, p.fecha, p.titulo,
         lower(public.f_unaccent(p.titulo)) ~ 'necesidad de (la )?ocupacion|bienes y derechos afectados' as pasa,
         lower(public.f_unaccent(p.titulo)) ~ 'utilidad publica' as utilidad
    from public.publicaciones p
   where p.seccion = '5B' and p.nivel_privacidad = 'publico'
)
select 0 as orden, 'Pasarían a restringidas' as dato, count(*) filter (where pasa)::text as valor from c
union all
select 1, 'De ellas, con resumen generado', (select count(*) from public.publicaciones p
  where p.seccion = '5B' and p.nivel_privacidad = 'publico' and p.resumen is not null
    and lower(public.f_unaccent(p.titulo)) ~ 'necesidad de (la )?ocupacion|bienes y derechos afectados')::text
union all
select 2, 'V.B públicas en total', count(*)::text from c
union all
select 3, '«Utilidad pública» (siguen públicas)', count(*) filter (where utilidad and not pasa)::text from c
union all
select * from (
  select 4, 'Muestra · ' || to_char(fecha, 'DD/MM/YYYY'), left(titulo, 220)
    from c where pasa order by fecha desc limit 15
) m
order by 1;
