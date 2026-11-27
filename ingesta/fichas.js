// Generación de fichas: para cada publicación pública sin ficha, descarga su XML oficial, genera
// la ficha con Haiku 5.5 y la guarda. El texto completo NO se guarda.
//
// Uso (en local: node --env-file=.env ingesta/fichas.js ...):
//   node ingesta/fichas.js --pendientes [--limite 50] [--max-coste 2]   fichas de las públicas + índice de su texto
//   node ingesta/fichas.js --restringidas [--limite 200]                 solo índice del texto de las restringidas (sin IA)
//   node ingesta/fichas.js --id BOE-A-2026-23758
//   añadir --sin-ia  para descargar y leer los XML SIN llamar a Claude ni guardar (no cuesta nada)
//   --concurrencia N  procesa N publicaciones a la vez (por defecto 1)
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

/** Indexa el texto de una publicación; falla si la base no encuentra el id (devuelve false). */
async function indexar(db, id, texto) {
  const ok = await db.rpc('indexar_texto', { p_id: id, p_texto: texto });
  if (ok === false) throw new Error(`indexar_texto: la publicación ${id} no existe`);
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
    // Una ficha «a revisar» tampoco guarda su aviso: es texto de la IA sin revisar (auditoría, 2.6).
    aviso_fuente: ficha.revisar ? null : (ficha.aviso_fuente ?? null),
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
  const { db, claveApi, sinIA = false, seco = false, maxCoste = 2, pausa = PAUSA_MS, concurrencia = 1, fetchFn, ia = generarFicha } = deps;
  const instrucciones = sinIA ? null : (deps.instrucciones ?? leerInstrucciones());
  const r = { procesadas: 0, guardadas: 0, a_revisar: 0, recortadas: 0, errores: [], coste: 0, tokens_entrada: 0, tokens_salida: 0, tokens_cache: 0, parada: null };

  // Grupo de `concurrencia` trabajadores que toman publicaciones de una cola común.
  let siguiente = 0;
  const trabajador = async () => {
    while (!r.parada) {
      if (r.coste >= maxCoste) { r.parada = `tope de coste alcanzado (${maxCoste} USD)`; return; }
      const i = siguiente++;
      if (i >= pubs.length) return;
      const pub = pubs[i];
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
            // Primero el índice: si falla, la ficha no queda guardada y la publicación se reintenta.
            await indexar(db, pub.id, doc.texto); // texto COMPLETO; no se guarda, solo sus lexemas
            await db.parchear('publicaciones', `id=eq.${encodeURIComponent(pub.id)}`, filaDeFicha(doc, ficha));
            r.guardadas += 1;
          } else {
            console.log(JSON.stringify({ id: pub.id, ...ficha }));
          }
        }
      } catch (e) {
        r.errores.push({ id: pub.id, error: String(e?.message ?? e) });
        if (e?.uso) {   // intentos ya cobrados antes del fallo
          r.coste += e.coste ?? 0;
          r.tokens_entrada += e.uso.input_tokens ?? 0;
          r.tokens_salida += e.uso.output_tokens ?? 0;
          r.tokens_cache += e.uso.cache_read_input_tokens ?? 0;
        }
        // Solo un 401/403 de Anthropic (errores «fatal» de ficha-ia.js) detiene la pasada: un 403 de boe.es al bajar un
        // XML es un fallo de esa publicación y se sigue con las demás (auditoría, apartado 3).
        if (e?.fatal && /HTTP 40[13]|invalid x-api-key|authentication/i.test(String(e?.message))) { r.parada = 'error de autenticación: se detiene'; return; }
      }
      if (pausa) await dormir(pausa);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrencia) }, trabajador));
  return r;
}

/**
 * Restringidas: sin IA ni ficha. Solo se descarga el XML para indexar sus palabras (el nombre de
 * alguien que figura en el cuerpo debe poder encontrarse) y se guardan los metadatos de vigencia.
 * El texto no se guarda y de estas publicaciones nunca sale nada salvo título, metadatos y enlaces.
 */
export async function indexarRestringidas(pubs, { db, sinIA = false, pausa = PAUSA_MS, concurrencia = 1, fetchFn, esperasXml } = {}) {
  const r = { procesadas: 0, indexadas: 0, errores: [], parada: null };
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < pubs.length) {
      const pub = pubs[siguiente++];
      try {
        const xml = await descargarXml(pub.url_xml, { fetchFn, esperas: esperasXml });
        const doc = leerDocumento(xml);
        r.procesadas += 1;
        if (sinIA) {
          console.log(JSON.stringify({ id: pub.id, caracteres: doc.texto.length, rango: doc.rango }));
        } else {
          await indexar(db, pub.id, doc.texto);
          await db.parchear('publicaciones', `id=eq.${encodeURIComponent(pub.id)}`, {
            rango: doc.rango,
            estatus_derogacion: doc.vigencia.estatus_derogacion,
            judicialmente_anulada: doc.vigencia.judicialmente_anulada,
            vigencia_agotada: doc.vigencia.vigencia_agotada,
            vigencia_actualizada: new Date().toISOString(),
          });
          r.indexadas += 1;
        }
      } catch (e) {
        r.errores.push({ id: pub.id, error: String(e?.message ?? e) });
      }
      if (pausa) await dormir(pausa);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrencia) }, trabajador));
  return r;
}

