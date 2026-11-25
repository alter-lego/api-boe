-- Pruebas de la migración del resumen del día (20261127100000_resumen_dia.sql): resumen editorial del día (resumenes_dia y resumen_del_dia).
-- Pegar entero en Supabase → SQL Editor y ejecutar DESPUÉS de esa migración.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo) values
  ('p1@test.local', 'Uno', 10, true),
  ('baja@test.local', 'De baja', 10, false);

-- A) la ingesta (service_role) inserta, lee y actualiza, pero no borra
do $$
declare n int;
begin
  set local role service_role;
  insert into public.resumenes_dia (fecha, contenido, n_publicaciones, modelo, version)
    values ('2099-01-02', '{"titulares":[{"tema":"Vivienda","texto":"Prueba","ids":["TEST-1"]}],"secciones":[],"apartados":{}}', 3, 'claude-sonnet-5-5', 1);
  insert into public.resumenes_dia (fecha, contenido, n_publicaciones, modelo, version)
    values ('2099-01-02', '{"titulares":[]}', 4, 'claude-sonnet-5-5', 1)
    on conflict (fecha) do update set contenido = excluded.contenido, n_publicaciones = excluded.n_publicaciones;
  select n_publicaciones into n from public.resumenes_dia where fecha = '2099-01-02';
  if n <> 4 then raise exception 'FALLO: service_role no puede regenerar el resumen de un día'; end if;
  update public.resumenes_dia set contenido = '{"titulares":[{"tema":"Vivienda","texto":"Prueba","ids":["TEST-1"]}]}' where fecha = '2099-01-02';
  begin
    delete from public.resumenes_dia;
    raise exception 'FALLO: service_role puede borrar resúmenes';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.resumenes_dia (fecha, contenido, n_publicaciones, modelo, version) values ('2099-01-03', '[]', 1, 'm', 1);
    raise exception 'FALLO: acepta un contenido que no es un objeto';
  exception when check_violation then null; end;
  begin
    perform public.resumen_del_dia('2099-01-02');
    raise exception 'FALLO: service_role puede ejecutar resumen_del_dia';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- B) un periodista lo recibe solo por la función; la tabla no la ve
do $$
declare v jsonb; n int; st text;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin
    select count(*) into n from public.resumenes_dia;
    raise exception 'FALLO: un periodista lee la tabla resumenes_dia directamente';
  exception when insufficient_privilege then null; end;

  v := public.resumen_del_dia('2099-01-02');
  if v is null then raise exception 'FALLO: un periodista no recibe el resumen del día'; end if;
  if v->'contenido'->'titulares'->0->>'texto' is distinct from 'Prueba' then raise exception 'FALLO: el contenido no llega entero (%)', v; end if;
  if v->>'fecha' is distinct from '2099-01-02' or v->'generado_en' is null then raise exception 'FALLO: faltan fecha o generado_en (%)', v; end if;
  if v ? 'avisos' or v ? 'modelo' then raise exception 'FALLO: resumen_del_dia expone datos internos (%)', v; end if;
  if public.resumen_del_dia('2099-01-05') is not null then raise exception 'FALLO: un día sin resumen no devuelve null'; end if;
  reset role;

  -- un periodista de baja no lo recibe
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"baja@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;
  begin
    perform public.resumen_del_dia('2099-01-02');
    raise exception 'FALLO: un periodista de baja recibe el resumen';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st = 'P0001' and sqlerrm like 'FALLO%' then raise; end if;
    if st <> '42501' then raise exception 'FALLO: periodista de baja esperaba 42501 y salió %', st; end if;
  end;
  reset role;
end $$;

-- C) permisos
do $$
begin
  if has_table_privilege('anon', 'public.resumenes_dia', 'select') or has_table_privilege('authenticated', 'public.resumenes_dia', 'select') then raise exception 'FALLO: resumenes_dia legible por anon o authenticated'; end if;
  if has_table_privilege('authenticated', 'public.resumenes_dia', 'insert') or has_table_privilege('authenticated', 'public.resumenes_dia', 'update') then raise exception 'FALLO: authenticated puede escribir resumenes_dia'; end if;
  if has_table_privilege('service_role', 'public.resumenes_dia', 'delete') or has_table_privilege('service_role', 'public.resumenes_dia', 'truncate') then raise exception 'FALLO: service_role puede borrar resumenes_dia'; end if;
  if has_function_privilege('anon', 'public.resumen_del_dia(date)', 'execute') then raise exception 'FALLO: resumen_del_dia abierta a anon'; end if;
  if not has_function_privilege('authenticated', 'public.resumen_del_dia(date)', 'execute') then raise exception 'FALLO: authenticated no puede ejecutar resumen_del_dia'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
