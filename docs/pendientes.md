# Pendientes y decisiones aplazadas (actualizado el 14/11/2026)

## Aplazado por decisión del usuario
- **Servicio de correo propio (SMTP).** El correo por defecto de Supabase solo envía 2 mensajes por hora en todo el proyecto: con más de un par de periodistas pidiendo su enlace, el login no sirve. Opciones valoradas: Gmail con contraseña de aplicación (la más rápida para el curso), Resend (exige dominio propio), Brevo, o el servidor de correo de eldiario.es (lo adecuado para uso real). Se configura en Supabase → Authentication → Emails → SMTP Settings. Imprescindible antes de abrir la herramienta al equipo.
- **Rol de ingesta con permisos mínimos.** Hoy la ingesta usa `service_role` (GitHub Secrets). Un rol propio exigiría conexión directa a Postgres o funciones con token, porque las claves `sb_secret_` solo actúan como `service_role`.
- **Más histórico** (hoy hay 3 meses, 13/08–13/11/2026): descartado por ahora. Un año no cabe en el plan gratuito de Supabase.
- **`POST /v1/entrar`** (login validado contra la lista de periodistas desde el Worker): descartado; el código está en la rama local `aparcado/entrar`. Lo sustituye la Edge Function de `docs/edge-function-alta.md`.

## Abierto
- **Nota de protección de datos (RGPD)** sobre el índice de nombres de las restringidas (finalidad, plazo de conservación, supresión).
- **Fase 4:** preguntas en lenguaje natural con Claude (`POST /v1/preguntar`, hoy 501): límite diario atómico (`reservar_consulta`), clave de Anthropic propia del buscador, `skill/SKILL.md`. **Fase 6:** pruebas con preguntas reales.
- **Panel de Supabase** (requisitos de la identidad por correo): «Secure email change» activo y Redirect URLs exactas, sin comodines.
- **Web:** decisiones menores en `docs/fase5-web/preguntas-abiertas.md` (aviso tras pedir el enlace, PKCE, registro de errores).
- **Edge Function:** publicada con el nombre automático `swift-task`; si se quiere el nombre claro, hay que publicarla de nuevo con otro nombre y actualizar la URL de la web.
- **Mantenimiento:** el límite de sesión de 24 h vive en dos sitios (base de datos y `SESION_MAX_HORAS` del Worker): si cambia, cambiar los dos. Los workflows de GitHub avisan de que Node 20 queda obsoleto: revisar versiones de las acciones.
