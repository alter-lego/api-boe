import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clasificar, construirPeticionResumen, depurar, fechaLarga, marcas, motivoDescarte, pedirResumen, ESQUEMA_RESUMEN, APARTADOS,
} from '../lib/resumen-dia.js';
import { resumirDia, registrarGastoResumen, fichasPendientesToleradas } from '../resumen-dia.js';

const pub = (o) => ({
  id: 'BOE-A-2026-1', seccion: '1', seccion_nombre: 'I', departamento: 'Ministerio de Hacienda', epigrafe: null, titulo: 'Real Decreto de prueba',
  rango: 'Real Decreto', resumen: 'Resumen público.', temas: ['fiscalidad'], tipo_acto: 'norma', nivel_privacidad: 'publico', ficha_version: 3, ...o,
});

const DIA = [
  pub({ id: 'A1', titulo: 'Real Decreto por el que se modifica el Impuesto sobre el Valor Añadido.' }),
  pub({ id: 'A2', seccion: '3', titulo: 'Extracto de la Orden por la que se convocan ayudas del Programa MOVES para vehículos eléctricos.', tipo_acto: 'subvencion_ayuda' }),
  pub({ id: 'A3', seccion: '2B', departamento: 'Ministerio del Interior', titulo: 'Resolución por la que se aprueba la lista de admitidos.', nivel_privacidad: 'restringido', resumen: 'SECRETO', temas: ['x'], tipo_acto: 'convocatoria' }),
  pub({ id: 'A4', seccion: '4', titulo: 'Edicto del Juzgado.' }),
  pub({ id: 'A5', seccion: '5C', titulo: 'Anuncio de particular.' }),
  pub({ id: 'A6', seccion: '5B', departamento: 'Ministerio para la Transición Ecológica', titulo: 'Concesión de aguas.' }),
  pub({ id: 'A7', seccion: '5A', titulo: 'Anuncio de licitación: suministro de drones de vigilancia para fronteras.' }),
  pub({ id: 'A8', seccion: '5A', titulo: 'Anuncio de licitación: vigilancia de edificios y oficinas.' }),
  pub({ id: 'A9', seccion: '2A', departamento: 'Administración Local', titulo: 'Nombramiento de funcionario.' }),
  pub({ id: 'A10', seccion: '3', departamento: 'Universidades', titulo: 'Plan de estudios.' }),
];

test('descartes: los mismos que el correo, más los anuncios de particulares', () => {
  assert.equal(motivoDescarte(DIA[3]), 'justicia');
  assert.equal(motivoDescarte(DIA[4]), 'anuncios_particulares');
  assert.equal(motivoDescarte(DIA[5]), 'confederaciones');
  assert.equal(motivoDescarte(DIA[8]), 'administracion_local');
  assert.equal(motivoDescarte(DIA[9]), 'universidades');
  assert.equal(motivoDescarte(DIA[0]), null);
});

test('marcas: impuestos, ayudas, automoción, oposiciones y contratos sensibles con sus exclusiones', () => {
  assert.deepEqual(marcas(DIA[0]), ['impuestos']);
  assert.deepEqual(marcas(DIA[1]), ['ayudas', 'automocion']);
  assert.deepEqual(marcas(DIA[2]), ['oposiciones']);
  assert.deepEqual(marcas(DIA[6]), ['contrato_sensible']);
  assert.deepEqual(marcas(DIA[7]), [], 'vigilancia de edificios no es un contrato sensible');
  assert.deepEqual(marcas(pub({ titulo: 'Recurso de la Fiscalía sobre impuestos' })), []);
});

test('clasificar: de las restringidas solo van título y metadatos', () => {
  const c = clasificar(DIA);
  assert.equal(c.total, 10);
  assert.deepEqual(c.candidatos.map((p) => p.id), ['A1', 'A2', 'A3', 'A7', 'A8']);
  assert.deepEqual(c.descartes, { justicia: 1, anuncios_particulares: 1, confederaciones: 1, administracion_local: 1, universidades: 1 });
  const r = c.candidatos.find((p) => p.id === 'A3');
  assert.equal(r.datos_personales, true);
  assert.equal(r.resumen, undefined);
  assert.equal(r.temas, undefined);
  assert.equal(r.tipo, undefined);
  assert.ok(!JSON.stringify(c).includes('SECRETO'));
  assert.deepEqual(c.apartados, { ayudas: ['A2'], oposiciones: ['A3'], impuestos: ['A1'], automocion: ['A2'] });
  assert.deepEqual(c.sensibles, ['A7']);
});

