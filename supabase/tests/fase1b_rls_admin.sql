-- Pruebas de las migraciones 10 y 11: RLS (segunda barrera), rol admin, sesión vigente y permisos.
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 12 migraciones.
-- Mete filas de prueba, comprueba y deshace todo (rollback). Si algo falla, el error empieza por
-- "FALLO". Si todo va bien, la última consulta devuelve «TODAS LAS PRUEBAS OK».
-- (El SQL Editor ejecuta el lote y se detiene en el primer error. Con psql: `-v ON_ERROR_STOP=1`.)
-- Es independiente de fase1_seguridad.sql: ejecutar las dos.

begin;

alter table public.publicaciones disable trigger publicaciones_vaciar_restringida;

-- ───────── Datos de prueba (como postgres) ─────────
-- Si ya existe un admin real, se le quita el rol SOLO dentro de esta transacción (se deshace con el
-- rollback): así las pruebas del «último admin» no dependen de quién haya en la base.
update public.periodistas set es_admin = false where es_admin and email not like '%@test.local';

insert into public.periodistas (email, nombre, es_admin, activo) values
  ('admin@test.local',     'Admin',          true,  true),
  ('prueba@test.local',    'Periodista',     false, true),
  ('otra@test.local',      'Otra',           false, true),
  ('baja@test.local',      'De baja',        false, false),
  ('bajaadmin@test.local', 'Admin de baja',  true,  false);

insert into public.publicaciones (id, boletin, fecha, seccion, departamento, titulo, nivel_privacidad, resumen, temas, tipo_acto)
values
  ('TEST-PUB-1', 'BOE', current_date, '2A', 'Ministerio de Prueba', 'Nombramiento de la directora general', 'publico',
   'Resumen público', array['empleo'], 'nombramiento'),
  ('TEST-RES-1', 'BOE', current_date, '2B', 'Ministerio de Prueba', 'Lista de admitidos a las pruebas selectivas', 'restringido',
   'CONTENIDO-SECRETO-NO-DEBE-SALIR', array['empleo'], 'convocatoria');
select public.indexar_texto('TEST-PUB-1', 'Texto de la pública con la directora Menganita Sánchez.');
select public.indexar_texto('TEST-RES-1', 'Admitidos: Fulanito Gómez Peñalver y otros aspirantes.');

insert into public.consultas (usuario, pregunta) values
  ('prueba@test.local', 'pregunta de prueba'),
  ('otra@test.local',   'pregunta de otra');

-- ───────── A) Simulamos un GRANT por error: ¿aguanta la RLS? ─────────
-- (Hoy no hay permisos de tabla; esto prueba que las políticas son una barrera real.)
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.periodistas, public.consultas, public.publicaciones to authenticated;

-- A1) anon: cero filas y no puede escribir
do $$
declare n int; t text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  set local role anon;
  foreach t in array array['publicaciones','periodistas','consultas','boletines','sumarios','periodistas_log','ingestas'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'FALLO: anon ve % filas de %', n, t; end if;
  end loop;
  begin insert into public.periodistas (email) values ('anon@test.local');
    raise exception 'FALLO: anon inserta en periodistas';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- A2) con sesión pero fuera de la lista, de baja, o admin de baja: cero filas, sin escritura
do $$
declare n int; t text; e text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  foreach e in array array['intruso@test.local','baja@test.local','bajaadmin@test.local'] loop
    perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',e,'amr',json_build_array(json_build_object('method','otp','timestamp',4102444800)))::text, true);
    set local role authenticated;
    foreach t in array array['publicaciones','periodistas','consultas','boletines','sumarios','periodistas_log','ingestas'] loop
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception 'FALLO: % ve % filas de %', e, n, t; end if;
    end loop;
    begin insert into public.periodistas (email, es_admin) values ('nuevo@test.local', true);
      raise exception 'FALLO: % inserta en periodistas', e;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- A3) periodista normal: solo lo suyo, solo lo público, sin escritura
