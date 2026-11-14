// Piezas comunes de la API: validación de filtros, errores y llamadas a las funciones SQL de Supabase.
import { z } from 'zod';
import { TEMAS, TIPOS_ACTO } from '../../ingesta/lib/listas.js';

export const SECCIONES = ['1', '2A', '2B', '3', '4', '5A', '5B', '5C', 'T'];
export const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha no válida (AAAA-MM-DD)')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'fecha no válida');
export const texto = (max) => z.string().trim().min(1).max(max);

/** Filtros comunes de buscar y contar. Los parámetros vacíos se ignoran. */
export const filtros = {
  desde: fecha.optional(),
  hasta: fecha.optional(),
  seccion: z.enum(SECCIONES).optional(),
  organismo: texto(200).optional(),
  tema: z.string().optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(TEMAS)).max(5).optional()),
  tipo: z.enum(TIPOS_ACTO).optional(),
  rango: texto(100).optional(),
  q: texto(500).optional(),
};
export const consultaBuscar = z.object({ ...filtros, limit: z.coerce.number().int().min(1).max(100).default(20) });
export const consultaContar = z.object({ ...filtros, agrupar: z.enum(['total', 'mes', 'organismo', 'tipo']).default('total') });

export const AGRUPAR_SQL = { total: 'total', mes: 'mes', organismo: 'departamento', tipo: 'tipo_acto' };

/** Parámetros de las RPC a partir de la consulta validada. */
export const paramsFiltros = (c) => ({
  p_desde: c.desde ?? null, p_hasta: c.hasta ?? null, p_seccion: c.seccion ?? null,
  p_departamento: c.organismo ?? null, p_temas: c.tema ?? null, p_tipo_acto: c.tipo ?? null,
  p_q: c.q ?? null, p_rango: c.rango ?? null,
});


export class ErrorApi extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

/** Llama a una función SQL con el JWT del usuario (o solo la clave anon, para /health). */
export async function rpc(env, nombre, args, { jwt, fetchFn }) {
  let res;
  try {
    res = await fetchFn(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt ?? env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ErrorApi(504, 'el archivo tardó demasiado en responder; inténtalo de nuevo');
    throw new ErrorApi(502, 'error al consultar el archivo');
  }
  if (res.ok) return res.json();
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
  if (cuerpo.code === '42501') throw new ErrorApi(403, 'no autorizado');
  if (cuerpo.code === 'PT429' || res.status === 429) throw new ErrorApi(429, cuerpo.message ?? 'límite alcanzado');
  if (cuerpo.code === '22023') throw new ErrorApi(400, cuerpo.message ?? 'consulta no válida');
  if (res.status === 401) throw new ErrorApi(401, 'sesión no válida o caducada');
  if (cuerpo.code === '57014') throw new ErrorApi(504, 'la consulta tardó demasiado; acótala con más filtros');
  throw new ErrorApi(502, 'error al consultar el archivo');
}


/** Lee el cuerpo JSON de una petición con un tope REAL de bytes (no se fía de Content-Length). */
export async function leerJson(req, tope = 8192) {
  if (!(req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) throw new ErrorApi(415, 'se esperaba JSON');
  const flujo = req.body;
  if (!flujo) throw new ErrorApi(400, 'falta el cuerpo');
  const lector = flujo.getReader();
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) { await lector.cancel().catch(() => {}); throw new ErrorApi(413, 'solicitud demasiado grande'); }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { todo.set(t, pos); pos += t.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(todo)); } catch { throw new ErrorApi(400, 'JSON no válido'); }
}
