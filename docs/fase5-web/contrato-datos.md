# Contrato de datos de la web (v2, 14/11/2026)

**Cambio de contrato (aviso de la sesión de API, 14/11/2026):** la web NO llama a Supabase por RPC ni toca las tablas. Solo usa **Supabase Auth** (magic link) para obtener la sesión y llama a la **API** (Worker de Cloudflare, Fase 3, ya desplegado) con `Authorization: Bearer <access_token>`.
- URL de la API: `https://api-boe.alter-lego.workers.dev` (código en `api/src/app.js`).
- La web solo conoce la URL de Supabase y la clave pública (anon) para el login, y la URL de la API. Nunca `service_role` ni claves de Anthropic.
- **CORS:** la API solo acepta orígenes de `ALLOWED_ORIGINS` (ahora `localhost:5173` y `:8080`). Cuando exista el dominio de la web (`algo.pages.dev`), hay que comunicarlo a la sesión de API.

## Rutas de la API
Todas son GET salvo la última; todas exigen sesión salvo `/v1/health`.
| Ruta | Parámetros | Respuesta |
| --- | --- | --- |
| `GET /v1/health` (sin sesión) | — | `{ok, ultima_ingesta:{fecha, fin}}` |
| `GET /v1/publicaciones` | filtros (abajo) + `limit` (1-100, por defecto 20) | `{n, publicaciones:[ficha]}` |
| `GET /v1/conteos` | mismos filtros + `agrupar` = `total` \| `mes` \| `organismo` \| `tipo` | `{agrupar, grupos:[{grupo, n}]}` |
| `GET /v1/publicaciones/{id}` | — | una ficha; 404 si no existe |
| `GET /v1/sumarios/{AAAA-MM-DD}` | — | `{fecha, total, secciones:[{seccion, seccion_nombre, publicaciones:[ficha]}]}` (ya agrupado por sección) |
| `POST /v1/preguntar` | JSON `{pregunta}` (3-1000 caracteres) | `{respuesta, citas:[{id,titulo,fecha,organismo,seccion,nivel_privacidad,url_html,url_pdf,avisos}], sin_resultados, datos_desde, datos_hasta, preguntas_hoy:{usadas,limite}}`; contrato completo en `docs/fase4-preguntar.md` |

### Filtros de `/v1/publicaciones` y `/v1/conteos`
| Parámetro | Notas |
| --- | --- |
| `q` | texto libre: título, resumen y texto completo; admite comillas, `-` y `or`; máx. 500 caracteres |
| `desde`, `hasta` | `AAAA-MM-DD` |
| `seccion` | `1`, `2A`, `2B`, `3`, `4`, `5A`, `5B`, `5C`, `T` |
| `organismo` | código o fragmento del nombre, sin tildes |
| `tema` | uno o varios separados por coma, máx. 5; valores de `docs/listas-fichas.md`; solo alcanza anuncios con resumen |
| `tipo` | un valor de tipo de publicación (18); solo alcanza anuncios con resumen |
| `rango` | Resolución, Orden, Real Decreto, Real Decreto-ley, Acuerdo, Sentencia, Providencia; sin distinguir tildes ni mayúsculas; muchos anuncios tienen rango null |
Los nombres de los filtros usan el vocabulario de la interfaz (`organismo`, `tipo`); los campos de cada ficha conservan los de la base (`departamento`, `tipo_acto`…).
Orden fijo: relevancia (si hay `q`) y después fecha descendente. **Sin paginación, sin offset y sin orden ascendente** (máximo 100).
`/v1/conteos` con `agrupar=tipo` agrupa las no clasificadas (anuncios sin resumen) como «sin clasificar». No agrupa por sección: para el recuento por sección se usa el sumario del día.

### Errores (JSON `{error}`)
| Código | Significado | Qué muestra la interfaz |
| --- | --- | --- |
| 400 | filtro no válido o búsqueda sin palabras útiles (mensaje legible) | «Búsqueda demasiado genérica» (ver `ux.md` §6.2) o aviso de filtro no válido |
| 401 | sesión no válida o caducada | «Tu sesión ha caducado» + «Entrar de nuevo» |
| 403 | correo no autorizado (no está en `periodistas`) | pantalla «Sin acceso» |
| 404 | publicación no encontrada | «No encontramos esa publicación» |
| 504 | consulta demasiado lenta | «No se pudo cargar. Reintentar» |
| 502 | fallo al consultar | «No se pudo cargar. Reintentar» |
Sin conexión o error de red: igual que 502.

