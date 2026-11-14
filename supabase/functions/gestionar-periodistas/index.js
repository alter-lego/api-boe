// Edge Function de Supabase: alta de periodistas con su acceso de Auth, en un solo paso.
//
// Lo publica el usuario pegando este fichero (como index.ts) en el panel de Supabase; ver docs/edge-function-alta.md.
//
// Cómo decide quién puede usarla: NO verifica el JWT por su cuenta. Reenvía la sesión del que llama a las
// funciones SQL (admin_alta_periodista / admin_listar_periodistas). Esas funciones comprueban en la base de datos
// que es un administrador activo con sesión de menos de 24 h (migraciones 10 y 11) y anotan su correo en el log.
// Solo si la base las acepta se usa la clave secreta, y únicamente para crear el usuario de Supabase Auth
// (confirmado y sin contraseña). La clave no sale de Supabase.
//
// Acciones (POST, JSON):
//   { accion: 'alta', email, nombre?, limite_diario?, es_admin? }  da de alta en `periodistas` y crea su acceso.
//   { accion: 'acceso', email }  crea el acceso de alguien ya dado de alta y activo (reparación si un alta se quedó a medias).

const ORIGENES_PERMITIDOS = ['https://buscador-boe.alter-lego.workers.dev', 'http://localhost:5173', 'http://localhost:8080'];
const TOPE_CUERPO = 4096;
const CORREO = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

class ErrorFuncion extends Error {
  estado = 0;
  extra = {};
  constructor(estado, mensaje, extra = {}) { super(mensaje); this.estado = estado; this.extra = extra; }
}

/** Mensaje de cualquier error (también los de tipo desconocido) sin filtrar nada más. */
const mensajeDe = (e) => String(Object(e).message ?? e).slice(0, 80);
const JWT_FORMA = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Lee un secreto que puede venir como JSON {"default": "..."} (claves nuevas) o como texto (claves antiguas). */
function claveDe(env, nombreNuevo, nombreAntiguo) {
  const crudo = env(nombreNuevo);
  if (crudo) {
    try {
      const d = JSON.parse(crudo);
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') return d.default ?? Object.values(d).find((v) => typeof v === 'string') ?? null;
    } catch { /* no era JSON: se usa tal cual */ return crudo; }
  }
  return env(nombreAntiguo) ?? null;
}

