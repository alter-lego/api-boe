# Decisiones, pendientes y dependencias (Fase 5)

Última actualización: 13/11/2026, tras revisar las maquetas. Estado puesto al día el 25/11/2026 (ver el bloque siguiente); el resto del documento se conserva como registro de decisiones.

> **Ya resuelto desde que se escribió (no volver a abrir):**
> - **Correo propio (SMTP):** configurado con Gmail el 21/11/2026; ya no aplica el límite de 2 correos por hora (`docs/pendientes.md`).
> - **Alta de periodistas desde `/admin`:** crea también el acceso con la Edge Function (14/11/2026); solo el primer administrador se crea a mano.
> - **Fase 4:** API de `/v1/preguntar` desplegada y probada; la web publicada lleva `VITE_PREGUNTAR=si` y la portada «Preguntar primero».
> - **CORS:** el dominio `buscador-boe.alter-lego.workers.dev` ya está en `ALLOWED_ORIGINS`. No se usa Cloudflare Pages sino un Worker con activos.
> - **Enlace de acceso que gastaban los filtros de correo:** resuelto con la ruta `/confirmar` (`ux.md` §12).
> - **Propuesta 5 (aviso de preguntas dudosas):** hecha en la web (`web/src/dudosa.ts`), y la API rechaza las evidentes (`api/src/pregunta-valida.js`).
>
> **Sigue abierto:** registro de errores, aviso neutro tras pedir el enlace (confirmación), PKCE, cómo cambiar de cuenta desde «Sin acceso», «Corregida por», cobertura del histórico en la interfaz, y resto de propuestas de mejora (2, 3, 4, 6 y 7). Resuelto el 25/11/2026: la barra de pestañas ya cabe en móvil de 375 px, y los textos secundarios son más grandes (mínimo 14 px).

## 1. Decisiones tomadas
| Tema | Decisión |
| --- | --- |
| Nombre y tono | «Buscador del BOE», tuteo |
| Logo | elDiario.es sin lema (SVG a color; blanco en tema oscuro). Origen: https://www.eldiario.es/assets/img/svg/logos/eldiario-tagline-2c.h-129fb361f1eeeaf4af9b8135dc8199ea.svg, recortado; uso autorizado por el responsable del proyecto |
| Colores y tipografía | Sobrios; azul de elDiario.es; Source Sans 3 y Source Serif 4 (propuesta propia, sin confirmar con elDiario.es) |
| Contacto para correos no autorizados | Ninguno; solo mensaje explicativo |
| Frescura | Ámbar si falta el BOE de hoy pasadas las 10:00 (Madrid); rojo a más de 2 días |
| Filtros | Menú desplegable «Filtros»; el texto libre es lo principal; ejemplos de búsquedas en lenguaje natural |
| «Copiar cita» | Incluido en el MVP |
| Búsqueda de nombres propios | Sin aviso en la interfaz |
| Pestañas | «Buscar» y «Resumen de hoy»; sin «Preguntar» hasta la Fase 4 |
| Vocabulario | Organismo (no departamento), Tipo de publicación (no tipo de acto), Generado con IA, sin XML, sin jerga técnica visible |
| Portada móvil | Tarjeta «BOE de hoy» reducida (fecha, total y «Ver sumario completo»), sin recuento por sección |
Detalle de pantallas y textos: `ux.md`. Etiquetas de listas: `etiquetas.md`.

## 2. Decisiones adicionales (13/11/2026)
- **Etiquetas** de temas, tipos y secciones: aprobadas (`etiquetas.md`).
- **Alcance del MVP**: sin exportar a CSV y sin guardar búsquedas.
- **Tipografía** (Source Sans 3 y Source Serif 4): aprobada.
- **Ejemplos de búsquedas** de la portada: aprobados.
- **«Preguntar al BOE»** en escritorio y móvil: se maqueta más adelante, en la Fase 4.
- **Todo lo demás**: aplazado por ahora (ver 3, 4, 5 y 6).

## 2b. Aviso en los filtros de tema y tipo (aprobado)
Solo aparece cuando hay un tema o tipo elegido, bajo el filtro: «Al filtrar por tema o tipo no salen los anuncios sin resumen (justicia, oposiciones y particulares).» Ya está en las maquetas y en `ux.md`.
Regla añadida: un anuncio sin resumen se muestra siempre con su título, y al pulsarlo se abre el detalle con lo que haya.

