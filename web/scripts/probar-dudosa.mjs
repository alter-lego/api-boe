// Prueba de la comprobación de preguntas dudosas: node --experimental-strip-types scripts/probar-dudosa.mjs
import { evaluar } from '../src/dudosa.ts';

const casos = [
  // [texto, esperado]
  ['lkjegjreg', 'sinsentido'],
  ['aaa', 'sinsentido'],
  ['???', 'sinsentido'],
  ['qué es el de la', 'sinsentido'],
  ['ljevbebqeb dzfb', 'rara'],
  ['asdf qwer', 'rara'],
  ['xkcd zzzz plmk', 'rara'],
  ['ayudas', 'corta'],
  ['subvenciones', 'corta'],
  ['IRPF', 'corta'],
  ['BOE', 'corta'],
  ['CNMC', 'corta'],
  ['DGT', 'corta'],
  ['TJUE', 'corta'],
  ['cnmc multa', null],
  ['dgt multas', null],
  ['ayudas vivienda Canarias', null],
  ['¿Qué ayudas al alquiler joven se han publicado esta semana?', null],
  ['contratos hospitales', null],
  ['BOE hoy', null],
  ['Hacienda 2026', null],
  ['técnico administración inmediato', null],
  ['psicología neumático abstracto', null],
  ['construcción presupuestos instituciones', null],
  ['Washington extraordinario excepcional', null],
  ['obstáculo perspectiva constitución atmósfera', null],
  ['ayuntamiento Ministerio transporte', null],
  ['adjudicado alquiler arqueología', null],
  ['esquina tranquilo subvención', null],
  ['obviamente adverso sublime', null],
];
let fallos = 0;
for (const [t, esperado] of casos) {
  const r = evaluar(t);
  if (r !== esperado) { fallos++; console.log(`FALLO  ${JSON.stringify(t)}: esperado ${esperado}, obtenido ${r}`); }
}
console.log(fallos ? `${fallos} fallos de ${casos.length}` : `OK: ${casos.length} casos`);
process.exit(fallos ? 1 : 0);