## Ficha de publicación (`ficha_publicacion`), cada elemento de las respuestas
| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | text | `BOE-A-2026-12345` |
| `fecha` | date | |
| `seccion` | text | `1`, `2A`, `2B`, `3`, `4`, `5A`, `5B`, `5C`, `T` |
| `seccion_nombre` | text | |
| `departamento_codigo` | text | |
| `departamento` | text | en la interfaz, «Organismo» |
| `epigrafe` | text | |
| `titulo` | text | Título oficial, se muestra siempre |
| `rango` | text | |
| `url_html`, `url_pdf`, `url_xml` | text | Enlaces al BOE; se usan tal cual. La interfaz no usa `url_xml` |
| `resumen` | text | Nulo si anuncio con datos personales o sin ficha todavía |
| `temas` | text[] | 1-3 de los 29; nulo si anuncio con datos personales |
| `tipo_acto` | text | uno de los 18; en la interfaz, «Tipo de publicación» |
| `nivel_privacidad` | text | `publico` o `restringido` |
| `corrige_a` | text | id de otra publicación (puede no existir en la base) |
| `referencias` | jsonb | normas anteriores; nulo si anuncio con datos personales (estructura sin documentar) |
| `aviso_fuente` | text | aviso sobre incoherencias del texto oficial; null en restringidas |
| `ficha_revisar` | boolean | resumen retenido para revisión; null en restringidas |
| `estatus_derogacion` | text | del XML («N» = vigente, según el XML; verificar) |
| `judicialmente_anulada` | boolean | |
| `vigencia_agotada` | boolean | |
| `vigencia_actualizada` | timestamptz | cuándo se leyó la vigencia |
En un anuncio con datos personales (restringido) solo salen los campos de vigencia; `aviso_fuente` y `ficha_revisar` llegan como null. `ficha_motivo_revision` no se expone. Si un dato falta, no se muestra nada. Pendiente al construir: confirmar los tipos exactos leyendo la migración 9 y la respuesta real de la API.

## Qué hay detrás (referencia; la web no lo llama)
Funciones de Supabase que usa la API: `buscar_publicaciones`, `contar_publicaciones`, `sumario_del_dia`, `publicacion`, `ultima_ingesta`, `consultas_de_hoy`. Para «Preguntar», la API usa además `reservar_consulta` y `completar_consulta` (la web no las llama; `registrar_consulta` ya no existe). Las tablas tienen RLS cerrada. Detalles en `supabase/migrations/`.

## Listas cerradas
- **Secciones**: `1` I Disposiciones generales · `2A` II.A Nombramientos y ceses · `2B` II.B Oposiciones y concursos (datos personales) · `3` III Otras disposiciones · `4` IV Administración de Justicia (datos personales) · `5A` V.A Contratación del Sector Público · `5B` V.B Otros anuncios oficiales (con datos personales en ciertos casos) · `5C` V.C Anuncios particulares (datos personales) · `T` Tribunal Constitucional.
- **Tipos de acto (18)** y **temas (29)**: valores en `docs/listas-fichas.md`; etiquetas de la interfaz en `etiquetas.md`.
- Qué es restringido (resumen): ver `docs/niveles-privacidad.md`.

## Reglas de uso en el cliente
- Sin `service_role` ni claves de Anthropic en el bundle; sin acceso a las tablas ni a las RPC de Supabase.
- Cada petición a la API lleva `Authorization: Bearer <access_token>` de la sesión de Supabase Auth. Si el token caduca, se renueva con Supabase Auth; si sigue fallando con 401, «Tu sesión ha caducado».
- Enlaces: `url_html` y `url_pdf` tal cual; si falta alguno, no se muestra ese botón.
- Fechas en `AAAA-MM-DD`; mostrar en español, zona Madrid.
- Las URLs de la web llevan los filtros como parámetros (compartible).
- Búsqueda: se ejecuta al pulsar Buscar o Intro (sin búsqueda en vivo).
- La frescura se obtiene de `GET /v1/health`, que no exige sesión.

## Excepción: administración de periodistas (14/11/2026)
La pantalla `/admin` llama a Supabase por RPC con la sesión del usuario (no pasa por la API), con las funciones de `supabase/migrations/20261114120000_rls_y_admin.sql`: `es_admin()`, `admin_listar_periodistas()`, `admin_alta_periodista(p_email, p_nombre, p_limite_diario, p_es_admin)`, `admin_modificar_periodista(p_email, p_nombre, p_limite_diario, p_activo, p_es_admin)` (null = no cambiar) y `admin_ver_log(p_limite)`. Errores de Postgres: 42501 sin permiso, 22023 dato no válido, 23505 correo repetido, 23514 debe quedar un administrador activo, P0002 no existe. Si las funciones no existen aún, `es_admin()` falla y la pantalla se oculta.

**Alta con acceso (14/11/2026):** el alta y la acción «Crear acceso» no usan `admin_alta_periodista` directamente sino la Edge Function `POST https://dgybontyrywfdzxvapqr.supabase.co/functions/v1/swift-task` (constante `FUNCION_ALTA` en `web/src/config.ts`, cambiable con `VITE_FUNCION_ALTA`). Cabeceras `Authorization: Bearer <token del administrador>`, `apikey: <clave publicable>`, `Content-Type: application/json`. Cuerpos: `{accion:'alta', email, nombre?, limite_diario?, es_admin?}` y `{accion:'acceso', email}`. Respuesta 200 `{ok, periodista, acceso_creado}`. Errores: 400, 401 (cierra la sesión local), 403, 404, 409, 413/415 y 502 con `periodista_creado` o `periodista_quiza_creado` (alta hecha o dudosa: se recarga la lista y se ofrece «Crear acceso»). Contrato completo: `docs/edge-function-alta.md`. Modificar, baja y registro siguen usando las funciones `admin_*`.
