// Negrita en las primeras palabras relevantes de un resumen o de un punto de la respuesta (solo presentación, no cambia los datos).
const FLOJAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u', 'por', 'para', 'con', 'sin', 'se', 'que', 'su', 'sus']);

export function partirInicio(texto: string): [string, string] {
  const t = texto.trim();
  const dosPuntos = t.indexOf(':');
  if (dosPuntos > 3 && dosPuntos <= 70) return [t.slice(0, dosPuntos), t.slice(dosPuntos)];
  const palabras = t.split(/\s+/);
  if (palabras.length <= 3) return [t, ''];
  // Primera frase corta: hasta la primera coma, punto y coma o punto (dentro de las 8 primeras palabras, con al menos 2).
  for (let i = 1; i < Math.min(8, palabras.length - 1); i++) {
    if (/[,;.]$/.test(palabras[i])) {
      const lead = palabras.slice(0, i + 1).join(' ').replace(/[,;.]$/, '');
      return [lead, t.slice(lead.length)];
    }
  }
  // Si no hay pausa, las 5 primeras palabras, sin terminar en artículo o preposición.
  const corte = palabras.slice(0, 5);
  while (corte.length > 2 && FLOJAS.has(corte[corte.length - 1].toLowerCase())) corte.pop();
  const lead = corte.join(' ');
  return [lead, t.slice(lead.length)];
}

export function ConInicioDestacado({ texto }: { texto: string }) {
  const [lead, resto] = partirInicio(texto);
  return <><strong className="destacado">{lead}</strong>{resto}</>;
}