do $$
declare n int; filas int; t text; l text; plan text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"prueba@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  -- rendimiento: las funciones de las políticas se evalúan UNA vez por consulta (InitPlan),
  -- no una vez por fila (SubPlan o filtro con llamada directa).
  foreach t in array array['publicaciones','periodistas','consultas'] loop
    plan := '';
    for l in execute format('explain select * from public.%I', t) loop plan := plan || l || E'\n'; end loop;
    if plan not like '%InitPlan%' then
      raise exception 'FALLO: la política de % no usa InitPlan: %', t, plan; end if;
    if plan like '%SubPlan%' then
      raise exception 'FALLO: la política de % se evalúa por fila (SubPlan): %', t, plan; end if;
  end loop;

  select count(*) into n from public.publicaciones where id like 'TEST-%';
  if n <> 1 then raise exception 'FALLO: por vía directa debería ver solo la pública y ve %', n; end if;
  select count(*) into n from public.publicaciones where id = 'TEST-RES-1';
  if n <> 0 then raise exception 'FALLO: ve una restringida por vía directa'; end if;
  select count(*) into n from public.publicaciones where tsv_texto @@ to_tsquery('spanish', 'fulanito');
  if n <> 0 then raise exception 'FALLO: llega al tsv_texto de una restringida por vía directa'; end if;
  select count(*) into n from public.publicaciones where resumen like '%SECRETO%';
  if n <> 0 then raise exception 'FALLO: llega al resumen de una restringida por vía directa'; end if;

  select count(*) into n from public.periodistas;
  if n <> 1 then raise exception 'FALLO: un periodista ve % filas de periodistas (debería ser 1)', n; end if;
  select count(*) into n from public.consultas;
  if n <> 1 then raise exception 'FALLO: ve % consultas (debería ser 1, la suya)', n; end if;
  select count(*) into n from public.consultas where usuario = 'otra@test.local';
  if n <> 0 then raise exception 'FALLO: ve consultas de otro periodista'; end if;
  select count(*) into n from public.periodistas_log;
  if n <> 0 then raise exception 'FALLO: un periodista ve el log de auditoría'; end if;

  -- no puede hacerse admin, ni darse de alta, ni tocar las consultas
  begin insert into public.periodistas (email) values ('colado@test.local');
    raise exception 'FALLO: un periodista inserta en periodistas';
  exception when insufficient_privilege then null; end;
  update public.periodistas set es_admin = true where email = 'prueba@test.local';
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista se hace admin'; end if;
  update public.periodistas set limite_diario = 9999 where email = 'prueba@test.local';
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista cambia su límite'; end if;
  delete from public.periodistas where email = 'otra@test.local';
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista borra periodistas'; end if;
  update public.consultas set pregunta = 'manipulada';
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista modifica consultas'; end if;
  delete from public.consultas;
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista borra consultas'; end if;
  update public.publicaciones set titulo = 'manipulado';
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista modifica publicaciones'; end if;
  delete from public.publicaciones;
  get diagnostics filas = row_count;
  if filas <> 0 then raise exception 'FALLO: un periodista borra publicaciones'; end if;
  reset role;
end $$;

-- A4) admin: ve todos los periodistas y el log, pero no las consultas de otros
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.periodistas where email like '%@test.local';
  if n <> 5 then raise exception 'FALLO: el admin debería ver 5 periodistas y ve %', n; end if;
  select count(*) into n from public.periodistas_log;
  if n < 1 then raise exception 'FALLO: el admin no ve el log'; end if;
  select count(*) into n from public.consultas;
  if n <> 0 then raise exception 'FALLO: el admin ve % consultas de otros', n; end if;
  select count(*) into n from public.publicaciones where id = 'TEST-RES-1';
  if n <> 0 then raise exception 'FALLO: el admin ve una restringida por vía directa'; end if;
  reset role;
end $$;

-- Se retira el GRANT simulado: a partir de aquí, el estado real
revoke select on all tables in schema public from anon, authenticated;
revoke insert, update, delete on public.periodistas, public.consultas, public.publicaciones from authenticated;

do $$ begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  if has_table_privilege('authenticated', 'public.publicaciones', 'select')
     or has_table_privilege('authenticated', 'public.periodistas', 'select')
     or has_table_privilege('anon', 'public.periodistas_log', 'select') then
    raise exception 'FALLO: quedan permisos de tabla abiertos';
  end if;
end $$;

-- ───────── B) Estado real: sin permisos de tabla, todo por funciones ─────────

-- B1) acceso directo denegado, incluida la nueva tabla de log
do $$
declare t text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  foreach t in array array['publicaciones','periodistas','consultas','periodistas_log','sumarios','boletines','ingestas'] loop
    begin execute format('select 1 from public.%I limit 1', t);
      raise exception 'FALLO: authenticated (incluso admin) lee % directamente', t;
    exception when insufficient_privilege then null; end;
  end loop;
  reset role;
end $$;

