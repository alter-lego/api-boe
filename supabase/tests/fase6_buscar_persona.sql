-- Pruebas de la migración 15: buscar_persona (nombre exacto en título o resumen; resto, «en el texto»).
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 15 migraciones.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
-- Los nombres son inventados. Las fechas futuras (2099) evitan mezclarse con publicaciones reales.
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);

insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad, resumen) values
  ('TEST-PER-1', 'BOE', '2099-01-05', '3', 'Real Decreto por el que se indulta a don Zacarías Herrero Quintanilla.', 'publico', 'Indulta a un condenado.'),
  ('TEST-PER-2', 'BOE', '2099-01-04', '3', 'Orden por la que se sanciona a doña Úrsula Herrera Quintanilla.', 'publico', 'Sanción a una particular.'),
  ('TEST-PER-3', 'BOE', '2099-01-03', '2A', 'Real Decreto por el que se nombra Director General.', 'publico', 'Nombra a Zacarías Herrero Quintanilla director general.'),
  ('TEST-PER-4', 'BOE', '2099-01-02', '2B', 'Resolución por la que se aprueba la lista de aspirantes.', 'restringido', null),
  ('TEST-PER-5', 'BOE', '2099-01-01', '3', 'Resolución sobre herreros y forja artesanal.', 'publico', 'Regula el oficio.');

-- Texto completo (solo índice): la lista restringida lleva el nombre en el cuerpo.
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Lista: Quintanilla Herrero, Zacarías; Pérez Gil, Ana.'))
 where id = 'TEST-PER-4';
update public.publicaciones set tsv_texto = to_tsvector('spanish', public.f_unaccent('Los herreros y la forja de Quintanilla.'))
 where id = 'TEST-PER-5';

do $$
declare r record; g text; n int; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  -- A) clasificación: exacto en título, exacto en resumen, el resto «texto»; la restringida, sin resumen
  for r in select coincidencia, total_grupo, (ficha).id as id, (ficha).resumen as resumen, (ficha).nivel_privacidad as nivel
             from public.buscar_persona('Zacarías HERRERO quintanilla', '2099-01-01', '2099-12-31') loop
    g := case r.id when 'TEST-PER-1' then 'titulo' when 'TEST-PER-3' then 'resumen' when 'TEST-PER-4' then 'texto' else 'ninguno' end;
    if g = 'ninguno' then raise exception 'FALLO: sale % y no tiene a esa persona', r.id; end if;
    if r.coincidencia <> g then raise exception 'FALLO: % clasificada como % (esperaba %)', r.id, r.coincidencia, g; end if;
    if r.nivel = 'restringido' and r.resumen is not null then raise exception 'FALLO: una restringida muestra resumen'; end if;
  end loop;
  select count(*) into n from public.buscar_persona('Zacarías Herrero Quintanilla', '2099-01-01', '2099-12-31');
  if n <> 3 then raise exception 'FALLO: esperaba 3 resultados y salen %', n; end if;

  -- B) orden: primero el título, luego el resumen, luego el texto
  select string_agg((ficha).id, ',') into g from public.buscar_persona('Zacarias Herrero Quintanilla', '2099-01-01', '2099-12-31');
  if g <> 'TEST-PER-1,TEST-PER-3,TEST-PER-4' then raise exception 'FALLO: orden inesperado %', g; end if;

  -- C) un apellido parecido no cuenta como exacto: «Herrero» no está en el título de Úrsula Herrera
  select coincidencia into g from public.buscar_persona('Herrero', '2099-01-01', '2099-12-31') where (ficha).id = 'TEST-PER-2';
  if g is not null and g <> 'texto' then raise exception 'FALLO: «Herrera» cuenta como «Herrero» exacto (%)', g; end if;
  select coincidencia into g from public.buscar_persona('Herrero', '2099-01-01', '2099-12-31') where (ficha).id = 'TEST-PER-5';
  if g is not null and g <> 'texto' then raise exception 'FALLO: «herreros» cuenta como «Herrero» exacto (%)', g; end if;

  -- D) total_grupo cuenta aunque el límite corte
  select total_grupo into n from public.buscar_persona('Quintanilla', '2099-01-01', '2099-12-31', null, 1);
  if n is null or n < 1 then raise exception 'FALLO: total_grupo vacío con límite 1'; end if;

  -- E) entradas no válidas
  foreach g in array array['a', 'x y', 'Pérez; drop table', '(.*)', 'uno dos tres cuatro cinco seis siete', 'de la'] loop
    begin
      perform * from public.buscar_persona(g);
      raise exception 'FALLO: acepta el nombre «%»', g;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
      if st <> '22023' then raise exception 'FALLO: «%» esperaba 22023 y salió %', g, st; end if;
    end;
  end loop;
  reset role;

  -- F) sin sesión vigente o fuera de la lista, no
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin
    perform * from public.buscar_persona('Quintanilla');
    raise exception 'FALLO: alguien fuera de la lista busca personas';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
    if st <> '42501' then raise exception 'FALLO: fuera de la lista esperaba 42501 y salió %', st; end if;
  end;
  reset role;
end $$;

-- G) permisos
do $$
begin
  if has_function_privilege('anon', 'public.buscar_persona(text, date, date, text, int)', 'execute') then raise exception 'FALLO: anon ejecuta buscar_persona'; end if;
  if not has_function_privilege('authenticated', 'public.buscar_persona(text, date, date, text, int)', 'execute') then raise exception 'FALLO: authenticated no puede ejecutar buscar_persona'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
