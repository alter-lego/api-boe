// Llamada a Claude Haiku 5.5 para generar la ficha de una publicación.
// - Las instrucciones (skill/FICHA.md) van primero y con punto de caché: iguales en todas las peticiones.
// - La publicación va después, como JSON.
// - Salida estructurada (output_config.format) y esfuerzo bajo: razonar se cobra como salida.

import { readFileSync } from 'node:fs';
import { ESQUEMA_FICHA, validarFicha, limpiarAviso } from './listas.js';

export const MODELO = 'claude-haiku-5-5';
const URL_API = 'https://api.anthropic.com/v1/messages';
const ESPERAS_MS = [2000, 6000, 20000];

// USD por millón de tokens (Haiku 5.5). Lectura de caché = 0,1×; escritura a 5 min = 1,25×.
const PRECIOS = { entrada: 0.10, salida: 0.50, lectura_cache: 0.01, escritura_cache: 0.125 };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export const leerInstrucciones = () =>
  readFileSync(new URL('../../skill/FICHA.md', import.meta.url), 'utf8');

export function costeUSD(uso = {}) {
  const t = (n) => (n ?? 0) / 1e6;
  return (
    t(uso.input_tokens) * PRECIOS.entrada +
    t(uso.output_tokens) * PRECIOS.salida +
    t(uso.cache_read_input_tokens) * PRECIOS.lectura_cache +
    t(uso.cache_creation_input_tokens) * PRECIOS.escritura_cache
  );
}

export function construirPeticion(instrucciones, entrada) {
  return {
    model: MODELO,
    max_tokens: 1500,
    system: [{ type: 'text', text: instrucciones, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(entrada) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_FICHA } },
  };
}

async function llamar(peticion, { claveApi, fetchFn = fetch, esperas = ESPERAS_MS }) {
  let ultimo = null;
  for (let i = 0; i <= esperas.length; i++) {
    try {
      const res = await fetchFn(URL_API, {
        method: 'POST',
        headers: {
          'x-api-key': claveApi,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(peticion),
        signal: AbortSignal.timeout(120_000),
      });
      const texto = await res.text();
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${texto.slice(0, 300)}`), { fatal: true });
      return JSON.parse(texto);
    } catch (e) {
      if (e.fatal) throw e;
      ultimo = e;
      if (i < esperas.length) await dormir(esperas[i]);
    }
  }
  throw new Error(`la API no responde: ${ultimo?.message ?? ultimo}`);
}

/**
 * Genera la ficha de una publicación.
 * @returns {{ ficha, uso, coste, intentos }}  ficha = salida validada o, si el modelo no
 *   consigue una salida válida o se niega, una ficha con revisar=true y sin resumen.
 */
export async function generarFicha(entrada, { claveApi, instrucciones, fetchFn, esperas } = {}) {
  const peticion = construirPeticion(instrucciones ?? leerInstrucciones(), entrada);
  const uso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let motivo = 'salida no válida';

  for (let intento = 1; intento <= 2; intento++) {
    const r = await llamar(peticion, { claveApi, fetchFn, esperas });
    for (const k of Object.keys(uso)) uso[k] += r.usage?.[k] ?? 0;

    if (r.stop_reason === 'refusal') { motivo = 'el modelo rechazó la petición'; break; }
    if (r.stop_reason === 'max_tokens') { motivo = 'respuesta cortada por longitud'; continue; }

    const texto = (r.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let ficha;
    try {
      ficha = JSON.parse(texto);
    } catch {
      motivo = 'la salida no es JSON';
      continue;
    }
    ficha = limpiarAviso(ficha);
    const v = validarFicha(ficha);
    if (v.ok) return { ficha, uso, coste: costeUSD(uso), intentos: intento };
    motivo = `salida inválida: ${v.errores.join('; ')}`;
  }

  return {
    ficha: {
      resumen: null, temas: ['otros'], tipo_acto: 'otros', revisar: true,
      motivo_revision: motivo, aviso_fuente: null,
    },
    uso,
    coste: costeUSD(uso),
    intentos: 2,
  };
}
