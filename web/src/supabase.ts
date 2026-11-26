import { createClient } from '@supabase/supabase-js';

// Solo URL y clave pública (anon): la service_role y las claves de Anthropic NUNCA van en la web.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://dgybontyrywfdzxvapqr.supabase.co';
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const CLAVE_PUBLICA = anon;

// detectSessionInUrl: false. La entrada es por token_hash en /confirmar (con botón): no hace falta leer la sesión de
// la URL, y hacerlo permitía «plantar» la sesión de otra cuenta con un enlace preparado (auditoría, 2.13).
export const supabase = anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