## 3. Login (14/11/2026: construido en la web; faltan estas decisiones)
- **Hecho en la web:** `/entrar`, `signInWithOtp` con `shouldCreateUser: false`, token renovado por supabase-js y enviado como `Bearer` a la API; mensajes distintos para 401 («sesión caducada», con «Entrar de nuevo») y 403 («Sin acceso»). El aviso tras pedir el enlace es neutro («Si tu correo está autorizado…»), para no revelar la lista; falta tu confirmación.
- **Pasos del usuario:** poner `VITE_MODO=api` y la clave anon en `web/.env`, y añadir `https://buscador-boe.alter-lego.workers.dev` y `http://localhost:5173` en Supabase → Authentication → URL Configuration.

### Pendientes del login
- **Alta de un periodista nuevo desde `/admin`:** `admin_alta_periodista` solo escribe en `periodistas`; no crea el usuario de Supabase Auth, y la web pide el enlace con `shouldCreateUser: false`, así que esa persona no podría entrar. Opciones: (a) dar de alta también el usuario en Auth a mano (hoy), o (b) cambiar a `shouldCreateUser: true` (cualquiera que escriba su correo recibiría un enlace, pero la API y la base le dirían «Sin acceso» si no está en `periodistas`). Decisión del usuario pendiente.
- Si se revela o no que un correo no está en la lista (`shouldCreateUser: false` o error posterior: la API devuelve 403 para un correo que no está en `periodistas`).
- ~~Duración de la sesión~~ **Decidido (14/11/2026): 24 horas desde el login por enlace.** Lo impone la API (`SESION_MAX_HORAS` en `api/wrangler.toml`, límite a partir de `amr[].timestamp` del JWT); la web trata el 401 como «Tu sesión ha caducado», cierra la sesión local y lleva a `/entrar`.
- Cómo cambia de cuenta quien entra con un correo equivocado (la pantalla «Sin acceso» no tiene «Salir»).
- Texto del correo del magic link, en español, y SMTP propio (el de Supabase integrado es muy limitado).

## 4. Dependencias de la Fase 3 (API/base)
- **Hecho (14/11/2026): el Worker de la Fase 3 está desplegado** en `https://api-boe.alter-lego.workers.dev`. Cambio de contrato: la web solo usa Supabase Auth y llama a la API con el token; no accede a tablas ni a RPC (ver `contrato-datos.md`).
- **Pendiente:** comunicar a la sesión de API el dominio de la web (`algo.pages.dev`) para añadirlo a `ALLOWED_ORIGINS` (CORS); hoy solo están `localhost:5173` y `:8080`.
- **Hecho (migración 9, 14/11/2026):** `ficha_publicacion` ya incluye `aviso_fuente`, `ficha_revisar`, `estatus_derogacion`, `judicialmente_anulada`, `vigencia_agotada` y `vigencia_actualizada` (de una publicación con datos personales solo salen los de vigencia). `ficha_motivo_revision` no se expone. Además `buscar_publicaciones` y `contar_publicaciones` aceptan `p_rango`. La ingesta diaria corre sola a las 08:30 y 14:30 (Madrid). Queda decidir si la web ofrece un filtro por rango (Resolución, Orden, Real Decreto…) y, mientras no haya motivo de revisión, cómo se explica «Resumen pendiente de revisión».
- **Orden y paginación** en `buscar_publicaciones`: hoy solo relevancia o fecha descendente, 100 como máximo. MVP: sin paginación y con el mensaje «afina». «Más recientes» con texto exige ordenar en cliente los ≤100 resultados o un parámetro nuevo.
- **Cobertura del histórico** («desde {fecha}»): no hay función que la dé.
- **«Sin BOE» frente a «aún no cargado»**: `ultima_ingesta` solo devuelve días con estado `ok`.
- **Recuento por sección**: resuelto; `GET /v1/sumarios/{fecha}` devuelve las publicaciones ya agrupadas por sección y con total.
- **«Corregida por»**: no hay función para buscar publicaciones con `corrige_a = id`.
- **Estructura de `referencias`** (jsonb): sin documentar.
- **Lista de organismos** para las sugerencias del filtro: no hay función; salen de resultados o de una lista fija.
- Pendiente de la revisión de seguridad: check de la base que impida `publico` fuera de las secciones permitidas.