-- B2) quién puede llamar a las funciones admin_*
do $$
declare e text; f text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  -- anon: sin EXECUTE
  set local role anon;
  begin perform public.es_admin();
    raise exception 'FALLO: anon ejecuta es_admin';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_listar_periodistas();
    raise exception 'FALLO: anon ejecuta admin_listar_periodistas';
  exception when insufficient_privilege then null; end;
  reset role;

  -- periodista normal, fuera de lista, de baja y admin de baja: «no autorizado»
  foreach e in array array['prueba@test.local','intruso@test.local','baja@test.local','bajaadmin@test.local'] loop
    perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',e,'amr',json_build_array(json_build_object('method','otp','timestamp',4102444800)))::text, true);
    set local role authenticated;
    if public.es_admin() then raise exception 'FALLO: es_admin da true para %', e; end if;
    begin perform 1 from public.admin_listar_periodistas();
      raise exception 'FALLO: % lista periodistas', e;
    exception when insufficient_privilege then null; end;
    begin perform 1 from public.admin_alta_periodista('colado@test.local');
      raise exception 'FALLO: % da de alta', e;
    exception when insufficient_privilege then null; end;
    begin perform 1 from public.admin_modificar_periodista('prueba@test.local', p_es_admin => true);
      raise exception 'FALLO: % modifica periodistas', e;
    exception when insufficient_privilege then null; end;
    begin perform 1 from public.admin_ver_log();
      raise exception 'FALLO: % lee el log', e;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;

  -- un admin activo sí
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  if not public.es_admin() then raise exception 'FALLO: es_admin da false para el admin'; end if;
  reset role;
end $$;

-- B3) alta: normaliza el correo, valida, audita y activa al instante
do $$
declare r record; n int; a text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  select * into r from public.admin_alta_periodista('  Nueva@Test.LOCAL ', '  Nueva Persona ', 12);
  if r.email <> 'nueva@test.local' or r.nombre <> 'Nueva Persona' or r.limite_diario <> 12
     or r.activo is not true or r.es_admin is not false then
    raise exception 'FALLO: el alta no normaliza o no devuelve la fila (%)', r; end if;

  begin perform 1 from public.admin_alta_periodista('nueva@test.local');
    raise exception 'FALLO: permite un alta duplicada';
  exception when unique_violation then null; end;
  begin perform 1 from public.admin_alta_periodista('NUEVA@test.local');
    raise exception 'FALLO: permite un alta duplicada con otra capitalización';
  exception when unique_violation then null; end;
  begin perform 1 from public.admin_alta_periodista('sin-arroba');
    raise exception 'FALLO: acepta un correo sin arroba';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('a b@test.local');
    raise exception 'FALLO: acepta un correo con espacios';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista(null);
    raise exception 'FALLO: acepta un correo nulo';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('x@test.local', null, 0);
    raise exception 'FALLO: acepta límite 0';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('x@test.local', null, 100000);
    raise exception 'FALLO: acepta un límite enorme';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('x@test.local', null, null);
    raise exception 'FALLO: acepta límite nulo';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('x@test.local', repeat('n', 201));
    raise exception 'FALLO: acepta un nombre de 201 caracteres';
  exception when invalid_parameter_value then null; end;
  reset role;

  -- el alta quedó en el log con el admin como actor
  select actor into a from public.periodistas_log where email = 'nueva@test.local' and accion = 'INSERT';
  if a is distinct from 'admin@test.local' then raise exception 'FALLO: el log no anota al admin (%)', a; end if;

  -- la nueva persona ya puede buscar
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nueva@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.buscar_publicaciones(p_departamento => 'Ministerio de Prueba') where id like 'TEST-%';
  if n <> 2 then raise exception 'FALLO: la persona dada de alta no puede buscar (%)', n; end if;
  select limite into n from public.consultas_de_hoy();
  if n <> 12 then raise exception 'FALLO: el límite de la nueva persona no es 12 (%)', n; end if;
  begin perform 1 from public.admin_listar_periodistas();
    raise exception 'FALLO: la nueva persona (no admin) lista periodistas';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- B4) modificar: baja inmediata, reactivar, límite, nombre; correo inexistente
