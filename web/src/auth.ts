import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Token de la sesión de Supabase Auth; supabase-js lo renueva solo. Sin sesión (o sin configurar), null.
export async function getToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const authConfigurado = () => supabase !== null;

// Envía el enlace de acceso. shouldCreateUser: false → solo entran correos ya dados de alta.
export async function enviarEnlace(email: string): Promise<'ok' | 'error' | 'sin-configurar'> {
  if (!supabase) return 'sin-configurar';
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
  return error ? 'error' : 'ok';
}

export async function salir() {
  await supabase?.auth.signOut();
}

// La API limita la sesión a 24 h desde el login por enlace: pasado ese tiempo responde 401 aunque el token se renueve.
// Se cierra la sesión local una sola vez y se recuerda el motivo para decírselo en /entrar (sin bucles de reintento).
const CLAVE_CADUCADA = 'sesion-caducada';
export async function cerrarPorCaducidad() {
  try { sessionStorage.setItem(CLAVE_CADUCADA, '1'); } catch { /* sin almacenamiento */ }
  await supabase?.auth.signOut({ scope: 'local' });
}
export function haCaducado(): boolean {
  try { return sessionStorage.getItem(CLAVE_CADUCADA) === '1'; } catch { return false; }
}
export function olvidarCaducidad() {
  try { sessionStorage.removeItem(CLAVE_CADUCADA); } catch { /* sin almacenamiento */ }
}

export function useSesion() {
  const [estado, setEstado] = useState<{ cargando: boolean; email: string | null }>({ cargando: true, email: null });
  useEffect(() => {
    if (!supabase) { setEstado({ cargando: false, email: null }); return; }
    supabase.auth.getSession().then(({ data }) => setEstado({ cargando: false, email: data.session?.user.email ?? null }));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEstado({ cargando: false, email: s?.user.email ?? null }));
    return () => data.subscription.unsubscribe();
  }, []);
  return estado;
}