## 5. Dependencias de la Fase 4 (preguntas con Claude)
- **Web (15/11/2026): pantalla `/preguntar` construida y probada en modo prueba** (respuesta con citas, límite diario simulado, cancelar). Para mostrarla en el build real hace falta `VITE_PREGUNTAR=si` en `web/.env`, solo cuando la API real esté desplegada y probada (falta: migración 12 aplicada por el usuario, clave de Anthropic del buscador y despliegue de la API por la sesión principal). Sin probar contra la API real: los 502/503/504 y el tiempo de espera de ~65 s.
- Texto histórico de esta sección (diseño previo al contrato final):
- Worker (Cloudflare, Hono) con endpoint tipo `POST /v1/preguntar`, autenticado con el JWT de Supabase; devuelve `{respuesta, citas:[{id,titulo,fecha,url_html}], usadas, limite}` y errores `429`, `401`, `422`. La web no llama a Anthropic.
- Cada cita es un `id` real devuelto por las funciones; sin cita, no hay afirmación.
- Límite diario: `consultas_de_hoy()`; lo hace cumplir el Worker, la web solo lo muestra.
- Respuesta en streaming (sí/no) y cancelación.
- Texto de privacidad de las preguntas (se guardan 90 días).
- Maqueta de móvil de «Preguntar».

## 6. Dependencias de despliegue y de la propia web
- Cloudflare Pages conectado al repo; variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- Supabase Auth: URL de Pages en Redirect URLs.
- `noindex` (meta y cabecera `X-Robots-Tag`) y `robots.txt`.
- **Registro de errores**: la persona no ve detalles técnicos; los fallos deben avisar solo a quien mantiene la herramienta. Falta decidir cómo y construirlo.
- **Componentes del design system** (tarjeta, línea de frescura, etiquetas, filtros): se añaden cuando se aprueben las maquetas.

## 7. Estado de los entregables
- **Maquetas de baja fidelidad (escritorio y móvil): aprobadas por el responsable el 13/11/2026.**
- `ux.md` v2, `contrato-datos.md`, `etiquetas.md` y este documento: en esta carpeta.
- Maquetas de baja fidelidad (escritorio y móvil) y design system: en Claude Design.
- `prompt-lovable.md` y `wireframes.md` del encargo original: no se hacen (Lovable descartado; el lienzo hace de wireframes). Cuando se construya, el contrato de datos pasará a `web/CLAUDE.md`.

## Seguridad de la web (revisión del 14/11/2026)
- **Cabeceras** (`web/public/_headers`): política de contenido (CSP) que solo permite scripts propios, estilos propios y de Google Fonts, y conexiones a la API y a Supabase; además `X-Frame-Options: DENY`, `Permissions-Policy`, `noindex`. Probado con un build real servido con `wrangler dev`: sin violaciones al recorrer inicio, resultados, detalle, sumario, administración y filtros.
- **Enlaces a la fuente:** solo se pintan si son `https` y de `boe.es` o `*.boe.es`; si no, no hay botón.
- **Sesión caducada:** un 401 de la API o de las funciones de administración (`PT401`, `PGRST301`) cierra la sesión local y lleva a `/entrar`; un visitante sin sesión no ve el aviso de caducidad.
- **Demasiados enlaces:** un 429 al pedir el enlace muestra «Has pedido demasiados enlaces; espera unos minutos.», sin revelar si el correo está autorizado.
- **Dependencias:** `react-router-dom` 7.18 y `vite` 8 (con `@vitejs/plugin-react` 6); `npm audit`: 0 vulnerabilidades; el build pasa.
- **PKCE (`flowType: 'pkce'`): no activado.** Con PKCE el enlace solo funciona en el mismo navegador y dispositivo que lo pidió (si se abre el correo en el móvil y el enlace se pide en el ordenador, falla). No se ha podido probar con un correo real; decidir si ese cambio de comportamiento compensa.

