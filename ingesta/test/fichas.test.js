import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerDocumento, recortarTexto, decodificarEntidades, textoPlano } from '../lib/xml-boe.js';
import { TEMAS, TIPOS_ACTO, ESQUEMA_FICHA, validarFicha, limpiarAviso, FICHA_VERSION } from '../lib/listas.js';
import { construirPeticion, costeUSD, generarFicha, MODELO } from '../lib/ficha-ia.js';
import { generarFichas, indexarRestringidas, construirEntrada, filaDeFicha, registrarGasto } from '../fichas.js';

const xml = (f) => readFileSync(new URL(`../fixtures/xml/${f}.xml`, import.meta.url), 'utf8');
const INSTRUCCIONES = readFileSync(new URL('../../skill/FICHA.md', import.meta.url), 'utf8');

// ───────────── Lector del XML ─────────────

test('orden del CGPJ: rango, referencias y vigencia', () => {
  const d = leerDocumento(xml('BOE-A-2026-23670'));
  assert.equal(d.rango, 'Orden');
  assert.equal(d.referencias.anteriores[0].referencia, 'BOE-A-2026-20403');
  assert.equal(d.referencias.anteriores[0].palabra, 'PUBLICA');
  assert.deepEqual(d.vigencia, { estatus_derogacion: 'N', judicialmente_anulada: false, vigencia_agotada: false });
  assert.equal(d.corrige_a, null);
});

test('materias oficiales', () => {
  const d = leerDocumento(xml('BOE-A-2026-23662'));
  assert.deepEqual(d.materias, ['Conflictos de Competencia', 'Urbanismo', 'Viviendas']);
  assert.equal(d.rango, 'Providencia');
});

test('real decreto que modifica otro: referencias con palabras clave', () => {
  const d = leerDocumento(xml('BOE-A-2026-23758-recortado'));
  assert.equal(d.rango, 'Real Decreto');
  assert.equal(d.referencias.anteriores.length, 2);
  assert.equal(d.referencias.anteriores[0].palabra, 'MODIFICA');
  assert.ok(d.materias.includes('Registros administrativos'));
});

test('anuncio de la sección V: sin rango ni referencias', () => {
  const d = leerDocumento(xml('BOE-B-2025-48181'));
  assert.equal(d.rango, null);
  assert.equal(d.referencias, null);
  assert.match(d.texto, /BDNS\(Identif\.\):878316/);
});

test('el cuerpo no arrastra nada del análisis (referencias, alertas)', () => {
  const t = leerDocumento(xml('BOE-A-2026-23670')).texto;
  assert.match(t, /^De conformidad con lo establecido en los artículos 326/);
  assert.ok(!t.includes('PUBLICA'), 'se coló la palabra de una referencia');
  assert.ok(!t.includes('Concursos de personal público'), 'se coló una alerta');
  const rd = leerDocumento(xml('BOE-A-2026-23758-recortado')).texto;
  assert.ok(!rd.includes('MODIFICA'), 'se coló una referencia en el real decreto');
});

