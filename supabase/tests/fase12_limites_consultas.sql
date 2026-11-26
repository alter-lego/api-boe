-- Pruebas de la migración 22: límites de completar_consulta y guardar_respuesta.
-- Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 22.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);

do $$
declare idp bigint; tk uuid; ok boolean; malo text[];
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  select x.id, x.token into idp, tk from public.reservar_consulta('prueba de límites') x;

  -- A) lo que no vale: citas largas o sin forma de id, demasiadas citas, coste o tokens desorbitados
  foreach malo slice 1 in array array[
      array[repeat('x', 5000)], array['BOE-A-2026-1; drop'], array['boe-a-2026-1']] loop
    begin
      perform public.completar_consulta(idp, tk, 'claude-haiku-5-5', 1, 10, 10, 0, 0.001, malo, false);
      raise exception 'FALLO: acepta las citas %', left(malo[1], 40);
    exception when sqlstate '22023' then null; end;
  end loop;
  begin
    perform public.completar_consulta(idp, tk, 'claude-haiku-5-5', 1, 10, 10, 0, 0.001,
      (select array_agg('BOE-A-2026-' || g) from generate_series(1, 31) g), false);
    raise exception 'FALLO: acepta 31 citas';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.completar_consulta(idp, tk, 'claude-haiku-5-5', 1, 10, 10, 0, 5, null, false);
    raise exception 'FALLO: acepta un coste de 5 USD';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.completar_consulta(idp, tk, 'claude-haiku-5-5', 1, 9000000, 10, 0, 0.001, null, false);
    raise exception 'FALLO: acepta 9 millones de tokens';
  exception when sqlstate '22023' then null; end;

  -- B) lo normal sigue valiendo
  select public.completar_consulta(idp, tk, 'claude-haiku-5-5', 2, 12000, 800, 9000, 0.0021,
    array['BOE-A-2026-23758', 'BOE-B-2026-38030'], false) into ok;
  if ok is not true then raise exception 'FALLO: no se completa una consulta normal'; end if;

  -- C) respuesta guardada: más de 100 KB no; una normal sí
  begin
    perform public.guardar_respuesta(idp, tk, jsonb_build_object('respuesta', repeat('x', 120000)));
    raise exception 'FALLO: acepta una respuesta de 120 KB';
  exception when sqlstate '22023' then null; end;
  select public.guardar_respuesta(idp, tk, '{"respuesta":"hola","citas":[]}'::jsonb) into ok;
  if ok is not true then raise exception 'FALLO: no se guarda una respuesta normal'; end if;
  reset role;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
