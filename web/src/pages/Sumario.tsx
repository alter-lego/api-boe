import { ConInicioDestacado } from '../destacar';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, EnlacesBoe, IA, estadoResumen } from '../ds';
import { ErrorCarga, Esqueletos } from '../Estados';
import { fechaConDia, fechaCorta, hoyMadrid, sumarDias } from '../labels';
import { useAsync } from '../useAsync';
import { ResumenDia } from './ResumenDia';

export function DiaDeHoy() {
  const { data, error, cargando, reintentar } = useAsync(() => api.salud(), 'salud-dia');
  if (cargando) return <Esqueletos n={2} />;
  if (error) return <ErrorCarga error={error} reintentar={reintentar} />;
  if (!data?.ultima_ingesta) return <div className="aviso"><p>Aún no hay datos cargados.</p></div>;
  return <Navigate to={`/dia/${data.ultima_ingesta.fecha}`} replace />;
}

const diaCorto = (f: string) => fechaCorta(f).replace(/ \d{4}$/, '');

export function Sumario() {
  const { fecha = '' } = useParams();
  const [buscar, setBuscar] = useState('');
  const { data, error, cargando, reintentar } = useAsync(() => api.sumario(fecha), fecha);
  const q = buscar.trim().toLowerCase();
  // Al llegar con un ancla (p. ej. desde la tarjeta «BOE de hoy» de la portada), se baja a ella cuando ya hay datos.
  const { hash } = useLocation();
  useEffect(() => {
    if (!data || !hash) return;
    // Tras pintar (requestAnimationFrame), para que no lo pise la restauración del scroll del navegador.
    const r = requestAnimationFrame(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(r);
  }, [data, hash]);

  return (
    <div className="sumario">
      <h1>Sumario del día{data ? <span className="sumario__n"> · {data.total} publicaciones</span> : null}</h1>
      <div className="sumario__nav">
        <Link className="bboe-btn bboe-btn--secondary bboe-btn--sm boton-dia" to={`/dia/${sumarDias(fecha, -1)}`}>← {diaCorto(sumarDias(fecha, -1))}</Link>
        <strong className="sumario__fecha">{fechaConDia(fecha)}</strong>
        {sumarDias(fecha, 1) > hoyMadrid()
          ? <span className="bboe-btn bboe-btn--secondary bboe-btn--sm boton-dia boton-dia--off" aria-disabled="true">{diaCorto(sumarDias(fecha, 1))} →</span>
          : <Link className="bboe-btn bboe-btn--secondary bboe-btn--sm boton-dia" to={`/dia/${sumarDias(fecha, 1)}`}>{diaCorto(sumarDias(fecha, 1))} →</Link>}
        <div className="sumario__buscar">
          <label className="bboe-field__label" htmlFor="b">Buscar en este día</label>
          <input id="b" className="bboe-input" placeholder="Palabra del título" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
      </div>
      {cargando ? <Esqueletos n={2} /> : error ? <ErrorCarga error={error} reintentar={reintentar} /> : data && data.total === 0 ? (
        <div className="aviso"><p>No hay publicaciones cargadas para este día.</p><p className="bboe-meta">Puede que ese día no se publicara BOE o que todavía no esté cargado.</p></div>
      ) : data && (
        <>
        {!q && data.resumen ? <ResumenDia resumen={data.resumen} publicaciones={data.secciones.flatMap((s) => s.publicaciones)} total={data.total} /> : null}
        {!q && !data.resumen && fecha === hoyMadrid() ? <p className="bboe-meta">El resumen de hoy aún se está preparando. Mientras, aquí tienes todas las publicaciones.</p> : null}
        {!q && data.resumen ? <h2 id="todas" tabIndex={-1} className="sumario__todas">Todas las publicaciones</h2> : null}
        <div className="lista">
          {data.secciones.map((s, i) => {
            const pubs = s.publicaciones.filter((p) => !q || p.titulo.toLowerCase().includes(q));
            if (!pubs.length) return null;
            return (
              <details key={s.seccion} open={i === 0 || !!q} className="seccion">
                <summary>{s.seccion_nombre} <span className="bboe-meta">({pubs.length})</span></summary>
                <div className="seccion__cuerpo">
                  {pubs.map((p) => {
                    const st = estadoResumen(p);
                    return (
                      <div key={p.id} className="pub">
                        {p.departamento ? <div className="sec">{p.departamento}</div> : null}
                        <Link className="bboe-card__title pub__tit" to={`/publicacion/${p.id}`} state={{ origen: 'dia' }}>{p.titulo}</Link>
                        {st === 'summary' ? <p className="bboe-meta pub__resumen"><ConInicioDestacado texto={p.resumen ?? ''} /> <IA /></p> : st === 'noSummary' ? <p><Badge tone="restricted">Sin resumen</Badge></p> : st === 'review' ? <p><Badge tone="warn">Resumen pendiente de revisión</Badge></p> : null}
                        <EnlacesBoe f={p} />
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
