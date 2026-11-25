-- Migración 14 · Gasto de la ingesta (fichas con Claude) y total mensual para admins
--
-- 1) TABLA gasto_ingesta: una fila por cada pasada de `fichas.js --pendientes` que haya llamado a Claude
--    (fichas generadas, tokens y coste en USD). La escribe solo la ingesta (service_role), que únicamente
--    puede INSERTAR y LEER: no puede corregir ni borrar filas pasadas. Ni anon ni authenticated la ven:
--    los admins solo reciben agregados por mes a través de admin_gasto().
--    Va en una tabla propia y no en `ingestas` porque `ingestas` decide la frescura (/v1/health) y la
--    caducidad de la caché de respuestas: una fila de fichas ahí alteraría ambas.
--    No se purga (son pocas filas al día y sin datos personales).
-- 2) admin_gasto() pasa a devolver también, por mes, el gasto de la ingesta. Cambia el tipo de retorno,
--    así que se borra y se vuelve a crear (y se repiten los permisos).

create table if not exists public.gasto_ingesta (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  modelo text,
  n_fichas int not null default 0 check (n_fichas >= 0),
  tokens_entrada int not null default 0 check (tokens_entrada >= 0),
  tokens_salida int not null default 0 check (tokens_salida >= 0),
  tokens_cache int not null default 0 check (tokens_cache >= 0),
  coste_usd numeric(10, 5) not null check (coste_usd >= 0)
);
create index if not exists gasto_ingesta_creado_en_idx on public.gasto_ingesta (creado_en);

-- RLS activa y sin políticas: por vía directa (PostgREST con sesión) nadie la ve.
alter table public.gasto_ingesta enable row level security;
revoke all on table public.gasto_ingesta from public, anon, authenticated, service_role;
revoke all on sequence public.gasto_ingesta_id_seq from public, anon, authenticated, service_role;
grant select, insert on table public.gasto_ingesta to service_role;
grant usage on sequence public.gasto_ingesta_id_seq to service_role;

-- Gasto por mes (últimos p_meses, 1 a 24): preguntas y, aparte, ingesta. Solo admins con sesión vigente.
-- Un mes aparece si tiene preguntas o gasto de ingesta.
drop function if exists public.admin_gasto(int);
create or replace function public.admin_gasto(p_meses int default 3)
  returns table (mes date, preguntas bigint, usuarios bigint, tokens_entrada bigint, tokens_salida bigint, tokens_cache bigint, coste_usd numeric,
                 ingesta_fichas bigint, ingesta_coste_usd numeric)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_desde timestamptz;
begin
  perform public.exigir_admin();
  if p_meses is null or p_meses not between 1 and 24 then
    raise exception 'meses no válidos' using errcode = '22023';
  end if;
  v_desde := (date_trunc('month', now() at time zone 'Europe/Madrid') - make_interval(months => p_meses - 1)) at time zone 'Europe/Madrid';
  return query
  with p as (
    select date_trunc('month', c.creado_en at time zone 'Europe/Madrid')::date as m,
           count(*) as preguntas, count(distinct c.usuario) as usuarios,
           coalesce(sum(c.tokens_entrada), 0)::bigint as te, coalesce(sum(c.tokens_salida), 0)::bigint as ts,
           coalesce(sum(c.tokens_cache), 0)::bigint as tc, coalesce(sum(c.coste_usd), 0)::numeric as coste
      from public.consultas c
     where c.creado_en >= v_desde
     group by 1
  ), i as (
    select date_trunc('month', g.creado_en at time zone 'Europe/Madrid')::date as m,
           coalesce(sum(g.n_fichas), 0)::bigint as fichas, coalesce(sum(g.coste_usd), 0)::numeric as coste
      from public.gasto_ingesta g
     where g.creado_en >= v_desde
     group by 1
  )
  select coalesce(p.m, i.m),
         coalesce(p.preguntas, 0)::bigint, coalesce(p.usuarios, 0)::bigint,
         coalesce(p.te, 0)::bigint, coalesce(p.ts, 0)::bigint, coalesce(p.tc, 0)::bigint, coalesce(p.coste, 0)::numeric,
         coalesce(i.fichas, 0)::bigint, coalesce(i.coste, 0)::numeric
    from p full join i on i.m = p.m
   order by 1 desc;
end;
$$;

revoke all on function public.admin_gasto(int) from public, anon, service_role;
grant execute on function public.admin_gasto(int) to authenticated;
