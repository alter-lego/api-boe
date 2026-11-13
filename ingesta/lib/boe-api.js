// Descarga del sumario con reintentos. Distingue los tres estados que importan:
//   ok            → 200 con sumario
//   sin_boletin   → 404 (domingos, festivos): no es un error
//   fuente_caida  → 5xx o tiempo agotado tras los reintentos

import { createHash } from 'node:crypto';

const BASE = 'https://www.boe.es/datosabiertos/api/boe/sumario';
const ESPERAS_MS = [2000, 5000, 15000];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} aaaammdd */
export async function descargarSumario(aaaammdd, { esperas = ESPERAS_MS, fetchFn = fetch } = {}) {
  let ultimoError = null;

  for (let intento = 0; intento <= esperas.length; intento++) {
    try {
      const res = await fetchFn(`${BASE}/${aaaammdd}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return { estado: 'sin_boletin' };
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return { estado: 'error', error: `HTTP ${res.status}` };

      const texto = await res.text();
      let json;
      try {
        json = JSON.parse(texto);
      } catch {
        return { estado: 'error', error: 'la respuesta no es JSON' };
      }
      const hash = createHash('sha256').update(texto).digest('hex');
      return { estado: 'ok', json, hash };
    } catch (e) {
      ultimoError = e;
      if (intento < esperas.length) await dormir(esperas[intento]);
    }
  }
  return { estado: 'fuente_caida', error: String(ultimoError?.message ?? ultimoError) };
}
