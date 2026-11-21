import { useEffect, useState } from 'react';

type Tema = 'claro' | 'oscuro';
const CLAVE = 'tema';

function guardado(): Tema | null {
  try { const v = localStorage.getItem(CLAVE); return v === 'claro' || v === 'oscuro' ? v : null; } catch { return null; }
}
const consulta = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null);

// Tema por defecto: el del sistema; la elección del usuario se recuerda (si el navegador lo permite).
export function useTema() {
  const [elegido, setElegido] = useState<Tema | null>(guardado);
  const [sistema, setSistema] = useState<Tema>(() => (consulta()?.matches ? 'oscuro' : 'claro'));
  useEffect(() => {
    const q = consulta();
    if (!q) return;
    const al = () => setSistema(q.matches ? 'oscuro' : 'claro');
    q.addEventListener('change', al);
    return () => q.removeEventListener('change', al);
  }, []);
  const tema = elegido ?? sistema;
  useEffect(() => { document.documentElement.setAttribute('data-tema', tema); }, [tema]);
  const alternar = () => {
    const siguiente: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
    setElegido(siguiente);
    try { localStorage.setItem(CLAVE, siguiente); } catch { /* se aplica solo en esta visita */ }
  };
  return { oscuro: tema === 'oscuro', alternar };
}
