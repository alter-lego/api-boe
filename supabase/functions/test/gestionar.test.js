import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearManejador } from '../gestionar-periodistas/index.js';

const URL_SB = 'https://proyecto.supabase.co';
const SECRETA = 'sb_secret_CLAVE-SECRETA-DE-PRUEBA';
const PUBLICA = 'sb_publishable_publica';
const WEB = 'https://buscador-boe.alter-lego.workers.dev';
const JWT = 'jwt.del.admin';

const envBase = {
  SUPABASE_URL: URL_SB,
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLICA }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRETA }),
};
const env = (extra = {}) => { const e = { ...envBase, ...extra }; return (k) => e[k]; };

/** Supabase falso. `rpcs` y `auth` definen qué responde cada llamada. */
function sbFalso({ alta, lista = [], auth = { estado: 200, cuerpo: { id: 'u1' } } } = {}) {
  const llamadas = [];
  const res = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    llamadas.push({ ruta: u.pathname, host: u.host, cab: init.headers ?? {}, cuerpo: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === '/rest/v1/rpc/admin_alta_periodista') {
      const a = alta ?? { estado: 200, cuerpo: [{ email: JSON.parse(init.body).p_email, nombre: null, limite_diario: 30, activo: true, es_admin: false }] };
      return res(a.estado, a.cuerpo);
    }
    if (u.pathname === '/rest/v1/rpc/admin_listar_periodistas') return res(200, lista);
    if (u.pathname === '/auth/v1/admin/users') return res(auth.estado, auth.cuerpo);
    return res(404, {});
  };
  return { fetchFn, llamadas };
}

