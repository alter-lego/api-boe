import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clasificarNivel, parsearSumario, resumir, fechaISO } from '../lib/sumario.js';
import { descargarSumario } from '../lib/boe-api.js';
import { ingestarFecha } from '../boe.js';

const leer = (f) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
const normal = () => JSON.parse(leer('sumario-dia-normal.json'));
const extra = () => JSON.parse(leer('sumario-con-extraordinario.json'));

// ───────────── Niveles de privacidad ─────────────

test('secciones públicas y restringidas según docs/niveles-privacidad.md', () => {
  for (const s of ['1', '2A', '3', '5A', 'T']) assert.equal(clasificarNivel(s, 'x'), 'publico', s);
  for (const s of ['2B', '4', '5C']) assert.equal(clasificarNivel(s, 'x'), 'restringido', s);
});

test('una sección desconocida es restringida', () => {
  assert.equal(clasificarNivel('9Z', 'x'), 'restringido');
  assert.equal(clasificarNivel(undefined, 'x'), 'restringido');
});

test('V.B es pública salvo subastas, expropiaciones y títulos universitarios', () => {
  assert.equal(clasificarNivel('5B', 'Extracto de la Resolución por la que se convoca la subvención X'), 'publico');
  assert.equal(clasificarNivel('5B', 'Anuncio de la Confederación Hidrográfica del Duero de información pública de una concesión'), 'publico');
  assert.equal(clasificarNivel('5B', 'U.R. SUBASTAS CATALUÑA'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio de la Agencia Tributaria sobre SUBASTA de bienes'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Resolución por la que se convoca el levantamiento de actas previas a la ocupación'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio sobre expropiación forzosa'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio de ADIF por el que se somete a información pública a efectos de declaración de la necesidad de ocupación el Proyecto de Plataforma.'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio sobre la NECESIDAD DE LA OCUPACIÓN de los terrenos'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio por el que se publica la relación de bienes y derechos afectados por la obra'), 'restringido');
  // Una autorización de un proyecto de energía (utilidad pública) sigue siendo pública: lo esencial es el proyecto.
  assert.equal(clasificarNivel('5B', 'Anuncio por el que se somete a información pública la solicitud de autorización administrativa y declaración, en concreto, de utilidad pública del parque eólico'), 'publico');
  assert.equal(clasificarNivel('5B', 'Anuncio del Centro Universitario sobre destrucción de título Universitario.'), 'restringido');
  assert.equal(clasificarNivel('5B', 'Anuncio sobre extravío de título de Graduado'), 'restringido');
  // Los títulos nobiliarios son públicos (decisión del 13/11/2026): sin restricción.
  assert.equal(clasificarNivel('5B', 'Anuncio por el que se anuncia la solicitud de sucesión en el título de Condesa de Benalúa.'), 'publico');
});

test('las reglas de V.B solo se aplican a V.B', () => {
  assert.equal(clasificarNivel('3', 'Resolución sobre una subasta de bienes del Estado'), 'publico');
});

// ───────────── Lectura del sumario real ─────────────

test('fechaISO convierte AAAAMMDD y rechaza lo demás', () => {
  assert.equal(fechaISO('20261112'), '2026-11-12');
  assert.throws(() => fechaISO('2026-11-12'));
  assert.throws(() => fechaISO(undefined));
});

test('día normal: un diario, 7 secciones y publicaciones bien formadas', () => {
  const { fecha, diarios } = parsearSumario(normal());
  assert.equal(fecha, '2026-11-12');
  assert.equal(diarios.length, 1);
  assert.equal(diarios[0].numero, '282');
  assert.equal(diarios[0].identificador, 'BOE-S-2026-282');
  const pubs = diarios[0].publicaciones;
  assert.ok(pubs.length > 10);
  // La sección T trae su contenido envuelto en `texto`: este día tiene una publicación.
  assert.deepEqual([...new Set(pubs.map((p) => p.seccion))].sort(), ['1', '2A', '2B', '3', '5A', '5B', 'T']);
  assert.ok(pubs.filter((p) => p.seccion === 'T').every((p) => p.nivel_privacidad === 'publico'));
  for (const p of pubs) {
    assert.match(p.id, /^BOE-[AB]-\d{4}-\d+$/);
    assert.equal(p.fecha, '2026-11-12');
    assert.ok(p.titulo);
    assert.match(p.url_xml, /xml\.php\?id=/);
    assert.ok(['publico', 'restringido'].includes(p.nivel_privacidad));
  }
});

