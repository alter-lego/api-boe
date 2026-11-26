import { cerrarPorCaducidad, getToken, getTokenFresco } from './auth';
import type { BusquedaPersona, Conteo, Ficha, Filtros, Respuesta, Salud, Sumario } from './types';

export const MODO: 'prueba' | 'api' = import.meta.env.VITE_MODO === 'api' ? 'api' : 'prueba';
// Los datos de ejemplo se cargan solo en modo prueba: en la compilación de producción (VITE_MODO=api) esas ramas
// son código muerto y el módulo mock no llega al bundle (auditoría del 26/11/2026, 1.7).
const datosPrueba = () => import('./mock').then((m) => m.mock);
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

async function llamar<T>(ruta: string, conSesion = true, init: RequestInit = {}, tokenFresco = false): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (conSesion) {
    const token = tokenFresco ? await getTokenFresco() : await getToken();
    if (!token) throw new ApiError(401, 'Sin sesión');
    headers.Authorization = `Bearer ${token}`;
  }
  let r: Response;
  try { r = await fetch(`${API}${ruta}`, { ...init, headers }); } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw new ApiError(0, 'cancelada');
    throw new ApiError(502, 'Sin conexión');
  }
  if (!r.ok) {
    if (r.status === 401 && conSesion) await cerrarPorCaducidad();
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

export type GastoMes = { mes: string; preguntas: number; usuarios: number; tokens_entrada: number; tokens_salida: number; tokens_cache: number; coste_usd: number; ingesta_fichas: number; ingesta_coste_usd: number };

const ESPERA_MAX_MS = 65000; // la respuesta puede tardar hasta ~60 s (varias rondas, sin streaming)

export const api = {
  async preguntar(pregunta: string, señal?: AbortSignal): Promise<Respuesta> {
    try {
      if (MODO === 'prueba') return await (await datosPrueba()).preguntar(pregunta);
      const tope = AbortSignal.timeout(ESPERA_MAX_MS);
      const signal = señal ? AbortSignal.any([señal, tope]) : tope;
      return await llamar<Respuesta>('/v1/preguntar', true, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pregunta }), signal }, true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(504, '');
      return normaliza(e);
    }
  },
  /** Gasto en IA por mes: preguntas a Claude y resúmenes de la ingesta. Solo administradores (la base de datos responde 403 al resto). */
  async gasto(meses = 3): Promise<GastoMes[]> {
    try {
      if (MODO === 'prueba') return [{ mes: '2026-11-01', preguntas: 42, usuarios: 5, tokens_entrada: 310000, tokens_salida: 41000, tokens_cache: 120000, coste_usd: 0.0812, ingesta_fichas: 1840, ingesta_coste_usd: 0.9123 }];
      // Con una API anterior a la migración 14 no llegan los campos de la ingesta: se toman como 0.
      return (await llamar<{ meses: GastoMes[] }>(`/v1/admin/gasto?meses=${meses}`)).meses.map((m) => ({ ...m, ingesta_fichas: m.ingesta_fichas ?? 0, ingesta_coste_usd: m.ingesta_coste_usd ?? 0 }));
    } catch (e) { return normaliza(e); }
  },
  async salud(): Promise<Salud> {
    if (MODO === 'prueba') return (await datosPrueba()).health();
    return llamar<Salud>('/v1/health', false);
  },
  async buscar(f: Filtros): Promise<Ficha[]> {
    try {
      const lista = MODO === 'prueba' ? await (await datosPrueba()).buscar(f) : (await llamar<{ publicaciones: Ficha[] }>(`/v1/publicaciones?${parametros(f, { limit: '100' })}`)).publicaciones;
      return ordenar(lista, f);
    } catch (e) { return normaliza(e); }
  },
  /** Buscar a una persona por su nombre: primero el nombre exacto en el título o el resumen, después el texto. */
  async personas(nombre: string, desde?: string, hasta?: string): Promise<BusquedaPersona> {
    try {
      if (MODO === 'prueba') return await (await datosPrueba()).personas(nombre);
      const p = new URLSearchParams({ nombre: nombre.trim() });
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
      return await llamar<BusquedaPersona>(`/v1/personas?${p}`);
    } catch (e) { return normaliza(e); }
  },
  async conteos(f: Filtros, agrupar: 'mes' | 'organismo' | 'tipo'): Promise<Conteo> {
    try {
      return MODO === 'prueba' ? await (await datosPrueba()).conteos(f, agrupar) : await llamar<Conteo>(`/v1/conteos?${parametros(f, { agrupar })}`);
    } catch (e) { return normaliza(e); }
  },
  async publicacion(id: string): Promise<Ficha> {
    try {
      if (MODO === 'prueba') {
        const x = await (await datosPrueba()).publicacion(id);
        if (!x) throw new ApiError(404, 'No encontrada');
        return x;
      }
      return await llamar<Ficha>(`/v1/publicaciones/${encodeURIComponent(id)}`);
    } catch (e) { return normaliza(e); }
  },
  async sumario(fecha: string): Promise<Sumario> {
    try {
      return MODO === 'prueba' ? await (await datosPrueba()).sumario(fecha) : await llamar<Sumario>(`/v1/sumarios/${encodeURIComponent(fecha)}`);
    } catch (e) { return normaliza(e); }
  },
};
