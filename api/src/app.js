// API del buscador: valida la sesión de Supabase y reenvía a las funciones SQL con el JWT del usuario.
// Sin driver de Postgres: solo HTTP. La privacidad y la lista de periodistas las impone la base de datos
// (cada función exige un correo autorizado y aplica _ficha()); el Worker no ve tablas.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { ErrorApi, rpc, leerJson, fecha, filtros, consultaBuscar, consultaContar, AGRUPAR_SQL, paramsFiltros } from './comun.js';
import { responderPregunta } from './preguntar.js';
import { preguntaSinSentido } from './pregunta-valida.js';

class SesionNoValida extends Error {}
const METODOS_VALIDOS = ['otp', 'magiclink'];
// Códigos de jose que significan «este token no vale» (firma, caducidad, claims, clave desconocida).
const ERRORES_DE_TOKEN = /^(ERR_JWT_|ERR_JWS_|ERR_JOSE_ALG_NOT_ALLOWED|ERR_JWKS_NO_MATCHING_KEY|ERR_JWKS_MULTIPLE_MATCHING_KEYS)/;

let jwksRemoto = null; // claves públicas del proyecto (se descargan una vez y se reutilizan)

/**
 * @param {{ fetchFn?: typeof fetch, jwks?: any, instrucciones?: string | null, esperar?: (ms: number) => Promise<void> }} deps  jwks: clave o conjunto de claves (por defecto, las públicas del proyecto)
 */
export function crearApp({ fetchFn = fetch, jwks, instrucciones = null, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
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
      if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new SesionNoValida('rol');
      // Solo vale una sesión iniciada con el enlace del correo (no contraseña, teléfono ni otros métodos).
      const entradas = (Array.isArray(payload.amr) ? payload.amr : []).filter((a) => a && typeof a === 'object');
      if (!entradas.some((a) => METODOS_VALIDOS.includes(a.method))) throw new SesionNoValida('método de acceso no permitido');
      // Duración máxima de la sesión: Supabase renueva el token cada hora sin límite, pero el token
      // conserva la fecha del login original (amr[].timestamp). Pasadas SESION_MAX_HORAS horas, se pide un enlace nuevo.
      const maxHoras = Number(c.env.SESION_MAX_HORAS ?? 24);
      const marcas = entradas.map((a) => Number(a.timestamp)).filter(Number.isFinite);
      const inicio = marcas.length ? Math.min(...marcas) : null;
      if (maxHoras > 0 && (inicio === null || Date.now() / 1000 - inicio > maxHoras * 3600)) throw new SesionNoValida('sesión demasiado antigua');
      correo = payload.email;
    } catch (e) {
      // 401 solo si el problema es del token. Si falla la descarga de las claves o la red, es un fallo
      // nuestro o de Supabase (503): no debe cerrar la sesión a todos los usuarios.
      if (e instanceof SesionNoValida || ERRORES_DE_TOKEN.test(String(e?.code ?? ''))) throw new ErrorApi(401, 'sesión no válida o caducada');
      console.error('error al validar la sesión:', e?.code ?? e?.name);
      throw new ErrorApi(503, 'servicio de autenticación no disponible; inténtalo de nuevo');
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

  // Buscar a una persona por su nombre (migración 15). La base comprueba el nombre exacto en título y resumen
  // y clasifica cada resultado: 'titulo', 'resumen', 'seguido' (nombre completo seguido en el texto, migración 17)
  // o 'texto' (palabras sueltas en el texto, o en una restringida: lo menos fiable).
  const consultaPersona = z.object({
    nombre: z.string().trim().min(2, 'escribe un nombre').max(100, 'el nombre es demasiado largo'),
    desde: fecha.optional(),
    hasta: fecha.optional(),
    seccion: filtros.seccion,
    limit: z.coerce.number().int().min(1).max(100).default(100),
  });
  app.get('/v1/personas', async (c) => {
    const q = validar(consultaPersona, c);
    const filas = await rpc(c.env, 'buscar_persona', {
      p_nombre: q.nombre, p_desde: q.desde ?? null, p_hasta: q.hasta ?? null, p_seccion: q.seccion ?? null, p_limite: q.limit,
    }, { jwt: c.get('jwt'), fetchFn });
    const totales = { titulo: 0, resumen: 0, seguido: 0, texto: 0 };
    for (const f of filas) totales[f.coincidencia] = Number(f.total_grupo);
    return c.json({
      n: filas.length,
      totales,
      resultados: filas.map((f) => ({ ...f.ficha, coincidencia: f.coincidencia })),
    });
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

  // Gasto por mes en IA: preguntas a Claude y, aparte, fichas de la ingesta (migración 14).
  // Solo administradores: lo decide la base de datos (exigir_admin). Sin la migración 14, la ingesta sale a 0.
  app.get('/v1/admin/gasto', async (c) => {
    const m = z.coerce.number().int().min(1).max(24).safeParse(c.req.query('meses') ?? '3');
    if (!m.success) throw new ErrorApi(400, 'meses debe estar entre 1 y 24');
    const filas = await rpc(c.env, 'admin_gasto', { p_meses: m.data }, { jwt: c.get('jwt'), fetchFn });
    const n = (v) => Number(v ?? 0);
    return c.json({ meses: filas.map((f) => ({
      mes: f.mes, preguntas: n(f.preguntas), usuarios: n(f.usuarios), tokens_entrada: n(f.tokens_entrada),
      tokens_salida: n(f.tokens_salida), tokens_cache: n(f.tokens_cache), coste_usd: n(f.coste_usd),
      ingesta_fichas: n(f.ingesta_fichas), ingesta_coste_usd: n(f.ingesta_coste_usd),
    })) });
  });

  // Preguntas en lenguaje natural (Fase 4). Sin clave de Anthropic o sin instrucciones no se reserva ninguna pregunta.
  const cuerpoPregunta = z.object({ pregunta: z.string().trim().min(3, 'escribe una pregunta').max(1000, 'la pregunta es demasiado larga (máximo 1000 caracteres)') });
  app.post('/v1/preguntar', async (c) => {
    if (!c.env.ANTHROPIC_API_KEY || !instrucciones) throw new ErrorApi(503, 'las preguntas no están disponibles todavía');
    const r = cuerpoPregunta.safeParse(await leerJson(c.req.raw));
    if (!r.success) throw new ErrorApi(400, r.error.issues.map((i) => i.message).join('; '));
    // Sin sentido evidente: se rechaza antes de reservar cupo y antes de llamar a Claude.
    if (preguntaSinSentido(r.data.pregunta)) throw new ErrorApi(400, 'Esto no parece una pregunta. Escríbela con palabras (por ejemplo: «ayudas al alquiler joven»).');
    return c.json(await responderPregunta({ pregunta: r.data.pregunta, jwt: c.get('jwt'), env: c.env, fetchFn, esperar, instrucciones }));
  });

  return app;
}