## Acceso por la lista de periodistas: `POST /v1/entrar` — DESCARTADO (decisión del usuario, 14/11/2026)
- Se había propuesto un endpoint en la API que validara el correo contra `periodistas` y creara el usuario de Auth. **El usuario decidió no hacerlo:** se mantiene el paso manual y la clave `service_role` no vive en el Worker. El código quedó aparcado en una rama local de la sesión de API (`aparcado/entrar`) y no está desplegado.
- **Lo que rige:** `Entrar` pide el enlace con `signInWithOtp` y `shouldCreateUser: false` (solo entran correos con usuario en Supabase Auth); la API y la base comprueban además que el correo esté activo en `periodistas`. **Actualización (14/11/2026):** el alta desde `/admin` ya crea también el usuario de acceso mediante una Edge Function de Supabase (opción B, `docs/edge-function-alta.md`); el botón «Crear acceso» de cada fila repara los casos dados de alta sin usuario (p. ej. un periodista dado de alta antes de existir la función). Ya no hace falta el paso manual en Authentication → Users, salvo para el primer administrador.
- **Administrador como periodista:** el administrador es además una fila de `periodistas`, así que ya puede buscar; la pestaña «Administración» se suma en su cabecera.

## Abierto a 14/11/2026
- **Despliegue de la web: hecho el 14/11/2026.** Versión actual `9ad535c4` de `buscador-boe` (commit `7c58793`: alta con acceso por Edge Function y «Crear acceso»); la anterior, `3b37afba`, llevó el commit `93c38fa` (CSP, enlaces validados, `react-router` 7 y `vite` 8). La petición previa (CORS) de la función `swift-task` desde la web publicada responde bien; falta probar el alta real como administrador. Comprobado en vivo: cabeceras de seguridad activas y pantalla de entrada sin errores de CSP. Falta que el usuario pruebe el login real y las pantallas con sesión en esta versión.
- **Registro de errores** (cómo avisar a quien mantiene la herramienta cuando la web falla): sin decidir.
- **Servicio de correo propio:** el de Supabase solo envía 2 correos por hora en todo el proyecto, insuficiente si entran varios periodistas a la vez (hace falta un SMTP propio).
- **Usuario de Auth del primer administrador:** debe existir en Supabase Auth con el correo confirmado para que pueda entrar.
- **Aviso neutro tras pedir el enlace:** pendiente de confirmación del usuario.
- **PKCE:** no activado (el enlace solo funcionaría en el mismo navegador y dispositivo que lo pidió).
- **«Preguntar al BOE» (Fase 4):** maqueta y pantalla pendientes de que exista el endpoint.
- **Más componentes del design system** (filtros, estados, fila del sumario).
- **Verificar con la respuesta real de la API** los tipos de los campos de vigencia y el significado de `estatus_derogacion`.

## Propuestas de mejora (21/11/2026): prototipos de baja fidelidad pendientes de decidir
Lienzo de Claude Design «Propuestas de mejora Buscador del BOE» (https://claude.ai/artifact/1eFd6CUUQLHTXRMgFJCKup), 7 pantallas:
1. **Portada «Preguntar primero»** y 2. **«Dos puertas»**: decidir dónde está el valor (preguntar frente a buscar).
3. **Dirección visual:** estilo actual afinado frente a «editorial cálida» (blanco roto, tinta cálida, titulares en grotesca, trama de líneas de texto como firma, azul de elDiario.es como único acento; contraste AA).
4. **Respuesta con jerarquía:** pregunta editable arriba, titular con la cifra, lista con dato destacado y fecha, «Ver las N en el buscador» (necesita que la API devuelva los filtros que usó el asistente) y leyenda.
5. **Aviso antes de enviar una pregunta dudosa** (sin sentido o demasiado corta), con «Reformular» y «Preguntar igualmente» (cuenta en el límite). Comprobación de forma en el navegador, sin mirar resultados; reforzable en la API.
6. **Página «Cómo funciona y hasta dónde fiarte».**
7. **Portada en móvil.**
Nada de esto está implementado; se decide tras verlo. Ya hecho el primer lote (commit `d9714c6`): pestaña activa por sección, sumario con recuento y flechas con texto, cierre de filtros al clicar fuera, «Agrupar resultados por…», citas sin hueco.
