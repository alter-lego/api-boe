import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { crearApp } from '../src/app.js';

const URL_SB = 'https://proyecto.supabase.co';
const env = { SUPABASE_URL: URL_SB, SUPABASE_ANON_KEY: 'anon-publica', ALLOWED_ORIGINS: 'https://web.test,http://localhost:5173' };

const { publicKey, privateKey } = await generarClaves();
async function generarClaves() { return generateKeyPair('ES256'); }
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });

async function token({ email = 'prueba@test.local', role = 'authenticated', aud = 'authenticated', iss = `${URL_SB}/auth/v1`, exp = '1h', anonimo = false, clave = privateKey, loginHace = 60, amr = undefined, metodo = 'otp' } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const claims = { role, amr: amr === undefined ? [{ method: metodo, timestamp: ahora - loginHace }] : amr, ...(email ? { email } : {}), ...(anonimo ? { is_anonymous: true } : {}) };
  return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setAudience(aud).setIssuer(iss).setSubject('u1').setIssuedAt().setExpirationTime(exp).sign(clave);
}

/** Supabase falso: guarda las llamadas y responde lo que se le diga. */
function sbFalso(respuestas = {}) {
  const llamadas = [];
  const fetchFn = async (url, init) => {
    const nombre = new URL(url).pathname.split('/').pop();
    llamadas.push({ nombre, args: JSON.parse(init.body), cab: init.headers });
    const r = respuestas[nombre] ?? { estado: 200, cuerpo: [] };
    return new Response(JSON.stringify(r.cuerpo), { status: r.estado ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchFn, llamadas };
}
const pedir = (app, ruta, init = {}) => app.request(ruta, init, env);
const conSesion = async (extra = {}) => ({ headers: { Authorization: `Bearer ${await token(extra)}` } });

test('health: sin sesión, devuelve la última ingesta', async () => {
  const sb = sbFalso({ ultima_ingesta: { cuerpo: [{ fecha: '2026-11-14', fin: '2026-11-14T08:00:00Z' }] } });
  const r = await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ultima_ingesta: { fecha: '2026-11-14', fin: '2026-11-14T08:00:00Z' } });
  assert.equal(sb.llamadas[0].cab.Authorization, 'Bearer anon-publica');
});

test('sin sesión: 401 y no se llama a la base de datos', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  for (const ruta of ['/v1/publicaciones?q=hola', '/v1/conteos', '/v1/publicaciones/BOE-A-2026-1', '/v1/sumarios/2026-11-12', '/v1/personas?nombre=Herrero']) {
    const r = await pedir(app, ruta);
    assert.equal(r.status, 401, ruta);
  }
  assert.equal(sb.llamadas.length, 0);
});

test('sesiones inválidas: caducada, otro emisor, otra audiencia, anon, anónima, sin correo, firma ajena', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const otra = (await generarClaves()).privateKey;
  const casos = {
    caducada: { exp: '-1h' }, otro_emisor: { iss: 'https://otro.supabase.co/auth/v1' }, otra_audiencia: { aud: 'otra' },
    rol_anon: { role: 'anon' }, anonima: { anonimo: true }, sin_correo: { email: null }, firma_ajena: { clave: otra },
  };
  for (const [nombre, extra] of Object.entries(casos)) {
    const r = await pedir(app, '/v1/publicaciones?q=hola', await conSesion(extra));
    assert.equal(r.status, 401, nombre);
  }
  const r = await pedir(app, '/v1/publicaciones?q=hola', { headers: { Authorization: 'Bearer basura' } });
  assert.equal(r.status, 401);
  assert.equal(sb.llamadas.length, 0);
});

test('duración de la sesión: máximo 24 h desde el login original, aunque el token se haya renovado', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const hora = 3600;
  // login hace 23 h (token renovado hace poco): vale
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ loginHace: 23 * hora }))).status, 200);
  // login hace 25 h con token recién renovado: caducada
  const r = await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ loginHace: 25 * hora }));
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /caducada/);
  // sin marca de login, o con marcas ilegibles: se rechaza
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ amr: [] }))).status, 401);
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ amr: null }))).status, 401);
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ amr: [{ method: 'otp', timestamp: 'x' }] }))).status, 401);
  // con varias marcas manda la más antigua (el login original)
  const ahora = Math.floor(Date.now() / 1000);
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ amr: [{ method: 'totp', timestamp: ahora - 60 }, { method: 'otp', timestamp: ahora - 30 * hora }] }))).status, 401);
  // el límite se puede cambiar por configuración
  const largo = await app.request('/v1/publicaciones?q=hola', await conSesion({ loginHace: 25 * hora }), { ...env, SESION_MAX_HORAS: '48' });
  assert.equal(largo.status, 200);
});