do $$
declare r record; n int; d jsonb;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  select * into r from public.admin_modificar_periodista('nueva@test.local', p_activo => false);
  if r.activo is not false or r.limite_diario <> 12 or r.nombre <> 'Nueva Persona' then
    raise exception 'FALLO: la baja cambia más que activo o no la aplica (%)', r; end if;
  reset role;
  select detalle into d from public.periodistas_log where email = 'nueva@test.local' and accion = 'UPDATE' order by id desc limit 1;
  if d is null or d -> 'activo' ->> 'antes' <> 'true' or d -> 'activo' ->> 'despues' <> 'false' or (d - 'activo') <> '{}'::jsonb then
    raise exception 'FALLO: el log de la baja no recoge solo el cambio de activo (%)', d; end if;

  -- de baja: ya no puede buscar
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nueva@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: una persona dada de baja sigue buscando';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select * into r from public.admin_modificar_periodista('NUEVA@test.local ', p_activo => true, p_limite_diario => 5, p_nombre => 'Nueva P.');
  if r.activo is not true or r.limite_diario <> 5 or r.nombre <> 'Nueva P.' then
    raise exception 'FALLO: reactivar/cambiar límite y nombre (%)', r; end if;
  select * into r from public.admin_modificar_periodista('nueva@test.local');   -- sin cambios: devuelve la fila
  if r.limite_diario <> 5 then raise exception 'FALLO: llamada sin cambios altera datos'; end if;

  begin perform 1 from public.admin_modificar_periodista('noexiste@test.local', p_activo => false);
    raise exception 'FALLO: modificar un correo inexistente no da error';
  exception when no_data_found then null; end;
  begin perform 1 from public.admin_modificar_periodista('nueva@test.local', p_limite_diario => 0);
    raise exception 'FALLO: modificar acepta límite 0';
  exception when invalid_parameter_value then null; end;
  reset role;

  -- el límite nuevo se refleja para esa persona
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nueva@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select limite into n from public.consultas_de_hoy();
  if n <> 5 then raise exception 'FALLO: el límite no se aplica (%)', n; end if;
  reset role;
end $$;

-- B5) listado: todos, con las consultas de hoy (solo el recuento, no el texto)
do $$
declare n int; c bigint;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.admin_listar_periodistas() where email like '%@test.local';
  if n <> 6 then raise exception 'FALLO: el listado debería traer 6 y trae %', n; end if;
  select consultas_hoy into c from public.admin_listar_periodistas() where email = 'prueba@test.local';
  if c <> 1 then raise exception 'FALLO: consultas_hoy de prueba debería ser 1 y es %', c; end if;
  reset role;
end $$;

-- B6) nunca puede quedarse el sistema sin admin activo; un admin puede ceder el testigo
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  -- el único admin activo (bajaadmin no cuenta) no puede quitarse el rol ni darse de baja
  begin perform 1 from public.admin_modificar_periodista('admin@test.local', p_es_admin => false);
    raise exception 'FALLO: el último admin se quita el rol';
  exception when check_violation then null; end;
  begin perform 1 from public.admin_modificar_periodista('admin@test.local', p_activo => false);
    raise exception 'FALLO: el último admin se da de baja';
  exception when check_violation then null; end;
  select count(*) into n from public.admin_listar_periodistas() where email = 'admin@test.local' and es_admin and activo;
  if n <> 1 then raise exception 'FALLO: el intento fallido dejó cambios'; end if;

  -- nombra a otro admin; ahora sí puede dejar de serlo
  perform 1 from public.admin_modificar_periodista('prueba@test.local', p_es_admin => true);
  perform 1 from public.admin_modificar_periodista('admin@test.local', p_es_admin => false);
  if public.es_admin() then raise exception 'FALLO: el antiguo admin sigue siéndolo'; end if;
  begin perform 1 from public.admin_listar_periodistas();
    raise exception 'FALLO: el antiguo admin sigue pudiendo listar';
  exception when insufficient_privilege then null; end;
  reset role;

  -- el nuevo admin funciona y ahora él es el último
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"prueba@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  if not public.es_admin() then raise exception 'FALLO: el nuevo admin no lo es'; end if;
  begin perform 1 from public.admin_modificar_periodista('prueba@test.local', p_es_admin => false);
    raise exception 'FALLO: el nuevo último admin se quita el rol';
  exception when check_violation then null; end;
  reset role;
end $$;

-- B7) log: lo ve el admin, con límite acotado; las ediciones a mano también quedan anotadas
do $$
declare n int; a text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"prueba@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);   -- admin actual
  set local role authenticated;
  select count(*) into n from public.admin_ver_log(2);
  if n <> 2 then raise exception 'FALLO: admin_ver_log(2) devuelve %', n; end if;
  select count(*) into n from public.admin_ver_log(0);
  if n <> 1 then raise exception 'FALLO: admin_ver_log(0) devuelve % (mínimo 1)', n; end if;
  select count(*) into n from public.admin_ver_log(1000000);
  if n > 500 then raise exception 'FALLO: admin_ver_log no acota a 500'; end if;
  reset role;

  -- edición a mano como postgres (sin sesión): también se anota
  perform set_config('request.jwt.claims', '', true);
  update public.periodistas set limite_diario = 77 where email = 'otra@test.local';
  select actor into a from public.periodistas_log where email = 'otra@test.local' and accion = 'UPDATE' order by id desc limit 1;
  if a is null or a like '%@%' then raise exception 'FALLO: la edición a mano no se anota con el rol de base de datos (%)', a; end if;
  -- un UPDATE que no cambia nada no ensucia el log
  select count(*) into n from public.periodistas_log where email = 'otra@test.local';
  update public.periodistas set limite_diario = 77 where email = 'otra@test.local';
  if (select count(*) from public.periodistas_log where email = 'otra@test.local') <> n then
    raise exception 'FALLO: un UPDATE sin cambios se anota en el log'; end if;