test('el texto sale plano: sin etiquetas ni entidades, un párrafo por línea', () => {
  for (const f of ['BOE-A-2026-23670', 'BOE-A-2026-23724', 'BOE-B-2025-48181', 'BOE-A-2026-23758-recortado']) {
    const t = leerDocumento(xml(f)).texto;
    assert.ok(t.length > 100, f);
    assert.ok(!/<[a-z\/]/i.test(t), `${f} conserva etiquetas`);
    assert.ok(!/&(amp|lt|gt|quot|#\d+);/.test(t), `${f} conserva entidades`);
    assert.ok(t.includes('\n'), `${f} debería tener varios párrafos`);
  }
});

test('«CORRIGE» apunta a la publicación corregida', () => {
  const sintetico = `<documento><metadatos><rango codigo="1">Resolución</rango></metadatos><analisis><referencias><anteriores>
    <anterior referencia="BOE-A-2026-111" orden="1"><palabra codigo="407">CORRIGE errores en</palabra><texto>la Resolución de 1 de octubre</texto></anterior>
    </anteriores><posteriores/></referencias></analisis><texto><p>x</p></texto></documento>`;
  assert.equal(leerDocumento(sintetico).corrige_a, 'BOE-A-2026-111');
});

test('algo que no es un documento del BOE falla', () => {
  assert.throws(() => leerDocumento('<html>error</html>'), /no es un documento/);
});

test('entidades HTML y numéricas', () => {
  assert.equal(decodificarEntidades('A&amp;B &lt;x&gt; &#241; &#xE9;'), 'A&B <x> ñ é');
  assert.equal(textoPlano('<texto><p>Uno &amp; dos</p><p>Tres</p></texto>'), 'Uno & dos\nTres');
});

test('recortar: lo corto no se toca', () => {
  assert.deepEqual(recortarTexto('corto'), { texto: 'corto', recortado: false });
});

test('recortar: conserva principio y final y corta siempre entre párrafos', () => {
  const parrafos = Array.from({ length: 400 }, (_, i) => `Párrafo ${i} ` + 'palabra '.repeat(30).trim());
  const original = parrafos.join('\n');
  const r = recortarTexto(original, { inicio: 3000, fin: 1000 });
  assert.equal(r.recortado, true);
  const lineas = r.texto.split('\n');
  assert.ok(lineas.includes('[…]'));
  assert.equal(lineas[0], parrafos[0]);
  assert.equal(lineas.at(-1), parrafos.at(-1));
  for (const l of lineas) assert.ok(l === '[…]' || parrafos.includes(l), `línea cortada: ${l.slice(0, 40)}`);
  assert.ok(r.texto.length < 4200);
});

test('recortar: un párrafo gigante se corta por caracteres como último recurso', () => {
  const r = recortarTexto('x'.repeat(5000), { inicio: 100, fin: 50 });
  assert.equal(r.recortado, true);
  assert.ok(r.texto.startsWith('xxxx') && r.texto.includes('[…]'));
});

// ───────────── Listas y validación ─────────────

test('FICHA.md recoge exactamente los tipos y temas del código', () => {
  for (const v of [...TIPOS_ACTO, ...TEMAS]) assert.ok(INSTRUCCIONES.includes(`\`${v}\``), `FICHA.md no menciona ${v}`);
  const mencionados = new Set([...INSTRUCCIONES.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]));
  const camposDeEntradaYSalida = ['tipo_acto', 'motivo_revision', 'aviso_fuente', 'texto_recortado', 'seccion_nombre'];
  const conocidos = new Set([...TIPOS_ACTO, ...TEMAS, ...camposDeEntradaYSalida]);
  for (const m of mencionados) assert.ok(conocidos.has(m), `FICHA.md menciona un valor desconocido: ${m}`);
});

test('el esquema usa las mismas listas', () => {
  assert.deepEqual(ESQUEMA_FICHA.properties.tipo_acto.enum, TIPOS_ACTO);
  assert.deepEqual(ESQUEMA_FICHA.properties.temas.items.enum, TEMAS);
});

const buena = { resumen: 'El Gobierno aprueba una subvención directa de 2 millones.', temas: ['cultura_y_patrimonio'], tipo_acto: 'subvencion_ayuda', revisar: false, motivo_revision: null, aviso_fuente: null };

test('validarFicha acepta una ficha correcta', () => assert.equal(validarFicha(buena).ok, true));

test('validarFicha rechaza lo que el esquema no puede exigir', () => {
  const casos = [
    { ...buena, resumen: '' },
    { ...buena, resumen: 'Mira https://www.boe.es/algo para ver más detalle del asunto.' },
    { ...buena, resumen: 'x'.repeat(901) },
    { ...buena, temas: [] },
    { ...buena, temas: ['vivienda', 'sanidad', 'energia', 'turismo'] },
    { ...buena, temas: ['vivienda', 'vivienda'] },
    { ...buena, temas: ['inventado'] },
    { ...buena, tipo_acto: 'ley' },
    { ...buena, revisar: 'no' },
    { ...buena, aviso_fuente: 5 },
  ];
  for (const c of casos) assert.equal(validarFicha(c).ok, false, JSON.stringify(c).slice(0, 80));
});

test('un resumen que comenta la extracción se rechaza', () => {
  for (const r of [
    'Regula las ayudas. La cuantía y el plazo no figuran en el texto recibido.',
    'Regula las ayudas; el texto está recortado y falta el articulado.',
    'Regula las ayudas […] y fija un plazo de dos meses para solicitarlas.',
  ]) assert.equal(validarFicha({ ...buena, resumen: r }).ok, false, r);
  assert.equal(validarFicha({ ...buena, resumen: 'Regula las ayudas y fija un plazo de dos meses para solicitarlas.' }).ok, true);
});

test('un aviso que solo habla del recorte se descarta; uno real se conserva', () => {
  assert.equal(limpiarAviso({ ...buena, aviso_fuente: 'El texto aparece recortado y la numeración no cuadra' }).aviso_fuente, null);
  assert.equal(limpiarAviso({ ...buena, aviso_fuente: 'Hay una marca […] en el articulado' }).aviso_fuente, null);
  for (const falso of ['Se detecta algo, pero no se detecta incoherencia verificable.', 'Variante ortográfica: Híjar y Hïjar.', 'No es una incoherencia verificable; se deja constancia solo como dato.']) {
    assert.equal(limpiarAviso({ ...buena, aviso_fuente: falso }).aviso_fuente, null, falso);
  }
  const real = 'La disposición final indica «a partir del el 1 de julio», con una duplicación de artículo.';
  assert.equal(limpiarAviso({ ...buena, aviso_fuente: real }).aviso_fuente, real);
});

test('generarFicha aplica la guarda: aviso falso fuera y resumen con comentario reintenta', async () => {
  const conAviso = { ...buena, aviso_fuente: 'El texto está recortado en el artículo 5' };
  const r1 = await generarFicha({ id: 'X' }, opciones(async () => respuesta(msg(conAviso))));
  assert.equal(r1.ficha.aviso_fuente, null);
  let n = 0;
  const comenta = { ...buena, resumen: 'Regula ayudas de 2 millones. El plazo no figura en el texto recibido.' };
  const r2 = await generarFicha({ id: 'X' }, opciones(async () => respuesta(++n === 1 ? msg(comenta) : msg(buena))));
  assert.equal(r2.intentos, 2);
  assert.equal(r2.ficha.resumen, buena.resumen);
});

// ───────────── Petición y coste ─────────────

test('la petición: caché en las instrucciones, esfuerzo bajo y salida estructurada', () => {
  const p = construirPeticion('INSTR', { id: 'X' });
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.system[0].text, 'INSTR');
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.messages.at(-1).role, 'user');
  assert.deepEqual(JSON.parse(p.messages[0].content), { id: 'X' });
  assert.ok(!('temperature' in p) && !('budget_tokens' in p));
});

