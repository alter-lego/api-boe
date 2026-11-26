// Lector del XML de un documento del BOE (diario_boe/xml.php?id=...).
// Sin dependencias: el XML del BOE es regular y solo necesitamos unos campos.

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodificarEntidades(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
}

const limpiar = (s) => decodificarEntidades(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function etiqueta(xml, nombre) {
  const m = xml.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`));
  return m ? limpiar(m[1]) || null : null;
}

const aBooleano = (v) => (v === 'S' ? true : v === 'N' ? false : null);

function referencias(bloque) {
  if (!bloque) return [];
  const salida = [];
  const re = /<(?:anterior|posterior)\s+referencia="([^"]+)"[^>]*>([\s\S]*?)<\/(?:anterior|posterior)>/g;
  for (let m; (m = re.exec(bloque)); ) {
    salida.push({
      referencia: m[1],
      palabra: etiqueta(m[2], 'palabra'),
      texto: etiqueta(m[2], 'texto'),
    });
  }
  return salida;
}

/**
 * Texto plano del cuerpo: un párrafo, fila o elemento de lista por línea.
 * Acepta un XML cortado (la API de Preguntar solo descarga el principio de los documentos largos): si falta
 * </texto>, toma el cuerpo hasta donde llegue, sin la etiqueta que haya quedado a medias.
 */
export function textoPlano(xml) {
  // Las referencias del análisis también llevan etiquetas <texto>: el cuerpo es el que viene después.
  const finAnalisis = xml.indexOf('</analisis>');
  const resto = finAnalisis >= 0 ? xml.slice(finAnalisis) : xml;
  const m = resto.match(/<texto>([\s\S]*)<\/texto>/) ?? resto.match(/<texto>([\s\S]*)$/);
  if (!m) return '';
  const conSaltos = m[1].replace(/<[^>]*$/, '').replace(/<\/(p|tr|li|dd|dt|h\d)>/g, '\n').replace(/<(br|\/td|\/th)[^>]*>/g, ' ');
  return decodificarEntidades(conSaltos.replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Recorta un texto largo conservando el arranque (lo esencial de casi cualquier acto) y el final
 * (parte dispositiva, firmas, plazos). Corta siempre entre párrafos, nunca a mitad de una palabra,
 * y marca el hueco con una línea «[…]». Devuelve { texto, recortado }.
 */
export function recortarTexto(texto, { inicio = 60_000, fin = 10_000 } = {}) {
  if (texto.length <= inicio + fin) return { texto, recortado: false };
  const lineas = texto.split('\n');

  const cabeza = [];
  let n = 0;
  for (const l of lineas) {
    if (n + l.length + 1 > inicio) break;
    cabeza.push(l);
    n += l.length + 1;
  }
  if (cabeza.length === 0) cabeza.push(lineas[0].slice(0, inicio)); // un solo párrafo enorme

  const cola = [];
  n = 0;
  for (let i = lineas.length - 1; i >= cabeza.length; i--) {
    if (n + lineas[i].length + 1 > fin) break;
    cola.unshift(lineas[i]);
    n += lineas[i].length + 1;
  }
  return { texto: [...cabeza, '[…]', ...cola].join('\n'), recortado: true };
}

/** @returns datos del documento listos para la ficha y para guardar en la base. */
export function leerDocumento(xml) {
  if (!/<documento[\s>]/.test(xml)) throw new Error('el XML no es un documento del BOE');
  const meta = (xml.match(/<metadatos>([\s\S]*?)<\/metadatos>/) ?? [])[1] ?? '';
  const analisis = (xml.match(/<analisis>([\s\S]*?)<\/analisis>/) ?? [])[1] ?? '';

  const anteriores = referencias((analisis.match(/<anteriores>([\s\S]*?)<\/anteriores>/) ?? [])[1]);
  const posteriores = referencias((analisis.match(/<posteriores>([\s\S]*?)<\/posteriores>/) ?? [])[1]);
  const materias = [...analisis.matchAll(/<materia\s[^>]*>([\s\S]*?)<\/materia>/g)].map((m) => limpiar(m[1]));

  // «CORRIGE errores…» apunta a la publicación corregida
  const correccion = anteriores.find((a) => /^corrige/i.test(a.palabra ?? ''));

  return {
    rango: etiqueta(meta, 'rango'),
    vigencia: {
      estatus_derogacion: etiqueta(meta, 'estatus_derogacion'),
      judicialmente_anulada: aBooleano(etiqueta(meta, 'judicialmente_anulada')),
      vigencia_agotada: aBooleano(etiqueta(meta, 'vigencia_agotada')),
    },
    materias,
    referencias: anteriores.length || posteriores.length ? { anteriores, posteriores } : null,
    corrige_a: correccion?.referencia ?? null,
    texto: textoPlano(xml),
  };
}
