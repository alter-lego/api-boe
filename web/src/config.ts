// URL de la Edge Function de Supabase que da de alta a un periodista y crea su acceso (docs/edge-function-alta.md).
// El panel le puso el nombre automático «swift-task»; si cambia, basta con `VITE_FUNCION_ALTA` en el .env o editar esta constante.
export const FUNCION_ALTA =
  (import.meta.env.VITE_FUNCION_ALTA as string | undefined) ?? 'https://dgybontyrywfdzxvapqr.supabase.co/functions/v1/swift-task';

// Clave pública del sitio de Cloudflare Turnstile (comprobación anti-robots al pedir el enlace de entrada).
// Es pública (va en la página). Supabase exige el CAPTCHA (Authentication → Attack Protection): sin esta clave nadie
// podría pedir enlaces. Widget «buscador-boe» (modo Managed) para buscador-boe.alter-lego.workers.dev y localhost.
// VITE_TURNSTILE_SITEKEY la sustituye; con VITE_TURNSTILE_SITEKEY=no se quita la comprobación (solo si Supabase no la exige).
const CLAVE_TURNSTILE = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined)?.trim() || '0x4AAAAAAGU5HyiqxA0UnreO';
export const TURNSTILE_SITEKEY = CLAVE_TURNSTILE === 'no' ? null : CLAVE_TURNSTILE;

// «Preguntar al BOE» (Fase 4): la pestaña solo se muestra si hay API real preparada (`VITE_PREGUNTAR=si`) o en modo prueba.
export const PREGUNTAR_ACTIVO =
  import.meta.env.VITE_PREGUNTAR === 'si' || import.meta.env.VITE_MODO !== 'api';