/**
 * Guarda en `gasto_ingesta` lo que ha costado una pasada (migración 14). Solo si se ha llamado a Claude.
 * No lanza: si falla (p. ej. migración sin aplicar), avisa y la pasada sigue contando como correcta,
 * porque las fichas ya están guardadas. El gasto real siempre se puede contrastar en la Console de Anthropic.
 * @returns {Promise<boolean>} true si se ha guardado una fila
 */
export async function registrarGasto(db, r, { modelo = MODELO } = {}) {
  if (!r.tokens_entrada && !r.tokens_salida && !r.tokens_cache) return false;
  try {
    await db.insertar('gasto_ingesta', {
      modelo,
      n_fichas: r.guardadas,
      tokens_entrada: r.tokens_entrada,
      tokens_salida: r.tokens_salida,
      tokens_cache: r.tokens_cache,
      coste_usd: Number(r.coste.toFixed(5)),
    });
    return true;
  } catch (e) {
    console.error(`AVISO: no se pudo registrar el gasto de la ingesta: ${String(e?.message ?? e).slice(0, 200)}`);
    return false;
  }
}

function leerArgumentos(argv) {
  const a = { limite: 50, maxCoste: 2, concurrencia: 1, sinIA: false, seco: false, pendientes: false, restringidas: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sin-ia') a.sinIA = true;
    else if (k === '--seco') a.seco = true;
    else if (k === '--pendientes') a.pendientes = true;
    else if (k === '--restringidas') a.restringidas = true;
    else if (k === '--id') a.id = argv[++i];
    else if (k === '--limite') a.limite = Number(argv[++i]);
    else if (k === '--max-coste') a.maxCoste = Number(argv[++i]);
    else if (k === '--concurrencia') a.concurrencia = Number(argv[++i]);
  }
  return a;
}

async function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  if (!a.id && !a.pendientes && !a.restringidas) throw new Error('indica --pendientes, --restringidas o --id <ID>');
  if (!Number.isFinite(a.limite) || a.limite < 1) throw new Error('--limite no válido');
  if (!a.sinIA && !a.restringidas && !process.env.ANTHROPIC_API_KEY) throw new Error('falta ANTHROPIC_API_KEY');

  const db = crearCliente({ url: process.env.SUPABASE_URL, claveSecreta: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const columnas = 'id,fecha,seccion,seccion_nombre,departamento,epigrafe,titulo,url_xml';
  if (a.restringidas) {
    const rutaR = `publicaciones?nivel_privacidad=eq.restringido&tsv_texto=is.null&select=id,url_xml&order=fecha.desc,id&limit=${a.limite}`;
    const pubsR = await db.seleccionar(rutaR);
    console.error(`${pubsR.length} restringidas a indexar${a.sinIA ? ' (sin escribir)' : ''}`);
    const rr = await indexarRestringidas(pubsR, { db, sinIA: a.sinIA, concurrencia: a.concurrencia });
    console.log(JSON.stringify({ resumen: rr }));
    process.exitCode = rr.errores.length && !rr.indexadas && !a.sinIA ? 1 : 0;
    return;
  }
  const ruta = a.id
    ? `publicaciones?id=eq.${encodeURIComponent(a.id)}&nivel_privacidad=eq.publico&select=${columnas}`
    : `publicaciones?nivel_privacidad=eq.publico&or=(ficha_version.is.null,ficha_version.lt.${FICHA_VERSION})&select=${columnas}&order=fecha.desc,id&limit=${a.limite}`;
  const pubs = await db.seleccionar(ruta);

  console.error(`${pubs.length} publicaciones a procesar${a.sinIA ? ' (sin IA)' : a.seco ? ' (seco: no se guarda)' : ''}`);
  const r = await generarFichas(pubs, { db, claveApi: process.env.ANTHROPIC_API_KEY, sinIA: a.sinIA, seco: a.seco, maxCoste: a.maxCoste, concurrencia: a.concurrencia });
  r.coste = Number(r.coste.toFixed(5));
  // También en --seco: Claude se ha llamado y se ha cobrado, aunque no se guarden las fichas.
  if (!a.sinIA) r.gasto_registrado = await registrarGasto(db, r);
  console.log(JSON.stringify({ resumen: r }));
  process.exitCode = r.errores.length && !r.guardadas && !a.sinIA && !a.seco ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
