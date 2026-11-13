// Recogida diaria del sumario del BOE.
//
// Uso:
//   node ingesta/boe.js --fecha hoy                      (lo que lanza GitHub Actions)
//   node ingesta/boe.js --fecha 2026-11-12
//   node ingesta/boe.js --desde 2026-11-01 --hasta 2026-11-12   (histórico, por tramos)
//   añadir --seco para descargar y clasificar SIN escribir en la base de datos
//
// En local las claves salen de .env:  node --env-file=.env ingesta/boe.js --fecha hoy

import { fileURLToPath } from 'node:url';
import { descargarSumario } from './lib/boe-api.js';
import { parsearSumario, resumir } from './lib/sumario.js';
import { crearCliente } from './lib/supabase.js';

const TAMANO_LOTE = 200;

const hoyEnMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function* dias(desde, hasta) {
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}

function lotes(lista, n) {
  const salida = [];
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
  return salida;
}

/**
 * Ingiere un día. Devuelve { estado, ...cifras }. No lanza: los fallos se registran.
 * @param {string} fecha AAAA-MM-DD
 * @param {{ db?: object, seco?: boolean, descargar?: Function }} deps
 */
export async function ingestarFecha(fecha, { db, seco = false, descargar = descargarSumario } = {}) {
  const inicio = new Date();
  let resultado = { fecha, estado: 'error' };

  try {
    const r = await descargar(fecha.replaceAll('-', ''));

    if (r.estado !== 'ok') {
      resultado = { fecha, estado: r.estado, error: r.error ?? null };
    } else {
      const parseado = parsearSumario(r.json);
      const cifras = resumir(parseado);

      if (seco) {
        resultado = { fecha, estado: 'ok', seco: true, ...cifras };
      } else {
        const previos = await db.seleccionar(
          `sumarios?boletin=eq.BOE&fecha=eq.${fecha}&select=numero,hash`,
        );
        const igual =
          previos.length === parseado.diarios.length &&
          parseado.diarios.every((d) => previos.some((p) => p.numero === d.numero && p.hash === r.hash));

        if (igual) {
          resultado = { fecha, estado: 'ok', sin_cambios: true, n_nuevas: 0, n_actualizadas: 0, ...cifras };
        } else {
          const existentes = new Set(
            (await db.seleccionar(`publicaciones?fecha=eq.${fecha}&boletin=eq.BOE&select=id`)).map((p) => p.id),
          );

          const sumarios = await db.upsert(
            'sumarios',
            parseado.diarios.map((d) => ({
              boletin: 'BOE', fecha, numero: d.numero, url_pdf: d.url_pdf, hash: r.hash,
            })),
            'boletin,fecha,numero',
          );
          const idSumario = new Map(sumarios.map((s) => [s.numero, s.id]));

          // Solo se envían las columnas del sumario: así un nuevo paso del mismo día
          // no borra las fichas (resumen, temas...) que ya se hayan generado.
          const filas = parseado.diarios.flatMap((d) =>
            d.publicaciones.map((p) => ({ ...p, sumario_id: idSumario.get(d.numero) })),
          );
          for (const lote of lotes(filas, TAMANO_LOTE)) await db.upsert('publicaciones', lote, 'id');

          const nuevas = filas.filter((p) => !existentes.has(p.id)).length;
          resultado = {
            fecha, estado: 'ok', n_nuevas: nuevas, n_actualizadas: filas.length - nuevas, ...cifras,
          };
        }
      }
    }
  } catch (e) {
    resultado = { fecha, estado: 'error', error: String(e?.message ?? e) };
  }

  if (!seco && db) {
    try {
      await db.insertar('ingestas', {
        boletin: 'BOE',
        fecha,
        inicio: inicio.toISOString(),
        fin: new Date().toISOString(),
        estado: resultado.estado,
        n_nuevas: resultado.n_nuevas ?? null,
        n_actualizadas: resultado.n_actualizadas ?? null,
        n_fichas: 0,
        error: resultado.error ?? null,
      });
    } catch (e) {
      resultado.error_registro = String(e?.message ?? e);
    }
  }
  return resultado;
}

function leerArgumentos(argv) {
  const a = { seco: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seco') a.seco = true;
    else if (['--fecha', '--desde', '--hasta'].includes(argv[i])) a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}

async function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  const fechas = a.desde
    ? [...dias(a.desde, a.hasta ?? hoyEnMadrid())]
    : [!a.fecha || a.fecha === 'hoy' ? hoyEnMadrid() : a.fecha];

  for (const f of fechas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error(`fecha no válida: ${f}`);
  }

  const db = a.seco
    ? null
    : crearCliente({ url: process.env.SUPABASE_URL, claveSecreta: process.env.SUPABASE_SERVICE_ROLE_KEY });

  let fallos = 0;
  for (const f of fechas) {
    const r = await ingestarFecha(f, { db, seco: a.seco });
    console.log(JSON.stringify(r));
    if (r.estado === 'error' || r.estado === 'fuente_caida') fallos += 1;
    if (fechas.length > 1) await dormir(1000);
  }
  process.exitCode = fallos ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