end $$;

-- B8) lo anterior sigue funcionando: las funciones de lectura saltan RLS y mantienen _ficha()
do $$
declare r public.ficha_publicacion; n int;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"otra@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.buscar_publicaciones(p_departamento => 'Ministerio de Prueba') where id like 'TEST-%';
  if n <> 2 then raise exception 'FALLO: buscar debería seguir devolviendo 2 y devuelve %', n; end if;
  select * into r from public.publicacion('TEST-RES-1');
  if r.titulo is null or r.resumen is not null or r.temas is not null or r.tipo_acto is not null then
    raise exception 'FALLO: _ficha() dejó de aplicar la privacidad'; end if;
  select * into r from public.publicacion('TEST-PUB-1');
  if r.resumen is null then raise exception 'FALLO: la pública perdió su resumen'; end if;
  select count(*) into n from public.buscar_publicaciones(p_q => 'Fulanito Gomez', p_departamento => 'Ministerio de Prueba') where id = 'TEST-RES-1';
  if n <> 1 then raise exception 'FALLO: la búsqueda por el cuerpo dejó de encontrar la restringida'; end if;
  perform public.reservar_consulta('otra pregunta');
  select usadas into n from public.consultas_de_hoy();
  if n <> 2 then raise exception 'FALLO: consultas_de_hoy de otra debería dar 2 y da %', n; end if;
  reset role;
end $$;

-- B9) la ingesta (service_role) sigue escribiendo y leyendo todo
do $$
declare n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  set local role service_role;
  insert into public.sumarios (boletin, fecha, numero) values ('BOE', current_date + 400, 'TEST-1');
  insert into public.publicaciones (id, boletin, fecha, titulo, nivel_privacidad)
    values ('TEST-SVC-1', 'BOE', current_date, 'Publicación de la ingesta', 'publico');
  update public.publicaciones set resumen = 'ficha escrita por la ingesta' where id = 'TEST-SVC-1';
  select public.indexar_texto('TEST-SVC-1', 'cuerpo de prueba') into ok;
  if ok is not true then raise exception 'FALLO: la ingesta no puede indexar'; end if;
  insert into public.ingestas (boletin, fecha, estado, n_nuevas) values ('BOE', current_date, 'ok', 1);
  select count(*) into n from public.publicaciones where id like 'TEST-%';
  if n <> 3 then raise exception 'FALLO: service_role debería ver las 3 publicaciones (también la restringida) y ve %', n; end if;
  -- desde la migración 24, la ingesta no lee la lista de periodistas
  begin perform 1 from public.periodistas limit 1;
    raise exception 'FALLO: service_role lee periodistas';
  exception when insufficient_privilege then null; end;
  perform public.purgar_consultas();
  begin perform 1 from public.admin_listar_periodistas();
    raise exception 'FALLO: service_role sin sesión de admin ejecuta funciones admin';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- C) sesión vigente (migración 11): tope de 24 h en la base de datos
