# Alta de periodistas con acceso incluido (Edge Function de Supabase)

Decidido el 14/11/2026 (opción B). Código: `supabase/functions/gestionar-periodistas/index.js`; pruebas: `supabase/functions/test/gestionar.test.js`.

## Qué resuelve
Antes, dar de alta a un periodista exigía dos pasos: la pantalla de administración y, aparte, crear a mano su usuario en Supabase Auth. Con esta función basta el alta en la web: crea el usuario de Auth (confirmado y sin contraseña) y el periodista ya puede pedir su enlace de acceso.

## Cómo decide quién puede usarla
La función **no verifica el JWT por su cuenta**. Reenvía la sesión de quien llama a `admin_alta_periodista` (o `admin_listar_periodistas`). Esas funciones SQL comprueban en la base de datos que es un administrador activo con sesión de menos de 24 h (migraciones 10 y 11) y anotan su correo en el log. **Solo si la base acepta**, la función usa la clave secreta, y únicamente para `POST /auth/v1/admin/users`. La clave secreta la inyecta Supabase en la función (`SUPABASE_SECRET_KEYS`): no se copia a ningún otro sitio ni sale de Supabase.

## Contrato (para la web)
`POST https://dgybontyrywfdzxvapqr.supabase.co/functions/v1/swift-task`
(El panel publicó la función con el nombre automático `swift-task` en vez de `gestionar-periodistas`; funciona igual. El código del repositorio vive en `supabase/functions/gestionar-periodistas/`. Probada con sesiones reales el 14/11/2026: sin sesión 401, no admin 403, admin 200, CORS solo para la web.)
Cabeceras: `Authorization: Bearer <access_token>`, `apikey: <clave publicable>`, `Content-Type: application/json`.

| Acción | Cuerpo | Qué hace |
| --- | --- | --- |
| `alta` | `{accion:'alta', email, nombre?, limite_diario? (1-1000, por defecto 30), es_admin? (por defecto false)}` | da de alta en `periodistas` y crea el acceso |
| `acceso` | `{accion:'acceso', email}` | crea el acceso de alguien ya dado de alta y activo (reparación) |

Respuesta 200: `{ok:true, periodista:{email,nombre,limite_diario,activo,es_admin}, acceso_creado:boolean}` (`acceso_creado:false` = ya tenía usuario de Auth).
Errores `{error}`: 400 datos no válidos, 401 sesión caducada o ausente (la web cierra la sesión y pide entrar de nuevo), 403 no es administrador, 404 (`acceso`) ese correo no está dado de alta, 409 ya existe (`alta`) o está de baja (`acceso`), 413/415 cuerpo demasiado grande o no JSON, **502 con `periodista_creado:true`**: el alta se hizo pero falló crear el acceso → la web debe ofrecer reintentar con la acción `acceso`; **502 con `periodista_quiza_creado:true`**: no se pudo confirmar el alta (tiempo agotado o fallo de la base) → la web debe mostrar la lista y, si el periodista aparece, ofrecer `acceso`. Un 409 en `alta` sugiere lo mismo.

## Publicarla (lo hace el usuario, una sola vez y cada vez que cambie el código)
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `gestionar-periodistas` (exacto).
3. Borra el contenido del editor y pega el de `supabase/functions/gestionar-periodistas/index.js` (el editor lo llama `index.ts`; vale: es JavaScript sin tipos).
4. **Deploy function**.
5. Abre la función → **Details** (o Settings) y **desactiva «Verify JWT»** (el nombre exacto puede variar: «Verify JWT with legacy secret»). Hay que desactivarlo porque la comprobación de la plataforma puede rechazar sesiones firmadas con las claves asimétricas del proyecto; la autorización la decide la base de datos, como se explica arriba. Si el panel no deja guardar el cambio sin redesplegar, pulsa Deploy otra vez.
6. Avisa para que se pruebe con una sesión real.

## Qué conviene saber
- **La seguridad real es `sesion_vigente()` (migración 11), no la función.** Si en la base ya existía un usuario de Auth con ese correo y una contraseña puesta por un tercero, la función no lo distingue (responde `acceso_creado:false`). Ese tercero no entra a los datos porque su sesión llevaría un método `password` y `sesion_vigente()` solo acepta `otp`/`magiclink`. **Nunca debe relajarse `sesion_vigente()` para aceptar contraseña.**
- **Si el panel protesta por tipos al publicar** (el editor lo llama `index.ts` y el código es JavaScript sin tipos): avísame y lo convierto a TypeScript.
- **La función es pública** (sin «Verify JWT»), pero sin una sesión de administrador válida la base de datos rechaza la primera llamada y la clave secreta no llega a usarse. Cada intento anónimo cuenta como una invocación (plan gratuito: 500.000 al mes).
- **No envía correos.** El usuario se crea ya confirmado. El enlace de acceso lo envía Supabase cuando el periodista lo pide, y para eso sigue haciendo falta un servicio de correo propio (con el de Supabase solo salen 2 correos por hora en todo el proyecto).
- **Bajas:** no cambian. Basta con desactivar al periodista; pierde el acceso al instante aunque su usuario de Auth siga existiendo.
- Si Supabase retira `SUPABASE_SECRET_KEYS` o cambia su formato, la función admite también el nombre antiguo (`SUPABASE_SERVICE_ROLE_KEY`).
