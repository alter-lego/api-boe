# Pendientes y decisiones aplazadas (actualizado el 14/11/2026)

## Aplazado por decisión del usuario
- **Servicio de correo propio (SMTP).** El correo por defecto de Supabase solo envía 2 mensajes por hora en todo el proyecto: con más de un par de periodistas pidiendo su enlace, el login no sirve. Opciones valoradas: Gmail con contraseña de aplicación (la más rápida para el curso), Resend (exige dominio propio), Brevo, o el servidor de correo de eldiario.es (lo adecuado para uso real). Se configura en Supabase → Authentication → Emails → SMTP Settings. Imprescindible antes de abrir la herramienta al equipo.
- **Rol de ingesta con permisos mínimos.** Hoy la ingesta usa `service_role` (GitHub Secrets). Un rol propio exigiría conexión directa a Postgres o funciones con token, porque las claves `sb_secret_` solo actúan como `service_role`.
- **Más histórico** (hoy hay 3 meses, 13/08–13/11/2026): descartado por ahora. Un año no cabe en el plan gratuito de Supabase.
- **`POST /v1/entrar`** (login validado contra la lista de periodistas desde el Worker): descartado; el código está en la rama local `aparcado/entrar`. Lo sustituye la Edge Function de `docs/edge-function-alta.md`.

## Abierto
- **Nota de protección de datos (RGPD)** sobre el índice de nombres de las restringidas (finalidad, plazo de conservación, supresión).
- **Fase 4:** hecha y desplegada (ver `fase4-preguntar.md`). **Fase 6:** pruebas con preguntas reales.
- **Panel de Supabase** (requisitos de la identidad por correo): «Secure email change» activo y Redirect URLs exactas, sin comodines.
- **Web:** decisiones menores en `docs/fase5-web/preguntas-abiertas.md` (aviso tras pedir el enlace, PKCE, registro de errores).
- **Edge Function:** publicada con el nombre automático `swift-task`; si se quiere el nombre claro, hay que publicarla de nuevo con otro nombre y actualizar la URL de la web.
- **Mantenimiento:** el límite de sesión de 24 h vive en dos sitios (base de datos y `SESION_MAX_HORAS` del Worker): si cambia, cambiar los dos. Los workflows de GitHub avisan de que Node 20 queda obsoleto: revisar versiones de las acciones.

## Decisiones y tareas añadidas el 21/11/2026
- **Sanciones (III):** decidido el 21/11/2026: **públicas**. Sin cambios de código. Ver `niveles-privacidad.md`.
- **Tras el piloto (decidido):** el servicio pasa a la nube propia de la organización, con otra configuración, mantenido por un equipo ya existente. No es tarea de este proyecto.
- **Fase 6 · documentación de traspaso** (falta): arquitectura (existe `RESUMEN-PROYECTO.md` como base), registro de decisiones, runbook (despliegue, claves, caducidades, alta de periodistas, ingesta) y guía «cómo añadir una fuente». Dependencias de Supabase a documentar: Postgres + Auth (enlace por correo, `amr`) + Edge Function + claves `sb_*`; el Worker y la ingesta dependen de las funciones SQL y de PostgREST.
- **Ampliación futura (BORME, CENDOJ, otros boletines):** el piloto ya facilita el traspaso (`publicaciones.boletin`, tabla `boletines`, reglas en `skill/*.md`), pero la ingesta está atada a BOE (`boletin: 'BOE'` fijo en `ingesta/boe.js`, `clasificarNivel` por secciones del BOE) y habrá que **rediseñar los niveles de privacidad** para BORME y CENDOJ. No se construye nada ahora.

## Pendiente tras la revisión del documento del curso v2 (21/11/2026)
Hecho ese día: caché de respuestas por periodista, gasto mensual solo para admins (`GET /v1/admin/gasto`) y copia de seguridad semanal (`docs/copia-seguridad.md`). Decidido que **no** hace falta el aviso de «preguntas guardadas 90 días» en la web. Queda:
- ~~Purga semanal de `consultas`~~: hecha el 21/11/2026 (`.github/workflows/purga-consultas.yml`, domingos). Falta lanzarla una vez a mano para comprobar que funciona.
- ~~Monitor de `/v1/health`~~: hecho el 21/11/2026 (`.github/workflows/monitor-ingesta.yml`, 09:00 UTC; falla si la última ingesta correcta tiene ≥6 h). El aviso llega por el correo de notificaciones de Actions de GitHub.
- **Batería `evals/preguntas.jsonl`** (60–80 preguntas, ~10 sin respuesta) y script que la lanza contra `/v1/preguntar` (acierto, cobertura, fidelidad, honestidad, coste y tiempo); elegir modelo con datos (hoy Haiku 5.5, esfuerzo `medium`; el documento pedía `low`).
- **Revisión manual de 50–100 fichas** antes de cargar más histórico.
- **Prueba con 4–5 periodistas** una semana, con encuesta y tiempos antes/después.
- **UI del gasto** en la web (solo admins; la API ya lo sirve). Y mostrar `en_cache: true` si se quiere («respuesta guardada de hoy»).
- **Caché compartida entre periodistas:** descartada por seguridad (cualquiera podría envenenarla escribiendo con su sesión); solo habría forma segura con un escritor de confianza (p. ej. un rol de servicio propio del Worker).
- **Gasto de la ingesta** (fichas con Haiku) no se registra en la base: el gasto mostrado solo cuenta preguntas.
- **Desviaciones conscientes respecto al documento v2** (por si se revisa): ingesta 2 veces al día (no cada 15 min); histórico de 3 meses (no 12); esfuerzo `medium`; las preguntas las lee cada periodista solo las suyas.
