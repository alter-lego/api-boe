# Copia de seguridad semanal

Decidida el 21/11/2026. El plan gratuito de Supabase no incluye copias: este volcado es la única.
Workflow: `.github/workflows/copia-seguridad.yml` (domingos 03:15 UTC y a mano con «Run workflow»).

## Qué guarda
`pg_dump` del esquema `public` en formato custom, como artefacto de GitHub **90 días** (en el repositorio privado). Incluye publicaciones, sumarios, ingestas, periodistas y su log. **No incluye los datos de `consultas`** (preguntas de los periodistas: sensibles, se borran a los 90 días y no hace falta restaurarlas). Las funciones, políticas RLS y permisos se pueden recrear aplicando las migraciones; el volcado va con `--no-privileges` y los permisos salen de las migraciones.
Aviso: el artefacto contiene correos de periodistas. Solo lo ve quien tenga acceso al repositorio (privado); no lo hagas público.

## Puesta en marcha (la hace el usuario, una vez)
1. **Crear un rol de solo lectura** (no usar la contraseña de `postgres`). En el SQL Editor, con una contraseña larga inventada por ti (no la pegues en el chat):
   ```sql
   create role respaldo login bypassrls password 'PON-AQUI-UNA-CONTRASEÑA-LARGA';
   grant pg_read_all_data to respaldo;
   ```
   `bypassrls` es necesario porque las tablas tienen RLS y, sin él, `pg_dump` falla. **Si el SQL Editor rechaza `bypassrls`** (requiere superusuario), dímelo antes de seguir: la alternativa es usar el usuario `postgres`, que tiene más permisos y habría que valorarlo.
2. **Cadena de conexión:** Supabase → botón **Connect** → **Session pooler** (funciona con IPv4, que es lo que usa GitHub). Tiene la forma `postgresql://respaldo.<ref>:<contraseña>@aws-…pooler.supabase.com:5432/postgres`: usuario `respaldo.<ref del proyecto>` y tu contraseña del paso 1.
3. **Secreto en GitHub:** repositorio → Settings → Secrets and variables → Actions → New repository secret → nombre exacto `SUPABASE_DB_URL`, valor la cadena anterior.
4. **Probar:** pestaña Actions → «Copia de seguridad» → Run workflow. Debe quedar en verde y generar un artefacto `respaldo-…`.

## Restaurar (en un proyecto Supabase nuevo)
1. Aplicar las migraciones en orden y las funciones (`supabase/migrations/`).
2. Descargar el artefacto y restaurar solo los datos: `pg_restore --data-only --no-owner -d "<cadena del proyecto nuevo>" respaldo.dump` (con las tablas ya creadas por las migraciones).
3. Volver a crear los usuarios de Supabase Auth (el volcado no incluye `auth`): `admin_alta_periodista`/Edge Function para cada periodista, y la clave pública, claves y secretos del Worker y de GitHub.
4. Pasar `supabase/tests/*.sql` para comprobar permisos.

## Mantenimiento
- Los artefactos caducan a los 90 días: siempre hay unas 13 copias.
- La contraseña del rol `respaldo` se puede rotar con `alter role respaldo password '…'` (y actualizar el secreto).
- El volcado no incluye el esquema `auth`: los usuarios de Auth no están en la copia (están en Supabase, y se recrean por correo).