test('coste con las tarifas de Haiku 5.5', () => {
  const c = costeUSD({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - 0.6) < 1e-9);
  assert.ok(Math.abs(costeUSD({ cache_read_input_tokens: 1_000_000 }) - 0.01) < 1e-9);
});

// ───────────── generarFicha con la API simulada ─────────────

const respuesta = (cuerpo, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(cuerpo) });
const msg = (obj, extra = {}) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, ...extra });
const opciones = (fetchFn) => ({ claveApi: 'k', instrucciones: 'I', fetchFn, esperas: [0, 0, 0] });

test('ficha válida a la primera', async () => {
  const r = await generarFicha({ id: 'X' }, opciones(async () => respuesta(msg(buena))));
  assert.equal(r.ficha.revisar, false);
  assert.equal(r.intentos, 1);
  assert.ok(r.coste > 0);
});

test('salida inválida y luego válida: reintenta una vez y suma el uso', async () => {
  let n = 0;
  const r = await generarFicha({ id: 'X' }, opciones(async () => respuesta(++n === 1 ? msg({ ...buena, tipo_acto: 'ley' }) : msg(buena))));
  assert.equal(r.intentos, 2);
  assert.equal(r.uso.input_tokens, 2000);
  assert.equal(r.ficha.tipo_acto, 'subvencion_ayuda');
});

