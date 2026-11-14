-- Fase 1 · Pruebas de seguridad y privacidad.
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 9 migraciones.
-- Mete filas de prueba, comprueba y deshace todo (rollback): no deja nada en la base de datos.
-- Si algo falla, sale un error que empieza por "FALLO". Si todo va bien, la última consulta
-- devuelve «TODAS LAS PRUEBAS OK».

begin;

-- Se desactiva el trigger que vacía las restringidas para probar las DOS capas por separado:
-- aquí la restringida entra CON resumen y la búsqueda/_ficha deben seguir sin filtrarlo.
alter table public.publicaciones disable trigger publicaciones_vaciar_restringida;

-- Datos de prueba (como postgres)
insert into public.periodistas (email, nombre) values ('prueba@test.local', 'Prueba');
insert into public.periodistas (email, nombre, activo) values ('baja@test.local', 'De baja', false);

insert into public.publicaciones
  (id, boletin, fecha, seccion, departamento, titulo, nivel_privacidad, resumen, temas, tipo_acto)
values
  ('TEST-PUB-1', 'BOE', current_date, '2A', 'Ministerio de Prueba',
   'Nombramiento de la directora general', 'publico',
   'Resumen público de la ficha', array['empleo'], 'nombramiento'),
  ('TEST-RES-1', 'BOE', current_date, '2B', 'Ministerio de Prueba',
   'Lista de admitidos a las pruebas selectivas', 'restringido',
   'CONTENIDO-SECRETO-NO-DEBE-SALIR', array['empleo'], 'convocatoria');
update public.publicaciones set referencias = '{"anteriores":["x"]}'::jsonb where id = 'TEST-RES-1';
update public.publicaciones set rango = 'Real Decreto', aviso_fuente = 'AVISO-PUBLICO', ficha_revisar = false,
  estatus_derogacion = 'N', judicialmente_anulada = false, vigencia_agotada = false, vigencia_actualizada = now()
  where id = 'TEST-PUB-1';
update public.publicaciones set rango = 'Resolución', aviso_fuente = 'AVISO-SECRETO', ficha_revisar = true,
  ficha_motivo_revision = 'MOTIVO-INTERNO', estatus_derogacion = 'N', judicialmente_anulada = false, vigencia_agotada = true,
  vigencia_actualizada = now()
  where id = 'TEST-RES-1';

-- Índice del texto completo (lo hace la ingesta): el nombre solo está en el CUERPO, no en el título
select public.indexar_texto('TEST-PUB-1', 'La directora general sustituta será doña Menganita Sánchez Ruiz-Pérez durante el periodo.');
select public.indexar_texto('TEST-RES-1', 'Relación de admitidos: Fulanito Gómez Peñalver, con DNI ***1234** en el anexo, y otros aspirantes.');

-- 1) anon no puede leer ninguna tabla ni ejecutar funciones de lectura
do $$ begin
  set local role anon;
  begin perform 1 from public.publicaciones limit 1;
    raise exception 'FALLO: anon lee publicaciones';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.periodistas limit 1;
    raise exception 'FALLO: anon lee periodistas';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: anon ejecuta buscar_publicaciones';
  exception when insufficient_privilege then null; end;
  perform 1 from public.ultima_ingesta();   -- esta sí está permitida
  reset role;
end $$;

-- 2) un usuario con sesión tampoco lee las tablas directamente
do $$ begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';
  begin perform 1 from public.publicaciones limit 1;
    raise exception 'FALLO: authenticated lee publicaciones directamente';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.consultas limit 1;
    raise exception 'FALLO: authenticated lee consultas directamente';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 3) con sesión pero fuera de la lista (o dado de baja): rechazado
do $$ begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"intruso@test.local"}';
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: un correo fuera de la lista puede buscar';
  exception when insufficient_privilege then null; end;
  set local request.jwt.claims = '{"role":"authenticated","email":"baja@test.local"}';
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: un periodista dado de baja puede buscar';
  exception when insufficient_privilege then null; end;
  begin perform public.registrar_consulta('x', 'm', 1, 1, 1, 0, 0, null, false);
    raise exception 'FALLO: un correo dado de baja puede registrar consultas';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 4) periodista autorizado: ve lo público completo y lo restringido sin contenido
