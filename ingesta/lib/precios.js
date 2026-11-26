// Tarifa de Claude Haiku 5.5 en USD por millón de tokens, común a la API (Preguntar) y a la ingesta (fichas).
// Hasta 100K tokens de prompt: 0,10 entrada / 0,50 salida. Por encima: 0,50 / 2,50 (×5). La caché sigue la misma
// proporción sobre la entrada: lectura 0,1× y escritura a 5 minutos 1,25× (se aplica el mismo ×5 en el tramo alto).
// El tramo se decide POR LLAMADA (el tamaño del prompt de esa petición), así que el coste se calcula llamada a
// llamada y se suma; sumar los tokens de varias llamadas y aplicar la tarifa después daría otro resultado.
// Auditoría del 26/11/2026, 2.8.
export const PRECIOS_HAIKU = { entrada: 0.10, salida: 0.50, lectura_cache: 0.01, escritura_cache: 0.125 };
export const UMBRAL_PROMPT_LARGO = 100_000;

/** Coste en USD de UNA llamada, a partir de su `usage`. */
export function costeHaikuUSD(uso = {}) {
  const t = (n) => (n ?? 0) / 1e6;
  const prompt = (uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0);
  const f = prompt > UMBRAL_PROMPT_LARGO ? 5 : 1;
  return f * (t(uso.input_tokens) * PRECIOS_HAIKU.entrada + t(uso.output_tokens) * PRECIOS_HAIKU.salida
    + t(uso.cache_read_input_tokens) * PRECIOS_HAIKU.lectura_cache + t(uso.cache_creation_input_tokens) * PRECIOS_HAIKU.escritura_cache);
}
