// Comprobación en el navegador, antes de enviar, de preguntas que probablemente no tengan respuesta útil.
// No mira si hay resultados (el buscador exige coincidencias exactas y bloquearía preguntas válidas).
// 'sinsentido' es la regla DURA: la API tiene una copia (api/src/pregunta-valida.js) y debe cambiar a la vez.
// 'rara' es BLANDA (solo avisa; se puede enviar igualmente): palabras que no parecen españolas.
export type Duda = 'sinsentido' | 'rara' | 'corta';

const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u', 'que', 'qué', 'por', 'para', 'con', 'sin', 'se', 'es', 'son', 'hay', 'lo', 'le', 'les', 'me', 'mi', 'su', 'sus', 'como', 'cómo', 'cual', 'cuál', 'cuales', 'cuáles', 'quien', 'quién', 'cuando', 'cuándo', 'donde', 'dónde', 'ha', 'han', 'he', 'has']);

function palabraRara(p: string): boolean {
  const s = p.toLowerCase();
  if (/(.)\1{3,}/.test(s)) return true; // «aaaa»
  if (s.length >= 3 && new Set(s).size <= 2) return true; // «aaa», «ababab»
  if (s.length < 5) return false; // siglas y palabras cortas válidas: BOE, IRPF, ley
  const vocales = (s.match(/[aeiouáéíóúü]/g) ?? []).length;
  return vocales / s.length < 0.25 || /[^aeiouáéíóúüñ\d\W]{5,}/.test(s);
}

// --- Regla BLANDA: palabras que no parecen españolas (no se rechaza en el servidor) ---
// Pares de consonantes que sí aparecen en español dentro de una palabra; cualquier otro par es raro.
const PARES = new Set(('bl br cl cr dr fl fr gl gr pl pr tr ch ll rr cc nn ss tt mm ' +
  'nt nd nc ns nf ng nz nv nm nr mb mp mn rb rc rd rf rg rj rl rm rn rp rs rt rv rz ' +
  'lb lc ld lf lg lm lp ls lt lv lz sb sc sd sf sg sl sm sn sp st sv sj ' +
  'ct cn cs cz pt ps pc pn pr bt bs bj bc bd bn gn gm gd gt gs dm dv ds tm tn tl ts tz ' +
  'xc xp xt xh fr ft zc zg ' +
  'bn ng nj kr kl ks sk sh ps bv dj rq lq nq sq mc').split(' '));
const VOCAL = /[aeiouáéíóúüy]/;

function sospechosa(original: string): boolean {
  // Las siglas escritas en mayúsculas (CNMC, DGT, TJUE, IRPF) no cuentan como raras.
  if (original.length <= 6 && original === original.toUpperCase() && /\p{L}/u.test(original)) return false;
  const s = original.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, (m) => (m === '\u0303' ? m : '')).normalize('NFC').replace(/h/g, (_m, i, t) => (t[i - 1] === 'c' ? 'h' : ''));
  if (s.length < 4) return false;
  if (/q(?!u)/.test(s)) return true; // «q» sin «u»
  let raros = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    if (!VOCAL.test(a) && !VOCAL.test(b) && /\p{L}/u.test(a + b) && !PARES.has(a + b)) raros++;
  }
  if (raros >= 1) return true;
  const vocales = (s.match(/[aeiouáéíóúü]/g) ?? []).length;
  return s.length >= 5 && vocales / s.length < 0.3;
}

export function evaluar(texto: string): Duda | null {
  const palabras = texto.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letras = palabras.filter((p) => /\p{L}/u.test(p));
  if (!letras.length) return 'sinsentido';
  const utiles = letras.filter((p) => !VACIAS.has(p.toLowerCase()));
  if (!utiles.length) return 'sinsentido';
  if (utiles.every(palabraRara)) return 'sinsentido';
  if (utiles.every(sospechosa)) return 'rara';
  if (palabras.length < 2) return 'corta';
  return null;
}
