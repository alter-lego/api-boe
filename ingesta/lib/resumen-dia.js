// Resumen editorial del día («Resumen de hoy»): lo mismo que el correo diario del BOE de n8n
// (n8n-workflows/boe-spec), pero sobre las fichas de la base y con la regla «Claude devuelve JSON y el
// código pinta»: Claude cita cada publicación por su id y nunca escribe enlaces ni HTML.
//
// - clasificar(): descartes y marcas (ayudas, oposiciones, impuestos, automoción, contratos sensibles),
//   con las mismas expresiones que el nodo «Filter and classify» del correo.
// - construirPeticion(): instrucciones (skill/RESUMEN-DIA.md) + publicaciones del día en JSON.
// - depurar(): valida la salida de Claude (ids que existen, sin URLs ni DNI) y completa los apartados.

import { readFileSync } from 'node:fs';
import { llamar } from './ficha-ia.js';

export const RESUMEN_VERSION = 1;
export const MODELO_RESUMEN = 'claude-opus-5-5';

// USD por millón de tokens (Claude Opus 5.5). Si responde el modelo de reserva, el coste es aproximado.
const PRECIOS = { entrada: 4, salida: 20, lectura_cache: 0.2, escritura_cache: 5 };

export const leerInstruccionesResumen = () =>
  readFileSync(new URL('../../skill/RESUMEN-DIA.md', import.meta.url), 'utf8');

export function costeResumenUSD(uso = {}) {
  const t = (n) => (n ?? 0) / 1e6;
  return t(uso.input_tokens) * PRECIOS.entrada + t(uso.output_tokens) * PRECIOS.salida
    + t(uso.cache_read_input_tokens) * PRECIOS.lectura_cache + t(uso.cache_creation_input_tokens) * PRECIOS.escritura_cache;
}

// ───────────── Clasificación determinista (copiada del correo de n8n) ─────────────

const RE = {
  ayudas: /(subvenci[oó]n|ayudas?|convocatoria.*(becas?|ayudas?|subvenci[oó]n|premio)|premios?\b|concesi[oó]n directa)/i,
  oposiciones: /(oposici|proceso selectivo|procedimiento selectivo|pruebas selectivas|lista de aprobados|ingreso por (promoci|turno)|cuerpo (superior|general|t[eé]cnico|facultativo|especial)|escala (t[eé]cnica|administrativa|auxiliar|de titulados))/i,
  tributos: /(\biva\b|\birpf\b|\bimpuest|tributari|retenciones|recaudac|\btasa[s]?\b|aranceles?\b|cotizaciones sociales|base imponible|hecho imponible|obligaciones tributarias)/i,
  tributosExcl: /(ministerio fiscal|fiscal[ií]a|\baeat\b)/i,
  sensibles: /(armament|\barmas\b|munici[oó]n|explosiv|misil|artiller|blindad|carro de combate|fusil|pistola|vigilan|videovigilan|escucha|interceptac|\bespia|espionaje|reconocimiento facial|biometr|migrac|fronter|\bCIE\b|centro de internamiento|expulsar|pateras|deport(ados|ar|aci[oó]n)|drone|\bUAV\b|aeronave no tripulada|cibersegur|malware|exploit|hacking|software de intelig|sistema de intelig|inteligencia (militar|estratégica|criminal|policial))/i,
  sensExcl: [
    /(microsoft|dynamics|\bsap\b|oracle|software|versi[oó]n|cloud|licencia)/i,
    /(salud|m[eé]dico|oftalmol[oó]gico|ginecol[oó]gico|reconocimientos|prevenci[oó]n de riesgos|psicot[eé]cnico)/i,
    /(edificios?|sedes|inmuebles?|oficinas?|despachos?|delegaci[oó]n|alquiler)/i,
    /(\badif\b|obra ferroviaria|infraestructura ferroviaria|ferrocarril|v[ií]a f[eé]rrea|estaci[oó]n)/i,
  ],
  automocion: /(automoci[oó]n|(industria|sector) del autom[oó]vil|veh[ií]culos? (el[eé]ctric|electrificad|h[ií]brid|enchufable|de cero emisiones|cero emisiones|de energ[ií]as alternativas)|coches? el[eé]ctric|turismos? el[eé]ctric|movilidad el[eé]ctrica|electromovilidad|perte vec|programa (auto\+|moves)|\bMOVES\b|puntos? de recarga|infraestructuras? (para la |de )?recarga|estaci[oó]n(es)? de recarga|recarga (ultrarr[aá]pida|del? veh[ií]culo|para veh[ií]culos)|bater[ií]as?.{0,40}veh[ií]culo|fabricantes? de (veh[ií]culos|autom[oó]viles))/i,
  automocionExcl: /(repuestos de automoci|fungible( de repuestos)? de automoci|combustible automoci|bater[ií]as de arranque)/i,
  universidades: /(universidad|universitat|escuela politécnica).*(plan de estudios|convenio|prácticas|título propio|m[aá]ster propio|grado en)/i,
};

