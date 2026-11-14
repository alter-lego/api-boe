import { getToken } from './auth';
import { mock } from './mock';
import type { Conteo, Ficha, Filtros, Salud, Sumario } from './types';

export const MODO: 'prueba' | 'api' = import.meta.env.VITE_MODO === 'api' ? 'api' : 'prueba';
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api-boe.alter-lego.workers.dev';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function parametros(f: Filtros, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.desde) p.set('desde', f.desde);
  if (f.hasta) p.set('hasta', f.hasta);
  if (f.seccion) p.set('seccion', f.seccion);
  if (f.organismo?.trim()) p.set('organismo', f.organismo.trim());
  if (f.tema?.length) p.set('tema', f.tema.join(','));
  if (f.tipo) p.set('tipo', f.tipo);
  return p;
}

async function llamar<T>(ruta: string, conSesion = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (conSesion) {
    const token = await getToken();
    if (!token) throw new ApiError(401, 'Sin sesión');
    headers.Authorization = `Bearer ${token}`;
  }
  let r: Response;
  try { r = await fetch(`${API}${ruta}`, { headers }); } catch { throw new ApiError(502, 'Sin conexión'); }
  if (!r.ok) {
    let msg = '';
    try { msg = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* sin cuerpo */ }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

// En modo prueba, los errores del mock llevan `status`; se normalizan igual.
const normaliza = (e: unknown): never => {
  if (e instanceof ApiError) throw e;
  const x = e as { status?: number; message?: string };
  throw new ApiError(x.status ?? 502, x.message ?? '');
};

const ordenar = (lista: Ficha[], f: Filtros) =>
  f.orden === 'recientes' ? [...lista].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)) : lista;

export const api = {
  async salud(): Promise<Salud> {
    if (MODO === 'prueba') return mock.health();
    return llamar<Salud>('/v1/health', false);
  },
  async buscar(f: Filtros): Promise<Ficha[]> {
    try {
      const lista = MODO === 'prueba' ? await mock.buscar(f) : (await llamar<{ publicaciones: Ficha[] }>(`/v1/publicaciones?${parametros(f, { limit: '100' })}`)).publicaciones;
      return ordenar(lista, f);
    } catch (e) { return normaliza(e); }
  },
  async conteos(f: Filtros, agrupar: 'mes' | 'organismo' | 'tipo'): Promise<Conteo> {
    try {
      return MODO === 'prueba' ? await mock.conteos(f, agrupar) : await llamar<Conteo>(`/v1/conteos?${parametros(f, { agrupar })}`);
    } catch (e) { return normaliza(e); }
  },
  async publicacion(id: string): Promise<Ficha> {
    try {
      if (MODO === 'prueba') {
        const x = await mock.publicacion(id);
        if (!x) throw new ApiError(404, 'No encontrada');
        return x;
      }
      return await llamar<Ficha>(`/v1/publicaciones/${encodeURIComponent(id)}`);
    } catch (e) { return normaliza(e); }
  },
  async sumario(fecha: string): Promise<Sumario> {
    try {
      return MODO === 'prueba' ? await mock.sumario(fecha) : await llamar<Sumario>(`/v1/sumarios/${fecha}`);
    } catch (e) { return normaliza(e); }
  },
};
