import { useState } from 'react';
import { textoCita } from './cita';

export function CopiarCita({ x, ancho }: { x: { titulo: string; id: string; fecha: string; url_html: string | null }; ancho?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    const t = textoCita(x);
    try { await navigator.clipboard.writeText(t); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { window.prompt('Copia la cita:', t); }
  };
  return (
    <div className="hov">
      <button type="button" className="bboe-btn bboe-btn--secondary bboe-btn--sm" style={ancho ? { width: '100%' } : undefined} onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar cita'}</button>
      <div className="tip" role="tooltip">Copia una referencia lista para pegar: título oficial, identificador y fecha del BOE y enlace.</div>
    </div>
  );
}