export const APARTADOS = ['ayudas', 'oposiciones', 'impuestos', 'automocion'];

/** Motivo de descarte (no llega a Claude) o null. */
export function motivoDescarte(p) {
  const t = (p.titulo ?? '').toLowerCase();
  const d = (p.departamento ?? '').toLowerCase();
  if (p.seccion === '4') return 'justicia';
  if (p.seccion === '5C') return 'anuncios_particulares';
  if (p.seccion === '5B' && /confederación hidrográfica|transición ecológica/.test(`${d} ${t}`)) return 'confederaciones';
  if (p.seccion === '3' && (d === 'universidades' || RE.universidades.test(p.titulo ?? ''))) return 'universidades';
  if ((p.seccion === '2A' || p.seccion === '2B') && d === 'administración local') return 'administracion_local';
  return null;
}

/** Marcas de una publicación que sobrevive a los descartes. */
export function marcas(p) {
  const t = p.titulo ?? '';
  const m = [];
  if (RE.ayudas.test(t) || p.tipo_acto === 'subvencion_ayuda') m.push('ayudas');
  if (p.seccion === '2B' || RE.oposiciones.test(t)) m.push('oposiciones');
  if (RE.tributos.test(t) && !RE.tributosExcl.test(t)) m.push('impuestos');
  if (RE.automocion.test(t) && !RE.automocionExcl.test(t)) m.push('automocion');
  if (p.seccion === '5A' && RE.sensibles.test(t) && !RE.sensExcl.some((r) => r.test(t))) m.push('contrato_sensible');
  return m;
}

const sinVacios = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));

/**
 * Prepara lo que recibe Claude. De las restringidas solo van título y metadatos (nunca resumen ni temas),
 * aunque la consulta los trajera: lo mismo que deja ver _ficha().
 */
export function clasificar(pubs) {
  const descartes = {};
  const candidatos = [];
  const apartados = Object.fromEntries(APARTADOS.map((a) => [a, []]));
  const sensibles = [];
  for (const p of pubs) {
    const motivo = motivoDescarte(p);
    if (motivo) { descartes[motivo] = (descartes[motivo] ?? 0) + 1; continue; }
    const m = marcas(p);
    for (const a of APARTADOS) if (m.includes(a)) apartados[a].push(p.id);
    if (m.includes('contrato_sensible')) sensibles.push(p.id);
    const publica = p.nivel_privacidad === 'publico';
    candidatos.push(sinVacios({
      id: p.id,
      seccion: p.seccion,
      organismo: p.departamento,
      epigrafe: p.epigrafe,
      rango: p.rango,
      titulo: p.titulo,
      resumen: publica ? p.resumen : null,
      tipo: publica ? p.tipo_acto : null,
      temas: publica ? p.temas : null,
      datos_personales: publica ? null : true,
      marcas: m,
    }));
  }
  return { candidatos, apartados, sensibles, descartes, total: pubs.length };
}

