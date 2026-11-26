// Comprobación anti-robots de Cloudflare (Turnstile) en la pantalla de entrada (auditoría del 26/11/2026, 1.9):
// sin ella, un script podía pedir enlaces de entrada en masa, agotar el cupo de correo y averiguar qué correos
// tienen cuenta. Supabase Auth valida el token (Authentication → Attack Protection → CAPTCHA, proveedor Turnstile).
// Modo «solo si hace falta interacción»: a casi todo el mundo no le aparece nada.
// La clave del sitio es pública (VITE_TURNSTILE_SITEKEY); la secreta solo está en Supabase.
import { useEffect, useRef } from 'react';

type OpcionesTurnstile = {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  appearance?: 'always' | 'execute' | 'interaction-only';
  language?: string;
};
declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: OpcionesTurnstile) => string; reset: (id: string) => void; remove: (id: string) => void };
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let carga: Promise<void> | null = null;
function cargarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  carga ??= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => { carga = null; mal(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return carga;
}

/**
 * Pinta el widget y entrega el token por `alToken` (null si caduca o falla).
 * Cambiar `reinicio` pide un token nuevo (cada token sirve para un solo envío).
 */
export function Turnstile({ sitekey, alToken, reinicio }: { sitekey: string; alToken: (t: string | null) => void; reinicio: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(alToken);
  cb.current = alToken;

  useEffect(() => {
    let vivo = true;
    cargarScript().then(() => {
      if (!vivo || !caja.current || !window.turnstile) return;
      id.current = window.turnstile.render(caja.current, {
        sitekey,
        appearance: 'interaction-only',
        language: 'es',
        callback: (t) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => {
      vivo = false;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [sitekey]);

  useEffect(() => {
    if (reinicio && id.current && window.turnstile) { cb.current(null); window.turnstile.reset(id.current); }
  }, [reinicio]);

  return <div ref={caja} className="entrar__turnstile" />;
}
