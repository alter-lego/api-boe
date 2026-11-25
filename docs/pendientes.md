# Pendientes y decisiones aplazadas (actualizado el 21/11/2026)

## Hecho recientemente (para no repetirlo)
- **Correo propio (SMTP) con Gmail** (cuenta del proyecto, contraseña de aplicación) en Supabase → Authentication → Emails → SMTP Settings. Ya no aplica el límite de 2 correos por hora. Válido para el piloto; para uso real, lo adecuado es el servidor de correo de eldiario.es (el remitente actual es una cuenta de Gmail y algunos filtros pueden mandarlo a spam).
- **Entrada por enlace con confirmación** (`/confirmar`, flujo `token_hash`): el filtro de correo de la empresa gastaba el enlace de un solo uso al abrirlo. Ahora el correo enlaza a la web y solo se verifica al pulsar el botón. La plantilla «Magic Link» de Supabase enlaza a `{{ .SiteURL }}/confirmar?token_hash={{ .TokenHash }}&type=email` (Site URL = la web).
- Fase 4 (`POST /v1/preguntar`) con caché por periodista, aviso de preguntas dudosas (web) y rechazo en la API de las preguntas sin sentido evidente (`api/src/pregunta-valida.js`, copia de la regla dura de `web/src/dudosa.ts`: si cambia una, cambiar la otra).
- Gasto mensual solo para administradores (`GET /v1/admin/gasto`, y bloque «Gasto en IA» en Administración): preguntas y, desde el 25/11/2026 (migración 14), resúmenes de la ingesta, con el total del mes en curso.
- Copia de seguridad semanal **cifrada** (`docs/copia-seguridad.md`), purga semanal de `consultas` de más de 90 días y monitor de la ingesta (`/v1/health`, falla si la última ingesta correcta tiene ≥ 6 h).
- Pruebas automáticas en cada push y pull request (`pruebas.yml`: 127 pruebas de Node y compilación de la web). Las pruebas SQL (`supabase/tests/`) se pasan a mano tras cada migración.
- Acciones de GitHub actualizadas a `checkout@v7`, `setup-node@v7` y `upload-artifact@v7` (Node 24), que eliminan el aviso de Node 20.
- Web: portada «Preguntar primero», modo claro/oscuro, botón dentro de la caja, tarjeta «BOE de hoy».
- Claves de Anthropic: la del buscador se renovó (`buscador-boe-worker-2`, caduca el 21/12/2026); la antigua `buscador-boe-worker` se borró (confirmado el 21/11/2026). **Renovar `buscador-boe-worker-2` antes del 21/12/2026** (con `npx wrangler secret put ANTHROPIC_API_KEY` en el panel Terminal). La de la ingesta (`api-boe-ingesta`) caduca el 29/01/2027.

- **Panel de Supabase** comprobado el 21/11/2026: «Secure email change» activo, Site URL de la web y Redirect URLs exactas (sin comodines y sin `localhost`).

## Aplazado por decisión del usuario
- **Rol de ingesta con permisos mínimos.** Hoy la ingesta usa `service_role` (GitHub Secrets). Un rol propio exigiría conexión directa a Postgres o funciones con token, porque las claves `sb_secret_` solo actúan como `service_role`.
- **Más histórico** (hoy hay 3 meses, 13/08–13/11/2026): descartado por ahora. Un año no cabe en el plan gratuito de Supabase.
- **`POST /v1/entrar`** (login validado contra la lista de periodistas desde el Worker): descartado; el código está en la rama local `aparcado/entrar`. Lo sustituye la Edge Function de `docs/edge-function-alta.md`.
- **Sanciones (sección III):** decidido el 21/11/2026: **públicas**. Ver `niveles-privacidad.md`.
- **Tras el piloto (decidido):** el servicio pasa a la nube propia de la organización, con otra configuración, mantenido por un equipo ya existente.

