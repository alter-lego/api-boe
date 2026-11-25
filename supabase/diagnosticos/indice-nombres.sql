-- Diagnóstico: ¿cuánto ocuparía un índice de nombres SIN reducción a raíces?
-- SOLO LECTURA: no crea, cambia ni borra nada. Pegar entero en Supabase → SQL Editor y ejecutar.
-- El SQL Editor solo enseña el último resultado, por eso todo sale en una sola tabla (bloque, dato, valor).
--
-- Qué mide:
--   1. Espacio: tamaño de la base, del índice del texto completo (por nivel) y de su índice de búsqueda.
--   2. Estimación: cuánto ocuparía un segundo índice «sin raíces» (configuración 'simple').
--      El texto completo NO está guardado (solo sus palabras indexadas), así que no se puede recalcular aquí:
--      se mide la proporción «sin raíces / con raíces» en los TÍTULOS y se aplica al índice actual.
--      Es una aproximación; el índice sin raíces guarda además las palabras vacías («de», «la»…), que el
--      diccionario de español descarta, y eso ya entra en la proporción.
--   3. Ejemplos inventados de cómo se recortan apellidos que coinciden con palabras comunes.
--   4. Coincidencias: cuántas publicaciones encuentra hoy cada uno de esos apellidos y en cuántas está en el
--      título. Solo cuenta: no muestra títulos ni nombres.
-- Puede tardar unos segundos (recorre los títulos de todas las publicaciones).

with
t as (
  select pg_database_size(current_database())::numeric as bd
),
c as (
  select nivel_privacidad as nivel, count(*) as n, count(tsv_texto) as con_indice,
         coalesce(sum(pg_column_size(tsv_texto)), 0)::numeric as b
    from public.publicaciones
   group by 1
),
g as (
  select coalesce(sum(pg_relation_size(i.indexrelid)), 0)::numeric as b
    from pg_index i
   where i.indrelid = 'public.publicaciones'::regclass
     and pg_get_indexdef(i.indexrelid) ilike '%tsv_texto%'
),
r as (
  select sum(pg_column_size(to_tsvector('simple', public.f_unaccent(titulo))))::numeric
         / nullif(sum(pg_column_size(to_tsvector('spanish', public.f_unaccent(titulo)))), 0) as proporcion
    from public.publicaciones
   where titulo is not null
),
est as (
  select ((select sum(b) from c) + (select b from g)) * (select proporcion from r) as b
),
ejemplos as (
  select w, k
    from unnest(array['Rosales', 'rosales', 'Herrero', 'herreros', 'Calvo', 'calvos', 'Moreno', 'morenas', 'Pastor', 'García', 'Garcés'])
         with ordinality as x(w, k)
),
apellidos as (
  select w, k,
         (select count(*) from public.publicaciones p
           where p.tsv_texto @@ plainto_tsquery('spanish', public.f_unaccent(w))) as en_indice,
         (select count(*) from public.publicaciones p
           where p.titulo ~ ('\m' || w || '\M')) as en_titulo
    from unnest(array['Rosales', 'Herrero', 'Calvo', 'Moreno', 'Pastor']) with ordinality as x(w, k)
)
select bloque, dato, valor
  from (
    select 1 as orden, 0::bigint as k, '1 · Espacio' as bloque, 'Base de datos completa' as dato,
           pg_size_pretty(bd) || ' de 500 MB del plan gratuito (' || round(100 * bd / (500 * 1024 * 1024)) || ' %)' as valor
      from t
    union all
    select 2, row_number() over (order by nivel), '1 · Espacio', 'Índice del texto completo (' || nivel || ')',
           pg_size_pretty(b) || ' · ' || con_indice || ' de ' || n || ' publicaciones indexadas'
      from c
    union all
    select 3, 0, '1 · Espacio', 'Índice de búsqueda (GIN) del texto completo', pg_size_pretty(b)
      from g
    union all
    select 4, 0, '2 · Estimación', 'Proporción sin raíces / con raíces (medida en títulos)', round(proporcion, 2)::text || ' veces'
      from r
    union all
    select 5, 0, '2 · Estimación', 'Índice de nombres sin raíces (texto + búsqueda), aprox.', pg_size_pretty(round(b))
      from est
    union all
    select 6, 0, '2 · Estimación', 'Base de datos tras añadirlo, aprox.',
           pg_size_pretty(round(t.bd + est.b)) || ' (' || round(100 * (t.bd + est.b) / (500 * 1024 * 1024)) || ' % de 500 MB)'
      from t, est
    union all
    select 7, k, '3 · Ejemplo', w,
           'con raíces: ' || to_tsvector('spanish', public.f_unaccent(w))::text
           || '  ·  sin raíces: ' || to_tsvector('simple', public.f_unaccent(w))::text
      from ejemplos
    union all
    select 8, k, '4 · Coincidencias hoy', w,
           en_indice || ' publicaciones en el índice  ·  ' || en_titulo || ' con «' || w || '» en el título'
      from apellidos
  ) filas
 order by orden, k;
