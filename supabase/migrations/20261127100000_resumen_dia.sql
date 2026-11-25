-- Migración · Resumen editorial del día («Resumen de hoy»)
--
-- 1) TABLA resumenes_dia: una fila por día con el resumen que redacta Claude tras la ingesta
--    (`ingesta/resumen-dia.js`): titulares, bloques por tema y los cuatro apartados fijos (ayudas,
--    oposiciones, impuestos y automoción). Claude NO escribe enlaces ni HTML: cita cada publicación por su
--    id, y la web pinta título y enlaces a partir de las fichas del sumario, que ya pasan por _ficha().
--    Claude solo recibe título y metadatos de las restringidas (nunca su texto), así que el resumen no
--    puede contener nada de ellas que no esté ya en su título.
--    La escribe solo la ingesta (service_role), que puede insertar, leer y actualizar (se regenera si el
--    día cambia, p. ej. por un BOE extraordinario), pero no borrar.
-- 2) resumen_del_dia(fecha): el resumen de un día para un periodista con sesión vigente, o null.

create table if not exists public.resumenes_dia (
  fecha date primary key,
  contenido jsonb not null check (jsonb_typeof(contenido) = 'object'),
  n_publicaciones int not null check (n_publicaciones >= 0),   -- publicaciones del día cuando se generó
  modelo text not null,
  version int not null check (version >= 1),                   -- versión de las instrucciones (skill/RESUMEN-DIA.md)
  avisos jsonb not null default '[]'::jsonb,                   -- lo que el código corrigió (ids desconocidos, textos descartados)
  generado_en timestamptz not null default now()
);

-- RLS activa y sin políticas: por vía directa (PostgREST con sesión) nadie la ve.
alter table public.resumenes_dia enable row level security;
revoke all on table public.resumenes_dia from public, anon, authenticated, service_role;
grant select, insert, update on table public.resumenes_dia to service_role;

create or replace function public.resumen_del_dia(p_fecha date)
  returns jsonb
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  perform public.exigir_periodista();
  select jsonb_build_object(
           'fecha', r.fecha,
           'contenido', r.contenido,
           'generado_en', r.generado_en,
           'n_publicaciones', r.n_publicaciones)
    into v
    from public.resumenes_dia r
   where r.fecha = p_fecha;
  return v;   -- null si ese día aún no tiene resumen
end;
$$;

revoke all on function public.resumen_del_dia(date) from public, anon, service_role;
grant execute on function public.resumen_del_dia(date) to authenticated;
