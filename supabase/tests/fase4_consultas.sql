-- Pruebas de la migración 12: límite diario atómico (reservar_consulta / completar_consulta).
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 12 migraciones.
-- Todo dentro de una transacción con rollback. Si algo falla, el error empieza por "FALLO".
-- La última consulta devuelve «TODAS LAS PRUEBAS OK».
-- Nota: la concurrencia real (dos peticiones a la vez) no se puede probar en una sola transacción; lo que
-- la garantiza es el bloqueo advisory por periodista, y se comprueba aquí que está en la función.

begin;

insert into public.periodistas (email, nombre, limite_diario, activo) values
  ('p1@test.local', 'Uno', 2, true),
  ('p2@test.local', 'Dos', 5, true),
  ('baja@test.local', 'Baja', 5, false);

-- A) límite diario: 2 preguntas valen, la tercera da PT429
do $$
declare r record; msg text; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select * into r from public.reservar_consulta('  ¿Cuántos contratos de obras?  ');
  if r.usadas <> 1 or r.limite <> 2 then raise exception 'FALLO: primera reserva usadas=% limite=%', r.usadas, r.limite; end if;
  select * into r from public.reservar_consulta('segunda');
  if r.usadas <> 2 then raise exception 'FALLO: segunda reserva usadas=%', r.usadas; end if;
  begin
    perform public.reservar_consulta('tercera');
    raise exception 'FALLO: se pudo reservar por encima del límite';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    if st <> 'PT429' then raise exception 'FALLO: se esperaba PT429 y salió % (%)', st, msg; end if;
  end;
  reset role;
  -- la pregunta se guardó recortada
  if not exists (select 1 from public.consultas where usuario = 'p1@test.local' and pregunta = '¿Cuántos contratos de obras?') then
    raise exception 'FALLO: la pregunta no se guardó recortada'; end if;
  if (select count(*) from public.consultas where usuario = 'p1@test.local') <> 2 then
    raise exception 'FALLO: una reserva rechazada dejó fila'; end if;
end $$;

-- B) el límite es por persona
do $$
declare r record;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p2@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select * into r from public.reservar_consulta('de otra persona');
  if r.usadas <> 1 or r.limite <> 5 then raise exception 'FALLO: p2 usadas=% limite=%', r.usadas, r.limite; end if;
  reset role;
end $$;

-- C) preguntas de ayer no cuentan; solo las de hoy (hora de Madrid)
do $$
declare r record;
begin
  insert into public.consultas (usuario, pregunta, creado_en) values ('p1@test.local', 'de ayer', now() - interval '2 days');
  update public.consultas set creado_en = now() - interval '3 days' where usuario = 'p1@test.local' and pregunta <> 'de ayer';
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select * into r from public.reservar_consulta('hoy');
  if r.usadas <> 1 then raise exception 'FALLO: las preguntas de días anteriores cuentan (usadas=%)', r.usadas; end if;
  reset role;
end $$;

-- D) entradas no válidas, no periodista, baja, sin sesión y sesión caducada
do $$
declare st text; e text; caso text;
begin
  for caso in select unnest(array['vacia','larga','fuera','baja','sin_amr','caducada','anon']) loop
    e := case caso when 'fuera' then 'intruso@test.local' when 'baja' then 'baja@test.local' else 'p2@test.local' end;
    perform set_config('request.jwt.claims',
      case caso
        when 'sin_amr' then '{"role":"authenticated","email":"p2@test.local"}'
        when 'caducada' then '{"role":"authenticated","email":"p2@test.local","amr":[{"method":"otp","timestamp":1000000000}]}'
        when 'anon' then ''
        else json_build_object('role','authenticated','email',e,'amr',json_build_array(json_build_object('method','otp','timestamp',4102444800)))::text
      end, true);
    set local role authenticated;
    if caso = 'anon' then reset role; set local role anon; end if;
    begin
      perform public.reservar_consulta(case caso when 'vacia' then '   ' when 'larga' then repeat('x', 4001) else 'hola' end);
      raise exception 'FALLO: caso % no debería poder reservar', caso;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
      if caso in ('vacia','larga') and st <> '22023' then raise exception 'FALLO: caso % esperaba 22023 y salió %', caso, st; end if;
      if caso in ('fuera','baja') and st <> '42501' then raise exception 'FALLO: caso % esperaba 42501 y salió %', caso, st; end if;
      if caso in ('sin_amr','caducada') and st <> 'PT401' then raise exception 'FALLO: caso % esperaba PT401 y salió %', caso, st; end if;
      if caso = 'anon' and st <> '42501' then raise exception 'FALLO: anon esperaba 42501 y salió %', st; end if;
    end;
    reset role;
  end loop;
