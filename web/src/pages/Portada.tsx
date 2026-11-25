import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, IA } from '../ds';
import { fechaConDia, hoyMadrid } from '../labels';
import { useAsync } from '../useAsync';

const EJEMPLOS = [
  '¿Qué ayudas al alquiler joven se han publicado esta semana?',
  '¿Qué subvenciones se han publicado esta semana y de cuánto dinero?',
  '¿Qué ha publicado hoy el Ministerio de Hacienda?',
  '¿Cuántos contratos de hospitales se han adjudicado este mes?',
];

// Tarjeta «BOE de hoy»: fecha, nº de publicaciones y, si ya está, el arranque de «Lo más destacado»
// (tres titulares, solo los que citan publicaciones del sumario, igual que en la pantalla del día).
const TITULARES_PORTADA = 3;

function BoeDeHoyTarjeta() {
  const { data } = useAsync(async () => {
    const s = await api.salud();
    return s.ultima_ingesta ? api.sumario(s.ultima_ingesta.fecha) : null;
  }, 'portada-hoy');
  if (!data) return null;
  const ids = new Set(data.secciones.flatMap((s) => s.publicaciones.map((p) => p.id)));
  const titulares = (data.resumen?.titulares ?? []).filter((t) => t.ids.some((id) => ids.has(id)));
  const temas = (data.resumen?.secciones ?? []).filter((s) => [...s.bloques, ...s.lineas].some((x) => x.ids.some((id) => ids.has(id)))).length;
  const resto = titulares.length - TITULARES_PORTADA;
  const dia = `/dia/${data.fecha}`;
  const cifra = (
    <div>
      <div className="hoy-tarjeta__t">BOE de hoy · {fechaConDia(data.fecha).toLowerCase()}</div>
      <div className="hoy-tarjeta__num">{data.total} <span>publicaciones</span></div>
    </div>
  );

  if (!titulares.length) {
    return (
      <section className="hoy-tarjeta" aria-label="BOE de hoy">
        {cifra}
        <p className="bboe-meta hoy-tarjeta__d">
          {data.fecha === hoyMadrid() && !data.resumen
            ? 'El resumen de lo más destacado se está preparando. Mientras, tienes todas las publicaciones.'
            : 'Disposiciones, nombramientos, contratos y anuncios del día, ordenados por sección.'}
        </p>
        <Link className="bboe-btn bboe-btn--secondary hoy-tarjeta__b" to={dia}>Ver el sumario completo</Link>
      </section>
    );
  }

  return (
    <section className="hoy-tarjeta hoy-tarjeta--rd" aria-label="BOE de hoy">
      <div className="hoy-tarjeta__izq">
        {cifra}
        <Link className="bboe-btn bboe-btn--secondary hoy-tarjeta__b hoy-tarjeta__sumario" to={{ pathname: dia, hash: '#todas' }}>Ver el sumario completo</Link>
      </div>
      <div className="hoy-tarjeta__rd">
        <div className="hoy-tarjeta__cab">
          <h2 className="hoy-tarjeta__h">Lo más destacado</h2>
          <IA />
        </div>
        <ul className="hoy-tarjeta__titulares">
          {titulares.slice(0, TITULARES_PORTADA).map((t, i) => <li key={i}>{t.texto}</li>)}
        </ul>
        <div className="hoy-tarjeta__pie">
          <Link className="bboe-btn bboe-btn--primary hoy-tarjeta__b" to={{ pathname: dia, hash: '#rd-titulo' }}>Leer lo más destacado</Link>
          {resto > 0 || temas > 0 ? (
            <span className="bboe-meta">
              {[resto > 0 ? `y ${resto} ${resto === 1 ? 'titular' : 'titulares'} más` : '', temas > 0 ? `${temas} ${temas === 1 ? 'tema' : 'temas'}` : ''].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>
      </div>
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
      <p className="portada__lead">Respuestas con las publicaciones oficiales y enlaces para comprobarlas.</p>
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
          <span className="bboe-meta">Suele responder en unos 10 segundos.</span>
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
