import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnlacesBoe, IA } from '../ds';
import type { ApartadoResumen, BloqueResumen, Ficha, ResumenDia as Resumen } from '../types';
import './resumen-dia.css';

// Resumen editorial del día (lo redacta Claude tras la carga del BOE). Claude solo cita publicaciones por
// su id: el título oficial y los enlaces al BOE salen de las fichas del sumario, que la base ya ha filtrado.
// A la vista, cabecera y titulares; el resto, plegado (el sumario completo es el uso principal).

const APARTADOS: { clave: ApartadoResumen; titulo: string }[] = [
  { clave: 'ayudas', titulo: 'Ayudas y subvenciones' },
  { clave: 'oposiciones', titulo: 'Oposiciones y empleo público' },
  { clave: 'impuestos', titulo: 'Impuestos, tributos y tasas' },
  { clave: 'automocion', titulo: 'Automoción y vehículo eléctrico' },
];
const CLAVE_ABIERTO = 'resumen-dia-abierto';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const recortar = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function leerAbierto() {
  try { return localStorage.getItem(CLAVE_ABIERTO) === 'si'; } catch { return false; }
}
function guardarAbierto(v: boolean) {
  try { localStorage.setItem(CLAVE_ABIERTO, v ? 'si' : 'no'); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Lleva el foco (y la vista) a un elemento con tabIndex -1. */
function irA(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Etiquetas de enlace: el rango, numerado si se repite dentro de la misma pieza («Resolución 1», «Resolución 2»). */
function etiquetas(fichas: Ficha[]) {
  const base = fichas.map((f) => f.rango ?? 'Publicación');
  const total = new Map<string, number>();
  base.forEach((b) => total.set(b, (total.get(b) ?? 0) + 1));
  const visto = new Map<string, number>();
  return base.map((b) => {
    if ((total.get(b) ?? 0) < 2) return b;
    const n = (visto.get(b) ?? 0) + 1;
    visto.set(b, n);
    return `${b} ${n}`;
  });
}

/** Enlace a la página de la publicación. El nombre accesible empieza por el texto visible y añade el título oficial. */
function EnlacePub({ f, texto }: { f: Ficha; texto: string }) {
  return (
    <Link className="rd-ref" to={`/publicacion/${f.id}`} state={{ origen: 'dia' }} aria-label={`${texto}: ${recortar(f.titulo)}`}>
      {texto}
    </Link>
  );
}

function EnlacesPubs({ fichas }: { fichas: Ficha[] }) {
  const et = etiquetas(fichas);
  return <span className="rd-refs">{fichas.map((f, i) => <Fragment key={f.id}>{i ? ' · ' : ''}<EnlacePub f={f} texto={et[i]} /></Fragment>)}</span>;
}

function Fuentes({ fichas }: { fichas: Ficha[] }) {
  if (fichas.length === 1) {
    const f = fichas[0];
    return (
      <div className="rd__fuente">
        <span className="rd__org">{[f.departamento, f.rango].filter(Boolean).join(' · ')}</span>
        <EnlacesBoe f={f} />
      </div>
    );
  }
  const et = etiquetas(fichas);
  return (
    <ul className="rd__fuentes">
      {fichas.map((f, i) => (
        <li key={f.id} className="rd__fuente">
          <span className="rd__org"><EnlacePub f={f} texto={et[i]} />{f.departamento ? <span className="bboe-meta"> · {f.departamento}</span> : null}</span>
          <EnlacesBoe f={f} />
        </li>
      ))}
    </ul>
  );
}

function Bloque({ b, fichas, ancla }: { b: BloqueResumen; fichas: Ficha[]; ancla: string }) {
  return (
    <article id={ancla} tabIndex={-1} className="rd__bloque">
      <h4>{fichas.length === 1
        ? <Link to={`/publicacion/${fichas[0].id}`} state={{ origen: 'dia' }}>{b.titulo}</Link>
        : b.titulo}</h4>
      <p>{b.resumen}</p>
      {b.por_que_importa ? <p className="rd__porque"><em>Por qué importa:</em> {b.por_que_importa}</p> : null}
      <Fuentes fichas={fichas} />
    </article>
  );
}

export function ResumenDia({ resumen, publicaciones, total }: { resumen: Resumen; publicaciones: Ficha[]; total: number }) {
  const [abierto, setAbierto] = useState(leerAbierto);
  const [destino, setDestino] = useState<string | null>(null);
  const porId = new Map(publicaciones.map((p) => [p.id, p]));
  const buscar = (ids: string[]) => ids.map((id) => porId.get(id)).filter((f): f is Ficha => !!f);

  // Secciones con solo lo que se puede pintar, y el ancla de cada bloque.
  const secciones = resumen.secciones.map((s, i) => ({
    titulo: s.titulo,
    bloques: s.bloques.map((b, j) => ({ b, fichas: buscar(b.ids), ancla: `rd-b-${i}-${j}` })).filter((x) => x.fichas.length),
    lineas: s.lineas.map((l) => ({ l, fichas: buscar(l.ids) })).filter((x) => x.fichas.length),
  })).filter((s) => s.bloques.length || s.lineas.length);
  const bloqueDe = new Map<string, string>();
  for (const s of secciones) for (const { b, ancla } of s.bloques) for (const id of b.ids) if (!bloqueDe.has(id)) bloqueDe.set(id, ancla);

  const titulares = resumen.titulares.map((t) => ({ t, fichas: buscar(t.ids) })).filter((x) => x.fichas.length);
  const apartados = APARTADOS.map((a) => ({
    ...a,
    items: (resumen.apartados[a.clave] ?? []).map((it) => ({ ...it, f: porId.get(it.id) })).filter((x): x is { id: string; texto: string | null; f: Ficha } => !!x.f),
  }));
  const conAlgo = apartados.filter((a) => a.items.length);
  const vacios = apartados.filter((a) => !a.items.length);
  const hayMas = secciones.length > 0 || apartados.length > 0;

  const alternar = () => setAbierto((v) => { guardarAbierto(!v); return !v; });
  // Ir a un bloque desde un titular: se despliega el resumen (sin cambiar la preferencia guardada) y se lleva el foco.
  const irABloque = (ancla: string) => { if (abierto) irA(ancla); else { setAbierto(true); setDestino(ancla); } };
  useEffect(() => { if (abierto && destino) { irA(destino); setDestino(null); } }, [abierto, destino]);

  return (
    <section className="rd" aria-labelledby="rd-titulo">
      <a className="rd__saltar enlace" href="#todas" onClick={(e) => { e.preventDefault(); irA('todas'); }}>
        Ir a todas las publicaciones ({total}) ↓
      </a>
      <div className="rd__cab">
        <h2 id="rd-titulo" tabIndex={-1}>Lo más destacado</h2>
        <IA />
      </div>
      <p className="bboe-meta rd__nota">
        Redactado con IA{resumen.generado_en ? ` a las ${hora(resumen.generado_en)}` : ''} · comprueba siempre el BOE antes de publicar
      </p>

      {titulares.length ? (
        <ul className="rd__titulares">
          {titulares.map(({ t, fichas }, i) => {
            const ancla = t.ids.map((id) => bloqueDe.get(id)).find(Boolean);
            return (
              <li key={i}>
                <strong>{t.tema}</strong>: {t.texto}{' '}
                {ancla
                  ? <a className="rd-ref" href={`#${ancla}`} onClick={(e) => { e.preventDefault(); irABloque(ancla); }}>{fichas.length > 1 ? `${fichas.length} publicaciones` : 'Más detalle'} ↓</a>
                  : <EnlacesPubs fichas={fichas} />}
              </li>
            );
          })}
        </ul>
      ) : null}

      {hayMas ? (
        <button type="button" className="bboe-btn bboe-btn--secondary bboe-btn--sm rd__mas" aria-expanded={abierto} aria-controls="rd-completo" onClick={alternar}>
          {abierto ? 'Ocultar el resumen completo ▴' : `Ver el resumen completo (${secciones.length} ${secciones.length === 1 ? 'tema' : 'temas'}) ▾`}
        </button>
      ) : null}

      <div id="rd-completo" hidden={!abierto} className="rd__completo">
        {secciones.map((s, i) => (
          <div key={i} className="rd__seccion">
            <h3>{s.titulo}</h3>
            {s.bloques.map(({ b, fichas, ancla }) => <Bloque key={ancla} b={b} fichas={fichas} ancla={ancla} />)}
            {s.lineas.length ? (
              <ul className="rd__lineas">
                {s.lineas.map(({ l, fichas }, j) => <li key={j}><strong>{l.tema}</strong>: {l.texto} <EnlacesPubs fichas={fichas} /></li>)}
              </ul>
            ) : null}
          </div>
        ))}

        <div className="rd__apartados">
          {conAlgo.map(({ clave, titulo, items }) => (
            <details key={clave} className="seccion rd__apartado">
              <summary>{titulo} · <span className="num">{items.length}</span></summary>
              <div className="seccion__cuerpo">
                <ol>
                  {items.map(({ id, texto, f }) => (
                    <li key={id}>
                      {texto ?? f.titulo}
                      {f.departamento ? <span className="bboe-meta"> · {f.departamento}</span> : null} · <EnlacePub f={f} texto={f.rango ?? 'Ver publicación'} />
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ))}
          {vacios.length ? <p className="bboe-meta">Sin novedades hoy en: {vacios.map((a) => a.titulo).join(' · ')}</p> : null}
        </div>
      </div>
    </section>
  );
}