do $$
declare
  r public.ficha_publicacion;
  n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';

  select count(*) into n from public.buscar_publicaciones(p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 2 then raise exception 'FALLO: debería ver 2 publicaciones de prueba y ve %', n; end if;

  select * into r from public.publicacion('TEST-PUB-1');
  if r.resumen is null or r.temas is null then
    raise exception 'FALLO: la ficha pública no trae resumen o temas'; end if;

  select * into r from public.publicacion('TEST-RES-1');
  if r.resumen is not null or r.temas is not null or r.tipo_acto is not null then
    raise exception 'FALLO: la publicación restringida filtra contenido'; end if;
  if r.titulo is null or r.nivel_privacidad <> 'restringido' then
    raise exception 'FALLO: la restringida debe seguir mostrando título y nivel'; end if;

  -- filtrar por tema solo alcanza fichas públicas
  select count(*) into n from public.buscar_publicaciones(p_temas => array['empleo'], p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 1 then raise exception 'FALLO: el filtro por tema debe devolver solo la pública y devuelve %', n; end if;

  -- la búsqueda por palabras no encuentra el texto del resumen restringido...
  select count(*) into n from public.buscar_publicaciones(p_q => 'CONTENIDO-SECRETO', p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 0 then raise exception 'FALLO: la búsqueda llega al resumen de una restringida'; end if;
  select count(*) into n from public.buscar_publicaciones(p_q => 'secreto', p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 0 then raise exception 'FALLO: la búsqueda llega al resumen de una restringida (palabra suelta)'; end if;
  select coalesce(sum(c.n), 0) into n from public.contar_publicaciones(p_q => 'secreto', p_departamento => 'Ministerio de Prueba') c;
  if n <> 0 then raise exception 'FALLO: contar llega al resumen de una restringida'; end if;
  -- ...pero sí encuentra su título, sin tildes
  select count(*) into n from public.buscar_publicaciones(p_q => 'admitidos selectivas', p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 1 then raise exception 'FALLO: no encuentra la restringida por su título (%)', n; end if;
  select count(*) into n from public.buscar_publicaciones(p_q => 'nombramiento directora', p_departamento => 'Ministerio de Prueba')
   where id like 'TEST-%';
  if n <> 1 then raise exception 'FALLO: no encuentra la pública por palabras (%)', n; end if;

  -- contar
  select sum(c.n) into n from public.contar_publicaciones(p_departamento => 'Ministerio de Prueba', p_agrupar => 'tipo_acto') c;
  if n < 2 then raise exception 'FALLO: contar_publicaciones devuelve menos de 2'; end if;
  -- la restringida (título «...admitidos...») se cuenta como «sin clasificar», no como «convocatoria»
  select c.n into n from public.contar_publicaciones(p_q => 'admitidos selectivas', p_departamento => 'Ministerio de Prueba', p_agrupar => 'tipo_acto') c
   where c.grupo = 'sin clasificar';
  if n is distinct from 1 then
    raise exception 'FALLO: contar no oculta el tipo de acto de la restringida (%)', n; end if;

  -- registrar y contar consultas del día
  perform public.registrar_consulta('pregunta de prueba', 'haiku', 1, 100, 10, 0, 0.001, array['TEST-PUB-1'], false);
  select usadas into n from public.consultas_de_hoy();
  if n <> 1 then raise exception 'FALLO: consultas_de_hoy debería dar 1 y da %', n; end if;

  reset role;
end $$;

-- 4b) buscar un nombre que solo está en el cuerpo: se encuentra, y de una restringida solo sale el enlace
do $$
declare
  r public.ficha_publicacion;
  n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';

  -- pública: se encuentra por un nombre del cuerpo, con o sin tildes
  select count(*) into n from public.buscar_publicaciones(p_q => 'Menganita Sanchez', p_departamento => 'Ministerio de Prueba') where id = 'TEST-PUB-1';
  if n <> 1 then raise exception 'FALLO: no encuentra a un nombre del cuerpo de una pública (%)', n; end if;
  select count(*) into n from public.buscar_publicaciones(p_q => 'Sánchez Ruiz-Pérez', p_departamento => 'Ministerio de Prueba') where id = 'TEST-PUB-1';
  if n <> 1 then raise exception 'FALLO: no encuentra el apellido compuesto con tilde (%)', n; end if;

  -- restringida: se encuentra por el nombre del cuerpo...
  select * into r from public.buscar_publicaciones(p_q => 'Fulanito Gomez Penalver', p_departamento => 'Ministerio de Prueba') where id = 'TEST-RES-1';
  if r.id is null then raise exception 'FALLO: no encuentra el nombre del cuerpo de una restringida'; end if;
  -- ...pero lo único que sale es título, metadatos y enlaces
  if r.resumen is not null or r.temas is not null or r.tipo_acto is not null or r.referencias is not null then
    raise exception 'FALLO: una restringida encontrada por el cuerpo filtra contenido'; end if;
  if r.titulo is null or r.nivel_privacidad <> 'restringido' then
    raise exception 'FALLO: la restringida encontrada debe mostrar título y nivel'; end if;

  -- contar también las cuenta
  select coalesce(sum(c.n), 0) into n from public.contar_publicaciones(p_q => 'Fulanito', p_departamento => 'Ministerio de Prueba') c;
  if n <> 1 then raise exception 'FALLO: contar no cuenta la restringida encontrada por el cuerpo (%)', n; end if;

  -- un nombre que no está en ningún texto no devuelve nada
  select count(*) into n from public.buscar_publicaciones(p_q => 'Zzyzxqwerty', p_departamento => 'Ministerio de Prueba') where id like 'TEST-%';
  if n <> 0 then raise exception 'FALLO: devuelve resultados para un nombre inexistente'; end if;

  -- los periodistas no pueden indexar ni medir
  begin perform public.indexar_texto('TEST-PUB-1', 'x');
    raise exception 'FALLO: authenticated ejecuta indexar_texto';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.medir_indice();
    raise exception 'FALLO: authenticated ejecuta medir_indice';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 5) service_role (ingesta) puede escribir; la generación de tsv funciona con tildes
do $$
declare n int;
begin
  set local role service_role;
  insert into public.publicaciones (id, boletin, fecha, titulo)
  values ('TEST-SVC-1', 'BOE', current_date, 'Resolución sobre la prórroga de ayudas a la vivienda');
  select count(*) into n from public.publicaciones where tsv @@ websearch_to_tsquery('spanish', public.f_unaccent('prorroga vivienda'));
  if n < 1 then raise exception 'FALLO: la búsqueda sin tildes no encuentra «prórroga»'; end if;
  reset role;
end $$;

-- 6) el trigger vacía la ficha de una restringida (segunda capa)
alter table public.publicaciones enable trigger publicaciones_vaciar_restringida;
do $$
declare r public.publicaciones;
begin
  insert into public.publicaciones (id, boletin, fecha, titulo, nivel_privacidad, resumen, temas, tipo_acto)
  values ('TEST-RES-2', 'BOE', current_date, 'Otra restringida', 'restringido', 'x', array['y'], 'z')
  returning * into r;
  if r.resumen is not null or r.temas is not null or r.tipo_acto is not null then
    raise exception 'FALLO: el trigger no vacía la ficha de una restringida'; end if;
end $$;

-- 7) lista blanca de funciones ejecutables (cubre también las que se creen en el futuro)
do $$
declare lista text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into lista
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'ultima_ingesta' then
    raise exception 'FALLO: anon puede ejecutar: %', coalesce(lista, '(ninguna)'); end if;

  select string_agg(p.proname, ', ' order by p.proname) into lista
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if lista is distinct from
     'buscar_publicaciones, consultas_de_hoy, contar_publicaciones, publicacion, registrar_consulta, sumario_del_dia, ultima_ingesta' then
    raise exception 'FALLO: authenticated puede ejecutar: %', lista; end if;
end $$;

-- 8) búsqueda con solo palabras vacías: error claro, no «0 resultados»
do $$ begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';
  begin perform 1 from public.buscar_publicaciones(p_q => 'de la');
    raise exception 'FALLO: una búsqueda solo con palabras vacías no da error';
  exception when invalid_parameter_value then null; end;
  reset role;
