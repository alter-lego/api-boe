import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Token de la sesión de Supabase Auth; supabase-js lo renueva solo. Sin sesión (o sin configurar), null.
export async function getToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Token con al menos `minSeg` segundos de vida: si caduca antes, se renueva ya. Para Preguntar, que puede tardar
 * cerca de un minuto y anota el gasto al final con el mismo token (auditoría, 2.7).
 */
export async function getTokenFresco(minSeg = 120): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  if (s.expires_at && s.expires_at * 1000 - Date.now() < minSeg * 1000) {
    const { data: renovada } = await supabase.auth.refreshSession();
    return renovada.session?.access_token ?? s.access_token;
  }
  return s.access_token;
}

export const authConfigurado = () => supabase !== null;

// Envía el enlace de acceso. shouldCreateUser: false → solo entran correos ya dados de alta.
export async function enviarEnlace(email: string, captchaToken?: string | null): Promise<'ok' | 'error' | 'limite' | 'sin-configurar'> {
  if (!supabase) return 'sin-configurar';
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin, ...(captchaToken ? { captchaToken } : {}) } });
  if (!error) return 'ok';
  return error.status === 429 || error.code === 'over_email_send_rate_limit' ? 'limite' : 'error';
}

// Confirma el enlace del correo (flujo token_hash): el correo enlaza a la web y solo se verifica al pulsar el botón,
// para que un filtro de correo que abra el enlace no lo gaste. Solo type='email'.
// En modo prueba sin Supabase se simula: 'prueba-ok' entra, 'prueba-red' falla por red, cualquier otro es inválido.
export async function confirmarEnlace(tokenHash: string): Promise<'ok' | 'invalido' | 'red' | 'sin-configurar'> {
  if (!supabase) {
    if (import.meta.env.VITE_MODO === 'api') return 'sin-configurar';
    await new Promise((r) => setTimeout(r, 400));
    return tokenHash === 'prueba-ok' ? 'ok' : tokenHash === 'prueba-red' ? 'red' : 'invalido';
  }
  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (error) {
      const sinRed = error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status === undefined || error.status >= 500;
      return sinRed ? 'red' : 'invalido';
    }
    if (!data.session) return 'invalido';
    olvidarCaducidad();
    return 'ok';
  } catch {
    return 'red';
  }
}

export async function salir() {
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Sin red: al menos se cierra la sesión en este navegador.
    await supabase.auth.signOut({ scope: 'local' });
  }
}

// La API limita la sesión a 24 h desde el login por enlace: pasado ese tiempo responde 401 aunque el token se renueve.
// Se cierra la sesión local una sola vez y se recuerda el motivo para decírselo en /entrar (sin bucles de reintento).
const CLAVE_CADUCADA = 'sesion-caducada';
export async function cerrarPorCaducidad() {
  if (!supabase) return;
  // Solo si había una sesión: un visitante sin sesión no debe ver «Tu sesión ha caducado».
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  try { sessionStorage.setItem(CLAVE_CADUCADA, '1'); } catch { /* sin almacenamiento */ }
  await supabase.auth.signOut({ scope: 'local' });
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
