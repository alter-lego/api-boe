// Generación de fichas: para cada publicación pública sin ficha, descarga su XML oficial, genera
// la ficha con Haiku 5.5 y la guarda. El texto completo NO se guarda.
//
// Uso (en local: node --env-file=.env ingesta/fichas.js ...):
//   node ingesta/fichas.js --pendientes [--limite 50] [--max-coste 2]
//   node ingesta/fichas.js --id BOE-A-2026-23758
//   añadir --sin-ia  para descargar y leer los XML SIN llamar a Claude ni guardar (no cuesta nada)
//   añadir --seco    para llamar a Claude pero NO guardar el resultado

import { fileURLToPath } from 'node:url';
import { leerDocumento, recortarTexto } from './lib/xml-boe.js';
import { generarFicha, leerInstrucciones, MODELO } from './lib/ficha-ia.js';
import { FICHA_VERSION } from './lib/listas.js';
import { crearCliente } from './lib/supabase.js';

const PAUSA_MS = 1200;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargarXml(url, { fetchFn = fetch, esperas = [2000, 5000, 15000] } = {}) {
  let ultimo = null;
  for (let i = 0; i <= esperas.length; i++) {
    try {
      const res = await fetchFn(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) throw Object.assign(new Error('XML no encontrado (404)'), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (e.fatal) throw e;
      ultimo = e;
      if (i < esperas.length) await dormir(esperas[i]);
    }
  }
  throw new Error(`no se pudo descargar el XML: ${ultimo?.message ?? ultimo}`);
}

/** Entrada para el modelo: solo lo que necesita, sin enlaces. */
export function construirEntrada(pub, doc, { texto, recortado }) {
  return {
    id: pub.id,
    fecha: pub.fecha,
    seccion: pub.seccion,
    seccion_nombre: pub.seccion_nombre,
    departamento: pub.departamento,
    epigrafe: pub.epigrafe,
    titulo: pub.titulo,
    rango: doc.rango,
    materias: doc.materias,
    texto,
    texto_recortado: recortado,
  };
}

/** Columnas a guardar. Una ficha «a revisar» no guarda resumen: nada dudoso llega al buscador. */
export function filaDeFicha(doc, ficha, { modelo = MODELO, ahora = new Date() } = {}) {
  return {
    resumen: ficha.revisar ? null : ficha.resumen,
    temas: ficha.temas,
    tipo_acto: ficha.tipo_acto,
    ficha_modelo: modelo,
    ficha_version: FICHA_VERSION,
    ficha_revisar: ficha.revisar,
    ficha_motivo_revision: ficha.revisar ? (ficha.motivo_revision ?? 'sin motivo') : null,
    aviso_fuente: ficha.aviso_fuente ?? null,
    rango: doc.rango,
    referencias: doc.referencias,
    corrige_a: doc.corrige_a,
    estatus_derogacion: doc.vigencia.estatus_derogacion,
    judicialmente_anulada: doc.vigencia.judicialmente_anulada,
    vigencia_agotada: doc.vigencia.vigencia_agotada,
    vigencia_actualizada: ahora.toISOString(),
  };
}

/**
 * Procesa una lista de publicaciones. No lanza: devuelve el resumen con errores por publicación.
 */
export async function generarFichas(pubs, deps) {
  const { db, claveApi, sinIA = false, seco = false, maxCoste = 2, pausa = PAUSA_MS, fetchFn, ia = generarFicha } = deps;
  const instrucciones = sinIA ? null : (deps.instrucciones ?? leerInstrucciones());
  const r = { procesadas: 0, guardadas: 0, a_revisar: 0, recortadas: 0, errores: [], coste: 0, tokens_entrada: 0, tokens_salida: 0, tokens_cache: 0, parada: null };

  for (const pub of pubs) {
    if (r.coste >= maxCoste) { r.parada = `tope de coste alcanzado (${maxCoste} USD)`; break; }
    try {
      const xml = await descargarXml(pub.url_xml, { fetchFn, esperas: deps.esperasXml });
      const doc = leerDocumento(xml);
      const texto = recortarTexto(doc.texto);
      if (texto.recortado) r.recortadas += 1;
      r.procesadas += 1;

      if (sinIA) {
        console.log(JSON.stringify({ id: pub.id, rango: doc.rango, materias: doc.materias.length, refs: doc.referencias?.anteriores.length ?? 0, corrige_a: doc.corrige_a, vigencia: doc.vigencia, caracteres: doc.texto.length, recortado: texto.recortado }));
      } else {
        const { ficha, uso, coste } = await ia(construirEntrada(pub, doc, texto), { claveApi, instrucciones });
        r.coste += coste;
        r.tokens_entrada += uso.input_tokens;
        r.tokens_salida += uso.output_tokens;
        r.tokens_cache += uso.cache_read_input_tokens;
        if (ficha.revisar) r.a_revisar += 1;
        if (!seco) {
          await db.parchear('publicaciones', `id=eq.${encodeURIComponent(pub.id)}`, filaDeFicha(doc, ficha));
          r.guardadas += 1;
        } else {
          console.log(JSON.stringify({ id: pub.id, ...ficha }));
        }
      }
    } catch (e) {
      r.errores.push({ id: pub.id, error: String(e?.message ?? e) });
      if (/HTTP 40[13]|invalid x-api-key|authentication/i.test(String(e?.message))) { r.parada = 'error de autenticación: se detiene'; break; }
    }
    if (pausa) await dormir(pausa);
  }
  return r;
}

function leerArgumentos(argv) {
  const a = { limite: 50, maxCoste: 2, sinIA: false, seco: false, pendientes: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sin-ia') a.sinIA = true;
    else if (k === '--seco') a.seco = true;
    else if (k === '--pendientes') a.pendientes = true;
    else if (k === '--id') a.id = argv[++i];
    else if (k === '--limite') a.limite = Number(argv[++i]);
    else if (k === '--max-coste') a.maxCoste = Number(argv[++i]);
  }
  return a;
}

async function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  if (!a.id && !a.pendientes) throw new Error('indica --pendientes o --id <ID>');
  if (!Number.isFinite(a.limite) || a.limite < 1) throw new Error('--limite no válido');
  if (!a.sinIA && !process.env.ANTHROPIC_API_KEY) throw new Error('falta ANTHROPIC_API_KEY');

  const db = crearCliente({ url: process.env.SUPABASE_URL, claveSecreta: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const columnas = 'id,fecha,seccion,seccion_nombre,departamento,epigrafe,titulo,url_xml';
  const ruta = a.id
    ? `publicaciones?id=eq.${encodeURIComponent(a.id)}&nivel_privacidad=eq.publico&select=${columnas}`
    : `publicaciones?nivel_privacidad=eq.publico&ficha_version=is.null&select=${columnas}&order=fecha.desc,id&limit=${a.limite}`;
  const pubs = await db.seleccionar(ruta);

  console.error(`${pubs.length} publicaciones a procesar${a.sinIA ? ' (sin IA)' : a.seco ? ' (seco: no se guarda)' : ''}`);
  const r = await generarFichas(pubs, { db, claveApi: process.env.ANTHROPIC_API_KEY, sinIA: a.sinIA, seco: a.seco, maxCoste: a.maxCoste });
  r.coste = Number(r.coste.toFixed(5));
  console.log(JSON.stringify({ resumen: r }));
  process.exitCode = r.errores.length && !r.guardadas && !a.sinIA && !a.seco ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