test('método de acceso: solo enlace del correo (otp/magiclink); contraseña u otros, no', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ metodo: 'magiclink' }))).status, 200);
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ metodo: 'password' }))).status, 401);
  assert.equal((await pedir(app, '/v1/publicaciones?q=hola', await conSesion({ metodo: 'sms' }))).status, 401);
});

test('fallo de las claves de Supabase: 503 (no 401, para no cerrar la sesión a todos); token malo: 401', async () => {
  const sb = sbFalso();
  const init = await conSesion();
  const jwksCaido = async () => { throw new TypeError('fetch failed'); };
  const r = await pedir(crearApp({ fetchFn: sb.fetchFn, jwks: jwksCaido }), '/v1/publicaciones?q=hola', init);
  assert.equal(r.status, 503);
  const e = Object.assign(new Error('timeout'), { code: 'ERR_JWKS_TIMEOUT' });
  const jwksLento = async () => { throw e; };
  assert.equal((await pedir(crearApp({ fetchFn: sb.fetchFn, jwks: jwksLento }), '/v1/publicaciones?q=hola', init)).status, 503);
  // un token mal firmado sigue siendo 401
  const otra = (await generarClaves()).privateKey;
  assert.equal((await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/publicaciones?q=hola', await conSesion({ clave: otra }))).status, 401);
  assert.equal(sb.llamadas.length, 0);
});

test('Supabase lento o caído al llamar a la RPC: 504 y 502, sin detalles', async () => {
  const init = await conSesion();
  const timeout = async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); };
  const red = async () => { throw new TypeError('fetch failed: detalle interno'); };
  const r1 = await pedir(crearApp({ fetchFn: timeout, jwks }), '/v1/publicaciones?q=hola', init);
  assert.equal(r1.status, 504);
  const r2 = await pedir(crearApp({ fetchFn: red, jwks }), '/v1/publicaciones?q=hola', init);
  assert.equal(r2.status, 502);
  assert.ok(!JSON.stringify(await r2.json()).includes('interno'));
});

test('publicaciones: traduce filtros a la RPC y reenvía el JWT del usuario', async () => {
  const sb = sbFalso({ buscar_publicaciones: { cuerpo: [{ id: 'BOE-A-2026-1', titulo: 'T' }] } });
  const init = await conSesion();
  const r = await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }),
    '/v1/publicaciones?q=Bassa&desde=2026-11-01&hasta=2026-11-14&seccion=2A&organismo=Hacienda&tema=empleo_y_trabajo,vivienda&tipo=nombramiento&rango=Real%20Decreto&limit=5', init);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { n: 1, publicaciones: [{ id: 'BOE-A-2026-1', titulo: 'T' }] });
  const l = sb.llamadas[0];
  assert.equal(l.nombre, 'buscar_publicaciones');
  assert.equal(l.cab.Authorization, init.headers.Authorization);   // el JWT del usuario, no la clave anon
  assert.equal(l.cab.apikey, 'anon-publica');
  assert.deepEqual(l.args, { p_desde: '2026-11-01', p_hasta: '2026-11-14', p_seccion: '2A', p_departamento: 'Hacienda', p_temas: ["empleo_y_trabajo", "vivienda"], p_tipo_acto: 'nombramiento', p_q: 'Bassa', p_rango: 'Real Decreto', p_limite: 5 });
});

test('publicaciones: por defecto límite 20 y todo lo demás a null', async () => {
  const sb = sbFalso();
  await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/publicaciones', await conSesion());
  assert.deepEqual(sb.llamadas[0].args, { p_desde: null, p_hasta: null, p_seccion: null, p_departamento: null, p_temas: null, p_tipo_acto: null, p_q: null, p_rango: null, p_limite: 20 });
});