do $$
declare
  ahora bigint := extract(epoch from now())::bigint;
  amrs text[];
  esperado text[] := array['ok','PT401','PT401','PT401','PT401','PT401','ok','PT401','PT401','PT401','PT401'];
  i int; r text; n int; f text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;
  amrs := array[
    format('[{"method":"otp","timestamp":%s}]', ahora - 23 * 3600),                                     -- 1 vale (23 h)
    format('[{"method":"otp","timestamp":%s}]', ahora - 25 * 3600),                                     -- 2 caducada (25 h)
    null,                                                                                               -- 3 sin amr
    format('[{"method":"password","timestamp":%s}]', ahora - 3600),                                     -- 4 método distinto
    format('[{"method":"otp","timestamp":%s},{"method":"otp","timestamp":%s}]', ahora - 3600, ahora - 30 * 3600), -- 5 manda la más antigua
    format('[{"method":"otp","timestamp":%s},{"method":"password","timestamp":%s}]', ahora - 3600, ahora - 2 * 3600), -- 6 no vale: lleva contraseña (migración 23)
    format('[{"method":"magiclink","timestamp":%s}]', ahora - 3600),                                    -- 7 magiclink vale
    '"x"',                                                                                              -- 8 amr ilegible (no es lista)
    '[{"method":"otp","timestamp":"abc"}]',                                                             -- 9 marca ilegible
    '[{"method":"otp"}]',                                                                               -- 10 sin marca
    '[]'                                                                                                -- 11 vacío
  ];
  for i in 1 .. array_length(esperado, 1) loop
    if amrs[i] is null then
      perform set_config('request.jwt.claims', '{"role":"authenticated","email":"prueba@test.local"}', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','email','prueba@test.local','amr', amrs[i]::json)::text, true);
    end if;
    set local role authenticated;
    begin
      perform 1 from public.consultas_de_hoy();
      r := 'ok';
    exception when sqlstate 'PT401' then r := 'PT401';
              when insufficient_privilege then r := '42501';
    end;
    reset role;
    if r is distinct from esperado[i] then
      raise exception 'FALLO: caso % de sesión: esperaba % y da % (amr = %)', i, esperado[i], r, amrs[i]; end if;
  end loop;

  -- sesión caducada: PT401 en TODAS las funciones de lectura y de admin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','prueba@test.local',
    'amr', json_build_array(json_build_object('method','otp','timestamp', ahora - 25 * 3600)))::text, true);
  set local role authenticated;
  foreach f in array array[
    'select 1 from public.buscar_publicaciones()',
    'select 1 from public.contar_publicaciones()',
    'select 1 from public.sumario_del_dia(current_date)',
    $q$select 1 from public.publicacion('TEST-PUB-1')$q$,
    'select 1 from public.consultas_de_hoy()',
    $q$select * from public.reservar_consulta('x')$q$,
    'select 1 from public.admin_listar_periodistas()',
    $q$select 1 from public.admin_alta_periodista('caducada@test.local')$q$,
    $q$select 1 from public.admin_modificar_periodista('otra@test.local', p_activo => false)$q$,
    'select 1 from public.admin_ver_log()'
  ] loop
    begin execute f;
      raise exception 'FALLO: con sesión caducada funciona: %', f;
    exception when sqlstate 'PT401' then null; end;
  end loop;
  if public.es_periodista() or public.es_admin() then
    raise exception 'FALLO: es_periodista/es_admin dan true con sesión caducada'; end if;
  reset role;

  -- un correo que NO está en la lista: sesión vieja → PT401 (no revela nada); sesión buena → 42501
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','intruso@test.local',
    'amr', json_build_array(json_build_object('method','otp','timestamp', ahora - 25 * 3600)))::text, true);
  set local role authenticated;
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: un intruso con sesión vieja pasa';
  exception when sqlstate 'PT401' then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','intruso@test.local',
    'amr', json_build_array(json_build_object('method','otp','timestamp', ahora - 3600)))::text, true);
  set local role authenticated;
  begin perform 1 from public.buscar_publicaciones();
    raise exception 'FALLO: un intruso con sesión buena pasa';
  exception when insufficient_privilege then null; end;
  reset role;

  -- el correo en otra capitalización sigue valiendo
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','Prueba@TEST.Local',
    'amr', json_build_array(json_build_object('method','otp','timestamp', ahora - 3600)))::text, true);
  set local role authenticated;
  perform 1 from public.consultas_de_hoy();
  if not public.es_admin() then raise exception 'FALLO: el correo con mayúsculas no reconoce al admin'; end if;
  reset role;

  -- la RLS también corta con sesión caducada (aunque hubiera un GRANT por error)
  grant select on public.publicaciones, public.periodistas to authenticated;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','prueba@test.local',
    'amr', json_build_array(json_build_object('method','otp','timestamp', ahora - 25 * 3600)))::text, true);
  set local role authenticated;
  select count(*) into n from public.publicaciones;
  if n <> 0 then raise exception 'FALLO: la RLS deja leer publicaciones con sesión caducada (%)', n; end if;
  select count(*) into n from public.periodistas;
  if n <> 0 then raise exception 'FALLO: la RLS deja leer periodistas con sesión caducada (%)', n; end if;
  reset role;
  revoke select on public.publicaciones, public.periodistas from authenticated;
end $$;

