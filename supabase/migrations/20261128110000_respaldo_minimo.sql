-- Migración 21 · El rol de la copia de seguridad (`respaldo`) solo lee lo que se copia
--
-- Por qué: la guía de docs/copia-seguridad.md lo creaba con `grant pg_read_all_data`, que da lectura sobre TODOS
-- los esquemas: también `auth` (usuarios, tokens de sesión y de enlaces de entrada) y `public.consultas` (las
-- preguntas de la redacción). Con la cadena de conexión de la copia (secreto SUPABASE_DB_URL de GitHub) se podía
-- entrar como cualquier periodista o administrador. Auditoría del 26/11/2026, 1.5. Comprobado en la base el 27/11.
--
-- Qué hace: le quita pg_read_all_data y le da SELECT solo sobre las tablas de `public` que se copian. `consultas`
-- queda fuera: el workflow la excluye entera (--exclude-table), porque pg_dump bloquea con LOCK TABLE cada tabla
-- que vuelca y eso exige SELECT. Conserva `bypassrls` (sin él pg_dump falla por las políticas RLS); bypassrls no da
-- permisos sobre tablas, solo evita las políticas de las que ya puede leer.
--
-- Si se crea una tabla nueva en `public`, hay que darle SELECT aquí (con otra migración) o excluirla del volcado:
-- si no, la copia semanal falla (y GitHub avisa) en lugar de copiar algo sin querer.
-- No hace nada si el rol no existe (proyecto nuevo sin copia configurada).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'respaldo') then
    raise notice 'No existe el rol respaldo: nada que cambiar';
    return;
  end if;

  if pg_has_role('respaldo', 'pg_read_all_data', 'member') then
    revoke pg_read_all_data from respaldo;
  end if;

  grant usage on schema public to respaldo;
  grant select on public.boletines, public.sumarios, public.publicaciones, public.ingestas,
                  public.periodistas, public.periodistas_log, public.gasto_ingesta, public.resumenes_dia
     to respaldo;
  grant select on all sequences in schema public to respaldo;
  revoke all on public.consultas from respaldo;
end $$;
