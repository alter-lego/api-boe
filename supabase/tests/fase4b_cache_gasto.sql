-- Pruebas de la migración 13: caché de respuestas por periodista y gasto para admins.
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 13 migraciones.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('a@test.local', 'Admin', 10, true, true),
  ('p1@test.local', 'Uno', 10, true, false),
  ('p2@test.local', 'Dos', 10, true, false);

-- A) caché: guardar, recuperar con otra redacción de la misma pregunta, no la ve otro periodista
do $$
declare r record; idp bigint; tk uuid; ok boolean; n int; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.respuesta_guardada('¿Qué ayudas hay?');
  if n <> 0 then raise exception 'FALLO: hay caché sin haber guardado nada'; end if;
  select x.id, x.token into idp, tk from public.reservar_consulta('¿Qué ayudas hay?') x;
  select public.completar_consulta(idp, tk, 'claude-haiku-5-5', 1, 10, 10, 0, 0.001, array['BOE-A-2026-1'], false) into ok;
  select public.guardar_respuesta(idp, gen_random_uuid(), '{"respuesta":"x"}'::jsonb) into ok;
  if ok is not false then raise exception 'FALLO: se guarda con un token falso'; end if;
  select public.guardar_respuesta(idp, tk, '{"respuesta":"hola","citas":[]}'::jsonb) into ok;
  if ok is not true then raise exception 'FALLO: no se guarda con su token'; end if;
  select public.guardar_respuesta(idp, tk, '{"respuesta":"otra"}'::jsonb) into ok;
  if ok is not false then raise exception 'FALLO: se sobrescribe una respuesta ya guardada'; end if;
  begin
    perform public.guardar_respuesta(idp, tk, '[1]'::jsonb);
    raise exception 'FALLO: acepta un JSON que no es objeto';
  exception when sqlstate '22023' then null; end;
  select count(*) into n from public.respuesta_guardada('  QUÉ ayudas   hay ');
  if n <> 1 then raise exception 'FALLO: no reconoce la misma pregunta con otra redacción'; end if;
  select count(*) into n from public.respuesta_guardada('otra cosa distinta');
  if n <> 0 then raise exception 'FALLO: devuelve caché de otra pregunta'; end if;
  reset role;

  -- otro periodista no la ve
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p2@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.respuesta_guardada('¿Qué ayudas hay?');
  if n <> 0 then raise exception 'FALLO: un periodista ve la caché de otro'; end if;
  -- y no puede escribir en la reserva ajena aunque conozca id y token
  select public.guardar_respuesta(idp, tk, '{"respuesta":"envenenada"}'::jsonb) into ok;
  if ok is not false then raise exception 'FALLO: escribe en la respuesta de otro'; end if;
  reset role;
end $$;

-- B) una ingesta posterior invalida la caché
do $$
declare n int;
begin
  insert into public.ingestas (boletin, fecha, inicio, fin, estado) values ('BOE', current_date, now() + interval '1 minute', now() + interval '2 minutes', 'ok');
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select count(*) into n from public.respuesta_guardada('¿Qué ayudas hay?');
  if n <> 0 then raise exception 'FALLO: la caché sobrevive a una ingesta posterior'; end if;
  reset role;
end $$;

-- C) acceso: sin sesión vigente o fuera de la lista, no
do $$
declare caso text; st text;
begin
  foreach caso in array array['fuera', 'sin_amr', 'anon'] loop
    begin
      perform set_config('request.jwt.claims', case caso
        when 'fuera' then '{"role":"authenticated","email":"nadie@test.local","amr":[{"method":"otp","timestamp":4102444800}]}'
        when 'sin_amr' then '{"role":"authenticated","email":"p1@test.local"}'
        else '{"role":"anon"}' end, true);
      set local role authenticated;
      perform * from public.respuesta_guardada('x');
      raise exception 'FALLO: caso % accede a respuesta_guardada', caso;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
      -- primero se comprueba la sesión (sin amr / anónimo → PT401) y después la lista (fuera → 42501)
      if caso in ('sin_amr', 'anon') and st <> 'PT401' then raise exception 'FALLO: % esperaba PT401 y salió %', caso, st; end if;
      if caso = 'fuera' and st <> '42501' then raise exception 'FALLO: % esperaba 42501 y salió %', caso, st; end if;
    end;
    reset role;
  end loop;
end $$;

-- D) gasto: solo admin; agregado sin datos ajenos
do $$
declare r record; n int; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin
    perform * from public.admin_gasto(3);
    raise exception 'FALLO: un periodista normal ve el gasto';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
    if st <> '42501' then raise exception 'FALLO: periodista normal esperaba 42501 y salió %', st; end if;
  end;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"a@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select * into r from public.admin_gasto(1);
  if r.mes is null or r.preguntas < 1 or r.coste_usd < 0.001 then raise exception 'FALLO: el gasto del mes no suma la consulta de prueba'; end if;
  begin
    perform * from public.admin_gasto(0);
    raise exception 'FALLO: acepta 0 meses';
  exception when sqlstate '22023' then null; end;
  reset role;
end $$;

-- E) permisos
do $$
begin
  if has_function_privilege('anon', 'public.respuesta_guardada(text)', 'execute') then raise exception 'FALLO: anon ejecuta respuesta_guardada'; end if;
  if has_function_privilege('service_role', 'public.guardar_respuesta(bigint, uuid, jsonb)', 'execute') then raise exception 'FALLO: service_role ejecuta guardar_respuesta'; end if;
  if has_function_privilege('anon', 'public.admin_gasto(int)', 'execute') or has_function_privilege('service_role', 'public.admin_gasto(int)', 'execute') then raise exception 'FALLO: admin_gasto abierta a anon o service_role'; end if;
  if not has_function_privilege('authenticated', 'public.admin_gasto(int)', 'execute') then raise exception 'FALLO: authenticated no puede ejecutar admin_gasto'; end if;
  if has_function_privilege('authenticated', 'public._normalizar_pregunta(text)', 'execute') then raise exception 'FALLO: _normalizar_pregunta expuesta'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
