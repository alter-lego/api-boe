import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { authConfigurado, confirmarEnlace } from '../auth';
import { Button } from '../ds';

// Pantalla pública a la que enlaza el correo de acceso. NO verifica al cargar: solo al pulsar el botón.
export function Confirmar() {
  const nav = useNavigate();
  // El token se guarda en memoria y se quita de la URL para que no quede en el historial.
  const [{ token, tipo }] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return { token: p.get('token_hash'), tipo: p.get('type') };
  });
  const [estado, setEstado] = useState<'inicial' | 'verificando' | 'invalido' | 'red' | 'sin-configurar'>('inicial');
  useEffect(() => { if (window.location.search) window.history.replaceState(null, '', window.location.pathname); }, []);

  if (!token || tipo !== 'email') return <Navigate to="/entrar" replace />;

  const entrar = async () => {
    if (estado === 'verificando') return;
    setEstado('verificando');
    const r = await confirmarEnlace(token);
    if (r === 'ok') { nav('/', { replace: true }); return; }
    setEstado(r);
  };

  return (
    <div className="entrar">
      <img className="logo logo--claro" src="/logo.svg" alt="elDiario.es" />
      <img className="logo logo--oscuro" src="/logo-blanco.svg" alt="elDiario.es" />
      <h1>Confirmar acceso</h1>
      {estado === 'invalido' ? (
        <div className="aviso" role="alert">
          <p>Este enlace ya no es válido. Pide uno nuevo.</p>
          <p><Link className="enlace" to="/entrar">Pedir un enlace nuevo</Link></p>
        </div>
      ) : !authConfigurado() && estado === 'sin-configurar' ? (
        <div className="aviso" role="alert"><p>Falta configurar el acceso en esta instalación.</p></div>
      ) : (
        <div className="entrar__form">
          <p>Pulsa el botón para entrar al buscador del BOE. La sesión dura 24 horas desde que entras.</p>
          <Button onClick={entrar} disabled={estado === 'verificando'}>{estado === 'verificando' ? 'Entrando…' : estado === 'red' ? 'Reintentar' : 'Entrar al buscador'}</Button>
          {estado === 'red' ? <p className="bboe-meta" role="alert">No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.</p> : null}
        </div>
      )}
    </div>
  );
}
