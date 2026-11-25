-- Pruebas de la migración 16: reclasificar a restringidas las «necesidad de ocupación» de V.B.
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de la migración 16.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
-- Publicaciones inventadas con fecha de 2099; la migración se vuelve a ejecutar sobre ellas.
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);

insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad, resumen, temas, tipo_acto) values
  ('TEST-OCU-1', 'BOE', '2099-02-01', '5B', 'Anuncio de ADIF por el que se somete a información pública a efectos de declaración de la necesidad de ocupación el Proyecto X.', 'publico', 'Resumen de prueba.', array['transporte_y_movilidad'], 'informacion_publica'),
  ('TEST-OCU-2', 'BOE', '2099-02-01', '5B', 'Anuncio por el que se publica la relación de BIENES Y DERECHOS AFECTADOS por la obra Y.', 'publico', 'Resumen de prueba.', array['transporte_y_movilidad'], 'informacion_publica'),
  ('TEST-OCU-3', 'BOE', '2099-02-01', '5B', 'Anuncio de autorización y declaración, en concreto, de utilidad pública del parque eólico Z.', 'publico', 'Resumen de prueba.', array['energia'], 'informacion_publica'),
  ('TEST-OCU-4', 'BOE', '2099-02-01', '3', 'Resolución sobre la necesidad de ocupación de una sede ministerial.', 'publico', 'Resumen de prueba.', array['otros'], 'otros');
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Relación de afectados: Zacarías Herrero Quintanilla, finca 12.'))
 where id in ('TEST-OCU-1', 'TEST-OCU-2');

-- La misma sentencia que la migración 16
update public.publicaciones
   set nivel_privacidad = 'restringido'
 where seccion = '5B'
   and nivel_privacidad = 'publico'
   and lower(public.f_unaccent(titulo)) ~ 'necesidad de (la )?ocupacion|bienes y derechos afectados';

do $$
declare r record; n int;
begin
  -- A) las de V.B con ocupación o bienes afectados pasan a restringidas, sin ficha y sin posiciones
  for r in select * from public.publicaciones where id in ('TEST-OCU-1', 'TEST-OCU-2') loop
    if r.nivel_privacidad <> 'restringido' then raise exception 'FALLO: % sigue pública', r.id; end if;
    if r.resumen is not null or r.temas is not null or r.tipo_acto is not null then raise exception 'FALLO: % conserva la ficha', r.id; end if;
    if r.tsv_texto is null then raise exception 'FALLO: % pierde el índice (debe seguir encontrándose)', r.id; end if;
    if r.tsv_texto <> strip(r.tsv_texto) then raise exception 'FALLO: % conserva las posiciones del texto', r.id; end if;
  end loop;

  -- B) lo que no toca: «utilidad pública» de V.B y la sección III
  select count(*) into n from public.publicaciones where id in ('TEST-OCU-3', 'TEST-OCU-4') and nivel_privacidad = 'publico' and resumen is not null;
  if n <> 2 then raise exception 'FALLO: se ha reclasificado algo que debía seguir público'; end if;

  -- C) por la API: se encuentra por el nombre, pero solo con título y enlace
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  for r in select (ficha).id as id, (ficha).resumen as resumen, (ficha).nivel_privacidad as nivel
             from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31') loop
    if r.nivel <> 'restringido' or r.resumen is not null then raise exception 'FALLO: % se muestra como pública', r.id; end if;
  end loop;
  select count(*) into n from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31');
  if n <> 2 then raise exception 'FALLO: las reclasificadas no se encuentran por el nombre (% resultados)', n; end if;
  reset role;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
