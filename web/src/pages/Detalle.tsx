import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, IA, estadoResumen } from '../ds';
import { textoCita } from '../cita';
import { enlaceBoe } from '../enlaces';
import { ErrorCarga, Esqueletos } from '../Estados';
import { etiquetaTema, etiquetaTipo, fechaCorta } from '../labels';
import type { Ficha } from '../types';
import { useAsync } from '../useAsync';

function referencias(r: unknown): string[] {
  if (!Array.isArray(r)) return [];
  return r.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).titulo ?? (x as Record<string, unknown>).texto ?? (x as Record<string, unknown>).id ?? '') : '')).filter(Boolean);
}

export function Detalle() {
  const { id = '' } = useParams();
  const { data: f, error, cargando, reintentar } = useAsync(() => api.publicacion(id), id);
  const [copiado, setCopiado] = useState(false);

  if (cargando) return <Esqueletos n={1} />;
  if (error?.status === 404) return <div className="aviso"><h2>No encontramos esa publicación</h2><p><Link className="enlace" to="/">← Volver al buscador</Link></p></div>;
  if (error || !f) return <ErrorCarga error={error!} reintentar={reintentar} />;

  const status = estadoResumen(f);
  const refs = status === 'noSummary' ? [] : referencias(f.referencias);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoCita(f)); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { window.prompt('Copia la cita:', textoCita(f)); }
  };
  const vig: { tone: 'warn' | 'danger'; text: string }[] = [];
  if (f.estatus_derogacion && f.estatus_derogacion !== 'N') vig.push({ tone: 'warn', text: 'Derogada' });
  if (f.judicialmente_anulada) vig.push({ tone: 'danger', text: 'Anulada judicialmente' });
  if (f.vigencia_agotada) vig.push({ tone: 'warn', text: 'Vigencia agotada' });
  if (f.aviso_fuente) vig.push({ tone: 'warn', text: f.aviso_fuente });
  const datos: [string, string | null][] = [['Sección', f.seccion_nombre], ['Organismo', f.departamento], ['Epígrafe', f.epigrafe], ['Rango', f.rango]];

  return (
    <div className="detalle">
      <article className="detalle__principal">
        <p><button type="button" className="enlace" onClick={() => history.back()}>← Volver a los resultados</button></p>
        <div className="bboe-meta">{f.id} · {fechaCorta(f.fecha)}</div>
        <h1 className="detalle__titulo">{f.titulo}</h1>
        {status !== 'noSummary' && (f.tipo_acto || f.temas?.length) ? (
          <p className="bboe-meta">
            {f.tipo_acto ? `Tipo de publicación: ${etiquetaTipo(f.tipo_acto)}` : ''}{f.tipo_acto && f.temas?.length ? ' · ' : ''}{f.temas?.length ? `Tema: ${f.temas.map(etiquetaTema).join(', ')}` : ''}
          </p>
        ) : null}
        {f.corrige_a ? <p className="bboe-meta">Corrige: <Link className="enlace" to={`/publicacion/${f.corrige_a}`}>{f.corrige_a}</Link></p> : null}
        <section className="detalle__bloque" aria-label="Resumen">
          {status === 'summary' ? <><div className="detalle__enc"><h2>Resumen</h2><IA /></div><p className="detalle__resumen">{f.resumen}</p></> : null}
          {status === 'noSummary' ? <div className="bboe-card__row"><Badge tone="restricted">Sin resumen</Badge><span className="bboe-meta">Esta sección puede incluir datos personales; por eso no generamos resumen. Consulta el texto en el BOE.</span></div> : null}
          {status === 'review' ? <div className="bboe-card__row"><Badge tone="warn">Resumen pendiente de revisión</Badge></div> : null}
          {status === 'pending' ? <p className="bboe-meta">Resumen aún no disponible</p> : null}
        </section>
        {refs.length ? (
          <section className="detalle__bloque" aria-label="Referencias">
            <h2>Referencias</h2>
            <p className="bboe-meta">Normas anteriores citadas en el texto.</p>
            <ul className="refs">{refs.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        ) : null}
      </article>
      <aside className="detalle__lateral">
        <div className="panel">
          <h2>Fuente oficial</h2>
          {enlaceBoe(f.url_html) ? <a className="bboe-btn bboe-btn--primary bboe-btn--md boton-enlace" href={enlaceBoe(f.url_html)!} target="_blank" rel="noopener noreferrer">Abrir en el BOE ↗</a> : <p className="bboe-meta">Sin enlace disponible</p>}
          {enlaceBoe(f.url_pdf) ? <a className="bboe-btn bboe-btn--secondary bboe-btn--md boton-enlace" href={enlaceBoe(f.url_pdf)!} target="_blank" rel="noopener noreferrer">PDF ↗</a> : null}
          <div className="hov">
            <button type="button" className="bboe-btn bboe-btn--secondary bboe-btn--md" style={{ width: '100%' }} onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar cita'}</button>
            <div className="tip" role="tooltip">Copia una referencia lista para pegar: título oficial, identificador y fecha del BOE y enlace.</div>
          </div>
        </div>
        <div className="panel">
          <h2>Datos</h2>
          <div className="filas">{datos.filter(([, v]) => v).map(([k, v]) => <div key={k} className="fila"><span className="bboe-meta">{k}</span><span>{v}</span></div>)}</div>
        </div>
        {vig.length ? <div className="panel"><h2>Vigencia y avisos</h2><div className="bboe-card__row">{vig.map((x, i) => <Badge key={i} tone={x.tone}>{x.text}</Badge>)}</div></div> : null}
      </aside>
    </div>
  );
}
