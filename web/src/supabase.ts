import { createClient } from '@supabase/supabase-js';

// Solo URL y clave pública (anon): la service_role y las claves de Anthropic NUNCA van en la web.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://dgybontyrywfdzxvapqr.supabase.co';
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const CLAVE_PUBLICA = anon;

export const supabase = anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
