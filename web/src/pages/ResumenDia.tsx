import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { EnlacesBoe, IA } from '../ds';
import type { ApartadoResumen, Ficha, LineaResumen, ResumenDia as Resumen } from '../types';
import './resumen-dia.css';

// Resumen editorial del día (lo redacta Claude tras la carga del BOE). Claude solo cita publicaciones por
// su id: el título oficial y los enlaces al BOE salen de las fichas del sumario, que la base ya ha filtrado.

const APARTADOS: { clave: ApartadoResumen; titulo: string; vacio: string }[] = [
  { clave: 'ayudas', titulo: 'Ayudas y subvenciones', vacio: 'Hoy no hay ayudas ni subvenciones.' },
  { clave: 'oposiciones', titulo: 'Oposiciones y empleo público', vacio: 'Hoy no hay convocatorias de empleo público.' },
  { clave: 'impuestos', titulo: 'Impuestos, tributos y tasas', vacio: 'Hoy no hay novedades sobre impuestos, tributos o tasas.' },
  { clave: 'automocion', titulo: 'Automoción y vehículo eléctrico', vacio: 'Hoy no hay novedades sobre automoción ni vehículo eléctrico.' },
];

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

/** Enlace a la página de la publicación, con el rango como texto corto y el título oficial al pasar el ratón. */
function EnlacePub({ f }: { f: Ficha }) {
  return (
    <Link className="rd-ref" to={`/publicacion/${f.id}`} state={{ origen: 'dia' }} title={f.titulo}>
      {f.rango ?? 'Ver publicación'}
    </Link>
  );
}

function Refs({ fichas }: { fichas: Ficha[] }) {
  return (
    <span className="rd-refs">
      {fichas.map((f, i) => <Fragment key={f.id}>{i ? ' · ' : ''}<EnlacePub f={f} /></Fragment>)}
    </span>
  );
}

function Linea({ l, buscar }: { l: LineaResumen; buscar: (ids: string[]) => Ficha[] }) {
  const fichas = buscar(l.ids);
  if (!fichas.length) return null;
  return <li><strong>{l.tema}</strong>: {l.texto} <Refs fichas={fichas} /></li>;
}

export function ResumenDia({ resumen, publicaciones }: { resumen: Resumen; publicaciones: Ficha[] }) {
  const porId = new Map(publicaciones.map((p) => [p.id, p]));
  const buscar = (ids: string[]) => ids.map((id) => porId.get(id)).filter((f): f is Ficha => !!f);
  const titulares = resumen.titulares.filter((t) => buscar(t.ids).length);

  return (
    <section className="rd" aria-labelledby="rd-titulo">
      <div className="rd__cab">
        <h2 id="rd-titulo">Lo más destacado</h2>
        <IA />
      </div>
      <p className="bboe-meta rd__nota">
        Resumen redactado con IA a partir de los títulos y resúmenes del día{resumen.generado_en ? ` (a las ${hora(resumen.generado_en)})` : ''}. Comprueba siempre el BOE antes de publicar.
      </p>

      {titulares.length ? (
        <ul className="rd__titulares">
          {titulares.map((t, i) => <Linea key={i} l={t} buscar={buscar} />)}
        </ul>
      ) : null}

      {resumen.secciones.map((s, i) => {
        const bloques = s.bloques.map((b) => ({ b, fichas: buscar(b.ids) })).filter((x) => x.fichas.length);
        const lineas = s.lineas.filter((l) => buscar(l.ids).length);
        if (!bloques.length && !lineas.length) return null;
        return (
          <div key={i} className="rd__seccion">
            <h3>{s.titulo}</h3>
            {bloques.map(({ b, fichas }, j) => (
              <article key={j} className="rd__bloque">
                <h4>{b.titulo}</h4>
                <p>{b.resumen}</p>
                {b.por_que_importa ? <p className="rd__porque"><em>Por qué importa:</em> {b.por_que_importa}</p> : null}
                {fichas.map((f) => (
                  <div key={f.id} className="rd__fuente">
                    {f.departamento ? <span className="bboe-meta">{f.departamento}</span> : null}
                    <EnlacePub f={f} />
                    <EnlacesBoe f={f} />
                  </div>
                ))}
              </article>
            ))}
            {lineas.length ? <ul className="rd__lineas">{lineas.map((l, j) => <Linea key={j} l={l} buscar={buscar} />)}</ul> : null}
          </div>
        );
      })}

      <div className="rd__apartados">
        {APARTADOS.map(({ clave, titulo, vacio }) => {
          const items = (resumen.apartados[clave] ?? []).map((it) => ({ ...it, f: porId.get(it.id) })).filter((x) => x.f) as { id: string; texto: string | null; f: Ficha }[];
          return (
            <details key={clave} className="seccion rd__apartado">
              <summary>{titulo} <span className="bboe-meta">({items.length})</span></summary>
              <div className="seccion__cuerpo">
                {items.length ? (
                  <ol>
                    {items.map(({ id, texto, f }) => (
                      <li key={id}>
                        {texto ?? f.titulo}
                        {f.departamento ? <span className="bboe-meta"> · {f.departamento}</span> : null} · <EnlacePub f={f} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="bboe-meta">{vacio}</p>}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