// ───────────── Petición a Claude ─────────────

const TEXTO = { type: 'string' };
const IDS = { type: 'array', items: { type: 'string' } };
export const ESQUEMA_RESUMEN = {
  type: 'object',
  properties: {
    titulares: {
      type: 'array',
      items: { type: 'object', properties: { tema: TEXTO, texto: TEXTO, ids: IDS }, required: ['tema', 'texto', 'ids'], additionalProperties: false },
    },
    secciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: TEXTO,
          bloques: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ids: IDS, titulo: TEXTO, resumen: TEXTO, por_que_importa: { type: ['string', 'null'] } },
              required: ['ids', 'titulo', 'resumen', 'por_que_importa'],
              additionalProperties: false,
            },
          },
          lineas: {
            type: 'array',
            items: { type: 'object', properties: { tema: TEXTO, texto: TEXTO, ids: IDS }, required: ['tema', 'texto', 'ids'], additionalProperties: false },
          },
        },
        required: ['titulo', 'bloques', 'lineas'],
        additionalProperties: false,
      },
    },
    apartados: {
      type: 'object',
      properties: Object.fromEntries(APARTADOS.map((a) => [a, {
        type: 'array',
        items: { type: 'object', properties: { id: TEXTO, texto: TEXTO }, required: ['id', 'texto'], additionalProperties: false },
      }])),
      required: APARTADOS,
      additionalProperties: false,
    },
  },
  required: ['titulares', 'secciones', 'apartados'],
  additionalProperties: false,
};

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function fechaLarga(f) {
  const d = new Date(`${f}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function construirPeticionResumen(instrucciones, fecha, c, { modelo = MODELO_RESUMEN } = {}) {
  const datos = {
    fecha,
    dia: fechaLarga(fecha),
    publicaciones_del_dia: c.total,
    descartadas_por_rutina: c.descartes,
    apartados: c.apartados,
    contratos_sensibles: c.sensibles,
    publicaciones: c.candidatos,
  };
  return {
    model: modelo,
    max_tokens: 24000,
    system: instrucciones,
    messages: [{ role: 'user', content: JSON.stringify(datos) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA_RESUMEN } },
    // Si Claude declina por sus filtros de seguridad, la API repite la petición con el modelo de reserva.
    fallbacks: 'default',
  };
}

/** Tokens de entrada aproximados (≈3,5 caracteres por token), para el tope de coste antes de llamar. */
export const tokensAproximados = (peticion) => Math.ceil((peticion.system.length + peticion.messages[0].content.length) / 3.5);

/**
 * Llama a Claude y devuelve { salida, uso, coste, modelo }. Lanza si se niega, se corta o no devuelve JSON:
 * un resumen a medias no se guarda.
 */
export async function pedirResumen(peticion, { claveApi, fetchFn, esperas = [5000, 20000] } = {}) {
  const r = await llamar(peticion, {
    claveApi, fetchFn, esperas, timeoutMs: 600_000,
    cabeceras: { 'anthropic-beta': 'server-side-fallback-2026-07-01' },
  });
  const uso = r.usage ?? {};
  const coste = costeResumenUSD(uso);
  if (r.stop_reason === 'refusal') throw Object.assign(new Error('el modelo rechazó la petición'), { uso, coste });
  if (r.stop_reason === 'max_tokens') throw Object.assign(new Error('respuesta cortada por longitud'), { uso, coste });
  const texto = (r.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let salida;
  try {
    salida = JSON.parse(texto);
  } catch {
    throw Object.assign(new Error('la salida no es JSON'), { uso, coste });
  }
  return { salida, uso, coste, modelo: r.model ?? peticion.model };
}

// ───────────── Validación de la salida ─────────────

const RE_URL = /https?:\/\/|www\.|<\/?[a-z][^>]*>/i;
// DNI/NIE completos o enmascarados como los publica el BOE (***1234**).
const RE_DNI = /\b\d{8}[A-HJ-NP-TV-Z]\b|\b[XYZ]\d{7}[A-Z]\b|\*{2,}\d{3,}\**/i;

/**
 * Deja solo lo que la web puede pintar con seguridad:
 * - ids que existen entre las publicaciones enviadas (los demás se quitan con aviso);
 * - ningún texto con URL, HTML o DNI (se quita la pieza entera con aviso);
 * - en los apartados, cada publicación marcada aparece aunque Claude la omita (sin texto: la web pone el título).
 * @returns {{ contenido, avisos: string[] }}
 */
export function depurar(salida, c) {
  const avisos = [];
  const validos = new Set(c.candidatos.map((p) => p.id));
  const limpio = (s) => (typeof s === 'string' ? s.trim() : '');
  const textoMalo = (...ts) => ts.some((t) => RE_URL.test(t) || RE_DNI.test(t));
  const filtrarIds = (ids, donde) => {
    const ok = [...new Set((ids ?? []).filter((id) => validos.has(id)))];
    for (const id of ids ?? []) if (!validos.has(id)) avisos.push(`${donde}: id desconocido ${id}`);
    return ok;
  };

  const titulares = [];
  for (const t of salida?.titulares ?? []) {
    const tema = limpio(t.tema), texto = limpio(t.texto);
    if (!texto) continue;
    if (textoMalo(tema, texto)) { avisos.push(`titular descartado (URL, HTML o DNI): ${tema}`); continue; }
    const ids = filtrarIds(t.ids, 'titular');
    if (!ids.length) { avisos.push(`titular sin publicaciones válidas: ${tema}`); continue; }
    titulares.push({ tema, texto, ids });
  }

  const secciones = [];
  for (const s of salida?.secciones ?? []) {
    const titulo = limpio(s.titulo);
    const bloques = [];
    for (const b of s.bloques ?? []) {
      const bt = limpio(b.titulo), br = limpio(b.resumen), bp = limpio(b.por_que_importa);
      if (!bt || !br) continue;
      if (textoMalo(bt, br, bp)) { avisos.push(`bloque descartado (URL, HTML o DNI): ${bt}`); continue; }
      const ids = filtrarIds(b.ids, 'bloque');
      if (!ids.length) { avisos.push(`bloque sin publicaciones válidas: ${bt}`); continue; }
      bloques.push({ ids, titulo: bt, resumen: br, por_que_importa: bp || null });
    }
    const lineas = [];
    for (const l of s.lineas ?? []) {
      const tema = limpio(l.tema), texto = limpio(l.texto).replace(/[.:;]+$/, '');
      if (!texto) continue;
      if (textoMalo(tema, texto)) { avisos.push(`línea descartada (URL, HTML o DNI): ${tema}`); continue; }
      const ids = filtrarIds(l.ids, 'línea');
      if (!ids.length) { avisos.push(`línea sin publicaciones válidas: ${tema}`); continue; }
      lineas.push({ tema, texto, ids });
    }
    if (titulo && (bloques.length || lineas.length)) secciones.push({ titulo, bloques, lineas });
  }

  const apartados = {};
  for (const a of APARTADOS) {
    const vistos = new Set();
    const lista = [];
    for (const it of salida?.apartados?.[a] ?? []) {
      if (!validos.has(it.id)) { avisos.push(`apartado ${a}: id desconocido ${it.id}`); continue; }
      if (vistos.has(it.id)) continue;
      let texto = limpio(it.texto).replace(/[.:;]+$/, '');
      if (texto && textoMalo(texto)) { avisos.push(`apartado ${a}: texto descartado (URL, HTML o DNI) de ${it.id}`); texto = ''; }
      vistos.add(it.id);
      lista.push({ id: it.id, texto: texto || null });
    }
    for (const id of c.apartados[a] ?? []) {
      if (!vistos.has(id)) { vistos.add(id); lista.push({ id, texto: null }); }
    }
    apartados[a] = lista;
  }

  return {
    contenido: { titulares, secciones, apartados, descartadas_por_rutina: c.descartes },
    avisos,
  };
}