test('dos salidas inválidas: ficha a revisar, sin resumen', async () => {
  const r = await generarFicha({ id: 'X' }, opciones(async () => respuesta(msg('no es json'))));
  assert.equal(r.ficha.revisar, true);
  assert.equal(r.ficha.resumen, null);
  assert.match(r.ficha.motivo_revision, /no es JSON/);
});

test('rechazo del modelo: ficha a revisar', async () => {
  const r = await generarFicha({ id: 'X' }, opciones(async () => respuesta(msg('', { stop_reason: 'refusal' }))));
  assert.equal(r.ficha.revisar, true);
  assert.match(r.ficha.motivo_revision, /rechaz/);
});

test('un 400 es fatal y un 429 se reintenta', async () => {
  await assert.rejects(generarFicha({ id: 'X' }, opciones(async () => respuesta({ error: 'x' }, 400))), /HTTP 400/);
  let n = 0;
  const r = await generarFicha({ id: 'X' }, opciones(async () => (++n < 3 ? respuesta({}, 429) : respuesta(msg(buena)))));
  assert.equal(r.ficha.revisar, false);
  assert.equal(n, 3);
});

// ───────────── Orquestación ─────────────

const pub = (id, url) => ({ id, fecha: '2026-11-12', seccion: '2A', seccion_nombre: 'II.A', departamento: 'CGPJ', epigrafe: null, titulo: 'Orden de prueba', url_xml: url });
const fetchXml = async (url) => {
  const id = url.split('id=')[1];
  const f = { 'BOE-A-2026-23670': 'BOE-A-2026-23670', 'BOE-A-2026-23724': 'BOE-A-2026-23724' }[id];
  return f ? { ok: true, status: 200, text: async () => xml(f) } : { ok: false, status: 404, text: async () => '' };
};
function bdFalsa() {
  const log = [];
  const rpcs = [];
  return { log, rpcs, parchear: async (tabla, filtro, cuerpo) => log.push({ tabla, filtro, cuerpo }), rpc: async (nombre, args) => rpcs.push({ nombre, args }) };
}
const iaFalsa = (ficha = buena, coste = 0.001) => async () => ({ ficha, uso: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0 }, coste });
const baseDeps = (extra) => ({ instrucciones: 'I', claveApi: 'k', pausa: 0, esperasXml: [0], fetchFn: fetchXml, ...extra });

test('guarda la ficha con rango, referencias y vigencia', async () => {
  const db = bdFalsa();
  const r = await generarFichas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], baseDeps({ db, ia: iaFalsa() }));
  assert.equal(r.guardadas, 1);
  const { filtro, cuerpo } = db.log[0];
  assert.equal(filtro, 'id=eq.BOE-A-2026-23670');
  assert.equal(cuerpo.resumen, buena.resumen);
  assert.equal(cuerpo.rango, 'Orden');
  assert.equal(cuerpo.ficha_version, FICHA_VERSION);
  assert.equal(cuerpo.ficha_modelo, MODELO);
  assert.equal(cuerpo.estatus_derogacion, 'N');
  assert.ok(cuerpo.referencias.anteriores.length === 1);
  assert.ok(!('texto' in cuerpo), 'el texto completo no se guarda');
  // ...pero sí se indexa: el texto COMPLETO va a la función que solo guarda los lexemas
  assert.equal(db.rpcs.length, 1);
  assert.equal(db.rpcs[0].nombre, 'indexar_texto');
  assert.equal(db.rpcs[0].args.p_id, 'BOE-A-2026-23670');
  assert.equal(db.rpcs[0].args.p_texto, leerDocumento(xml('BOE-A-2026-23670')).texto);
});