end $$;

-- 9) endurecimiento del índice (migración 8)
do $$
declare n int; t text; ok boolean;
begin
  -- la restringida guarda el índice SIN posiciones; la pública, con ellas
  select tsv_texto::text into t from public.publicaciones where id = 'TEST-RES-1';
  if t like '%:%' then raise exception 'FALLO: el índice de una restringida conserva posiciones'; end if;
  select tsv_texto::text into t from public.publicaciones where id = 'TEST-PUB-1';
  if t not like '%:%' then raise exception 'FALLO: el índice de una pública debería conservar posiciones'; end if;
  -- no se indexan los números enmascarados
  if (select tsv_texto::text from public.publicaciones where id = 'TEST-RES-1') like '%1234%' then
    raise exception 'FALLO: se indexó un número de la restringida'; end if;

  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';
  -- una frase entre comillas sigue encontrando la restringida (se trata como «y»), sin reconstruir texto
  select count(*) into n from public.buscar_publicaciones(p_q => '"Fulanito Gomez"', p_departamento => 'Ministerio de Prueba') where id = 'TEST-RES-1';
  if n <> 1 then raise exception 'FALLO: la frase entre comillas no encuentra la restringida (%)', n; end if;
  -- el número enmascarado no sirve para confirmar a la persona
  select count(*) into n from public.buscar_publicaciones(p_q => 'Fulanito 1234', p_departamento => 'Ministerio de Prueba') where id = 'TEST-RES-1';
  if n <> 0 then raise exception 'FALLO: un número enmascarado encuentra la restringida'; end if;
  -- solo exclusiones: error
  begin perform 1 from public.buscar_publicaciones(p_q => '-Fulanito');
    raise exception 'FALLO: una búsqueda solo con exclusiones no da error';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.contar_publicaciones(p_q => '-Fulanito');
    raise exception 'FALLO: contar solo con exclusiones no da error';
  exception when invalid_parameter_value then null; end;
  reset role;

  -- service_role sí puede indexar y medir; un id inexistente devuelve false
  set local role service_role;
  select public.indexar_texto('TEST-PUB-1', 'Texto nuevo con Zorrilla Quintanilla.') into ok;
  if ok is not true then raise exception 'FALLO: service_role no puede indexar'; end if;
  select public.indexar_texto('NO-EXISTE', 'x') into ok;
  if ok is not false then raise exception 'FALLO: indexar un id inexistente debe devolver false'; end if;
  perform 1 from public.medir_indice();
  reset role;
  -- un texto muy largo (más de 300.000 caracteres) se indexa sin fallar
  select public.indexar_texto('TEST-PUB-1', repeat('palabra distinta número uno ', 30000)) into ok;
  if ok is not true then raise exception 'FALLO: no se indexa un texto muy largo'; end if;
