import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { BuscadorForm } from '../BuscadorForm';
import { ResultCard } from '../ds';
import { ErrorCarga, Esqueletos } from '../Estados';
import { filtrosDesdeUrl, urlDesdeFiltros } from '../filtros';
import { etiquetaSeccion, etiquetaTema, etiquetaTipo, fechaCorta } from '../labels';
import type { Filtros } from '../types';
import { useAsync } from '../useAsync';

function chips(f: Filtros): { clave: string; texto: string; quitar: Partial<Filtros> }[] {
  const c: { clave: string; texto: string; quitar: Partial<Filtros> }[] = [];
  if (f.q?.trim()) c.push({ clave: 'q', texto: `Texto: ${f.q.trim()}`, quitar: { q: undefined } });
  if (f.desde || f.hasta) c.push({ clave: 'fechas', texto: `${f.desde ? fechaCorta(f.desde) : '…'} – ${f.hasta ? fechaCorta(f.hasta) : '…'}`, quitar: { desde: undefined, hasta: undefined } });
  if (f.seccion) c.push({ clave: 'seccion', texto: etiquetaSeccion(f.seccion), quitar: { seccion: undefined } });
  if (f.organismo?.trim()) c.push({ clave: 'organismo', texto: `Organismo: ${f.organismo.trim()}`, quitar: { organismo: undefined } });
  if (f.tema?.length) c.push({ clave: 'tema', texto: `Tema: ${f.tema.map(etiquetaTema).join(', ')}`, quitar: { tema: undefined } });
  if (f.tipo) c.push({ clave: 'tipo', texto: etiquetaTipo(f.tipo), quitar: { tipo: undefined } });
  if (f.orden === 'recientes') c.push({ clave: 'orden', texto: 'Más recientes', quitar: { orden: undefined } });
  return c;
}

function Desglose({ f }: { f: Filtros }) {
  const [por, setPor] = useState<'mes' | 'organismo' | 'tipo'>('organismo');
  const { data, cargando, error } = useAsync(() => api.conteos(f, por), `${urlDesdeFiltros(f)}|${por}`);
  return (
    <details className="desglose">
      <summary className="bboe-btn bboe-btn--secondary bboe-btn--sm">Desglose ▾</summary>
      <div className="desglose__cuerpo">
        <label className="bboe-field__label" htmlFor="por">Agrupar por</label>
        <select id="por" className="bboe-input" value={por} onChange={(e) => setPor(e.target.value as typeof por)}>
          <option value="organismo">Organismo</option>
          <option value="mes">Mes</option>
          <option value="tipo">Tipo de publicación</option>
        </select>
        {cargando ? <p className="bboe-meta">Cargando…</p> : error ? <p className="bboe-meta">No se pudo cargar el desglose.</p> : (
          <div className="filas">
            {data?.grupos.map((g) => (
              <div key={g.grupo} className="fila"><span>{por === 'tipo' && g.grupo !== 'sin clasificar' ? etiquetaTipo(g.grupo) : g.grupo === 'sin clasificar' ? 'Sin clasificar (sin resumen)' : g.grupo}</span><span className="num">{g.n}</span></div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function Resultados() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const f = filtrosDesdeUrl(params);
  const clave = params.toString();
  const { data, error, cargando, reintentar } = useAsync(() => api.buscar(f), clave);
  const cs = chips(f);
  const rango = f.desde || f.hasta ? ` · ${f.desde ? fechaCorta(f.desde) : '…'} – ${f.hasta ? fechaCorta(f.hasta) : '…'}` : '';

  return (
    <div className="resultados">
      <BuscadorForm key={clave} inicial={f} />
      {cargando ? <Esqueletos /> : error ? <ErrorCarga error={error} reintentar={reintentar} /> : data && (
        <>
          <div className="resultados__cab">
            <div>
              <h2 aria-live="polite">{data.length === 0 ? 'Sin resultados' : `${data.length} resultado${data.length === 1 ? '' : 's'}${rango}`}</h2>
              {cs.length ? (
                <div className="chips-activos">
                  {cs.map((c) => (
                    <span key={c.clave} className="chip-activo">
                      {c.texto}
                      <button type="button" aria-label={`Quitar filtro: ${c.texto}`} onClick={() => nav(urlDesdeFiltros({ ...f, ...c.quitar }))}>✕</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {data.length ? <Desglose f={f} /> : null}
          </div>
          {data.length >= 100 ? <p className="bboe-meta">Mostrando los 100 primeros resultados. Afina con filtros o fechas.</p> : null}
          {data.length === 0 ? (
            <div className="aviso">
              <p>No hay resultados{f.q?.trim() ? ` para «${f.q.trim()}»` : ''} con estos filtros.</p>
              <p className="bboe-meta">Prueba con otras palabras, o con: vivienda, última semana · contratos de hospitales este mes.</p>
              {cs.length ? <p><Link className="enlace" to={urlDesdeFiltros({ q: f.q })}>Quitar filtros</Link></p> : null}
            </div>
          ) : (
            <div className="lista">
              {data.map((x) => (
                <ResultCard key={x.id} f={x} ocultarTipo={!!f.tipo} enlace={<Link className="bboe-card__title" to={`/publicacion/${x.id}`}>{x.titulo}</Link>} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
