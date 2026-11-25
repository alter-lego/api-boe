// Resumen editorial del día («Resumen de hoy» de la web). Se lanza tras las fichas, en cada pasada de la
// ingesta: solo llama a Claude si el día aún no tiene resumen o si han cambiado sus publicaciones.
//
// Uso (en local: node --env-file=.env ingesta/resumen-dia.js ...):
//   node ingesta/resumen-dia.js --fecha hoy            (lo que lanza GitHub Actions)
//   node ingesta/resumen-dia.js --fecha 2026-11-24
//   --sin-ia     prepara la entrada y muestra las cifras SIN llamar a Claude (no cuesta nada)
//   --seco       llama a Claude y muestra el resultado, pero NO lo guarda
//   --forzar     regenera aunque ya exista o falten fichas por hacer
//   --max-coste  tope en USD (por defecto 1): si la estimación lo supera, no se llama

import { fileURLToPath } from 'node:url';
import { crearCliente } from './lib/supabase.js';
import {
  clasificar, construirPeticionResumen, costeResumenUSD, depurar, leerInstruccionesResumen, pedirResumen,
  tokensAproximados, MODELO_RESUMEN, RESUMEN_VERSION,
} from './lib/resumen-dia.js';

const hoyEnMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const COLUMNAS = 'id,seccion,seccion_nombre,departamento,epigrafe,titulo,rango,resumen,temas,tipo_acto,nivel_privacidad,ficha_version';

/** Fichas públicas aún sin hacer que se toleran antes de resumir (las que fallan una y otra vez no bloquean). */
export const fichasPendientesToleradas = (nPublicas) => Math.max(3, Math.floor(nPublicas * 0.05));

/**
 * Genera (si hace falta) y guarda el resumen de un día. No lanza por los casos previstos: devuelve { estado }.
 * estados: sin_publicaciones · ya_generado · fichas_pendientes · tope_coste · sin_ia · seco · guardado
 */
export async function resumirDia(fecha, deps) {
  const { db, claveApi, sinIA = false, seco = false, forzar = false, maxCoste = 1, fetchFn, pedir = pedirResumen } = deps;
  const instrucciones = deps.instrucciones ?? leerInstruccionesResumen();

  const pubs = await db.seleccionar(`publicaciones?fecha=eq.${fecha}&select=${COLUMNAS}&order=seccion,departamento,id&limit=5000`);
  if (!pubs.length) return { fecha, estado: 'sin_publicaciones' };

  if (!forzar && !sinIA) {
    const previo = await db.seleccionar(`resumenes_dia?fecha=eq.${fecha}&select=n_publicaciones,version`);
    if (previo.length && previo[0].n_publicaciones === pubs.length && previo[0].version === RESUMEN_VERSION) {
      return { fecha, estado: 'ya_generado', publicaciones: pubs.length };
    }
    const publicas = pubs.filter((p) => p.nivel_privacidad === 'publico');
    const pendientes = publicas.filter((p) => p.ficha_version == null).length;
    if (pendientes > fichasPendientesToleradas(publicas.length)) {
      return { fecha, estado: 'fichas_pendientes', pendientes, publicas: publicas.length };
    }
  }

  const c = clasificar(pubs);
  const peticion = construirPeticionResumen(instrucciones, fecha, c);
  const estimado = tokensAproximados(peticion);
  const cifras = { publicaciones: pubs.length, candidatas: c.candidatos.length, descartes: c.descartes, tokens_entrada_aprox: estimado };
  if (sinIA) return { fecha, estado: 'sin_ia', ...cifras, apartados: Object.fromEntries(Object.entries(c.apartados).map(([k, v]) => [k, v.length])), contratos_sensibles: c.sensibles.length };

  // Cota del coste antes de llamar: entrada estimada + una salida larga (24k tokens).
  const tope = costeResumenUSD({ input_tokens: estimado, output_tokens: 24000 });
  if (tope > maxCoste) return { fecha, estado: 'tope_coste', ...cifras, coste_maximo_estimado: Number(tope.toFixed(3)) };

  const r = await pedir(peticion, { claveApi, fetchFn });
  const { contenido, avisos } = depurar(r.salida, c);
  const gasto = { modelo: r.modelo, uso: r.uso, coste: r.coste };
  if (seco) return { fecha, estado: 'seco', ...cifras, contenido, avisos, ...gasto };

  await db.upsert('resumenes_dia', [{
    fecha,
    contenido,
    n_publicaciones: pubs.length,
    modelo: r.modelo,
    version: RESUMEN_VERSION,
    avisos,
    generado_en: new Date().toISOString(),
  }], 'fecha');
  return { fecha, estado: 'guardado', ...cifras, avisos, ...gasto };
}

/** Anota el gasto en `gasto_ingesta` (n_fichas = 0). No lanza: el resumen ya está guardado. */
export async function registrarGastoResumen(db, { modelo, uso, coste }) {
  if (!uso) return false;
  try {
    await db.insertar('gasto_ingesta', {
      modelo: modelo ?? MODELO_RESUMEN,
      n_fichas: 0,
      tokens_entrada: uso.input_tokens ?? 0,
      tokens_salida: uso.output_tokens ?? 0,
      tokens_cache: uso.cache_read_input_tokens ?? 0,
      coste_usd: Number((coste ?? 0).toFixed(5)),
    });
    return true;
  } catch (e) {
    console.error(`AVISO: no se pudo registrar el gasto del resumen: ${String(e?.message ?? e).slice(0, 200)}`);
    return false;
  }
}

function leerArgumentos(argv) {
  const a = { fecha: 'hoy', sinIA: false, seco: false, forzar: false, maxCoste: 1 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fecha') a.fecha = argv[++i];
    else if (k === '--sin-ia') a.sinIA = true;
    else if (k === '--seco') a.seco = true;
    else if (k === '--forzar') a.forzar = true;
    else if (k === '--max-coste') a.maxCoste = Number(argv[++i]);
  }
  if (!a.fecha || a.fecha === 'hoy') a.fecha = hoyEnMadrid();
  return a;
}

async function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) throw new Error('--fecha debe ser AAAA-MM-DD o «hoy»');
  if (!Number.isFinite(a.maxCoste) || a.maxCoste <= 0) throw new Error('--max-coste no válido');
  if (!a.sinIA && !process.env.ANTHROPIC_API_KEY) throw new Error('falta ANTHROPIC_API_KEY');

  const db = crearCliente({ url: process.env.SUPABASE_URL, claveSecreta: process.env.SUPABASE_SERVICE_ROLE_KEY });
  let r;
  try {
    r = await resumirDia(a.fecha, { db, claveApi: process.env.ANTHROPIC_API_KEY, sinIA: a.sinIA, seco: a.seco, forzar: a.forzar, maxCoste: a.maxCoste });
  } catch (e) {
    // Claude ya ha cobrado aunque la salida no sirva: se anota igualmente.
    if (e?.uso) await registrarGastoResumen(db, { modelo: MODELO_RESUMEN, uso: e.uso, coste: e.coste });
    throw e;
  }
  if (r.uso) r.gasto_registrado = await registrarGastoResumen(db, r);
  if (r.coste != null) r.coste = Number(r.coste.toFixed(5));
  console.log(JSON.stringify({ resumen_dia: r }, null, a.seco ? 2 : 0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`resumen del día: ${e.message}`);
    process.exitCode = 1;
  });
}
