// Saneado común (ingesta/lib/sanear.js), con los casos de la auditoría del 26/11/2026 (2.1, 2.2, 2.5, 2.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quitarDatosPersonales as q, quitarEnlaces as e, textoInseguro } from '../lib/sanear.js';
import { depurar } from '../lib/resumen-dia.js';
import { limpiarAviso, validarFicha } from '../lib/listas.js';
import { filaDeFicha } from '../fichas.js';

test('los importes no se toman por DNI', () => {
  for (const t of ['entre 1.000.000 y 2.000.000 euros', '25.000.000 e IVA', 'importe 12.345.678 euros',
    'expediente 12345678', 'Real Decreto 123/2026', 'un total de 10.500.000 Y otras cifras en mayúsculas'.toLowerCase()]) {
    assert.equal(q(t), t, t);
  }
});

test('DNI y NIE con letra de control válida, en sus formatos', () => {
  assert.equal(q('DNI 12345678Z'), 'DNI [DNI]');
  assert.equal(q('12.345.678-Z'), '[DNI]');
  assert.equal(q('12 345 678 Z'), '[DNI]');
  assert.equal(q('１２３４５６７８Z'), '[DNI]');          // dígitos de ancho completo (NFKC)
  assert.equal(q('X-1234567-L'), '[NIE]');
  assert.equal(q('X1234567L'), '[NIE]');
  assert.equal(q('DNI 12345678'), 'DNI [DNI]');          // sin letra, anunciado
  assert.equal(q('NIF: 12.345.678'), 'NIF: [DNI]');
  assert.equal(q('***4567**'), '[ID]');
  assert.equal(q('*** 4567 **'), '[ID]');
  assert.equal(q('xxx4567x'), '[ID]');
});

test('enlaces con y sin esquema, y ofuscados', () => {
  for (const t of ['bit.ly/abc', 't.me/canal', 'hxxps://evil[.]com/x', 'malo(.)es', 'https://x.com', 'www.algo.net', 'evil[punto]com']) {
    assert.equal(e(t), '[enlace omitido]', t);
  }
  assert.equal(e('[pincha](https://x.com)'), '[pincha]');
  for (const t of ['EE.UU. y p.ej. art. 3.2 de la Ley 39/2015', 'S.L.U. y S.A.', 'Real Decreto 1/2026, de 2 de enero']) {
    assert.equal(e(t), t, t);
    assert.equal(textoInseguro(t), false, t);
  }
});

test('el resumen del día descarta secciones con título inseguro y DNI con guiones', () => {
  const c = { candidatos: [{ id: 'BOE-A-2026-1' }], apartados: {} };
  const salida = {
    titulares: [{ tema: 'Ayudas', texto: 'Afecta a 12.345.678-Z', ids: ['BOE-A-2026-1'] }],
    secciones: [
      { titulo: 'Visita t.me/canal', bloques: [{ titulo: 'B', resumen: 'R', ids: ['BOE-A-2026-1'] }] },
      { titulo: 'Vivienda', bloques: [{ titulo: 'B', resumen: 'R con X-1234567-L', ids: ['BOE-A-2026-1'] }, { titulo: 'Bien', resumen: 'Sin datos', ids: ['BOE-A-2026-1'] }] },
    ],
    apartados: {},
  };
  const { contenido, avisos } = depurar(salida, c);
  assert.equal(contenido.titulares.length, 0);
  assert.deepEqual(contenido.secciones.map((s) => s.titulo), ['Vivienda']);
  assert.deepEqual(contenido.secciones[0].bloques.map((b) => b.titulo), ['Bien']);
  assert.ok(avisos.some((a) => /sección descartada/.test(a)));
});

test('fichas: resumen con DNI o dominio no vale; aviso inseguro o de ficha a revisar no se guarda', () => {
  const base = { resumen: 'Convoca ayudas para la rehabilitación de viviendas.', temas: ['vivienda'], tipo_acto: 'subvencion_ayuda', revisar: false, motivo_revision: null, aviso_fuente: null };
  assert.equal(validarFicha(base).ok, true);
  assert.equal(validarFicha({ ...base, resumen: 'Más información en bit.ly/ayudas para todos.' }).ok, false);
  assert.equal(validarFicha({ ...base, resumen: 'Beneficiario con DNI 12345678Z y otros datos.' }).ok, false);
  assert.equal(validarFicha({ ...base, aviso_fuente: 'x'.repeat(401) }).ok, false);
  assert.equal(limpiarAviso({ ...base, aviso_fuente: 'Ver t.me/canal' }).aviso_fuente, null);
  assert.equal(limpiarAviso({ ...base, aviso_fuente: 'La fecha del título (3 de mayo) no coincide con la del texto (5 de mayo).' }).aviso_fuente !== null, true);
  const doc = { rango: null, referencias: null, corrige_a: null, vigencia: { estatus_derogacion: null, judicialmente_anulada: null, vigencia_agotada: null } };
  assert.equal(filaDeFicha(doc, { ...base, revisar: true, motivo_revision: 'm', aviso_fuente: 'Contradicción de fechas.' }).aviso_fuente, null);
  assert.equal(filaDeFicha(doc, { ...base, aviso_fuente: 'Contradicción de fechas.' }).aviso_fuente, 'Contradicción de fechas.');
});
