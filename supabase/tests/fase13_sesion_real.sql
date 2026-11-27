-- Pruebas de la migración 23: la sesión tiene que existir en auth.sessions y entrar solo por enlace.
-- Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 23. Necesita que haya al menos una sesión abierta
-- (la tuya, si has entrado en el buscador). Todo en una transacción con rollback; no cambia nada.
-- Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);

do $$
declare
  ahora bigint := extract(epoch from now())::bigint;
  v_sesion uuid; v_usuario uuid; r text;
  claims jsonb;
begin
  select s.id, s.user_id into v_sesion, v_usuario from auth.sessions s
   where s.not_after is null or s.not_after > now()
   order by s.created_at desc limit 1;
  if v_sesion is null then raise exception 'FALLO: no hay ninguna sesión abierta para probar (entra en el buscador y repite)'; end if;

  claims := jsonb_build_object('role', 'authenticated', 'email', 'p1@test.local', 'sub', v_usuario,
                               'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', ahora - 3600)));

  -- A) sesión que existe y es del usuario: vale
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('session_id', v_sesion))::text, true);
  set local role authenticated;
  begin perform 1 from public.consultas_de_hoy(); r := 'ok'; exception when sqlstate 'PT401' then r := 'PT401'; end;
  reset role;
  if r <> 'ok' then raise exception 'FALLO: una sesión abierta no vale (%)', r; end if;

  -- B) sesión que no existe (cerrada, o de otro): no vale
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('session_id', gen_random_uuid()))::text, true);
  set local role authenticated;
  begin perform 1 from public.consultas_de_hoy(); r := 'ok'; exception when sqlstate 'PT401' then r := 'PT401'; end;
  reset role;
  if r <> 'PT401' then raise exception 'FALLO: una sesión cerrada sigue valiendo'; end if;

  -- C) sesión real pero de otro usuario (sub distinto): no vale
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('session_id', v_sesion, 'sub', gen_random_uuid()))::text, true);
  set local role authenticated;
  begin perform 1 from public.consultas_de_hoy(); r := 'ok'; exception when sqlstate 'PT401' then r := 'PT401'; end;
  reset role;
  if r <> 'PT401' then raise exception 'FALLO: vale una sesión de otro usuario'; end if;

  -- D) enlace + contraseña: no vale
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'email', 'p1@test.local',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', ahora - 60),
                             jsonb_build_object('method', 'password', 'timestamp', ahora - 120)))::text, true);
  set local role authenticated;
  begin perform 1 from public.consultas_de_hoy(); r := 'ok'; exception when sqlstate 'PT401' then r := 'PT401'; end;
  reset role;
  if r <> 'PT401' then raise exception 'FALLO: vale una sesión con contraseña'; end if;

  -- E) nadie puede llamar a sesion_vigente directamente
  if has_function_privilege('authenticated', 'public.sesion_vigente()', 'execute')
     or has_function_privilege('anon', 'public.sesion_vigente()', 'execute') then
    raise exception 'FALLO: sesion_vigente se puede ejecutar directamente'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