test('los identificadores no se repiten', () => {
  const ids = parsearSumario(normal()).diarios.flatMap((d) => d.publicaciones.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('II.B queda restringida y I, II.A y III públicas en datos reales', () => {
  const pubs = parsearSumario(normal()).diarios[0].publicaciones;
  assert.ok(pubs.filter((p) => p.seccion === '2B').every((p) => p.nivel_privacidad === 'restringido'));
  assert.ok(pubs.filter((p) => ['1', '2A', '3', '5A'].includes(p.seccion)).every((p) => p.nivel_privacidad === 'publico'));
});

test('los dos formatos (item directo y dentro de epígrafe) se leen', () => {
  const pubs = parsearSumario(normal()).diarios[0].publicaciones;
  assert.ok(pubs.some((p) => p.epigrafe === null), 'falta algún item sin epígrafe');
  assert.ok(pubs.some((p) => p.epigrafe !== null), 'falta algún item con epígrafe');
});

test('día con extraordinario: dos diarios con números distintos', () => {
  const { diarios } = parsearSumario(extra());
  assert.deepEqual(diarios.map((d) => d.numero), ['275', '274']);
  assert.ok(diarios.every((d) => d.publicaciones.length > 0));
});

test('resumir cuenta por nivel', () => {
  const r = resumir(parsearSumario(normal()));
  assert.equal(r.total, r.publico + r.restringido);
  assert.equal(r.diarios, 1);
});

test('un sumario sin data.sumario falla con un mensaje claro', () => {
  assert.throws(() => parsearSumario({ data: {} }), /sin data\.sumario/);
});

// ───────────── Descarga: estados y reintentos ─────────────

const respuesta = (status, cuerpo = '') => ({ status, ok: status >= 200 && status < 300, text: async () => cuerpo });

test('404 es sin_boletin y no se reintenta', async () => {
  let llamadas = 0;
  const r = await descargarSumario('20261108', {
    esperas: [0, 0, 0],
    fetchFn: async () => (llamadas++, respuesta(404, leer('sumario-sin-boletin.xml'))),
  });
  assert.equal(r.estado, 'sin_boletin');
  assert.equal(llamadas, 1);
});

test('5xx se reintenta y acaba en fuente_caida', async () => {
  let llamadas = 0;
  const r = await descargarSumario('20261112', {
    esperas: [0, 0, 0],
    fetchFn: async () => (llamadas++, respuesta(503)),
  });
  assert.equal(r.estado, 'fuente_caida');
  assert.equal(llamadas, 4);
});

test('un fallo y después éxito devuelve ok con hash', async () => {
  let llamadas = 0;
  const r = await descargarSumario('20261112', {
    esperas: [0, 0, 0],
    fetchFn: async () => (++llamadas === 1 ? respuesta(502) : respuesta(200, leer('sumario-dia-normal.json'))),
  });
  assert.equal(r.estado, 'ok');
  assert.match(r.hash, /^[0-9a-f]{64}$/);
});

test('una respuesta 200 que no es JSON es error, no se reintenta', async () => {
  const r = await descargarSumario('20261112', { esperas: [0], fetchFn: async () => respuesta(200, '<html>') });
  assert.equal(r.estado, 'error');
});

// ───────────── Ingesta completa con base de datos simulada ─────────────

function bdFalsa({ previos = [], existentes = [] } = {}) {
  const log = { upserts: [], insertados: [] };
  return {
    log,
    seleccionar: async (ruta) => (ruta.startsWith('sumarios') ? previos : existentes.map((id) => ({ id }))),
    upsert: async (tabla, filas) => {
      log.upserts.push({ tabla, filas });
      return tabla === 'sumarios' ? filas.map((f, i) => ({ ...f, id: 100 + i })) : null;
    },
    insertar: async (tabla, fila) => log.insertados.push({ tabla, fila }),
  };
}
const descargarNormal = async () => ({ estado: 'ok', json: normal(), hash: 'h1' });

test('ingestar guarda sumario y publicaciones, y registra la ingesta', async () => {
  const db = bdFalsa();
  const r = await ingestarFecha('2026-11-12', { db, descargar: descargarNormal });
  assert.equal(r.estado, 'ok');
  assert.equal(r.n_nuevas, r.total);
  const pubs = db.log.upserts.filter((u) => u.tabla === 'publicaciones').flatMap((u) => u.filas);
  assert.equal(pubs.length, r.total);
  assert.ok(pubs.every((p) => p.sumario_id === 100));
  assert.equal(db.log.insertados[0].fila.estado, 'ok');
});

test('no envía columnas de ficha: no pisa resumen ni temas', async () => {
  const db = bdFalsa();
  await ingestarFecha('2026-11-12', { db, descargar: descargarNormal });
  const fila = db.log.upserts.find((u) => u.tabla === 'publicaciones').filas[0];
  for (const prohibida of ['resumen', 'temas', 'tipo_acto', 'ficha_modelo', 'corrige_a', 'referencias']) {
    assert.ok(!(prohibida in fila), `no debe enviar ${prohibida}`);
  }
});

test('con el mismo hash no reescribe nada', async () => {
  const db = bdFalsa({ previos: [{ numero: '282', hash: 'h1' }] });
  const r = await ingestarFecha('2026-11-12', { db, descargar: descargarNormal });
  assert.equal(r.sin_cambios, true);
  assert.equal(db.log.upserts.length, 0);
  assert.equal(db.log.insertados[0].fila.estado, 'ok');
});

test('cuenta nuevas y actualizadas', async () => {
  const todas = parsearSumario(normal()).diarios[0].publicaciones.map((p) => p.id);
  const db = bdFalsa({ existentes: todas.slice(0, 5) });
  const r = await ingestarFecha('2026-11-12', { db, descargar: descargarNormal });
  assert.equal(r.n_actualizadas, 5);
  assert.equal(r.n_nuevas, todas.length - 5);
});

test('día sin BOE se registra como sin_boletin y no escribe publicaciones', async () => {
  const db = bdFalsa();
  const r = await ingestarFecha('2026-11-08', { db, descargar: async () => ({ estado: 'sin_boletin' }) });
  assert.equal(r.estado, 'sin_boletin');
  assert.equal(db.log.upserts.length, 0);
  assert.equal(db.log.insertados[0].fila.estado, 'sin_boletin');
});

test('un fallo de la base se registra como error y no lanza', async () => {
  const db = bdFalsa();
  db.upsert = async () => { throw new Error('Supabase caído'); };
  const r = await ingestarFecha('2026-11-12', { db, descargar: descargarNormal });
  assert.equal(r.estado, 'error');
  assert.match(r.error, /Supabase caído/);
  assert.equal(db.log.insertados[0].fila.estado, 'error');
});

test('modo seco no toca la base de datos', async () => {
  const r = await ingestarFecha('2026-11-12', { seco: true, descargar: descargarNormal });
  assert.equal(r.seco, true);
  assert.equal(r.estado, 'ok');
});