end $$;

-- E) completar: solo la propia, una sola vez, con datos válidos
do $$
declare id1 bigint; id2 bigint; idp bigint; tk1 uuid; tk2 uuid; ok boolean; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p2@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select r.id, r.token into id2, tk2 from public.reservar_consulta('para completar') r;
  idp := id2;   -- la primera reserva: es la que se comprueba al final
  reset role;
  select c.id, c.token into id1, tk1 from public.consultas c where c.usuario = 'p1@test.local' order by c.id desc limit 1;

  set local role authenticated;
  select public.completar_consulta(id2, tk2, 'claude-haiku-5-5', 2, 1000, 200, 800, 0.0012, array['BOE-A-2026-1'], false) into ok;
  if ok is not true then raise exception 'FALLO: no completa su propia reserva'; end if;
  select public.completar_consulta(id2, tk2, 'otro', 1, 1, 1, 1, 0, null, true) into ok;
  if ok is not false then raise exception 'FALLO: se puede completar dos veces'; end if;
  select public.completar_consulta(id1, tk1, 'claude-haiku-5-5', 1, 1, 1, 1, 0, null, false) into ok;
  if ok is not false then raise exception 'FALLO: completa la reserva de otra persona'; end if;
  begin
    perform public.completar_consulta(id2, tk2, 'x', 99, 1, 1, 1, 0, null, false);
    raise exception 'FALLO: acepta rondas absurdas';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st <> '22023' then raise; end if;
  end;
  begin
    perform public.completar_consulta(id2, tk2, 'x', 1, 1, 1, 1, 5000, null, false);
    raise exception 'FALLO: acepta un coste absurdo';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st <> '22023' then raise; end if;
  end;
  -- sin el token (o con uno falso) no se puede completar una reserva propia: nadie rellena la de otro adivinando el id
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p2@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  select r.id, r.token into id2, tk2 from public.reservar_consulta('segunda reserva') r;
  select public.completar_consulta(id2, gen_random_uuid(), 'claude-haiku-5-5', 1, 1, 1, 1, 0, null, false) into ok;
  if ok is not false then raise exception 'FALLO: se completa con un token falso'; end if;
  select public.completar_consulta(id2, tk2, 'claude-haiku-5-5', 1, 1, 1, 1, 0, null, false) into ok;
  if ok is not true then raise exception 'FALLO: no se completa con su token'; end if;
  -- registrar_consulta (falseable) ya no existe
  begin
    perform public.registrar_consulta('x', 'm', 1, 1, 1, 0, 0, null, false);
    raise exception 'FALLO: registrar_consulta sigue existiendo';
  exception when undefined_function then null; end;
  reset role;
  if (select coste_usd from public.consultas where id = idp) <> 0.0012 then raise exception 'FALLO: no se guardó el coste'; end if;
end $$;

-- F) permisos y diseño: sin función de «liberar»; service_role y anon sin acceso; bloqueo advisory presente
do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.reservar_consulta(text)', 'execute') then raise exception 'FALLO: anon ejecuta reservar_consulta'; end if;
  if has_function_privilege('service_role', 'public.reservar_consulta(text)', 'execute') then raise exception 'FALLO: service_role ejecuta reservar_consulta'; end if;
  if not has_function_privilege('authenticated', 'public.reservar_consulta(text)', 'execute') then raise exception 'FALLO: authenticated no puede reservar'; end if;
  if not has_function_privilege('authenticated', 'public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean)', 'execute') then raise exception 'FALLO: authenticated no puede completar'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('liberar_consulta', 'devolver_consulta', 'cancelar_consulta', 'registrar_consulta');
  if n <> 0 then raise exception 'FALLO: existe una función para liberar reservas o registrar consultas a mano (se saltaría el límite)'; end if;
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.reservar_consulta(text)'::regprocedure)) = 0 then
    raise exception 'FALLO: reservar_consulta no serializa por periodista'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
