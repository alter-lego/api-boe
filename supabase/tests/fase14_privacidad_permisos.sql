-- Pruebas de la migración 24: búsquedas sencillas en las restringidas, permisos mínimos de service_role y registro
-- de migraciones. Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 24.
-- Todo en una transacción con rollback. Si algo falla, el error empieza por "FALLO".
begin;

insert into public.periodistas (email, nombre, limite_diario, activo, es_admin) values
  ('p1@test.local', 'Uno', 10, true, false);
insert into public.publicaciones (id, boletin, fecha, seccion, titulo, nivel_privacidad) values
  ('TEST-DED-1', 'BOE', '2099-05-01', '4', 'Edicto de prueba.', 'restringido');
update public.publicaciones set tsv_texto = strip(to_tsvector('spanish', 'zacarias herrero quintanilla deudor'))
 where id = 'TEST-DED-1';

do $$
declare n int; t text; nombres int;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"p1@test.local","amr":[{"method":"otp","timestamp":4102444800}]}', true);
  set local role authenticated;

  -- A) consulta sencilla: el cuerpo de la restringida se sigue encontrando
  select count(*) into n from public.buscar_publicaciones(p_desde => '2099-01-01', p_q => 'herrero quintanilla');
  if n <> 1 then raise exception 'FALLO: la búsqueda sencilla no encuentra la restringida (%)', n; end if;
  -- B) con «or», exclusión o más de 6 palabras, no se mira su cuerpo
  foreach t in array array['herrero or perez', 'herrero -perez', 'herrero quintanilla zacarias deudor uno dos tres'] loop
    select count(*) into n from public.buscar_publicaciones(p_desde => '2099-01-01', p_q => t);
    if n <> 0 then raise exception 'FALLO: «%» llega al cuerpo de una restringida', t; end if;
    select coalesce(sum(c.n), 0) into n from public.contar_publicaciones(p_desde => '2099-01-01', p_q => t) c;
    if n <> 0 then raise exception 'FALLO: el recuento de «%» cuenta el cuerpo de una restringida', t; end if;
  end loop;
  reset role;

  -- C) service_role: solo lo que usa la ingesta
  foreach t in array array['public.consultas', 'public.periodistas', 'public.periodistas_log', 'public.migraciones'] loop
    if has_table_privilege('service_role', t, 'select') or has_table_privilege('service_role', t, 'insert')
       or has_table_privilege('service_role', t, 'update') or has_table_privilege('service_role', t, 'delete') then
      raise exception 'FALLO: service_role tiene permisos sobre %', t; end if;
  end loop;
  foreach t in array array['public.publicaciones', 'public.sumarios', 'public.ingestas', 'public.gasto_ingesta', 'public.resumenes_dia', 'public.boletines'] loop
    if has_table_privilege('service_role', t, 'delete') or has_table_privilege('service_role', t, 'truncate') then
      raise exception 'FALLO: service_role puede borrar en %', t; end if;
  end loop;
  foreach t in array array['public.publicaciones', 'public.sumarios', 'public.resumenes_dia'] loop
    if not (has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
            and has_table_privilege('service_role', t, 'update')) then
      raise exception 'FALLO: a la ingesta le falta permiso sobre %', t; end if;
  end loop;
  if not (has_table_privilege('service_role', 'public.ingestas', 'insert') and has_table_privilege('service_role', 'public.gasto_ingesta', 'insert')) then
    raise exception 'FALLO: la ingesta no puede anotar ingestas o gasto'; end if;
  if not has_function_privilege('service_role', 'public.indexar_texto(text, text)', 'execute') then
    raise exception 'FALLO: la ingesta no puede indexar textos'; end if;

  -- D) registro de migraciones: todas las del repositorio (24) y nadie de la API lo ve
  select count(*) into nombres from public.migraciones;
  if nombres < 24 then raise exception 'FALLO: el registro tiene % migraciones (esperaba 24 o más)', nombres; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.migraciones'::regclass) then
    raise exception 'FALLO: public.migraciones sin RLS'; end if;
  if has_table_privilege('authenticated', 'public.migraciones', 'select') or has_table_privilege('anon', 'public.migraciones', 'select') then
    raise exception 'FALLO: la API puede leer public.migraciones'; end if;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;

rollback;