test('validación: entradas malas dan 400 sin llegar a la base de datos', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const init = await conSesion();
  const malas = ['desde=ayer', 'desde=2026-13-45', 'seccion=9', 'tema=inventado', 'tipo=otra', 'limit=0', 'limit=101', 'limit=abc',
    `q=${'x'.repeat(501)}`, 'tema=vivienda,vivienda,vivienda,vivienda,vivienda,vivienda'];
  for (const q of malas) {
    const r = await pedir(app, `/v1/publicaciones?${q}`, init);
    assert.equal(r.status, 400, q);
  }
  const r = await pedir(app, '/v1/conteos?agrupar=seccion', init);
  assert.equal(r.status, 400);
  assert.equal((await pedir(app, '/v1/sumarios/hoy', init)).status, 400);
  assert.equal((await pedir(app, '/v1/publicaciones/../etc', init)).status, 404);
  assert.equal((await pedir(app, '/v1/publicaciones/a%20b', init)).status, 400);
  assert.equal(sb.llamadas.length, 0);
});

test('conteos: agrupar se traduce a los nombres de la base', async () => {
  const sb = sbFalso({ contar_publicaciones: { cuerpo: [{ grupo: '2026-11', n: 3 }] } });
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const init = await conSesion();
  const r = await pedir(app, '/v1/conteos?agrupar=organismo&q=Bassa', init);
  assert.deepEqual(await r.json(), { agrupar: 'organismo', grupos: [{ grupo: '2026-11', n: 3 }] });
  assert.equal(sb.llamadas[0].args.p_agrupar, 'departamento');
  await pedir(app, '/v1/conteos?agrupar=tipo', init);
  assert.equal(sb.llamadas[1].args.p_agrupar, 'tipo_acto');
  await pedir(app, '/v1/conteos', init);
  assert.equal(sb.llamadas[2].args.p_agrupar, 'total');
});