test('el índice recibe el texto completo aunque el modelo reciba uno recortado', async () => {
  const db = bdFalsa();
  const largo = '<documento><metadatos><rango>Orden</rango></metadatos><analisis/><texto>' +
    Array.from({ length: 3000 }, (_, i) => `<p>Párrafo ${i} ` + 'palabra '.repeat(40) + '</p>').join('') + '</texto></documento>';
  const fetchLargo = async () => ({ ok: true, status: 200, text: async () => largo });
  let entradaModelo;
  const ia = async (entrada) => { entradaModelo = entrada; return { ficha: buena, uso: { input_tokens: 1 }, coste: 0 }; };
  await generarFichas([pub('X', 'https://x/?id=X')], baseDeps({ db, ia, fetchFn: fetchLargo }));
  assert.equal(entradaModelo.texto_recortado, true);
  assert.ok(entradaModelo.texto.length < 75_000);
  assert.ok(db.rpcs[0].args.p_texto.length > 900_000, 'al índice debe llegar el texto entero');
});

test('una ficha a revisar no guarda resumen pero sí queda marcada como hecha', async () => {
  const db = bdFalsa();
  const dudosa = { ...buena, revisar: true, motivo_revision: 'texto ilegible' };
  await generarFichas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], baseDeps({ db, ia: iaFalsa(dudosa) }));
  const c = db.log[0].cuerpo;
  assert.equal(c.resumen, null);
  assert.equal(c.ficha_revisar, true);
  assert.equal(c.ficha_motivo_revision, 'texto ilegible');
  assert.equal(c.ficha_version, FICHA_VERSION);
});

test('la entrada del modelo no lleva enlaces ni claves de la base', () => {
  const doc = leerDocumento(xml('BOE-A-2026-23670'));
  const e = construirEntrada(pub('X', 'https://x/'), doc, recortarTexto(doc.texto));
  assert.ok(!('url_xml' in e) && !('url_html' in e) && !('url_pdf' in e));
  assert.deepEqual(Object.keys(e).sort(), ['departamento', 'epigrafe', 'fecha', 'id', 'materias', 'rango', 'seccion', 'seccion_nombre', 'texto', 'texto_recortado', 'titulo']);
});

test('un XML que falla (404) se anota y no impide seguir con el resto', async () => {
  const db = bdFalsa();
  const r = await generarFichas(
    [pub('MAL', 'https://x/?id=MAL'), pub('BOE-A-2026-23724', 'https://x/?id=BOE-A-2026-23724')],
    baseDeps({ db, ia: iaFalsa() }),
  );
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].id, 'MAL');
  assert.equal(r.guardadas, 1);
});

test('concurrencia: procesa varias a la vez, cada publicación una sola vez', async () => {
  const db = bdFalsa();
  const ids = Array.from({ length: 8 }, (_, i) => `BOE-A-2026-${23670 + i}`);
  const lista = ids.map((id) => pub(id, 'https://x/?id=BOE-A-2026-23670'));
  let activas = 0, maxActivas = 0;
  const vistas = [];
  const ia = async (entrada, o) => {
    activas += 1; maxActivas = Math.max(maxActivas, activas);
    vistas.push(entrada.id);
    await new Promise((res) => setTimeout(res, 5));
    activas -= 1;
    return iaFalsa()(entrada, o);
  };
  const r = await generarFichas(lista, baseDeps({ db, ia, concurrencia: 3 }));
  assert.equal(r.guardadas, 8);
  assert.equal(new Set(vistas).size, 8);
  assert.ok(maxActivas > 1 && maxActivas <= 3, `activas simultáneas: ${maxActivas}`);
});

test('tope de coste: se detiene sin pasarse', async () => {
  const db = bdFalsa();
  const lista = ['BOE-A-2026-23670', 'BOE-A-2026-23724', 'BOE-A-2026-23670'].map((id) => pub(id, `https://x/?id=${id}`));
  const r = await generarFichas(lista, baseDeps({ db, ia: iaFalsa(buena, 0.6), maxCoste: 1 }));
  assert.equal(r.guardadas, 2);
  assert.match(r.parada, /tope de coste/);
});

test('--sin-ia no llama a Claude ni escribe en la base', async () => {
  const db = bdFalsa();
  let llamadas = 0;
  const silencio = console.log; console.log = () => {};
  try {
    const r = await generarFichas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], baseDeps({ db, sinIA: true, ia: async () => { llamadas++; } }));
    assert.equal(r.procesadas, 1);
  } finally { console.log = silencio; }
  assert.equal(llamadas, 0);
  assert.equal(db.log.length, 0);
});

