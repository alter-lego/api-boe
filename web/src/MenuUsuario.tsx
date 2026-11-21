import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { salir } from './auth';

// Menú de la persona administradora: correo con desplegable («Acceder al panel» y «Salir»).
export function MenuUsuario({ email, enAdmin }: { email: string; enAdmin: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);
  const boton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus(); } };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  return (
    <div className="menu-usuario" ref={caja}>
      <button ref={boton} type="button" className={`menu-usuario__boton${enAdmin ? ' menu-usuario__boton--on' : ''}`} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} title={email}>
        <span className="menu-usuario__correo">{email}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {abierto ? (
        <div className="menu-usuario__lista" role="menu">
          <Link role="menuitem" className="menu-usuario__op" to="/admin" onClick={() => setAbierto(false)}>Acceder al panel</Link>
          <button role="menuitem" type="button" className="menu-usuario__op" onClick={() => { setAbierto(false); void salir(); }}>Salir</button>
        </div>
      ) : null}
    </div>
  );
}
