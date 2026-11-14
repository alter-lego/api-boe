import type { Filtros } from './types';

export function filtrosDesdeUrl(p: URLSearchParams): Filtros {
  const tema = p.get('tema');
  return {
    q: p.get('q') ?? undefined,
    desde: p.get('desde') ?? undefined,
    hasta: p.get('hasta') ?? undefined,
    seccion: p.get('seccion') ?? undefined,
    organismo: p.get('organismo') ?? undefined,
    tema: tema ? tema.split(',').filter(Boolean) : undefined,
    tipo: p.get('tipo') ?? undefined,
    orden: p.get('orden') === 'recientes' ? 'recientes' : undefined,
  };
}

export function urlDesdeFiltros(f: Filtros): string {
  const p = new URLSearchParams();
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.desde) p.set('desde', f.desde);
  if (f.hasta) p.set('hasta', f.hasta);
  if (f.seccion) p.set('seccion', f.seccion);
  if (f.organismo?.trim()) p.set('organismo', f.organismo.trim());
  if (f.tema?.length) p.set('tema', f.tema.join(','));
  if (f.tipo) p.set('tipo', f.tipo);
  if (f.orden === 'recientes') p.set('orden', 'recientes');
  const s = p.toString();
  return `/buscar${s ? `?${s}` : ''}`;
}

export const numFiltros = (f: Filtros) =>
  [f.desde || f.hasta, f.seccion, f.organismo?.trim(), f.tema?.length, f.tipo, f.orden === 'recientes'].filter(Boolean).length;
