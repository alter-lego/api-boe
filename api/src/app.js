// API del buscador: valida la sesión de Supabase y reenvía a las funciones SQL con el JWT del usuario.
// Sin driver de Postgres: solo HTTP. La privacidad y la lista de periodistas las impone la base de datos
// (cada función exige un correo autorizado y aplica _ficha()); el Worker no ve tablas.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { TEMAS, TIPOS_ACTO } from '../../ingesta/lib/listas.js';

const SECCIONES = ['1', '2A', '2B', '3', '4', '5A', '5B', '5C', 'T'];
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha no válida (AAAA-MM-DD)')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'fecha no válida');
const texto = (max) => z.string().trim().min(1).max(max);

/** Filtros comunes de buscar y contar. Los parámetros vacíos se ignoran. */
const filtros = {
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
const consultaBuscar = z.object({ ...filtros, limit: z.coerce.number().int().min(1).max(100).default(20) });
const consultaContar = z.object({ ...filtros, agrupar: z.enum(['total', 'mes', 'organismo', 'tipo']).default('total') });

const AGRUPAR_SQL = { total: 'total', mes: 'mes', organismo: 'departamento', tipo: 'tipo_acto' };

/** Parámetros de las RPC a partir de la consulta validada. */
const paramsFiltros = (c) => ({
  p_desde: c.desde ?? null, p_hasta: c.hasta ?? null, p_seccion: c.seccion ?? null,
  p_departamento: c.organismo ?? null, p_temas: c.tema ?? null, p_tipo_acto: c.tipo ?? null,
  p_q: c.q ?? null, p_rango: c.rango ?? null,
});

let jwksRemoto = null; // claves públicas del proyecto (se descargan una vez y se reutilizan)

export class ErrorApi extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

/** Llama a una función SQL con el JWT del usuario (o solo la clave anon, para /health). */
async function rpc(env, nombre, args, { jwt, fetchFn }) {
  const res = await fetchFn(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt ?? env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return res.json();
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
  if (cuerpo.code === '42501') throw new ErrorApi(403, 'no autorizado');
  if (cuerpo.code === '22023') throw new ErrorApi(400, cuerpo.message ?? 'consulta no válida');
  if (res.status === 401) throw new ErrorApi(401, 'sesión no válida o caducada');
  if (cuerpo.code === '57014') throw new ErrorApi(504, 'la consulta tardó demasiado; acótala con más filtros');
  throw new ErrorApi(502, 'error al consultar el archivo');
}

/**
 * @param {{ fetchFn?: typeof fetch, jwks?: any }} deps  jwks: clave o conjunto de claves (por defecto, las públicas del proyecto)
 */
export function crearApp({ fetchFn = fetch, jwks } = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const permitidos = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return cors({
      origin: (origen) => (permitidos.includes(origen) ? origen : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    })(c, next);
  });
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.onError((e, c) => {
    if (e instanceof ErrorApi) return c.json({ error: e.message }, e.estado);
    console.error('error no controlado:', e?.message);
    return c.json({ error: 'error interno' }, 500);
  });
  app.notFound((c) => c.json({ error: 'no encontrado' }, 404));

  // Estado de la ingesta: sin autenticación, solo devuelve una fecha.
  app.get('/v1/health', async (c) => {
    const filas = await rpc(c.env, 'ultima_ingesta', {}, { fetchFn });
    return c.json({ ok: true, ultima_ingesta: filas[0] ?? null });
  });

  // Todo lo demás exige sesión de Supabase Auth de un periodista.
  const exigirSesion = async (c, next) => {
    const cab = c.req.header('Authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(cab);
    if (!m) throw new ErrorApi(401, 'falta la sesión');
    let correo;
    try {
      const clave = jwks ?? (jwksRemoto ??= createRemoteJWKSet(new URL(`${c.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`)));
      const { payload } = await jwtVerify(m[1], clave, {
        issuer: `${c.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`,
        audience: 'authenticated',
        algorithms: ['ES256'],
      });
      if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new Error('rol');
      correo = payload.email;
    } catch {
      throw new ErrorApi(401, 'sesión no válida o caducada');
    }
    if (!correo) throw new ErrorApi(401, 'sesión sin correo');
    c.set('jwt', m[1]);
    await next();
  };
  app.use('/v1/*', async (c, next) => (c.req.path === '/v1/health' ? next() : exigirSesion(c, next)));

  const validar = (esquema, c) => {
    const r = esquema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!r.success) throw new ErrorApi(400, r.error.issues.map((i) => `${i.path.join('.') || 'consulta'}: ${i.message}`).join('; '));
    return r.data;
  };

  app.get('/v1/publicaciones', async (c) => {
    const q = validar(consultaBuscar, c);
    const datos = await rpc(c.env, 'buscar_publicaciones', { ...paramsFiltros(q), p_limite: q.limit }, { jwt: c.get('jwt'), fetchFn });
    return c.json({ n: datos.length, publicaciones: datos });
  });

  app.get('/v1/conteos', async (c) => {
    const q = validar(consultaContar, c);
    const datos = await rpc(c.env, 'contar_publicaciones', { ...paramsFiltros(q), p_agrupar: AGRUPAR_SQL[q.agrupar] }, { jwt: c.get('jwt'), fetchFn });
    return c.json({ agrupar: q.agrupar, grupos: datos });
  });

  app.get('/v1/publicaciones/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9-]{3,60}$/.test(id)) throw new ErrorApi(400, 'identificador no válido');
    const datos = await rpc(c.env, 'publicacion', { p_id: id }, { jwt: c.get('jwt'), fetchFn });
    if (!datos.length) throw new ErrorApi(404, 'publicación no encontrada');
    return c.json(datos[0]);
  });

  app.get('/v1/sumarios/:fecha', async (c) => {
    const f = fecha.safeParse(c.req.param('fecha'));
    if (!f.success) throw new ErrorApi(400, 'fecha no válida (AAAA-MM-DD)');
    const datos = await rpc(c.env, 'sumario_del_dia', { p_fecha: f.data }, { jwt: c.get('jwt'), fetchFn });
    const secciones = [];
    for (const p of datos) {
      let s = secciones.at(-1);
      if (!s || s.seccion !== p.seccion) { s = { seccion: p.seccion, seccion_nombre: p.seccion_nombre, publicaciones: [] }; secciones.push(s); }
      s.publicaciones.push(p);
    }
    // Un día pasado ya no cambia: el navegador puede guardarlo unos minutos.
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    if (f.data < hoy) c.header('Cache-Control', 'private, max-age=300');
    return c.json({ fecha: f.data, total: datos.length, secciones });
  });

  app.post('/v1/preguntar', (c) => c.json({ error: 'las preguntas en lenguaje natural llegan en la fase 4' }, 501));

  return app;
}
