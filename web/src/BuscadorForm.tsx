import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field } from './ds';
import { filtrosDesdeUrl, numFiltros, urlDesdeFiltros } from './filtros';
import { SECCIONES, TEMAS, TIPOS, hoyMadrid, sumarDias } from './labels';
import type { Filtros } from './types';

export function BuscadorForm({ inicial }: { inicial: Filtros }) {
  const nav = useNavigate();
  const [f, setF] = useState<Filtros>(inicial);
  const [abierto, setAbierto] = useState(false);
  const n = numFiltros(f);
  const set = (c: Partial<Filtros>) => setF((x) => ({ ...x, ...c }));
  const enviar = (e: React.FormEvent) => { e.preventDefault(); setAbierto(false); nav(urlDesdeFiltros(f)); };
  const atajo = (dias: number) => { const h = hoyMadrid(); set({ desde: sumarDias(h, -dias), hasta: h }); };
  const toggleTema = (t: string) => set({ tema: f.tema?.includes(t) ? f.tema.filter((x) => x !== t) : [...(f.tema ?? []), t].slice(0, 5) });

  return (
    <form onSubmit={enviar} className="buscador">
      <div className="buscador__fila">
        <Field label="Texto libre" id="q">
          <input id="q" className="bboe-input bboe-input--lg" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="Nombres, organismos, temas…" />
        </Field>
        <div className="buscador__botones">
          <Button variant="secondary" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>{n ? `Filtros (${n})` : 'Filtros'} {abierto ? '▴' : '▾'}</Button>
          <Button type="submit">Buscar</Button>
        </div>
      </div>

      {abierto ? (
        <div className="filtros" role="group" aria-label="Filtros">
          <Field label="Desde" id="desde">
            <input id="desde" type="date" className="bboe-input" value={f.desde ?? ''} onChange={(e) => set({ desde: e.target.value || undefined })} />
            <div className="atajos">
              <button type="button" className="atajo" onClick={() => atajo(0)}>Hoy</button>
              <button type="button" className="atajo" onClick={() => atajo(7)}>7 días</button>
              <button type="button" className="atajo" onClick={() => atajo(30)}>30 días</button>
            </div>
          </Field>
          <Field label="Hasta" id="hasta"><input id="hasta" type="date" className="bboe-input" value={f.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || undefined })} /></Field>
          <Field label="Sección" id="seccion">
            <select id="seccion" className="bboe-input" value={f.seccion ?? ''} onChange={(e) => set({ seccion: e.target.value || undefined })}>
              <option value="">Todas</option>
              {SECCIONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Organismo" id="organismo">
            <input id="organismo" className="bboe-input" value={f.organismo ?? ''} onChange={(e) => set({ organismo: e.target.value })} placeholder="Ministerio, comunidad, institución…" />
          </Field>
          <Field label="Tema" id="tema" hint="Se pueden elegir hasta 5">
            <details className="multi">
              <summary className="bboe-input">{f.tema?.length ? `${f.tema.length} elegido${f.tema.length > 1 ? 's' : ''}` : 'Cualquiera'}</summary>
              <div className="multi__lista">
                {TEMAS.map(([v, l]) => (
                  <label key={v} className="multi__op"><input type="checkbox" checked={!!f.tema?.includes(v)} onChange={() => toggleTema(v)} /> {l}</label>
                ))}
              </div>
            </details>
          </Field>
          <Field label="Tipo de publicación" id="tipo">
            <select id="tipo" className="bboe-input" value={f.tipo ?? ''} onChange={(e) => set({ tipo: e.target.value || undefined })}>
              <option value="">Cualquiera</option>
              {TIPOS.map((g) => g.grupo
                ? <optgroup key={g.grupo} label={g.grupo}>{g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                : g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>))}
            </select>
          </Field>
          <Field label="Orden" id="orden">
            <select id="orden" className="bboe-input" value={f.orden ?? 'relevancia'} onChange={(e) => set({ orden: e.target.value === 'recientes' ? 'recientes' : undefined })}>
              <option value="relevancia">Relevancia</option>
              <option value="recientes">Más recientes</option>
            </select>
          </Field>
          {f.tema?.length || f.tipo ? <p className="bboe-meta filtros__aviso">Al filtrar por tema o tipo no salen los anuncios sin resumen (justicia, oposiciones y particulares).</p> : null}
          <div className="filtros__acciones">
            <Button variant="secondary" size="sm" onClick={() => setF({ q: f.q })}>Borrar filtros</Button>
            <Button size="sm" type="submit">Aplicar</Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export { filtrosDesdeUrl };