test('petición: instrucciones, salida estructurada, sin enlaces en la entrada y con modelo de reserva', () => {
  const c = clasificar(DIA);
  const p = construirPeticionResumen('INSTR', '2026-11-25', c);
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.system, 'INSTR');
  assert.equal(p.output_config.format.schema, ESQUEMA_RESUMEN);
  assert.equal(p.fallbacks, 'default');
  const datos = JSON.parse(p.messages[0].content);
  assert.equal(datos.dia, 'miércoles, 25 de noviembre de 2026');
  assert.ok(!/https?:/.test(p.messages[0].content));
  assert.equal(fechaLarga('2026-11-29'), 'domingo, 29 de noviembre de 2026');
});

test('esquema: todos los objetos cierran sus propiedades (lo exige la salida estructurada)', () => {
  const recorrer = (s) => {
    if (s?.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(recorrer);
    }
    if (s?.type === 'array') recorrer(s.items);
  };
  recorrer(ESQUEMA_RESUMEN);
});

test('depurar: quita ids inventados, URLs, HTML y DNI; en los apartados manda Claude', () => {
  const c = clasificar(DIA);
  const salida = {
    titulares: [
      { tema: 'IVA', texto: 'El Gobierno cambia el IVA', ids: ['A1', 'INVENTADO'] },
      { tema: 'Falso', texto: 'Sin publicaciones', ids: ['NO-EXISTE'] },
      { tema: 'Enlace', texto: 'Ver https://www.boe.es', ids: ['A1'] },
    ],
    secciones: [
      { titulo: 'Hacienda', bloques: [{ ids: ['A1'], titulo: 'Cambia el IVA', resumen: 'Resumen.', por_que_importa: '' }], lineas: [{ tema: 'Drones', texto: 'Licitación de drones.', ids: ['A7'] }] },
      { titulo: 'Vacía', bloques: [{ ids: ['A3'], titulo: 'Admitidos', resumen: 'Fulano con DNI 12345678Z', por_que_importa: null }], lineas: [] },
      { titulo: 'HTML', bloques: [], lineas: [{ tema: 'x', texto: '<b>negrita</b>', ids: ['A2'] }] },
    ],
    apartados: { ayudas: [{ id: 'A2', texto: 'Ayudas MOVES.' }, { id: 'A2', texto: 'repetida' }], oposiciones: [], impuestos: [{ id: 'ZZZ', texto: 'x' }], automocion: [{ id: 'A2', texto: 'DNI ***1234**' }] },
  };
  const { contenido, avisos } = depurar(salida, c);
  assert.deepEqual(contenido.titulares, [{ tema: 'IVA', texto: 'El Gobierno cambia el IVA', ids: ['A1'] }]);
  assert.equal(contenido.secciones.length, 1);
  assert.equal(contenido.secciones[0].bloques[0].por_que_importa, null);
  assert.equal(contenido.secciones[0].lineas[0].texto, 'Licitación de drones', 'sin punto final');
  assert.deepEqual(contenido.apartados.ayudas, [{ id: 'A2', texto: 'Ayudas MOVES' }]);
  assert.deepEqual(contenido.apartados.oposiciones, [], 'lo marcado que Claude quita no se vuelve a añadir');
  assert.deepEqual(contenido.apartados.impuestos, []);
  assert.ok(avisos.includes('apartado oposiciones: Claude quita A3'));
  assert.deepEqual(contenido.apartados.automocion, [{ id: 'A2', texto: null }], 'el texto con DNI se quita');
  assert.deepEqual(Object.keys(contenido.apartados), APARTADOS);
  for (const a of ['INVENTADO', 'NO-EXISTE', 'Enlace', 'Admitidos', 'ZZZ']) assert.ok(avisos.some((x) => x.includes(a)), a);
  assert.ok(!JSON.stringify(contenido).includes('12345678Z'));
});

