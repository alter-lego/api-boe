// Comprobación en el navegador, antes de enviar, de preguntas que probablemente no tengan respuesta útil.
// No mira si hay resultados (el buscador exige coincidencias exactas y bloquearía preguntas válidas).
export type Duda = 'sinsentido' | 'corta';

const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u', 'que', 'qué', 'por', 'para', 'con', 'sin', 'se', 'es', 'son', 'hay', 'lo', 'le', 'les', 'me', 'mi', 'su', 'sus', 'como', 'cómo', 'cual', 'cuál', 'cuales', 'cuáles', 'quien', 'quién', 'cuando', 'cuándo', 'donde', 'dónde', 'ha', 'han', 'he', 'has']);

function palabraRara(p: string): boolean {
  const s = p.toLowerCase();
  if (/(.)\1{3,}/.test(s)) return true; // «aaaa»
  if (s.length >= 3 && new Set(s).size <= 2) return true; // «aaa», «ababab»
  if (s.length < 5) return false; // siglas y palabras cortas válidas: BOE, IRPF, ley
  const vocales = (s.match(/[aeiouáéíóúü]/g) ?? []).length;
  return vocales / s.length < 0.25 || /[^aeiouáéíóúüñ\d\W]{5,}/.test(s);
}

export function evaluar(texto: string): Duda | null {
  const palabras = texto.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letras = palabras.filter((p) => /\p{L}/u.test(p));
  if (!letras.length) return 'sinsentido';
  const utiles = letras.filter((p) => !VACIAS.has(p.toLowerCase()));
  if (!utiles.length) return 'sinsentido';
  if (utiles.every(palabraRara)) return 'sinsentido';
  if (palabras.length < 2) return 'corta';
  return null;
}
