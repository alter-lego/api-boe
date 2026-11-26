import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authConfigurado, enviarEnlace, haCaducado, olvidarCaducidad, useSesion } from '../auth';
import { Button, Field } from '../ds';
import { TURNSTILE_SITEKEY } from '../config';
import { Turnstile } from '../Turnstile';

export function Entrar() {
  const { cargando, email: sesion } = useSesion();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'enviado' | 'fallo' | 'limite'>('inicial');
  const [espera, setEspera] = useState(0);
  const desde = (loc.state as { desde?: string } | null)?.desde ?? '/';
  const [caducada] = useState(() => haCaducado());
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [reinicio, setReinicio] = useState(0);
  const faltaCaptcha = TURNSTILE_SITEKEY !== null && !captcha;

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((e) => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  if (!cargando && sesion) { olvidarCaducidad(); return <Navigate to={desde} replace />; }

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || espera > 0 || faltaCaptcha) return;
    setEstado('enviando');
    const r = await enviarEnlace(email, captcha);
    if (TURNSTILE_SITEKEY) setReinicio((n) => n + 1);   // cada token vale para un envío: se pide otro para «Reenviar»
    // Respuesta neutra a propósito: no se revela quién está en la lista de acceso (decisión pendiente, ver preguntas-abiertas).
    if (r === 'sin-configurar') { setEstado('fallo'); return; }
    if (r === 'limite') { setEstado('limite'); setEspera(60); return; }
    setEstado('enviado');
    setEspera(60);
  };

  // El widget va fuera del formulario para que siga vivo en la pantalla de «enlace enviado» (Reenviar).
  const widget = TURNSTILE_SITEKEY && authConfigurado() ? <Turnstile sitekey={TURNSTILE_SITEKEY} alToken={setCaptcha} reinicio={reinicio} /> : null;

  return (
    <div className="entrar">
      <img className="logo logo--claro" src="/logo.svg" alt="elDiario.es" />
      <img className="logo logo--oscuro" src="/logo-blanco.svg" alt="elDiario.es" />
      <h1>Entrar al buscador del BOE</h1>
      {caducada ? <div className="aviso" role="alert"><p>Tu sesión ha caducado. Por seguridad, dura 24 horas desde que entras. Pide un enlace nuevo.</p></div> : null}
      {!authConfigurado() ? (
        <div className="aviso" role="alert"><p>Falta configurar el acceso (clave pública de Supabase) en esta instalación.</p></div>
      ) : estado === 'enviado' ? (
        <div className="aviso" role="status">
          <p>Si tu correo está autorizado, te hemos enviado un enlace a <strong>{email.trim()}</strong>. Ábrelo desde este dispositivo. Caduca en 1 hora.</p>
          <p><button type="button" className="enlace" disabled={espera > 0 || faltaCaptcha} onClick={enviar}>{espera > 0 ? `Reenviar (${espera} s)` : faltaCaptcha ? 'Comprobando…' : 'Reenviar'}</button></p>
        </div>
      ) : (
        <form onSubmit={enviar} className="entrar__form">
          <Field label="Correo electrónico" id="correo">
            <input id="correo" type="email" autoComplete="email" required className="bboe-input bboe-input--lg" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={estado === 'enviando' || faltaCaptcha}>{estado === 'enviando' ? 'Enviando…' : faltaCaptcha ? 'Comprobando que no eres un robot…' : 'Enviarme el enlace'}</Button>
          <p className="bboe-meta">La sesión dura 24 horas desde que entras.</p>
          {estado === 'limite' ? <p className="bboe-meta" role="alert">Has pedido demasiados enlaces; espera unos minutos.</p> : null}
          {estado === 'fallo' ? <p className="bboe-meta" role="alert">No hemos podido enviar el enlace. Inténtalo de nuevo en un minuto.</p> : null}
        </form>
      )}
      {widget}
    </div>
  );
}
