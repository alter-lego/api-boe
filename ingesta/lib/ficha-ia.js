// Llamada a Claude Haiku 5.5 para generar la ficha de una publicación.
// - Las instrucciones (skill/FICHA.md) van primero y con punto de caché: iguales en todas las peticiones.
// - La publicación va después, como JSON.
// - Salida estructurada (output_config.format) y esfuerzo bajo: razonar se cobra como salida.

import { readFileSync } from 'node:fs';
import { ESQUEMA_FICHA, validarFicha, limpiarAviso } from './listas.js';
import { costeHaikuUSD } from './precios.js';

export const MODELO = 'claude-haiku-5-5';
const URL_API = 'https://api.anthropic.com/v1/messages';
const ESPERAS_MS = [2000, 6000, 20000];


const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export const leerInstrucciones = () =>
  readFileSync(new URL('../../skill/FICHA.md', import.meta.url), 'utf8');

// Tarifa en precios.js (común con la API). Una ficha son una o dos llamadas de unos 25K tokens como mucho: nunca
// llegan al tramo de más de 100K, así que basta con aplicarla al uso sumado.
export const costeUSD = (uso = {}) => costeHaikuUSD(uso);

export function construirPeticion(instrucciones, entrada) {
  return {
    model: MODELO,
    max_tokens: 4000, // el razonamiento (esfuerzo bajo) también cuenta como salida
    system: [{ type: 'text', text: instrucciones, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(entrada) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_FICHA } },
  };
}

/** POST a la API de Mensajes con reintentos en 429/5xx. También la usa el resumen del día (resumen-dia.js). */
export async function llamar(peticion, { claveApi, fetchFn = fetch, esperas = ESPERAS_MS, timeoutMs = 120_000, cabeceras = {} }) {
  let ultimo = null;
  for (let i = 0; i <= esperas.length; i++) {
    try {
      const res = await fetchFn(URL_API, {
        method: 'POST',
        headers: {
          'x-api-key': claveApi,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          ...cabeceras,
        },
        body: JSON.stringify(peticion),
        signal: AbortSignal.timeout(timeoutMs),
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
    let r;
    try {
      r = await llamar(peticion, { claveApi, fetchFn, esperas });
    } catch (e) {
      // Si falla el segundo intento, el primero ya se cobró: el uso viaja con el error (auditoría, apartado 3).
      if (intento > 1) Object.assign(e, { uso: { ...uso }, coste: costeUSD(uso) });
      throw e;
    }
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
