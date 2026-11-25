-- Pruebas de las migraciones 17 y 18: buscar_persona devuelve las públicas con el nombre seguido en el texto
-- ('seguido'), descarta las públicas con las palabras sueltas y deja las restringidas en su grupo ('restringida').
-- Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 18.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
-- Nombres y publicaciones inventados, con fecha de 2099.
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);

insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad, resumen) values
  ('TEST-SEG-1', 'BOE', '2099-03-05', '3', 'Candidaturas proclamadas (prueba).', 'publico', 'Listas de candidatos.'),
  ('TEST-SEG-2', 'BOE', '2099-03-04', '3', 'Relación de admitidos (prueba).', 'publico', 'Lista de admitidos.'),
  ('TEST-SEG-3', 'BOE', '2099-03-03', '3', 'Candidaturas presentadas (prueba).', 'publico', 'Listas de candidatos.'),
  ('TEST-SEG-4', 'BOE', '2099-03-02', '2B', 'Lista de aspirantes (prueba).', 'restringido', null);

-- Seguido, nombre delante
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('1. Doña Ana Gil. 2. Don Zacarías Herrero Quintanilla. 3. Don Pedro Ruiz.')) where id = 'TEST-SEG-1';
-- Seguido, apellidos delante y coma
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Admitidos: GIL RUIZ, Ana; HERRERO QUINTANILLA, Zacarías; RUIZ PÉREZ, Pedro.')) where id = 'TEST-SEG-2';
-- Palabras sueltas en personas distintas
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('1. Zacarías Gil Pérez. 2. Marta Herrero Ruiz. 3. Luis Quintanilla Sanz.')) where id = 'TEST-SEG-3';
-- Restringida con el nombre seguido: nunca 'seguido' (sin posiciones, por privacidad)
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Don Zacarías Herrero Quintanilla, admitido.')) where id = 'TEST-SEG-4';

do $$
declare r record; g text; n int;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  -- A) clasificación
  for r in select coincidencia, (ficha).id as id
             from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31') loop
    g := case r.id when 'TEST-SEG-1' then 'seguido' when 'TEST-SEG-2' then 'seguido'
                   when 'TEST-SEG-3' then 'descartada' when 'TEST-SEG-4' then 'restringida' else 'ninguno' end;
    if g = 'descartada' then raise exception 'FALLO: una pública con las palabras sueltas sigue saliendo'; end if;
    if g = 'ninguno' then continue; end if;   -- puede haber publicaciones reales de 2099: no las hay, pero no fallar por ellas
    if r.coincidencia <> g then raise exception 'FALLO: % clasificada como % (esperaba %)', r.id, r.coincidencia, g; end if;
  end loop;
  select count(*) into n from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31')
   where (ficha).id like 'TEST-SEG-%';
  if n <> 3 then raise exception 'FALLO: esperaba 3 resultados de prueba (sin la de palabras sueltas) y salen %', n; end if;

  -- B) orden: 'seguido' antes que 'restringida'
  select string_agg(coincidencia, ',') into g from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31');
  if g <> 'seguido,seguido,restringida' then raise exception 'FALLO: orden de grupos inesperado %', g; end if;

  -- C) con una sola palabra, toda pública que la contenga cuenta (no hay «sueltas» posibles)
  select count(*) into n from public.buscar_persona('Quintanilla', '2099-01-01', '2099-12-31') where coincidencia = 'seguido' and (ficha).id like 'TEST-SEG-%';
  if n <> 3 then raise exception 'FALLO: con una sola palabra esperaba 3 públicas y salen %', n; end if;

  -- D) dos palabras en orden inverso también cuentan como seguidas
  select coincidencia into g from public.buscar_persona('Quintanilla Herrero', '2099-01-01', '2099-12-31') where (ficha).id = 'TEST-SEG-1';
  if g is distinct from 'seguido' then raise exception 'FALLO: «Quintanilla Herrero» no se reconoce como seguido (%)', g; end if;
  reset role;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
