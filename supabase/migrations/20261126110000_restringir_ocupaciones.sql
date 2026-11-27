-- Migración 16 · V.B: la «necesidad de ocupación» y la «relación de bienes y derechos afectados» pasan a restringidas
--
-- Por qué: son listas de propietarios afectados por una obra (expropiación en la práctica) y nombran a
-- particulares. La regla de V.B solo restringía los títulos con «expropiación» o «levantamiento de actas»,
-- y estos se escapaban: se les generaba resumen con IA y su texto se indexaba con posiciones.
--
-- Qué hace: reclasifica las ya cargadas. El trigger tg_vaciar_restringida (migraciones 6 y 8) se encarga
-- del resto en la misma actualización: borra resumen, temas, tipo, referencias y avisos, y quita las
-- posiciones del índice del texto (strip). La búsqueda por palabras las sigue encontrando, pero solo se
-- muestra su título, metadatos y enlace al BOE.
--
-- Debe ir con el cambio de la ingesta (ingesta/lib/sumario.js, V_B_RESTRINGIDA): si no, una nueva pasada
-- del mismo día volvería a marcar como públicas las de hoy. Misma expresión en los dos sitios.
-- Antes de aplicarla se puede ver qué cambia con supabase/diagnosticos/reclasificar-ocupaciones.sql.

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261126110000_restringir_ocupaciones') then
      raise exception 'La migración 20261126110000_restringir_ocupaciones ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

update public.publicaciones
   set nivel_privacidad = 'restringido'
 where seccion = '5B'
   and nivel_privacidad = 'publico'
   and lower(public.f_unaccent(titulo)) ~ 'necesidad de (la )?ocupacion|bienes y derechos afectados';