## Abierto
- **Nota de protección de datos (RGPD)** sobre el índice de nombres de las restringidas (finalidad, plazo de conservación, supresión).
- **Fase 6:**
  - Batería `evals/preguntas.jsonl` (60–80 preguntas, ~10 sin respuesta; se están reuniendo preguntas de periodistas) y script que la lanza contra `/v1/preguntar` (acierto, cobertura, fidelidad, honestidad, coste y tiempo). Elegir modelo con datos (hoy Haiku 5.5, esfuerzo `medium`; el documento pedía `low`).
  - Revisión manual de 50–100 fichas antes de cargar más histórico.
  - Prueba con 4–5 periodistas una semana, con encuesta y tiempos antes y después.
  - Documentación de traspaso: arquitectura (base: `RESUMEN-PROYECTO.md`), registro de decisiones, runbook (despliegue, claves y caducidades, alta de periodistas, ingesta) y guía «cómo añadir una fuente».
- **Web:** decisiones menores en `docs/fase5-web/preguntas-abiertas.md`; en móvil de 375 px la barra de pestañas se sale por la derecha (la sesión de web puede arreglarlo).
- **Edge Function:** publicada con el nombre automático `swift-task`; si se quiere el nombre claro, hay que publicarla de nuevo y actualizar la URL de la web.
- **Mantenimiento:** el límite de sesión de 24 h vive en dos sitios (base de datos y `SESION_MAX_HORAS` del Worker): si cambia, cambiar los dos.
- **Gasto de la ingesta:** se registra desde el 25/11/2026 en `gasto_ingesta` (migración 14, una fila por pasada de `fichas.js`). Los meses anteriores no tienen ese dato; para ellos, la Console de Anthropic (clave `api-boe-ingesta`).
- **Caché compartida entre periodistas:** descartada por seguridad (cualquiera podría envenenarla escribiendo con su sesión); solo habría forma segura con un escritor de confianza propio del Worker.

## Riesgos conocidos
- **Bloqueos de LaLiga a Cloudflare.** En España, los días de partido, los operadores bloquean direcciones de Cloudflare por orden judicial y la web y la API (alojadas en Cloudflare) pueden dar `ERR_CONNECTION_TIMED_OUT` desde redes afectadas (visto el 21/11/2026 en Chrome de iOS con 5G; Safari con Relay privado de iCloud sí cargaba). Un dominio propio no lo evita (mismas direcciones). Solo se evitaría alojando fuera de Cloudflare: valorarlo en el traspaso a la nube de la organización.
- **El cron de GitHub no es fiable:** el 21/11/2026 no lanzó la ingesta de las 07:30. Por eso hay varias pasadas por la mañana y el monitor vigila la antigüedad.
- **Repositorio público** (desde el 21/11/2026): los artefactos de las Actions los puede descargar cualquiera con cuenta de GitHub (por eso la copia va cifrada), el diseño de seguridad es visible y las reglas de protección de ramas solo funcionan mientras sea público. Si se vuelve a privado, esas reglas dejan de aplicarse.

## Entornos
Solo existe producción: la rama `main` (la rama `pre` está creada pero no tiene entorno propio y la local `aparcado/entrar` no se subió), un proyecto de Supabase (`main · PRODUCTION`, plan gratuito sin ramas de base de datos), un Worker de API y uno de web, y una clave de Anthropic por uso. Los cambios llegan directos a producción; la red de seguridad es: pruebas automáticas en cada push, tests SQL con `rollback`, revisión independiente de lo sensible y despliegues solo desde la sesión principal. Para el traspaso (o antes, si se abre a la redacción): crear un entorno de pre (Worker `api-boe-pre`; segundo proyecto de Supabase con datos de prueba para ensayar migraciones), reglas de protección de `main` y claves separadas por entorno.

## Desviaciones conscientes respecto al documento del curso v2
Ingesta: cinco pasadas por la mañana de lunes a sábado (05:30–09:30 UTC) y una a las 13:30 UTC todos los días (el documento proponía cada 15 minutos). Histórico de 3 meses (no 12). Esfuerzo `medium` (no `low`). Las preguntas las lee cada periodista solo las suyas.
