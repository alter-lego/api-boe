-- Pruebas de la migración 21: el rol `respaldo` lee las tablas que se copian y nada más.
-- Pegar entero en Supabase → SQL Editor DESPUÉS de la migración 21. Solo lee permisos: no cambia nada.
-- Si algo falla, el error empieza por "FALLO".
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'respaldo') then
    raise exception 'FALLO: no existe el rol respaldo (¿la copia usa postgres?)'; end if;
  if pg_has_role('respaldo', 'pg_read_all_data', 'member') then
    raise exception 'FALLO: respaldo sigue teniendo pg_read_all_data'; end if;
  if (select rolsuper from pg_roles where rolname = 'respaldo') then
    raise exception 'FALLO: respaldo es superusuario'; end if;

  foreach t in array array['auth.users', 'auth.refresh_tokens', 'auth.one_time_tokens', 'auth.sessions', 'public.consultas'] loop
    if to_regclass(t) is not null and has_table_privilege('respaldo', t, 'select') then
      raise exception 'FALLO: respaldo puede leer %', t; end if;
  end loop;

  foreach t in array array['public.boletines', 'public.sumarios', 'public.publicaciones', 'public.ingestas',
                           'public.periodistas', 'public.periodistas_log', 'public.gasto_ingesta', 'public.resumenes_dia'] loop
    if not has_table_privilege('respaldo', t, 'select') then
      raise exception 'FALLO: respaldo no puede leer % (la copia fallaría)', t; end if;
    if has_table_privilege('respaldo', t, 'insert') or has_table_privilege('respaldo', t, 'update')
       or has_table_privilege('respaldo', t, 'delete') then
      raise exception 'FALLO: respaldo puede escribir en %', t; end if;
  end loop;

  -- Toda tabla de public, salvo consultas, tiene que poder volcarse: si alguien añade una y no le da SELECT, avisa aquí.
  for t in select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' and tablename <> 'consultas' loop
    if not has_table_privilege('respaldo', t, 'select') then
      raise exception 'FALLO: tabla nueva % sin SELECT para respaldo: la copia fallará', t; end if;
  end loop;
end $$;

select 'TODAS LAS PRUEBAS OK' as resultado;
