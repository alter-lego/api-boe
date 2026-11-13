-- Fase 2 · Migración 6 · Columnas para fichas (revisión) y vigencia del XML del BOE
-- Solo añade columnas e índice; no toca las funciones de la API (eso llega con la Fase 3/4).

alter table public.publicaciones
  add column ficha_revisar boolean not null default false,   -- la IA no pudo resumir con seguridad
  add column ficha_motivo_revision text,
  add column aviso_fuente text,                              -- incoherencia verificable del texto oficial
  add column estatus_derogacion text,                        -- del XML: 'N' (vigente) u otro valor
  add column judicialmente_anulada boolean,
  add column vigencia_agotada boolean,
  add column vigencia_actualizada timestamptz;               -- cuándo se leyó el estado de vigencia

-- Cola de fichas pendientes: públicas y sin ficha.
create index publicaciones_fichas_pendientes_idx
  on public.publicaciones (fecha desc)
  where nivel_privacidad = 'publico' and ficha_version is null;

-- El trigger que vacía las restringidas también limpia los campos nuevos.
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
  end if;
  return new;
end;
$$;
