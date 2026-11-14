import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, EnlacesBoe, IA, estadoResumen } from '../ds';
import { ErrorCarga, Esqueletos } from '../Estados';
import { fechaConDia, sumarDias } from '../labels';
import { useAsync } from '../useAsync';

export function DiaDeHoy() {
  const { data, error, cargando, reintentar } = useAsync(() => api.salud(), 'salud-dia');
  if (cargando) return <Esqueletos n={2} />;
  if (error) return <ErrorCarga error={error} reintentar={reintentar} />;
  if (!data?.ultima_ingesta) return <div className="aviso"><p>Aún no hay datos cargados.</p></div>;
  return <Navigate to={`/dia/${data.ultima_ingesta.fecha}`} replace />;
}

export function Sumario() {
  const { fecha = '' } = useParams();
  const [buscar, setBuscar] = useState('');
  const { data, error, cargando, reintentar } = useAsync(() => api.sumario(fecha), fecha);
  const q = buscar.trim().toLowerCase();

  return (
    <div className="sumario">
      <h1>Sumario del día</h1>
      <div className="sumario__nav">
        <Link className="bboe-btn bboe-btn--secondary bboe-btn--sm" to={`/dia/${sumarDias(fecha, -1)}`} aria-label="Día anterior">◀</Link>
        <strong>{fechaConDia(fecha)}</strong>
        <Link className="bboe-btn bboe-btn--secondary bboe-btn--sm" to={`/dia/${sumarDias(fecha, 1)}`} aria-label="Día siguiente">▶</Link>
        {data ? <span className="bboe-meta">{data.total} publicaciones</span> : null}
        <div className="sumario__buscar">
          <label className="bboe-field__label" htmlFor="b">Buscar en este día</label>
          <input id="b" className="bboe-input" placeholder="Palabra del título" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
      </div>
      {cargando ? <Esqueletos n={2} /> : error ? <ErrorCarga error={error} reintentar={reintentar} /> : data && data.total === 0 ? (
        <div className="aviso"><p>No hay publicaciones cargadas para este día.</p><p className="bboe-meta">Puede que ese día no se publicara BOE o que todavía no esté cargado.</p></div>
      ) : data && (
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
                        <Link className="bboe-card__title pub__tit" to={`/publicacion/${p.id}`}>{p.titulo}</Link>
                        {st === 'summary' ? <p className="bboe-meta">{p.resumen} <IA /></p> : st === 'noSummary' ? <p><Badge tone="restricted">Sin resumen</Badge></p> : st === 'review' ? <p><Badge tone="warn">Resumen pendiente de revisión</Badge></p> : null}
                        <EnlacesBoe f={p} />
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
