-- Pruebas de la migración 20: al pasar de pública a restringida se vacía el índice; la limpieza de números;
-- las variantes nuevas de ocupación de V.B se reclasifican.
-- Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 20.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
-- Nombres y publicaciones inventados, con fecha de 2099.
begin;

insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad, resumen) values
  ('TEST-VAC-1', 'BOE', '2099-04-01', '5B', 'Anuncio de la Confederación Hidrográfica de prueba para el levantamiento de las actas previas a la ocupación de los bienes y/o derechos afectados.', 'publico', 'Resumen de prueba.'),
  ('TEST-VAC-2', 'BOE', '2099-04-01', '5B', 'Anuncio por el que se somete a información pública el proyecto Y, así como la relación de bienes y derechos de necesaria ocupación.', 'publico', 'Resumen de prueba.'),
  ('TEST-VAC-3', 'BOE', '2099-04-01', '5B', 'Anuncio de la Autoridad Portuaria de prueba de concesión de ocupación de dominio público portuario.', 'publico', 'Resumen de prueba.'),
  ('TEST-VAC-4', 'BOE', '2099-04-01', '5B', 'Anuncio de subasta de prueba.', 'restringido', null),
  ('TEST-VAC-5', 'BOE', '2099-04-01', '3', 'Resolución de prueba sobre el justiprecio.', 'publico', 'Resumen de prueba.');

-- Índices como los de una pública (con posiciones y números)
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Finca 123: Zacarías Herrero Quintanilla, DNI ***4567**.'))
 where id in ('TEST-VAC-1', 'TEST-VAC-2', 'TEST-VAC-3', 'TEST-VAC-5');
-- Una restringida con números en el índice (como las reclasificadas por la migración 16): el trigger no la
-- toca (ya era restringida), así que se mete el índice sin pasar por indexar_texto.
alter table public.publicaciones disable trigger publicaciones_vaciar_restringida;
update public.publicaciones set tsv_texto = strip(to_tsvector('spanish', 'finca 123 herrero')) where id = 'TEST-VAC-4';
alter table public.publicaciones enable trigger publicaciones_vaciar_restringida;

-- Los pasos 2 y 3 de la migración 20, iguales
update public.publicaciones p
   set tsv_texto = null
 where p.seccion = '5B' and p.nivel_privacidad = 'restringido' and p.tsv_texto is not null
   and exists (select 1 from unnest(p.tsv_texto) l where l.lexeme ~ '[0-9*]{3,}');
update public.publicaciones
   set nivel_privacidad = 'restringido'
 where seccion = '5B' and nivel_privacidad = 'publico'
   and lower(public.f_unaccent(titulo)) ~ (
         'expropia|levantamiento (de )?(las )?actas|justiprecio'
      || '|necesidad de (la )?ocupacion|necesaria ocupacion|urgente ocupacion'
      || '|bienes (y(/o)? |o )?(derechos )?afectados|fincas afectadas|propietarios afectados|afecciones de (la|las) (parcela|finca)');

do $$
declare r record; n int;
begin
  -- A) las variantes nuevas pasan a restringidas, sin ficha y con el índice vacío
  for r in select * from public.publicaciones where id in ('TEST-VAC-1', 'TEST-VAC-2') loop
    if r.nivel_privacidad <> 'restringido' then raise exception 'FALLO: % sigue pública', r.id; end if;
    if r.resumen is not null then raise exception 'FALLO: % conserva el resumen', r.id; end if;
    if r.tsv_texto is not null then raise exception 'FALLO: % conserva el índice de cuando era pública', r.id; end if;
  end loop;

  -- B) lo que no toca: concesión portuaria (V.B) y sección III, aunque diga «justiprecio»
  select count(*) into n from public.publicaciones
   where id in ('TEST-VAC-3', 'TEST-VAC-5') and nivel_privacidad = 'publico' and resumen is not null and tsv_texto is not null;
  if n <> 2 then raise exception 'FALLO: se ha tocado algo que debía seguir público'; end if;

  -- C) la restringida con números en el índice se vacía
  select count(*) into n from public.publicaciones where id = 'TEST-VAC-4' and tsv_texto is null;
  if n <> 1 then raise exception 'FALLO: una restringida conserva números de 3 o más cifras en el índice'; end if;

  -- D) al reindexarla (fichas.js --restringidas) queda sin posiciones y sin números
  perform public.indexar_texto('TEST-VAC-1', 'Finca 123: Zacarías Herrero Quintanilla, DNI ***4567**.');
  select * into r from public.publicaciones where id = 'TEST-VAC-1';
  if r.tsv_texto is null then raise exception 'FALLO: indexar_texto no reindexa la restringida'; end if;
  if r.tsv_texto <> strip(r.tsv_texto) then raise exception 'FALLO: la restringida reindexada tiene posiciones'; end if;
  if exists (select 1 from unnest(r.tsv_texto) l where l.lexeme ~ '[0-9*]{3,}') then
    raise exception 'FALLO: la restringida reindexada conserva números'; end if;
  if not r.tsv_texto @@ to_tsquery('spanish', 'herrero') then raise exception 'FALLO: la reindexada no se encuentra por el apellido'; end if;

  -- E) una actualización cualquiera de una restringida ya indexada no le vacía el índice
  update public.publicaciones set titulo = titulo || ' ' where id = 'TEST-VAC-1';
  select count(*) into n from public.publicaciones where id = 'TEST-VAC-1' and tsv_texto is not null;
  if n <> 1 then raise exception 'FALLO: actualizar una restringida le vacía el índice'; end if;

  -- F) insertar una restringida con índice: se queda, sin posiciones
  insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad, tsv_texto)
  values ('TEST-VAC-6', 'BOE', '2099-04-01', '4', 'Edicto de prueba.', 'restringido', to_tsvector('spanish', 'uno dos'));
  select count(*) into n from public.publicaciones where id = 'TEST-VAC-6' and tsv_texto is not null and tsv_texto = strip(tsv_texto);
  if n <> 1 then raise exception 'FALLO: al insertar una restringida no se le quitan las posiciones'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