-- D) baja = sin rol de admin; correo solo ASCII; actor del log por rol
do $$
declare r record; a text; n int;
begin
  perform set_config('request.jwt.claims', '', true); reset role;
  -- (aquí el admin activo es «prueba», tras el relevo de B6)
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"prueba@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  perform 1 from public.admin_modificar_periodista('otra@test.local', p_es_admin => true);
  select * into r from public.admin_modificar_periodista('otra@test.local', p_activo => false, p_es_admin => true);
  if r.activo is not false or r.es_admin is not false then
    raise exception 'FALLO: dar de baja no quita el rol de admin (%)', r; end if;
  select * into r from public.admin_modificar_periodista('otra@test.local', p_activo => true);
  if r.activo is not true or r.es_admin is not false then
    raise exception 'FALLO: reactivar devuelve el rol de admin (%)', r; end if;

  begin perform 1 from public.admin_alta_periodista('ñandú@test.local');
    raise exception 'FALLO: acepta un correo con ñ';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('josé@test.local');
    raise exception 'FALLO: acepta un correo con tilde';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('a@b');
    raise exception 'FALLO: acepta un dominio sin punto';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('a@b.c');
    raise exception 'FALLO: acepta un dominio de una letra';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.admin_alta_periodista('a..b@@test.local');
    raise exception 'FALLO: acepta dos arrobas';
  exception when invalid_parameter_value then null; end;
  select * into r from public.admin_alta_periodista('Ok.Nombre+tag@Sub.Test.LOCAL');
  if r.email <> 'ok.nombre+tag@sub.test.local' then raise exception 'FALLO: correo válido mal normalizado (%)', r.email; end if;
  reset role;

  -- actor del log: sin correo, el rol del token
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.periodistas set limite_diario = 11 where email = 'otra@test.local';
  select actor into a from public.periodistas_log where email = 'otra@test.local' and accion = 'UPDATE' order by id desc limit 1;
  if a is distinct from 'service_role' then raise exception 'FALLO: el actor sin correo debería ser el rol (%)', a; end if;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- E) service_role: sin acceso a periodistas ni al log (migración 24); TRUNCATE bloqueado
do $$
declare t text; f text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;
  set local role service_role;
  foreach f in array array[
    'select 1 from public.periodistas limit 1',
    'select 1 from public.periodistas_log limit 1',
    $q$insert into public.periodistas (email) values ('svc@test.local')$q$,
    $q$update public.periodistas set es_admin = true where email = 'otra@test.local'$q$,
    $q$delete from public.periodistas where email = 'otra@test.local'$q$,
    'truncate public.periodistas',
    $q$insert into public.periodistas_log (actor, accion, email) values ('x','INSERT','x')$q$,
    $q$update public.periodistas_log set actor = 'borrado'$q$,
    'delete from public.periodistas_log',
    'truncate public.periodistas_log',
    $q$select nextval('public.periodistas_log_id_seq')$q$
  ] loop
    begin execute f;
      raise exception 'FALLO: service_role puede ejecutar: %', f;
    exception when insufficient_privilege then null; end;
  end loop;
  reset role;

  -- las funciones admin no son de service_role; las de la ingesta sí
  foreach f in array array['public.es_admin()', 'public.exigir_admin()', 'public.sesion_vigente()',
      'public.admin_listar_periodistas()', 'public.admin_alta_periodista(text, text, int, boolean)',
      'public.admin_modificar_periodista(text, text, int, boolean, boolean)', 'public.admin_ver_log(int)'] loop
    if has_function_privilege('service_role', f, 'execute') then
      raise exception 'FALLO: service_role puede ejecutar %', f; end if;
  end loop;
  foreach f in array array['public.indexar_texto(text, text)', 'public.medir_indice()', 'public.purgar_consultas()'] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FALLO: service_role perdió el acceso a % (lo necesita la ingesta)', f; end if;
  end loop;

  -- TRUNCATE también está bloqueado para el dueño (el SQL Editor).
  -- Postgres no deja hacer TRUNCATE con eventos de trigger diferidos pendientes (error 55006) y esta
  -- transacción de pruebas ya tiene alguno: se ejecutan antes (modo inmediato) para llegar al trigger de bloqueo.
  set constraints all immediate;
  foreach t in array array['periodistas', 'periodistas_log'] loop
    begin execute format('truncate public.%I', t);
      raise exception 'FALLO: TRUNCATE de % no está bloqueado', t;
    exception when restrict_violation then null; end;
  end loop;
  set constraints all deferred;
end $$;