test('--seco llama a Claude pero no guarda', async () => {
  const db = bdFalsa();
  const silencio = console.log; console.log = () => {};
  try {
    const r = await generarFichas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], baseDeps({ db, seco: true, ia: iaFalsa() }));
    assert.equal(r.guardadas, 0);
    assert.ok(r.coste > 0);
  } finally { console.log = silencio; }
  assert.equal(db.log.length, 0);
});

test('filaDeFicha: restringir lo que no debe salir', () => {
  const doc = leerDocumento(xml('BOE-A-2026-23662'));
  const f = filaDeFicha(doc, { ...buena, revisar: true, motivo_revision: null });
  assert.equal(f.ficha_motivo_revision, 'sin motivo');
  assert.equal(f.resumen, null);
});

// ───────────── Restringidas: solo índice ─────────────

test('restringidas: se indexa el texto y los metadatos de vigencia, sin IA ni ficha', async () => {
  const db = bdFalsa();
  const r = await indexarRestringidas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], { db, pausa: 0, esperasXml: [0], fetchFn: fetchXml });
  assert.equal(r.indexadas, 1);
  assert.equal(db.rpcs[0].nombre, 'indexar_texto');
  const cuerpo = db.log[0].cuerpo;
  assert.deepEqual(Object.keys(cuerpo).sort(), ['estatus_derogacion', 'judicialmente_anulada', 'rango', 'vigencia_actualizada', 'vigencia_agotada']);
  for (const prohibida of ['resumen', 'temas', 'tipo_acto', 'referencias', 'ficha_version']) assert.ok(!(prohibida in cuerpo), prohibida);
});

test('restringidas: un fallo no impide seguir y --sin-ia no escribe', async () => {
  const db = bdFalsa();
  const r = await indexarRestringidas([pub('MAL', 'https://x/?id=MAL'), pub('BOE-A-2026-23724', 'https://x/?id=BOE-A-2026-23724')], { db, pausa: 0, esperasXml: [0], fetchFn: fetchXml });
  assert.equal(r.errores.length, 1);
  assert.equal(r.indexadas, 1);
  const db2 = bdFalsa();
  const silencio = console.log; console.log = () => {};
  try { await indexarRestringidas([pub('BOE-A-2026-23670', 'https://x/?id=BOE-A-2026-23670')], { db: db2, sinIA: true, pausa: 0, esperasXml: [0], fetchFn: fetchXml }); } finally { console.log = silencio; }
  assert.equal(db2.rpcs.length + db2.log.length, 0);
});

// ───────────── Gasto de la ingesta (migración 14) ─────────────

test('registrarGasto: guarda una fila con fichas, tokens y coste redondeado', async () => {
  const filas = [];
  const db = { insertar: async (tabla, fila) => filas.push({ tabla, fila }) };
  const r = { guardadas: 3, tokens_entrada: 1500, tokens_salida: 150, tokens_cache: 900, coste: 0.0012345678 };
  assert.equal(await registrarGasto(db, r, { modelo: 'm' }), true);
  assert.deepEqual(filas, [{ tabla: 'gasto_ingesta', fila: { modelo: 'm', n_fichas: 3, tokens_entrada: 1500, tokens_salida: 150, tokens_cache: 900, coste_usd: 0.00123 } }]);
});

test('registrarGasto: sin llamadas a Claude no escribe; si la base falla, avisa sin lanzar', async () => {
  let escrito = 0;
  const db = { insertar: async () => { escrito += 1; } };
  assert.equal(await registrarGasto(db, { guardadas: 0, tokens_entrada: 0, tokens_salida: 0, tokens_cache: 0, coste: 0 }), false);
  assert.equal(escrito, 0);
  const rota = { insertar: async () => { throw new Error('HTTP 404: relation "gasto_ingesta" does not exist'); } };
  const silencio = console.error; console.error = () => {};
  try { assert.equal(await registrarGasto(rota, { guardadas: 1, tokens_entrada: 10, tokens_salida: 1, tokens_cache: 0, coste: 0.001 }), false); }
  finally { console.error = silencio; }
});