async function rpc(fetchFn, url, clavePublica, jwt, nombre, args) {
  const res = await fetchFn(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: clavePublica, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return res.json();
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
  if (cuerpo.code === 'PT401' || res.status === 401) throw new ErrorFuncion(401, 'sesión caducada: vuelve a entrar');
  if (cuerpo.code === '42501') throw new ErrorFuncion(403, 'no autorizado');
  if (cuerpo.code === '22023') throw new ErrorFuncion(400, cuerpo.message ?? 'datos no válidos');
  if (cuerpo.code === '23505') throw new ErrorFuncion(409, 'ya existe un periodista con ese correo; si su alta se quedó a medias, usa la acción «acceso»');
  throw new ErrorFuncion(502, 'no se pudo completar la operación');
}

/** Crea el usuario de Auth si no existe. Devuelve true si lo ha creado, false si ya existía. */
async function asegurarUsuarioAuth(fetchFn, url, claveSecreta, email) {
  const res = await fetchFn(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: claveSecreta, Authorization: `Bearer ${claveSecreta}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return true;
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
  // Según la versión de Auth, «ya existe» llega con uno de estos dos códigos (422 o 409).
  if ((res.status === 422 || res.status === 409) && ['email_exists', 'user_already_exists'].includes(cuerpo.error_code)) return false;
  throw new Error(`crear usuario ${res.status} ${cuerpo.error_code ?? ''}`);
}

async function leerCuerpo(req) {
  const flujo = req.body;
  if (!flujo) return '';
  const lector = flujo.getReader();
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > TOPE_CUERPO) { await lector.cancel().catch(() => {}); throw new ErrorFuncion(413, 'solicitud demasiado grande'); }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { todo.set(t, pos); pos += t.byteLength; }
  return new TextDecoder().decode(todo);
}

/**
 * @param {{ fetchFn?: typeof fetch, env: (nombre: string) => string | undefined }} deps
 * @returns {(req: Request) => Promise<Response>}
 */
export function crearManejador({ fetchFn = fetch, env }) {
  const cabecerasCors = (origen) => (ORIGENES_PERMITIDOS.includes(origen ?? '')
    ? {
        'Access-Control-Allow-Origin': origen,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' });

  return async function manejar(req) {
    const origen = req.headers.get('Origin');
    const responder = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cabecerasCors(origen) },
    });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecerasCors(origen) });
    if (req.method !== 'POST') return responder(405, { error: 'método no permitido' });

    try {
      const url = (env('SUPABASE_URL') ?? '').replace(/\/$/, '');
      const clavePublica = claveDe(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
      const claveSecreta = claveDe(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !clavePublica || !claveSecreta) throw new Error('configuración incompleta');

      const m = /^Bearer (.+)$/i.exec(req.headers.get('Authorization') ?? '');
      if (!m) throw new ErrorFuncion(401, 'falta la sesión');
      const jwt = m[1];
      if (!JWT_FORMA.test(jwt)) throw new ErrorFuncion(401, 'sesión no válida'); // ni siquiera tiene forma de JWT: no se llama a la base

      if (!(req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) throw new ErrorFuncion(415, 'se esperaba JSON');
      let datos;
      try { datos = JSON.parse(await leerCuerpo(req)); } catch (e) { if (e instanceof ErrorFuncion) throw e; throw new ErrorFuncion(400, 'JSON no válido'); }
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ErrorFuncion(400, 'cuerpo no válido');

      const email = typeof datos.email === 'string' ? datos.email.trim().toLowerCase() : '';
      if (email.length > 254 || !CORREO.test(email)) throw new ErrorFuncion(400, 'correo no válido');

      let periodista;
      if (datos.accion === 'alta') {
        if (datos.nombre != null && (typeof datos.nombre !== 'string' || datos.nombre.length > 200)) throw new ErrorFuncion(400, 'nombre no válido');
        if (datos.limite_diario != null && (!Number.isInteger(datos.limite_diario) || datos.limite_diario < 1 || datos.limite_diario > 1000)) throw new ErrorFuncion(400, 'límite diario no válido (1 a 1000)');
        if (datos.es_admin != null && typeof datos.es_admin !== 'boolean') throw new ErrorFuncion(400, 'es_admin no válido');
        // 1) La base de datos decide si quien llama puede dar de alta (admin con sesión vigente).
        let filas;
        try {
          filas = await rpc(fetchFn, url, clavePublica, jwt, 'admin_alta_periodista', {
            p_email: email,
            p_nombre: datos.nombre ?? null,
            p_limite_diario: datos.limite_diario ?? 30,
            p_es_admin: datos.es_admin ?? false,
          });
        } catch (e) {
          // Si se agotó el tiempo o falló la red, la base pudo guardar el alta sin que lo sepamos.
          if (!(e instanceof ErrorFuncion) || e.estado === 502) {
            console.error('gestionar-periodistas: alta sin confirmar:', mensajeDe(e));
            throw new ErrorFuncion(502, 'no se pudo confirmar el alta; mira la lista y, si el periodista aparece, usa la acción «acceso»', { periodista_quiza_creado: true });
          }
          throw e;
        }
        periodista = Array.isArray(filas) ? filas[0] : filas;
        if (!periodista || typeof periodista.email !== 'string') throw new ErrorFuncion(502, 'respuesta inesperada de la base de datos', { periodista_quiza_creado: true });
      } else if (datos.accion === 'acceso') {
        // 1) Igual: solo un admin con sesión vigente puede listar; el correo debe estar en la lista y activo.
        const lista = await rpc(fetchFn, url, clavePublica, jwt, 'admin_listar_periodistas', {});
        periodista = (Array.isArray(lista) ? lista : []).find((p) => p.email === email);
        if (!periodista) throw new ErrorFuncion(404, 'ese correo no está dado de alta');
        if (!periodista.activo) throw new ErrorFuncion(409, 'ese periodista está dado de baja');
      } else {
        throw new ErrorFuncion(400, 'acción no válida');
      }

      // 2) Solo ahora se usa la clave secreta, y solo para crear el usuario de Auth del correo que ACEPTÓ la base.
      let acceso;
      try {
        acceso = await asegurarUsuarioAuth(fetchFn, url, claveSecreta, periodista.email);
      } catch (e) {
        console.error('gestionar-periodistas:', mensajeDe(e));
        if (datos.accion === 'alta') {
          throw new ErrorFuncion(502, 'dado de alta, pero no se pudo crear su acceso; usa la acción «acceso» para reintentarlo', { periodista_creado: true });
        }
        throw new ErrorFuncion(502, 'no se pudo crear su acceso; inténtalo de nuevo');
      }
      return responder(200, { ok: true, periodista, acceso_creado: acceso });
    } catch (e) {
      if (e instanceof ErrorFuncion) return responder(e.estado, { error: e.message, ...e.extra });
      console.error('gestionar-periodistas: error no controlado:', mensajeDe(e));
      return responder(500, { error: 'error interno' });
    }
  };
}

// En Supabase (Deno) se publica el manejador; en las pruebas (Node) solo se importa `crearManejador`.
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(crearManejador({ env: (k) => Deno.env.get(k) }));
}