-- F) siempre queda un admin activo, también por SQL directo (constraint trigger diferible)
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '', true); reset role;
  -- un segundo admin (el INSERT no entra en la comprobación) y se activa el modo inmediato
  insert into public.periodistas (email, es_admin) values ('segundo@test.local', true);
  set constraints public.periodistas_ultimo_admin immediate;

  begin update public.periodistas set es_admin = false where es_admin and activo;
    raise exception 'FALLO: SQL directo deja al sistema sin admin (update)';
  exception when check_violation then null; end;
  begin update public.periodistas set activo = false where es_admin and activo;
    raise exception 'FALLO: SQL directo da de baja a todos los admin';
  exception when check_violation then null; end;
  begin delete from public.periodistas where es_admin and activo;
    raise exception 'FALLO: SQL directo borra a todos los admin';
  exception when check_violation then null; end;

  -- quitar el rol a UNO habiendo otro activo, sí; tocar a quien no es admin, también
  update public.periodistas set es_admin = false where email = 'prueba@test.local';
  update public.periodistas set limite_diario = 3 where email = 'baja@test.local';
  select count(*) into n from public.periodistas where es_admin and activo;
  if n <> 1 then raise exception 'FALLO: debería quedar 1 admin activo y hay %', n; end if;
  set constraints public.periodistas_ultimo_admin deferred;
end $$;

-- B10) forma de las políticas y de los permisos
do $$
declare n int; lista text;
begin
  perform set_config('request.jwt.claims', '', true); reset role;   -- sin claims ni rol heredados
  -- todas las tablas con RLS y al menos una política, salvo ingestas (cerrada a propósito)
  if exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
              where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
                and c.relname in ('boletines','sumarios','publicaciones','ingestas','periodistas','consultas','periodistas_log')) then
    raise exception 'FALLO: hay tablas sin RLS'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ingestas';
  if n <> 0 then raise exception 'FALLO: ingestas no debe tener políticas'; end if;

  -- ninguna política de escritura sobre publicaciones, sumarios, boletines, ingestas o consultas
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('publicaciones','sumarios','boletines','ingestas','consultas')
              and cmd <> 'SELECT') then
    raise exception 'FALLO: hay políticas de escritura donde no debe haberlas'; end if;
  -- ni de borrado en ninguna tabla
  if exists (select 1 from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')) then
    raise exception 'FALLO: hay políticas de borrado o ALL'; end if;
  -- todas para authenticated, nunca para anon/public
  if exists (select 1 from pg_policies where schemaname = 'public' and roles <> array['authenticated']::name[]) then
    raise exception 'FALLO: hay políticas que no son solo para authenticated'; end if;

  -- lista blanca de funciones ejecutables
  select string_agg(p.proname, ', ' order by p.proname collate "C") into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'ultima_ingesta' then raise exception 'FALLO: anon puede ejecutar: %', coalesce(lista, '(ninguna)'); end if;

  select string_agg(p.proname, ', ' order by p.proname collate "C") into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if lista is distinct from 'admin_alta_periodista, admin_gasto, admin_listar_periodistas, admin_modificar_periodista, admin_ver_log, buscar_persona, buscar_publicaciones, completar_consulta, consultas_de_hoy, contar_publicaciones, es_admin, es_periodista, guardar_respuesta, publicacion, reservar_consulta, respuesta_guardada, resumen_del_dia, sumario_del_dia, ultima_ingesta' then
    raise exception 'FALLO: authenticated puede ejecutar: %', lista; end if;

  -- las funciones admin y es_admin tienen search_path fijo
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and (p.proname like 'admin\_%' or p.proname in ('es_admin','exigir_admin','tg_auditar_periodistas','sesion_vigente','tg_exigir_admin_activo','tg_bloquear_truncate'))
                and not (p.proconfig::text like '%search_path%')) then
    raise exception 'FALLO: una función admin no tiene search_path fijo'; end if;

  -- inventario de permisos: ni anon, ni authenticated, ni PUBLIC tienen NADA sobre tablas, vistas ni
  -- secuencias de public (todo el acceso es por funciones)
  select string_agg(distinct c.relname || ' → ' || coalesce(r.rolname, 'PUBLIC'), ', ') into lista
    from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
   where s.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'f', 'p')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if lista is not null then raise exception 'FALLO: permisos abiertos sobre relaciones: %', lista; end if;

  -- ni sobre columnas sueltas
  select string_agg(distinct c.relname || '.' || at.attname || ' → ' || coalesce(r.rolname, 'PUBLIC'), ', ') into lista
    from pg_attribute at
    join pg_class c on c.oid = at.attrelid
    join pg_namespace s on s.oid = c.relnamespace
    cross join lateral aclexplode(at.attacl) a
    left join pg_roles r on r.oid = a.grantee
   where s.nspname = 'public' and at.attacl is not null
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if lista is not null then raise exception 'FALLO: permisos abiertos sobre columnas: %', lista; end if;
end $$;

rollback;

select 'TODAS LAS PRUEBAS OK' as resultado;
