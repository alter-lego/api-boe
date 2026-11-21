// Comprobación en el servidor de preguntas sin sentido evidente (sin letras, solo palabras vacías, o solo palabras
// que parecen letras al azar). Se rechazan con 400 ANTES de reservar cupo y de llamar a Claude: no gastan nada.
// Es la misma regla que el aviso «Esto no parece una pregunta» de la web (web/src/dudosa.ts): si cambia una, cambiar la otra.
// Deliberadamente conservadora: no rechaza palabras sueltas ni siglas válidas (IRPF, BOE) ni preguntas cortas.

const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u', 'que', 'qué', 'por', 'para', 'con', 'sin', 'se', 'es', 'son', 'hay', 'lo', 'le', 'les', 'me', 'mi', 'su', 'sus', 'como', 'cómo', 'cual', 'cuál', 'cuales', 'cuáles', 'quien', 'quién', 'cuando', 'cuándo', 'donde', 'dónde', 'ha', 'han', 'he', 'has']);

function palabraRara(p) {
  const s = p.toLowerCase();
  if (/(.)\1{3,}/u.test(s)) return true; // «aaaa»
  if (s.length >= 3 && new Set(s).size <= 2) return true; // «aaa», «ababab»
  if (s.length < 5) return false; // siglas y palabras cortas válidas: BOE, IRPF, ley
  const vocales = (s.match(/[aeiouáéíóúü]/g) ?? []).length;
  return vocales / s.length < 0.25 || /[^aeiouáéíóúüñ\d\W]{5,}/u.test(s);
}

/** true si la pregunta no tiene sentido evidente y no debe gastar cupo ni llamar a Claude. */
export function preguntaSinSentido(texto) {
  const palabras = String(texto).match(/[\p{L}\p{N}]+/gu) ?? [];
  const letras = palabras.filter((p) => /\p{L}/u.test(p));
  if (!letras.length) return true;
  const utiles = letras.filter((p) => !VACIAS.has(p.toLowerCase()));
  if (!utiles.length) return true;
  return utiles.every(palabraRara);
}