end $$;

-- 10) migración 9: vigencia, avisos y filtro por rango
do $$
declare r public.ficha_publicacion; n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"prueba@test.local"}';

  -- pública: sale todo, incluido el aviso y la vigencia
  select * into r from public.publicacion('TEST-PUB-1');
  if r.aviso_fuente is distinct from 'AVISO-PUBLICO' or r.estatus_derogacion is distinct from 'N'
     or r.ficha_revisar is distinct from false or r.vigencia_actualizada is null then
    raise exception 'FALLO: una pública no devuelve aviso/vigencia'; end if;

  -- restringida: la vigencia (metadato oficial) sale; el aviso y «a revisar» NO
  select * into r from public.publicacion('TEST-RES-1');
  if r.vigencia_agotada is distinct from true or r.estatus_derogacion is distinct from 'N' then
    raise exception 'FALLO: una restringida no devuelve la vigencia'; end if;
  if r.aviso_fuente is not null or r.ficha_revisar is not null then
    raise exception 'FALLO: una restringida filtra aviso_fuente o ficha_revisar'; end if;
  if row_to_json(r)::text like '%AVISO-SECRETO%' or row_to_json(r)::text like '%MOTIVO-INTERNO%' then
    raise exception 'FALLO: la ficha de una restringida contiene texto interno'; end if;
  -- el motivo interno no existe en el tipo
  if to_jsonb(r) ? 'ficha_motivo_revision' then raise exception 'FALLO: se expone ficha_motivo_revision'; end if;

  -- filtro por rango (sin tildes ni mayúsculas)
  select count(*) into n from public.buscar_publicaciones(p_rango => 'real decreto', p_departamento => 'Ministerio de Prueba');
  if n <> 1 then raise exception 'FALLO: el filtro por rango «real decreto» devuelve % y debería ser 1', n; end if;
  select count(*) into n from public.buscar_publicaciones(p_rango => 'RESOLUCION', p_departamento => 'Ministerio de Prueba');
  if n <> 1 then raise exception 'FALLO: el filtro por rango sin tildes devuelve % y debería ser 1', n; end if;
  select coalesce(sum(c.n), 0) into n from public.contar_publicaciones(p_rango => 'Real Decreto', p_departamento => 'Ministerio de Prueba') c;
  if n <> 1 then raise exception 'FALLO: contar con rango devuelve %', n; end if;
  reset role;

  -- no quedan sobrecargas antiguas (la lista blanca no debe repetir nombres)
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('buscar_publicaciones', 'contar_publicaciones')) <> 2 then
    raise exception 'FALLO: hay sobrecargas de buscar/contar'; end if;
end $$;

rollback;

select 'TODAS LAS PRUEBAS OK' as resultado;
