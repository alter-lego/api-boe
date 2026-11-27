-- Migración 20 · Al restringir una publicación se vacía su índice; más anuncios de ocupación de V.B, restringidos
--
-- 1) TRIGGER. Cuando una publicación pasa de pública a restringida, tg_vaciar_restringida pone tsv_texto a null
--    (antes solo le quitaba las posiciones con strip). El índice de una pública guarda los números de 3 o más
--    cifras y las máscaras de DNI (***4567**), que indexar_texto solo quita al indexar una restringida: con el
--    strip se quedaban, y «Apellido 4567» confirmaba si alguien figuraba en la lista. El paso
--    «node ingesta/fichas.js --restringidas» de cada ingesta las vuelve a indexar con las reglas de las
--    restringidas (busca tsv_texto nulo); hasta entonces no se encuentran por el texto, solo por el título.
-- 2) LIMPIEZA. Las 5B restringidas que ya tienen números de 3 o más cifras en el índice (las reclasificadas por
--    la migración 16: 46 el 26/11/2026) se vacían para reindexarlas.
-- 3) RECLASIFICACIÓN. Variantes que se escapaban de la migración 16 (11 el 26/11/2026): «levantamiento de las
--    actas», «procedimiento expropiatorio», «bienes y/o derechos afectados», «necesaria ocupación», «fincas
--    afectadas», «afecciones de la parcela». El trigger borra su ficha y vacía su índice.
--    Misma expresión que V_B_RESTRINGIDA en ingesta/lib/sumario.js: si no, la siguiente pasada del mismo día
--    volvería a marcarlas como públicas.
--
-- Después: node --env-file=.env ingesta/fichas.js --restringidas --limite 1000 (o esperar a la próxima ingesta).
-- Se puede ejecutar más de una vez: cada paso solo toca lo que aún no está corregido.

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261128100000_vaciar_indice_y_reclasificar') then
      raise exception 'La migración 20261128100000_vaciar_indice_y_reclasificar ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

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
    if tg_op = 'UPDATE' and old.nivel_privacidad is distinct from 'restringido' then
      -- Venía de pública: su índice tiene posiciones y números. Se reindexa con las reglas de las restringidas.
      new.tsv_texto := null;
    elsif new.tsv_texto is not null then
      new.tsv_texto := strip(new.tsv_texto);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_vaciar_restringida() from public, anon, authenticated;

-- 2) Restringidas de V.B con números de 3 o más cifras en el índice
update public.publicaciones p
   set tsv_texto = null
 where p.seccion = '5B'
   and p.nivel_privacidad = 'restringido'
   and p.tsv_texto is not null
   and exists (select 1 from unnest(p.tsv_texto) l where l.lexeme ~ '[0-9*]{3,}');

-- 3) Variantes de ocupación de fincas que seguían públicas
update public.publicaciones
   set nivel_privacidad = 'restringido'
 where seccion = '5B'
   and nivel_privacidad = 'publico'
   and lower(public.f_unaccent(titulo)) ~ (
         'expropia|levantamiento (de )?(las )?actas|justiprecio'
      || '|necesidad de (la )?ocupacion|necesaria ocupacion|urgente ocupacion'
      || '|bienes (y(/o)? |o )?(derechos )?afectados|fincas afectadas|propietarios afectados|afecciones de (la|las) (parcela|finca)');
