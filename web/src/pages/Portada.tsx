import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button } from '../ds';
import { fechaConDia } from '../labels';
import { useAsync } from '../useAsync';

const EJEMPLOS = [
  '¿Qué subvenciones se han publicado esta semana y de cuánto dinero?',
  '¿Qué ha publicado hoy el Ministerio de Hacienda?',
  '¿Cuántos contratos de hospitales se han adjudicado este mes?',
];

// Tarjeta «BOE de hoy» (la de la propuesta «dos puertas»): fecha, nº de publicaciones y enlace al sumario.
function BoeDeHoyTarjeta() {
  const { data } = useAsync(async () => {
    const s = await api.salud();
    return s.ultima_ingesta ? api.sumario(s.ultima_ingesta.fecha) : null;
  }, 'portada-hoy');
  if (!data) return null;
  return (
    <section className="hoy-tarjeta" aria-label="BOE de hoy">
      <div>
        <div className="hoy-tarjeta__t">BOE de hoy · {fechaConDia(data.fecha).toLowerCase()}</div>
        <div className="hoy-tarjeta__num">{data.total} <span>publicaciones</span></div>
      </div>
      <p className="bboe-meta hoy-tarjeta__d">Disposiciones, nombramientos, contratos y anuncios del día, ordenados por sección.</p>
      <Link className="bboe-btn bboe-btn--secondary hoy-tarjeta__b" to={`/dia/${data.fecha}`}>Ver el sumario completo</Link>
    </section>
  );
}

// Portada «Preguntar primero»: la pregunta es la acción principal; el buscador queda un clic más allá.
export function Portada() {
  const nav = useNavigate();
  const [texto, setTexto] = useState('');
  const largo = texto.trim().length;
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (largo >= 3) nav('/preguntar', { state: { pregunta: texto.trim() } });
  };
  return (
    <div className="portada">
      <h1 className="portada__titulo">Pregunta al BOE</h1>
      <p className="portada__lead">Pregunta con tus palabras. Respuestas con las publicaciones oficiales y enlaces para comprobarlas.</p>
      <form className="portada__caja" onSubmit={enviar}>
        <label className="sr-only" htmlFor="p">Tu pregunta</label>
        <div className="portada__campo">
          <textarea id="p" maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (largo >= 3) nav('/preguntar', { state: { pregunta: texto.trim() } }); } }} placeholder=" " aria-describedby="p-ejemplos" />
          <div className="ejemplos portada__ejemplos" id="p-ejemplos">
            <div className="ejemplos__titulo">Ejemplos de preguntas que puedes hacer</div>
            <ul>{EJEMPLOS.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        </div>
        <div className="portada__pie">
          <span className="bboe-meta">Responde en unos 10 segundos.</span>
          <Button type="submit" disabled={largo < 3}>Preguntar</Button>
        </div>
      </form>
      <div className="portada__otros">
        <p>¿Prefieres buscar por palabras y filtros? <Link className="enlace" to="/buscar">Buscar con filtros →</Link></p>
      </div>
      <BoeDeHoyTarjeta />
    </div>
  );
}
