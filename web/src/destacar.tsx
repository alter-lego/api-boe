// Negrita en las primeras palabras relevantes de un resumen o de un punto de la respuesta (solo presentación, no cambia los datos).
const FLOJAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u', 'por', 'para', 'con', 'sin', 'se', 'que', 'su', 'sus']);

// Corta por posiciones del texto original (no volviendo a unir las palabras): con dobles espacios o saltos de línea,
// unirlas con un espacio cambiaba la longitud y el corte caía en otro sitio (auditoría, apartado 3).
export function partirInicio(texto: string): [string, string] {
  const t = texto.trim();
  const dosPuntos = t.indexOf(':');
  if (dosPuntos > 3 && dosPuntos <= 70) return [t.slice(0, dosPuntos), t.slice(dosPuntos)];
  const palabras = [...t.matchAll(/\S+/g)].map((m) => ({ txt: m[0], fin: (m.index ?? 0) + m[0].length }));
  if (palabras.length <= 3) return [t, ''];
  // Primera frase corta: hasta la primera coma, punto y coma o punto (dentro de las 8 primeras palabras, con al menos 2).
  for (let i = 1; i < Math.min(8, palabras.length - 1); i++) {
    if (/[,;.]$/.test(palabras[i].txt)) {
      const corte = palabras[i].fin - 1;   // sin el signo de puntuación
      return [t.slice(0, corte), t.slice(corte)];
    }
  }
  // Si no hay pausa, las 5 primeras palabras, sin terminar en artículo o preposición.
  let n = Math.min(5, palabras.length);
  while (n > 2 && FLOJAS.has(palabras[n - 1].txt.toLowerCase())) n--;
  const corte = palabras[n - 1].fin;
  return [t.slice(0, corte), t.slice(corte)];
}

export function ConInicioDestacado({ texto }: { texto: string }) {
  const [lead, resto] = partirInicio(texto);
  return <><strong className="destacado">{lead}</strong>{resto}</>;
}