test('pedirResumen: lanza si Claude se niega, se corta o no devuelve JSON; cabecera del modelo de reserva', async () => {
  const respuesta = (cuerpo) => async (_url, init) => {
    respuesta.cab = init.headers;
    return new Response(JSON.stringify({ model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, ...cuerpo }), { status: 200 });
  };
  const p = construirPeticionResumen('I', '2026-11-25', clasificar(DIA));
  const ok = await pedirResumen(p, { claveApi: 'k', fetchFn: respuesta({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"titulares":[]}' }] }) });
  assert.deepEqual(ok.salida, { titulares: [] });
  assert.equal(respuesta.cab['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.ok(ok.coste > 0);
  await assert.rejects(pedirResumen(p, { claveApi: 'k', fetchFn: respuesta({ stop_reason: 'refusal', content: [] }) }), /rechazó/);
  await assert.rejects(pedirResumen(p, { claveApi: 'k', fetchFn: respuesta({ stop_reason: 'max_tokens', content: [] }) }), /cortada/);
  await assert.rejects(pedirResumen(p, { claveApi: 'k', fetchFn: respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hola' }] }) }), /no es JSON/);
});

// ───────────── resumirDia con una base falsa ─────────────

function dbFalsa({ pubs = DIA, previo = [] } = {}) {
  const escrito = { upserts: [], inserts: [] };
  return {
    escrito,
    seleccionar: async (ruta) => (ruta.startsWith('publicaciones') ? pubs : previo),
    upsert: async (tabla, filas, conflicto) => { escrito.upserts.push({ tabla, filas, conflicto }); return filas; },
    insertar: async (tabla, fila) => { escrito.inserts.push({ tabla, fila }); },
  };
}
const SALIDA = { titulares: [{ tema: 'IVA', texto: 'Cambia el IVA', ids: ['A1'] }], secciones: [], apartados: { ayudas: [], oposiciones: [], impuestos: [], automocion: [] } };
const pedirFalso = async () => ({ salida: SALIDA, uso: { input_tokens: 20000, output_tokens: 5000 }, coste: 0.18, modelo: 'claude-sonnet-5-5' });

test('resumirDia: guarda el resumen depurado y no repite si el día no ha cambiado', async () => {
  const db = dbFalsa();
  const r = await resumirDia('2026-11-25', { db, claveApi: 'k', instrucciones: 'I', pedir: pedirFalso });
  assert.equal(r.estado, 'guardado');
  const fila = db.escrito.upserts[0];
  assert.equal(fila.tabla, 'resumenes_dia');
  assert.equal(fila.conflicto, 'fecha');
  assert.equal(fila.filas[0].n_publicaciones, 10);
  assert.equal(fila.filas[0].contenido.titulares[0].texto, 'Cambia el IVA');
  assert.deepEqual(fila.filas[0].contenido.apartados.oposiciones, []);

  const igual = await resumirDia('2026-11-25', { db: dbFalsa({ previo: [{ n_publicaciones: 10, version: 1 }] }), claveApi: 'k', instrucciones: 'I', pedir: () => assert.fail('no debe llamar') });
  assert.equal(igual.estado, 'ya_generado');
  const cambiado = await resumirDia('2026-11-25', { db: dbFalsa({ previo: [{ n_publicaciones: 8, version: 1 }] }), claveApi: 'k', instrucciones: 'I', pedir: pedirFalso });
  assert.equal(cambiado.estado, 'guardado', 'un extraordinario regenera el resumen');
});

test('resumirDia: día sin BOE, fichas pendientes, tope de coste y modo seco', async () => {
  const nunca = () => assert.fail('no debe llamar a Claude');
  assert.equal((await resumirDia('2026-11-29', { db: dbFalsa({ pubs: [] }), instrucciones: 'I', pedir: nunca })).estado, 'sin_publicaciones');

  const sinFichas = DIA.map((p) => ({ ...p, ficha_version: p.nivel_privacidad === 'publico' ? null : p.ficha_version }));
  assert.equal((await resumirDia('2026-11-25', { db: dbFalsa({ pubs: sinFichas }), instrucciones: 'I', pedir: nunca })).estado, 'fichas_pendientes');
  assert.equal((await resumirDia('2026-11-25', { db: dbFalsa({ pubs: sinFichas }), instrucciones: 'I', forzar: true, pedir: pedirFalso })).estado, 'guardado');
  assert.equal(fichasPendientesToleradas(20), 3);
  assert.equal(fichasPendientesToleradas(200), 10);

  assert.equal((await resumirDia('2026-11-25', { db: dbFalsa(), instrucciones: 'I', maxCoste: 0.01, pedir: nunca })).estado, 'tope_coste');

  const db = dbFalsa();
  const seco = await resumirDia('2026-11-25', { db, instrucciones: 'I', seco: true, pedir: pedirFalso });
  assert.equal(seco.estado, 'seco');
  assert.equal(db.escrito.upserts.length, 0);

  const sinIA = await resumirDia('2026-11-25', { db: dbFalsa(), instrucciones: 'I', sinIA: true, pedir: nunca });
  assert.equal(sinIA.estado, 'sin_ia');
  assert.equal(sinIA.candidatas, 5);
});

test('registrarGastoResumen: anota tokens y coste con 0 fichas; no lanza si la tabla falla', async () => {
  const db = dbFalsa();
  assert.equal(await registrarGastoResumen(db, { modelo: 'claude-sonnet-5-5', uso: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 }, coste: 0.123456 }), true);
  assert.deepEqual(db.escrito.inserts[0], { tabla: 'gasto_ingesta', fila: { modelo: 'claude-sonnet-5-5', n_fichas: 0, tokens_entrada: 10, tokens_salida: 5, tokens_cache: 0, coste_usd: 0.12346 } });
  const rota = { insertar: async () => { throw new Error('HTTP 404'); } };
  assert.equal(await registrarGastoResumen(rota, { uso: { input_tokens: 1 }, coste: 0 }), false);
});

test('las instrucciones del resumen existen y piden ids, no enlaces', async () => {
  const { leerInstruccionesResumen } = await import('../lib/resumen-dia.js');
  const t = leerInstruccionesResumen();
  for (const k of ['titulares', 'secciones', 'apartados', 'ids', 'Datos personales']) assert.ok(t.includes(k), k);
  for (const a of APARTADOS) assert.ok(t.includes(`\`${a}\``), a);
});

test('resumirDia: tope de 24 h (llamadas y gasto ya anotados) y --forzar lo salta (auditoría, 2.9)', async () => {
  const conGasto = (gastos) => ({
    ...dbFalsa(),
    seleccionar: async (ruta) => (ruta.startsWith('publicaciones') ? DIA : ruta.startsWith('gasto_ingesta') ? gastos : []),
  });
  const muchas = await resumirDia('2026-11-25', { db: conGasto([{ coste_usd: 0.1 }, { coste_usd: 0.1 }, { coste_usd: 0.1 }, { coste_usd: 0.1 }]), claveApi: 'k', instrucciones: 'I', pedir: () => assert.fail('no debe llamar') });
  assert.equal(muchas.estado, 'tope_24h');
  const caro = await resumirDia('2026-11-25', { db: conGasto([{ coste_usd: 1.95 }]), claveApi: 'k', instrucciones: 'I', pedir: () => assert.fail('no debe llamar') });
  assert.equal(caro.estado, 'tope_24h');
  const poco = await resumirDia('2026-11-25', { db: conGasto([{ coste_usd: 0.2 }]), claveApi: 'k', instrucciones: 'I', pedir: pedirFalso });
  assert.equal(poco.estado, 'guardado');
  const forzado = await resumirDia('2026-11-25', { db: conGasto([{ coste_usd: 0.1 }, { coste_usd: 0.1 }, { coste_usd: 0.1 }, { coste_usd: 0.1 }]), claveApi: 'k', instrucciones: 'I', forzar: true, pedir: pedirFalso });
  assert.equal(forzado.estado, 'guardado');
});

test('usoTotal: con modelo de reserva se suman todas las iteraciones', async () => {
  const { usoTotal } = await import('../lib/resumen-dia.js');
  assert.deepEqual(usoTotal({ input_tokens: 10, output_tokens: 5 }), { input_tokens: 10, output_tokens: 5 });
  const u = usoTotal({ input_tokens: 7, output_tokens: 3, iterations: [
    { type: 'message', input_tokens: 100, output_tokens: 20 },
    { type: 'fallback_message', input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 50 },
  ] });
  assert.deepEqual(u, { input_tokens: 107, output_tokens: 23, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 });
});
