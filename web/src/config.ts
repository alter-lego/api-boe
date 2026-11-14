// URL de la Edge Function de Supabase que da de alta a un periodista y crea su acceso (docs/edge-function-alta.md).
// El panel le puso el nombre automático «swift-task»; si cambia, basta con `VITE_FUNCION_ALTA` en el .env o editar esta constante.
export const FUNCION_ALTA =
  (import.meta.env.VITE_FUNCION_ALTA as string | undefined) ?? 'https://dgybontyrywfdzxvapqr.supabase.co/functions/v1/swift-task';

// «Preguntar al BOE» (Fase 4): la pestaña solo se muestra si hay API real preparada (`VITE_PREGUNTAR=si`) o en modo prueba.
export const PREGUNTAR_ACTIVO =
  import.meta.env.VITE_PREGUNTAR === 'si' || import.meta.env.VITE_MODO !== 'api';
