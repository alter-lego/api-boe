// Saneado común de todo lo que escribe la IA o se le entrega: respuestas de Preguntar, textos que lee Claude,
// resumen del día y fichas. Lo usan la API (api/src/preguntar.js) y la ingesta. Auditoría del 26/11/2026, 2.1–2.6.
//
// - DNI y NIE solo si la letra de control cuadra (módulo 23) y es mayúscula: así «entre 1.000.000 y 2.000.000
//   euros» o «25.000.000 e IVA» no se toman por DNI.
// - Máscaras del BOE (***4567**, también con espacios) y DNI sin letra precedidos de «DNI»/«NIF».
// - Enlaces: con esquema (también «hxxps»), «www.», y dominios sin esquema (bit.ly/x, t.me/canal), incluidos los
//   ofuscados con «[.]», «(.)» o «[punto]».
// Todo se normaliza antes con NFKC (dígitos de ancho completo, ligaduras…).

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const letraValida = (numero, letra) => LETRAS_DNI[Number(numero) % 23] === letra;

export const normalizar = (t) => String(t ?? '').normalize('NFKC');

/** DNI, NIE y números enmascarados → [DNI], [NIE], [ID]. */
export function quitarDatosPersonales(t) {
  return normalizar(t)
    // NIE: X/Y/Z + 7 cifras + letra, con separadores opcionales (X-1234567-L, Y 1234567 L)
    .replace(/(?<![A-Za-z0-9])([XYZ])[\s.-]?(\d{7})[\s.-]?([A-Z])(?![A-Za-z0-9])/g,
      (m, p, n, l) => (letraValida(`${'XYZ'.indexOf(p)}${n}`, l) ? '[NIE]' : m))
    // DNI con puntos o espacios: 12.345.678-Z, 12 345 678 Z
    .replace(/(?<![\d.,])(\d{1,2})[. ](\d{3})[. ](\d{3})\s?-?\s?([A-Z])(?![A-Za-z0-9])/g,
      (m, a, b, c, l) => (letraValida(a + b + c, l) ? '[DNI]' : m))
    // DNI seguido: 12345678Z, 12345678-Z, 12345678 Z
    .replace(/(?<![\d.,])(\d{8})(?:-|\s)?([A-Z])(?![A-Za-z0-9])/g, (m, n, l) => (letraValida(n, l) ? '[DNI]' : m))
    // DNI sin letra, solo si lo anuncia la palabra (DNI 12345678, NIF: 12.345.678)
    .replace(/\b(D\.?\s?N\.?\s?I\.?|N\.?\s?I\.?\s?F\.?)(\s?(?:n[.º°]*|núm\.?)?\s?:?\s?)\d{1,2}\.?\d{3}\.?\d{3}(?![\d])/gi, '$1$2[DNI]')
    // máscaras del BOE: ***4567**, *** 4567 **, xxx4567x (sin cuantificadores anidados: sin backtracking cuadrático)
    .replace(/(?<!\*)\*{2,6}\s?\d{3,4}\s?\*{0,3}[A-Za-z]?/g, '[ID]')
    .replace(/(?<![xX*])[xX]{2,6}\d{3,4}[xX*]{0,3}[A-Za-z]?/g, '[ID]');
}

// Dominios de primer nivel que se tratan como enlace sin esquema. Lista cerrada a propósito: con cualquier
// palabra de 2 letras saldrían falsos positivos en texto normal («EE.UU.», «p.ej»).
const TLD = 'com|es|org|net|eu|info|io|ly|me|co|gl|gd|to|ai|app|dev|link|site|online|click|live|shop|store|biz|us|uk|de|fr|it|pt|nl|be|ch|at|br|mx|ar|cat|gal|eus|xyz|top|ru|cn|tk|ml|ga|cf|gq|ws|cc|tv|sh|so|la|gg|im|is|li|st|vu|fm|ly|gov|edu|int';
const RE_DOMINIO = new RegExp(`(?<![\\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,4}(?:${TLD})\\b(?:[/?#]\\S*)?`, 'gi');
const RE_ESQUEMA = /\b(?:h[tx]{2}ps?|ftp|javascript|data|vbscript|file):\S*/gi;
const RE_WWW = /\bwww\.\S+/gi;
const desofuscar = (t) => t.replace(/\s?[[(]\s?(?:\.|dot|punto)\s?[\])]\s?/gi, '.');

/** Enlaces fuera: con esquema, www., dominios sin esquema y ofuscados. */
export function quitarEnlaces(t) {
  return desofuscar(normalizar(t))
    .replace(/\]\([^)]*\)/g, ']')                 // [texto](enlace) → [texto]
    .replace(RE_ESQUEMA, '[enlace omitido]')
    .replace(RE_WWW, '[enlace omitido]')
    .replace(RE_DOMINIO, '[enlace omitido]');
}

const RE_HTML = /<\/?[a-z][^>]*>/i;

/** ¿Tiene un dato personal, un enlace o HTML? Para descartar piezas enteras (resumen del día, fichas). */
export function textoInseguro(t) {
  const s = normalizar(t);
  return RE_HTML.test(s) || quitarDatosPersonales(s) !== s || quitarEnlaces(s) !== desofuscar(s);
}
