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