test('publicacion: 404 si no existe, ficha si existe', async () => {
  const sb = sbFalso({ publicacion: { cuerpo: [] } });
  const init = await conSesion();
  assert.equal((await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/publicaciones/BOE-A-2026-9', init)).status, 404);
  const sb2 = sbFalso({ publicacion: { cuerpo: [{ id: 'BOE-A-2026-9', titulo: 'T' }] } });
  const r = await pedir(crearApp({ fetchFn: sb2.fetchFn, jwks }), '/v1/publicaciones/BOE-A-2026-9', init);
  assert.deepEqual(await r.json(), { id: 'BOE-A-2026-9', titulo: 'T' });
});

test('sumario: agrupa por sección y cachea solo días pasados', async () => {
  const cuerpo = [
    { id: 'a', seccion: '1', seccion_nombre: 'I', titulo: 'x' }, { id: 'b', seccion: '1', seccion_nombre: 'I', titulo: 'y' },
    { id: 'c', seccion: '3', seccion_nombre: 'III', titulo: 'z' },
  ];
  const sb = sbFalso({ sumario_del_dia: { cuerpo } });
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const init = await conSesion();
  const r = await pedir(app, '/v1/sumarios/2026-11-12', init);
  const j = await r.json();
  assert.equal(j.total, 3);
  assert.deepEqual(j.secciones.map((s) => [s.seccion, s.publicaciones.length]), [['1', 2], ['3', 1]]);
  assert.equal(r.headers.get('Cache-Control'), 'private, max-age=300');
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  assert.equal((await pedir(app, `/v1/sumarios/${hoy}`, init)).headers.get('Cache-Control'), 'no-store');
});

test('errores de la base: 42501→403, 22023→400, 401→401, resto→502 sin filtrar detalles', async () => {
  const init = await conSesion();
  const caso = async (estado, cuerpo) => {
    const sb = sbFalso({ buscar_publicaciones: { estado, cuerpo } });
    return pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/publicaciones?q=hola', init);
  };
  assert.equal((await caso(403, { code: '42501', message: 'no autorizado' })).status, 403);
  const r400 = await caso(400, { code: '22023', message: 'la búsqueda no contiene palabras útiles' });
  assert.equal(r400.status, 400);
  assert.match((await r400.json()).error, /palabras útiles/);
  assert.equal((await caso(401, { message: 'JWT expired' })).status, 401);
  assert.equal((await caso(500, { code: 'XX000', message: 'detalle interno secreto' })).status, 502);
  const r = await caso(500, { code: 'XX000', message: 'detalle interno secreto' });
  assert.ok(!JSON.stringify(await r.json()).includes('secreto'));
  assert.equal((await caso(500, { code: '57014' })).status, 504);
});

test('CORS: solo los orígenes permitidos; cabeceras de seguridad', async () => {
  const app = crearApp({ fetchFn: sbFalso().fetchFn, jwks });
  const ok = await pedir(app, '/v1/health', { headers: { Origin: 'https://web.test' } });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://web.test');
  assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
  const mal = await pedir(app, '/v1/health', { headers: { Origin: 'https://malo.test' } });
  assert.equal(mal.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await pedir(app, '/v1/publicaciones', { method: 'OPTIONS', headers: { Origin: 'https://web.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.status, 204);
});

test('preguntar sin configurar (sin clave de Anthropic): 503 y no se reserva nada; rutas inexistentes: 404 JSON', async () => {
  const sb = sbFalso();
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const init = await conSesion();
  const r = await pedir(app, '/v1/preguntar', { ...init, method: 'POST', headers: { ...init.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ pregunta: 'hola qué tal' }) });
  assert.equal(r.status, 503);
  assert.equal(sb.llamadas.length, 0);
  assert.equal((await pedir(app, '/v1/nada', init)).status, 404);
});

test('gasto: preguntas e ingesta por mes; sin la migración 14 la ingesta sale a 0', async () => {
  const sb = sbFalso({ admin_gasto: { cuerpo: [
    { mes: '2026-11-01', preguntas: 42, usuarios: 5, tokens_entrada: 310000, tokens_salida: 41000, tokens_cache: 120000, coste_usd: 0.0812, ingesta_fichas: 1800, ingesta_coste_usd: 0.9 },
    { mes: '2026-10-01', preguntas: 3, usuarios: 1, tokens_entrada: 1, tokens_salida: 1, tokens_cache: 0, coste_usd: 0.01 },
  ] } });
  const r = await pedir(crearApp({ fetchFn: sb.fetchFn, jwks }), '/v1/admin/gasto?meses=2', await conSesion());
  assert.equal(r.status, 200);
  const { meses } = await r.json();
  assert.equal(meses[0].ingesta_fichas, 1800);
  assert.equal(meses[0].ingesta_coste_usd, 0.9);
  assert.equal(meses[1].ingesta_fichas, 0);
  assert.equal(meses[1].ingesta_coste_usd, 0);
  assert.deepEqual(sb.llamadas[0].args, { p_meses: 2 });
});

test('personas: valida el nombre, reenvía la sesión y aplana la ficha con su coincidencia', async () => {
  const ficha = (id) => ({ id, titulo: 't', nivel_privacidad: 'publico' });
  const sb = sbFalso({ buscar_persona: { cuerpo: [
    { coincidencia: 'titulo', total_grupo: 2, ficha: ficha('BOE-A-2026-1') },
    { coincidencia: 'titulo', total_grupo: 2, ficha: ficha('BOE-A-2026-2') },
    { coincidencia: 'restringida', total_grupo: 340, ficha: ficha('BOE-A-2026-3') },
  ] } });
  const app = crearApp({ fetchFn: sb.fetchFn, jwks });
  const r = await pedir(app, '/v1/personas?nombre=%20Herrero%20&desde=2026-09-01&seccion=3', await conSesion());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.n, 3);
  assert.deepEqual(j.totales, { titulo: 2, resumen: 0, seguido: 0, restringida: 340 });
  assert.deepEqual(j.resultados[2], { id: 'BOE-A-2026-3', titulo: 't', nivel_privacidad: 'publico', coincidencia: 'restringida' });
  assert.deepEqual(sb.llamadas[0].args, { p_nombre: 'Herrero', p_desde: '2026-09-01', p_hasta: null, p_seccion: '3', p_limite: 100 });
  assert.match(sb.llamadas[0].cab.Authorization, /^Bearer /);
  for (const mala of ['', 'nombre=a', 'nombre=Herrero&seccion=9', 'nombre=Herrero&desde=2026-13-01', `nombre=${'x'.repeat(101)}`]) {
    const m = await pedir(app, `/v1/personas?${mala}`, await conSesion());
    assert.equal(m.status, 400, mala);
  }
  assert.equal(sb.llamadas.length, 1);
});