const pedir = (manejar, cuerpo, { cab = {}, metodo = 'POST', raw = false } = {}) => manejar(new Request('https://f.test/functions/v1/gestionar-periodistas', {
  method: metodo,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}`, Origin: WEB, ...cab },
  body: metodo === 'POST' ? (raw ? cuerpo : JSON.stringify(cuerpo)) : undefined,
}));
const crear = (sb, e = env()) => crearManejador({ fetchFn: sb.fetchFn, env: e });
const conClave = (sb, clave) => sb.llamadas.filter((l) => JSON.stringify(l.cab).includes(clave));

test('alta: la base decide primero (con la sesión del admin) y solo después se crea el usuario de Auth', async () => {
  const sb = sbFalso();
  const r = await pedir(crear(sb), { accion: 'alta', email: ' Ana@Test.local ', nombre: 'Ana', limite_diario: 40, es_admin: false });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.acceso_creado, true);
  assert.equal(j.periodista.email, 'ana@test.local');
  assert.deepEqual(sb.llamadas.map((l) => l.ruta), ['/rest/v1/rpc/admin_alta_periodista', '/auth/v1/admin/users']);
  const [rpc, auth] = sb.llamadas;
  assert.deepEqual(rpc.cuerpo, { p_email: 'ana@test.local', p_nombre: 'Ana', p_limite_diario: 40, p_es_admin: false });
  assert.equal(rpc.cab.Authorization, `Bearer ${JWT}`);   // sesión del que llama, no la clave secreta
  assert.equal(rpc.cab.apikey, PUBLICA);
  assert.deepEqual(auth.cuerpo, { email: 'ana@test.local', email_confirm: true });
  assert.equal(auth.cab.Authorization, `Bearer ${SECRETA}`);
});

test('la clave secreta solo se envía al crear el usuario de Auth, en Supabase; el JWT del usuario nunca va a la API de administración', async () => {
  const sb = sbFalso();
  await pedir(crear(sb), { accion: 'alta', email: 'ana@test.local' });
  const secretas = conClave(sb, SECRETA);
  assert.equal(secretas.length, 1);
  assert.equal(secretas[0].ruta, '/auth/v1/admin/users');
  assert.ok(sb.llamadas.every((l) => l.host === 'proyecto.supabase.co'));
  assert.equal(conClave(sb, JWT).some((l) => l.ruta === '/auth/v1/admin/users'), false);
});

test('sin sesión, con sesión que la base rechaza o sin ser admin: no se toca la clave secreta', async () => {
  // sin cabecera Authorization
  const sb1 = sbFalso();
  const r1 = await crear(sb1)(new Request('https://f.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'alta', email: 'a@test.local' }) }));
  assert.equal(r1.status, 401);
  assert.equal(sb1.llamadas.length, 0);
  // no es admin (42501)
  const sb2 = sbFalso({ alta: { estado: 403, cuerpo: { code: '42501', message: 'no autorizado' } } });
  assert.equal((await pedir(crear(sb2), { accion: 'alta', email: 'a@test.local' })).status, 403);
  assert.equal(conClave(sb2, SECRETA).length, 0);
  // sesión caducada (PT401)
  const sb3 = sbFalso({ alta: { estado: 401, cuerpo: { code: 'PT401', message: 'sesión caducada' } } });
  assert.equal((await pedir(crear(sb3), { accion: 'alta', email: 'a@test.local' })).status, 401);
  assert.equal(conClave(sb3, SECRETA).length, 0);
  // ya existe (23505) y datos no válidos de la base (22023)
  const sb4 = sbFalso({ alta: { estado: 409, cuerpo: { code: '23505' } } });
  assert.equal((await pedir(crear(sb4), { accion: 'alta', email: 'a@test.local' })).status, 409);
  const sb5 = sbFalso({ alta: { estado: 400, cuerpo: { code: '22023', message: 'límite diario no válido (1 a 1000)' } } });
  const r5 = await pedir(crear(sb5), { accion: 'alta', email: 'a@test.local', limite_diario: 5000 });
  assert.equal(r5.status, 400);
  assert.match((await r5.json()).error, /límite diario/);
  assert.equal(conClave(sb4, SECRETA).length + conClave(sb5, SECRETA).length, 0);
});

test('si falla crear el usuario de Auth, el alta queda hecha y se avisa para reintentar con «acceso»', async () => {
  const sb = sbFalso({ auth: { estado: 500, cuerpo: { error_code: 'unexpected_failure' } } });
  const r = await pedir(crear(sb), { accion: 'alta', email: 'ana@test.local' });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.periodista_creado, true);
  assert.match(j.error, /acceso/);
});

test('usuario de Auth que ya existía: es lo normal, acceso_creado = false', async () => {
  const sb = sbFalso({ auth: { estado: 422, cuerpo: { error_code: 'email_exists' } } });
  const r = await pedir(crear(sb), { accion: 'alta', email: 'ana@test.local' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).acceso_creado, false);
});

test('acceso: solo para alguien ya dado de alta y activo, comprobado con la sesión del admin', async () => {
  const lista = [{ email: 'ana@test.local', activo: true, es_admin: false }, { email: 'baja@test.local', activo: false, es_admin: false }];
  const sb = sbFalso({ lista });
  const ok = await pedir(crear(sb), { accion: 'acceso', email: 'ana@test.local' });
  assert.equal(ok.status, 200);
  assert.deepEqual(sb.llamadas.map((l) => l.ruta), ['/rest/v1/rpc/admin_listar_periodistas', '/auth/v1/admin/users']);
  assert.equal(sb.llamadas[0].cab.Authorization, `Bearer ${JWT}`);

  const sb2 = sbFalso({ lista });
  assert.equal((await pedir(crear(sb2), { accion: 'acceso', email: 'nadie@test.local' })).status, 404);
  assert.equal((await pedir(crear(sb2), { accion: 'acceso', email: 'baja@test.local' })).status, 409);
  assert.equal(conClave(sb2, SECRETA).length, 0);
});

test('entradas no válidas: 400/413/415/405 sin llamar a Supabase', async () => {
  const sb = sbFalso();
  const m = crear(sb);
  for (const cuerpo of [{}, { accion: 'alta' }, { accion: 'borrar', email: 'a@test.local' }, { accion: 'alta', email: 'sinarroba' },
    { accion: 'alta', email: 'ñ@test.local' }, { accion: 'alta', email: `${'a'.repeat(250)}@test.local` }, { accion: 'alta', email: 5 },
    { accion: 'alta', email: 'a@test.local', nombre: 'x'.repeat(201) }, { accion: 'alta', email: 'a@test.local', nombre: 7 },
    { accion: 'alta', email: 'a@test.local', limite_diario: '30' }, { accion: 'alta', email: 'a@test.local', limite_diario: 1.5 },
    { accion: 'alta', email: 'a@test.local', es_admin: 'sí' }]) {
    assert.equal((await pedir(m, cuerpo)).status, 400, JSON.stringify(cuerpo).slice(0, 60));
  }
  assert.equal((await pedir(m, '[1,2]', { raw: true })).status, 400);
  assert.equal((await pedir(m, '{no es json', { raw: true })).status, 400);
  assert.equal((await pedir(m, 'x', { raw: true, cab: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await pedir(m, JSON.stringify({ accion: 'alta', email: 'a@test.local', nombre: 'x'.repeat(5000) }), { raw: true })).status, 413);
  assert.equal((await pedir(m, null, { metodo: 'GET' })).status, 405);
  assert.equal(sb.llamadas.length, 0);
});

test('configuración: acepta claves nuevas (JSON) y antiguas (texto); si falta algo, 500 sin filtrar nada', async () => {
  // claves antiguas
  const sb = sbFalso();
  const e = env({ SUPABASE_PUBLISHABLE_KEYS: undefined, SUPABASE_SECRET_KEYS: undefined, SUPABASE_ANON_KEY: 'anon-antigua', SUPABASE_SERVICE_ROLE_KEY: 'service-antigua' });
  assert.equal((await pedir(crear(sb, e), { accion: 'alta', email: 'ana@test.local' })).status, 200);
  assert.equal(sb.llamadas[0].cab.apikey, 'anon-antigua');
  assert.equal(sb.llamadas[1].cab.Authorization, 'Bearer service-antigua');
  // falta la clave secreta
  const sb2 = sbFalso();
  const r = await pedir(crear(sb2, env({ SUPABASE_SECRET_KEYS: undefined })), { accion: 'alta', email: 'ana@test.local' });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'error interno' });
  assert.equal(sb2.llamadas.length, 0);
});

test('CORS: el preflight y las respuestas solo dan permiso al origen de la web; errores incluidos', async () => {
  const m = crear(sbFalso());
  const pre = await m(new Request('https://f.test/', { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, apikey' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), WEB);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /authorization/);
  const preMalo = await m(new Request('https://f.test/', { method: 'OPTIONS', headers: { Origin: 'https://malo.test' } }));
  assert.equal(preMalo.headers.get('Access-Control-Allow-Origin'), null);
  const error = await pedir(m, { accion: 'alta' });   // 400
  assert.equal(error.status, 400);
  assert.equal(error.headers.get('Access-Control-Allow-Origin'), WEB);
  const ajeno = await pedir(m, { accion: 'alta', email: 'a@test.local' }, { cab: { Origin: 'https://malo.test' } });
  assert.equal(ajeno.headers.get('Access-Control-Allow-Origin'), null);
});

test('alta con la base lenta o caída: puede haberse guardado, así que se avisa de usar «acceso» y no se crea ningún usuario', async () => {
  const tiempo = async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); };
  const red = async () => { throw new TypeError('fetch failed: detalle secreto'); };
  for (const fetchFn of [tiempo, red]) {
    const r = await pedir(crearManejador({ fetchFn, env: env() }), { accion: 'alta', email: 'a@test.local' });
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.equal(j.periodista_quiza_creado, true);
    assert.match(j.error, /acceso/);
    assert.ok(!JSON.stringify(j).includes('secreto'));
  }
  // un 500 de la base en el alta también es «sin confirmar»
  const sb = sbFalso({ alta: { estado: 500, cuerpo: { code: 'XX000', message: 'detalle interno' } } });
  const r = await pedir(crear(sb), { accion: 'alta', email: 'a@test.local' });
  assert.equal(r.status, 502);
  assert.equal(conClave(sb, SECRETA).length, 0);
});

test('en acceso, un fallo de la base no dice «dado de alta»; un 401 sin código (token manipulado) es 401', async () => {
  const fetch500 = async () => new Response('{}', { status: 500 });
  const r = await pedir(crearManejador({ fetchFn: fetch500, env: env() }), { accion: 'acceso', email: 'a@test.local' });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(await r.json()).includes('dado de alta'));
  // PostgREST rechaza un token ajeno con 401 y código PGRST301 (sin PT401)
  const fetch401 = async () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT invalid' }), { status: 401 });
  const sb = { llamadas: [] };
  const r2 = await pedir(crearManejador({ fetchFn: fetch401, env: env() }), { accion: 'alta', email: 'a@test.local' });
  assert.equal(r2.status, 401);
  assert.equal(sb.llamadas.length, 0);
});

test('fallo al crear el acceso en acceso: no dice «dado de alta»; con alta sí e indica periodista_creado', async () => {
  const sb = sbFalso({ lista: [{ email: 'ana@test.local', activo: true }], auth: { estado: 500, cuerpo: { error_code: 'x' } } });
  const r = await pedir(crear(sb), { accion: 'acceso', email: 'ana@test.local' });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.periodista_creado, undefined);
  assert.ok(!j.error.includes('dado de alta'));
});

test('respuestas raras de la base: lista vacía, 2xx sin fila o sin correo → no se crea nada', async () => {
  const sb = sbFalso({ lista: [] });
  assert.equal((await pedir(crear(sb), { accion: 'acceso', email: 'a@test.local' })).status, 404);
  const sb2 = sbFalso({ alta: { estado: 200, cuerpo: [] } });
  assert.equal((await pedir(crear(sb2), { accion: 'alta', email: 'a@test.local' })).status, 502);
  const sb3 = sbFalso({ alta: { estado: 200, cuerpo: [{ nombre: 'sin correo' }] } });
  assert.equal((await pedir(crear(sb3), { accion: 'alta', email: 'a@test.local' })).status, 502);
  assert.equal(conClave(sb, SECRETA).length + conClave(sb2, SECRETA).length + conClave(sb3, SECRETA).length, 0);
});

test('el usuario de Auth se crea con el correo que devolvió la base, no con el del cuerpo', async () => {
  const sb = sbFalso({ alta: { estado: 200, cuerpo: [{ email: 'devuelto@test.local', activo: true }] } });
  await pedir(crear(sb), { accion: 'alta', email: 'enviado@test.local' });
  assert.equal(sb.llamadas.find((l) => l.ruta === '/auth/v1/admin/users').cuerpo.email, 'devuelto@test.local');
});

test('Auth: «ya existe» con cualquiera de los dos códigos (422 o 409) no es un error', async () => {
  for (const auth of [{ estado: 422, cuerpo: { error_code: 'user_already_exists' } }, { estado: 409, cuerpo: { error_code: 'email_exists' } }]) {
    const r = await pedir(crear(sbFalso({ auth })), { accion: 'alta', email: 'a@test.local' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).acceso_creado, false);
  }
});

test('validación extra: límite fuera de rango o absurdo → 400; token sin forma de JWT → 401 sin llamar a la base', async () => {
  const sb = sbFalso();
  const m = crear(sb);
  for (const l of [0, 1001, 1e20, -5]) assert.equal((await pedir(m, { accion: 'alta', email: 'a@test.local', limite_diario: l })).status, 400, String(l));
  for (const malo of ['x', 'a.b', 'con espacios.a.b', '']) {
    const r = await pedir(m, { accion: 'alta', email: 'a@test.local' }, { cab: { Authorization: `Bearer ${malo || 'x'}` } });
    assert.equal(r.status, 401, malo);
  }
  assert.equal(sb.llamadas.length, 0);
});

test('CORS: todas las respuestas llevan Vary: Origin', async () => {
  const m = crear(sbFalso());
  const r = await pedir(m, { accion: 'alta', email: 'a@test.local' });
  assert.match(r.headers.get('Vary') ?? '', /Origin/);
  const mal = await pedir(m, { accion: 'alta', email: 'a@test.local' }, { cab: { Origin: 'https://malo.test' } });
  assert.match(mal.headers.get('Vary') ?? '', /Origin/);
});
