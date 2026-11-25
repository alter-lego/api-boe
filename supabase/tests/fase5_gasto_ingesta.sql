-- Pruebas de la migración 14: gasto de la ingesta y admin_gasto con su total mensual.
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de las 14 migraciones.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('a@test.local', 'Admin', 10, true, true),
  ('p1@test.local', 'Uno', 10, true, false);

-- A) la ingesta (service_role) inserta y lee, pero no corrige ni borra
do $$
declare n int; st text;
begin
  set local role service_role;
  insert into public.gasto_ingesta (modelo, n_fichas, tokens_entrada, tokens_salida, tokens_cache, coste_usd)
    values ('claude-haiku-5-5', 40, 120000, 9000, 300000, 0.02000),
           ('claude-haiku-5-5', 10, 30000, 2000, 80000, 0.00500);
  select count(*) into n from public.gasto_ingesta;
  if n < 2 then raise exception 'FALLO: service_role no lee lo que inserta'; end if;
  begin
    update public.gasto_ingesta set coste_usd = 0;
    raise exception 'FALLO: service_role puede corregir el gasto';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.gasto_ingesta;
    raise exception 'FALLO: service_role puede borrar el gasto';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.gasto_ingesta (coste_usd) values (-1);
    raise exception 'FALLO: acepta un coste negativo';
  exception when check_violation then null; end;
  reset role;
end $$;

-- B) por vía directa nadie con sesión la ve; los admins solo reciben agregados
do $$
declare r record; n int; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"a@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin
    select count(*) into n from public.gasto_ingesta;
    raise exception 'FALLO: un admin lee la tabla gasto_ingesta directamente';
  exception when insufficient_privilege then null; end;

  select * into r from public.admin_gasto(1);
  if r.mes is null then raise exception 'FALLO: un mes con solo gasto de ingesta no aparece'; end if;
  if r.ingesta_fichas < 50 or r.ingesta_coste_usd < 0.025 then raise exception 'FALLO: el mes no suma el gasto de la ingesta (% fichas, % USD)', r.ingesta_fichas, r.ingesta_coste_usd; end if;
  if r.preguntas is null or r.coste_usd is null then raise exception 'FALLO: preguntas o coste nulos en un mes sin preguntas'; end if;
  reset role;

  -- un periodista normal sigue sin ver el gasto
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
end $$;

-- C) permisos
do $$
begin
  if has_table_privilege('anon', 'public.gasto_ingesta', 'select') or has_table_privilege('authenticated', 'public.gasto_ingesta', 'select') then raise exception 'FALLO: gasto_ingesta legible por anon o authenticated'; end if;
  if has_table_privilege('authenticated', 'public.gasto_ingesta', 'insert') then raise exception 'FALLO: authenticated puede escribir gasto_ingesta'; end if;
  if has_table_privilege('service_role', 'public.gasto_ingesta', 'truncate') then raise exception 'FALLO: service_role puede vaciar gasto_ingesta'; end if;
  if has_function_privilege('anon', 'public.admin_gasto(int)', 'execute') or has_function_privilege('service_role', 'public.admin_gasto(int)', 'execute') then raise exception 'FALLO: admin_gasto abierta a anon o service_role'; end if;
  if not has_function_privilege('authenticated', 'public.admin_gasto(int)', 'execute') then raise exception 'FALLO: authenticated no puede ejecutar admin_gasto'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
