// POST /v1/preguntar — preguntas en lenguaje natural sobre el BOE, respondidas por Claude con herramientas.
//
// Reglas del diseño (Claude devuelve JSON, el código renderiza):
//  - El límite diario se RESERVA antes de llamar a Claude (reservar_consulta, atómico en la base de datos).
//  - Las herramientas llaman a las mismas funciones SQL que el buscador, con la sesión del periodista: la
//    privacidad (restringidas = solo título y enlace) la impone la base de datos, no este código.
//  - Claude nunca escribe enlaces: cada cita se valida contra lo que devolvieron las herramientas y los
//    enlaces oficiales los pone el código a partir de lo guardado.
//  - El contenido de las publicaciones es dato no fiable: se entrega a Claude como JSON y las instrucciones
//    (skill/SKILL.md) le dicen que lo ignore como orden.

import { z } from 'zod';
import { TEMAS, TIPOS_ACTO } from '../../ingesta/lib/listas.js';
import { leerDocumento, recortarTexto } from '../../ingesta/lib/xml-boe.js';
import { quitarDatosPersonales, quitarEnlaces } from '../../ingesta/lib/sanear.js';

export { quitarDatosPersonales };
import { ErrorApi, rpc, filtros, paramsFiltros, AGRUPAR_SQL } from './comun.js';

const URL_API = 'https://api.anthropic.com/v1/messages';
export const MAX_RONDAS = 3;
const MAX_LLAMADAS_POR_RONDA = 4;
const MODELO_POR_DEFECTO = 'claude-haiku-5-5';
// Bytes del XML que se descargan y procesan. El plan gratuito de Cloudflare Workers corta a los 10 ms de CPU, y
// procesar 1,5 MB costaba 13-16 ms (auditoría del 26/11/2026). Con 300 KB cabe con margen; de los documentos más
// largos Claude recibe solo el principio, avisado. RESTRICCIÓN DEL PILOTO: cuando el proyecto pase a la nube
// interna (o a un plan de Workers de pago, 30 s de CPU), subir el tope (p. ej. a 5 MB) para leer también el final.
const TOPE_XML = 300_000;

/**
 * Lee el cuerpo como flujo y se detiene al llegar al tope (no se descarga ni se procesa un XML enorme).
 * @returns {Promise<{ xml: string, cortado: boolean }>}
 */
async function leerLimitado(res, tope) {
  const lector = res.body?.getReader();
  if (!lector) { const t = await res.text(); return { xml: t.slice(0, tope), cortado: t.length > tope }; }
  const trozos = [];
  let total = 0;
  let cortado = false;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    total += value.byteLength;
    if (total >= tope) { cortado = true; await lector.cancel().catch(() => {}); break; }
  }
  const todo = new Uint8Array(Math.min(total, tope));
  let pos = 0;
  for (const t of trozos) { const parte = t.subarray(0, todo.length - pos); todo.set(parte, pos); pos += parte.length; if (pos >= todo.length) break; }
  return { xml: new TextDecoder().decode(todo), cortado };
}
// USD por millón de tokens. Solo se conocen los de Haiku 5.5: con otro modelo el coste es una ESTIMACIÓN.
const PRECIOS = { entrada: 0.10, salida: 0.50, lectura_cache: 0.01, escritura_cache: 0.125 };

export const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    citas: { type: 'array', items: { type: 'string' } },
    sin_resultados: { type: 'boolean' },
  },
  required: ['respuesta', 'citas', 'sin_resultados'],
  additionalProperties: false,
};

// ───────── Herramientas ─────────
const props = {
  q: { type: 'string', description: 'Palabras a buscar (nombres, entidades, términos del BOE). Admite comillas y -exclusión.' },
  desde: { type: 'string', description: 'Fecha mínima AAAA-MM-DD' },
  hasta: { type: 'string', description: 'Fecha máxima AAAA-MM-DD' },
  seccion: { type: 'string', enum: ['1', '2A', '2B', '3', '4', '5A', '5B', '5C', 'T'] },
  organismo: { type: 'string', description: 'Ministerio u organismo (fragmento del nombre)' },
  tema: { type: 'array', items: { type: 'string', enum: TEMAS }, description: 'Hasta 5 temas' },
  tipo: { type: 'string', enum: TIPOS_ACTO },
  rango: { type: 'string', description: 'Tipo de norma: Resolución, Orden, Real Decreto, Real Decreto-ley, Acuerdo, Sentencia, Providencia' },
};

export const HERRAMIENTAS = [
  {
    name: 'buscar_publicaciones',
    description: 'Busca publicaciones del BOE por palabras y filtros. Devuelve hasta 20, con título, organismo, fecha, resumen (solo las públicas) y avisos de vigencia. Los más relevantes primero.',
    input_schema: { type: 'object', properties: { ...props, limite: { type: 'integer', description: 'Máximo de resultados (1-20, por defecto 10)' } }, additionalProperties: false },
  },
  {
    name: 'contar_publicaciones',
    description: 'Cuenta publicaciones con los mismos filtros, agrupadas por mes, organismo o tipo. Úsala siempre en preguntas de cantidad.',
    input_schema: { type: 'object', properties: { ...props, agrupar: { type: 'string', enum: ['total', 'mes', 'organismo', 'tipo'], description: 'Cómo agrupar el recuento (por defecto total)' } }, additionalProperties: false },
  },
  {
    name: 'leer_publicacion',
    description: 'Lee el texto oficial de UNA publicación pública (no restringida), para importes, plazos, adjudicatarios u otros detalles que el resumen no tenga. Devuelve un extracto de hasta ~11.000 caracteres.',
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Identificador, por ejemplo BOE-A-2026-12345' } }, required: ['id'], additionalProperties: false },
  },
];

const { tema: _t, ...baseFiltros } = filtros;
const temas = z.array(z.enum(TEMAS)).max(5).optional();
const entradaBuscar = z.object({ ...baseFiltros, tema: temas, limite: z.number().int().min(1).max(20).default(10) });
const entradaContar = z.object({ ...baseFiltros, tema: temas, agrupar: z.enum(['total', 'mes', 'organismo', 'tipo']).default('total') });
const entradaLeer = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{3,60}$/) });

const sinVacios = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)));

// DNI, NIE y máscaras: quitarDatosPersonales (ingesta/lib/sanear.js, común con la ingesta), también en el texto
// que se entrega a Claude (defensa en profundidad).

const esBoe = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'www.boe.es' || x.hostname === 'boe.es'); } catch { return false; } };

function vigencia(f) {
  const avisos = [];
  if (f.estatus_derogacion && f.estatus_derogacion !== 'N') avisos.push('puede estar derogada o modificada');
  if (f.judicialmente_anulada) avisos.push('anulada judicialmente');
  if (f.vigencia_agotada) avisos.push('vigencia agotada');
  return avisos;
}

/** Lo que ve Claude de una ficha: lo imprescindible (menos tokens) y marcado como dato. */
function paraClaude(f) {
  const base = { id: f.id, fecha: f.fecha, seccion: f.seccion, organismo: f.departamento, titulo: f.titulo, rango: f.rango ?? undefined };
  if (f.nivel_privacidad !== 'publico') return { ...base, restringida: true, nota: 'Solo se conoce el título; no hay resumen ni texto.' };
  const av = vigencia(f);
  return {
    ...base,
    tipo: f.tipo_acto ?? undefined,
    temas: f.temas ?? undefined,
    resumen: f.resumen ? String(f.resumen).slice(0, 500) : 'Sin resumen disponible.',
    avisos: av.length ? av : undefined,
    aviso_fuente: f.aviso_fuente ?? undefined,
  };
}

async function ejecutarHerramienta(nombre, bruto, ctx) {
  const { env, jwt, fetchFn, vistos } = ctx;
  const opciones = { jwt, fetchFn };
  if (nombre === 'buscar_publicaciones') {
    const e = entradaBuscar.parse(sinVacios(bruto));
    const filas = await rpc(env, 'buscar_publicaciones', { ...paramsFiltros(e), p_limite: e.limite }, opciones);
    for (const f of filas) vistos.set(f.id, f);
    return { n: filas.length, publicaciones: filas.map(paraClaude) };
  }
  if (nombre === 'contar_publicaciones') {
    const e = entradaContar.parse(sinVacios(bruto));
    const grupos = await rpc(env, 'contar_publicaciones', { ...paramsFiltros(e), p_agrupar: AGRUPAR_SQL[e.agrupar] }, opciones);
    return { agrupar: e.agrupar, grupos: grupos.slice(0, 60), nota: grupos.length > 60 ? 'Recuento recortado a 60 grupos.' : undefined };
  }
  if (nombre === 'leer_publicacion') {
    const { id } = entradaLeer.parse(sinVacios(bruto));
    const filas = await rpc(env, 'publicacion', { p_id: id }, opciones);
    if (!filas.length) return { error: 'No existe una publicación con ese identificador.' };
    const f = filas[0];
    vistos.set(f.id, f);
    if (f.nivel_privacidad !== 'publico') return { id: f.id, titulo: f.titulo, error: 'Publicación restringida: solo se puede mostrar el título y el enlace; no se puede leer su texto.' };
    if (!esBoe(f.url_xml)) return { id: f.id, error: 'No hay texto oficial disponible.' };
    let xml;
    let cortado;
    try {
      const res = await fetchFn(f.url_xml, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (res.url && !esBoe(res.url)) throw new Error('redirección a otro dominio');
      ({ xml, cortado } = await leerLimitado(res, TOPE_XML));
    } catch {
      return { id: f.id, error: 'No se pudo descargar el texto oficial ahora mismo.' };
    }
    let completo;
    try { completo = leerDocumento(xml).texto; } catch { completo = ''; }
    // Sin texto no se le dice a Claude «aquí está todo»: podría concluir que algo «no figura» (auditoría, 2.4).
    if (!completo) return { id: f.id, titulo: f.titulo, error: 'No se ha podido extraer el texto de esta publicación. No saques conclusiones sobre su contenido: remite al enlace del BOE.' };
    if (cortado) {
      // Documento más largo que el tope: solo tenemos el principio. El final (disposiciones finales, entrada en
      // vigor, firma) no se ha leído, así que no se da por completo ni se ofrece un «final» que no lo es.
      const { texto } = recortarTexto(completo, { inicio: 9000, fin: 0 });
      return {
        id: f.id, titulo: f.titulo, texto: quitarDatosPersonales(texto.replace(/\n\[…\]\n?$/, '')), extracto_recortado: true,
        aviso: 'Documento muy largo: solo se ha leído el principio. Lo que no aparezca aquí (por ejemplo, el final, la entrada en vigor o la firma) puede estar en el BOE: no digas que no figura; remite al enlace.',
      };
    }
    const { texto, recortado } = recortarTexto(completo, { inicio: 9000, fin: 2000 });
    return { id: f.id, titulo: f.titulo, texto: quitarDatosPersonales(texto), extracto_recortado: recortado };
  }
  throw new Error('herramienta desconocida');
}

// ───────── Claude ─────────
export function costeUSD(uso = {}) {
  const t = (n) => (n ?? 0) / 1e6;
  return t(uso.input_tokens) * PRECIOS.entrada + t(uso.output_tokens) * PRECIOS.salida
    + t(uso.cache_read_input_tokens) * PRECIOS.lectura_cache + t(uso.cache_creation_input_tokens) * PRECIOS.escritura_cache;
}

async function llamarClaude(env, peticion, { fetchFn, esperar }) {
  for (let intento = 0; intento < 2; intento++) {
    let res;
    try {
      res = await fetchFn(URL_API, {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(peticion),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (intento === 0) { await esperar(1500); continue; }
      throw new ErrorApi(504, 'el asistente tardó demasiado en responder; inténtalo de nuevo');
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && intento === 0) { await esperar(1500); continue; }
    console.error('anthropic:', res.status);
    if (res.status === 401 || res.status === 403) throw new ErrorApi(503, 'el asistente no está configurado correctamente');
    throw new ErrorApi(503, 'el asistente no está disponible ahora mismo; inténtalo en unos minutos');
  }
  throw new ErrorApi(503, 'el asistente no está disponible ahora mismo; inténtalo en unos minutos');
}

const ID_BOE = /\bBOE-[A-Z]-\d{4}-\d+\b/gi;   // también en minúsculas: se normaliza y se comprueba igual

/** Limpia el texto de Claude: sin enlaces y sin identificadores que no salieron de las herramientas. */
export function limpiarRespuesta(texto, vistos) {
  // Enlaces y datos personales con el saneado común (sanear.js): dominios sin esquema, «hxxps», «[.]», DNI con letra
  // de control (sin comerse importes)…
  return quitarEnlaces(quitarDatosPersonales(String(texto ?? '')))
    .replace(ID_BOE, (id) => (vistos.has(id.toUpperCase()) ? id.toUpperCase() : '[referencia no verificada]'))
    .trim()
    .slice(0, 6000);
}

export function citaRenderizada(f) {
  return {
    id: f.id, titulo: f.titulo, fecha: f.fecha, organismo: f.departamento, seccion: f.seccion,
    nivel_privacidad: f.nivel_privacidad,
    url_html: esBoe(f.url_html) ? f.url_html : null,
    url_pdf: esBoe(f.url_pdf) ? f.url_pdf : null,
    avisos: f.nivel_privacidad === 'publico' ? vigencia(f) : undefined,
  };
}

/**
 * @returns {Promise<object>} respuesta lista para la web.
 */
export async function responderPregunta({ pregunta, jwt, env, fetchFn, esperar, instrucciones, ahora = new Date() }) {
  const modelo = env.MODELO_PREGUNTAR || MODELO_POR_DEFECTO;
  const ctx = { env, jwt, fetchFn, vistos: new Map() };

  // 0) Caché por periodista: la misma pregunta, el mismo día y sin ingesta nueva se sirve sin llamar a Claude ni gastar cupo.
  try {
    const [guardada] = await rpc(env, 'respuesta_guardada', { p_pregunta: pregunta }, { jwt, fetchFn });
    if (guardada?.respuesta && typeof guardada.respuesta === 'object') {
      return { ...guardada.respuesta, en_cache: true, preguntas_hoy: { usadas: guardada.usadas, limite: guardada.limite } };
    }
  } catch (e) {
    if (e instanceof ErrorApi && [401, 403].includes(e.estado)) throw e;   // sesión caducada o sin permiso
    console.error('respuesta_guardada:', e instanceof ErrorApi ? e.estado : String(e?.message ?? e).slice(0, 60));
  }

  // 1) Reserva atómica del sitio en el límite diario (si no hay, la base responde 429 y no se llama a Claude).
  const [reserva] = await rpc(env, 'reservar_consulta', { p_pregunta: pregunta }, { jwt, fetchFn });
  const ingesta = (await rpc(env, 'ultima_ingesta', {}, { fetchFn }).catch(() => []))[0] ?? null;

  const hoy = ahora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const mensaje = `Fecha de hoy: ${hoy} (Madrid). Datos disponibles: del ${env.COBERTURA_DESDE ?? 'inicio del archivo'} al ${ingesta?.fecha ?? 'última carga'}.\n\n<pregunta>\n${pregunta}\n</pregunta>`;
  const messages = [{ role: 'user', content: mensaje }];
  const uso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let rondas = 0;
  let final = null;
  let fallo = null;

  try {
    for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
      const ultima = ronda === MAX_RONDAS;
      const r = await llamarClaude(env, {
        model: modelo,
        max_tokens: 4000,
        system: [{ type: 'text', text: instrucciones, cache_control: { type: 'ephemeral' } }],
        tools: HERRAMIENTAS,
        tool_choice: { type: ultima ? 'none' : 'auto' },
        messages,
        output_config: { effort: env.ESFUERZO_PREGUNTAR || 'medium', format: { type: 'json_schema', schema: ESQUEMA_RESPUESTA } },
      }, { fetchFn, esperar });
      for (const k of Object.keys(uso)) uso[k] += r.usage?.[k] ?? 0;

      if (r.stop_reason === 'refusal') { fallo = 'el asistente rechazó la petición'; break; }
      if (r.stop_reason === 'max_tokens') { fallo = 'la respuesta salió demasiado larga'; break; }

      const llamadas = (r.content ?? []).filter((b) => b.type === 'tool_use');
      if (llamadas.length && !ultima) {
        rondas += 1;
        messages.push({ role: 'assistant', content: r.content });   // se devuelve tal cual (incluido el razonamiento)
        const resultados = [];
        for (const [i, l] of llamadas.entries()) {
          if (i >= MAX_LLAMADAS_POR_RONDA) { resultados.push({ type: 'tool_result', tool_use_id: l.id, is_error: true, content: 'Demasiadas llamadas en una ronda; no se ha ejecutado.' }); continue; }
          try {
            resultados.push({ type: 'tool_result', tool_use_id: l.id, content: JSON.stringify(await ejecutarHerramienta(l.name, l.input, ctx)) });
          } catch (e) {
            if (e instanceof ErrorApi && [401, 403, 429].includes(e.estado)) throw e;   // sesión caducada, sin permiso…
            const msg = e instanceof ErrorApi && e.estado === 504 ? 'La consulta tardó demasiado; acótala con más filtros (fechas, sección, organismo).'
              : e instanceof z.ZodError ? `Argumentos no válidos: ${e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ').slice(0, 300)}`
              : e instanceof ErrorApi ? e.message : 'La herramienta falló.';
            resultados.push({ type: 'tool_result', tool_use_id: l.id, is_error: true, content: msg });
          }
        }
        messages.push({ role: 'user', content: resultados });
        continue;
      }

      const texto = (r.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      try { final = z.object({ respuesta: z.string(), citas: z.array(z.string()), sin_resultados: z.boolean() }).parse(JSON.parse(texto)); }
      catch { fallo = 'la respuesta del asistente no tiene el formato esperado'; }
      break;
    }
  } catch (e) {
    // Falla algo tras reservar: la pregunta se da por gastada (es lo seguro) y se anota lo consumido.
    await completar(env, jwt, fetchFn, reserva, modelo, rondas, uso, [], true);
    throw e;
  }

  if (!final) {
    await completar(env, jwt, fetchFn, reserva, modelo, rondas, uso, [], true);
    throw new ErrorApi(502, `${fallo ?? 'no se pudo responder'}; inténtalo de nuevo con otra formulación`);
  }

  const { vistos } = ctx;
  if (rondas === 0) {
    // Claude contestó sin consultar el archivo: lo que diga no está respaldado, no se entrega (tampoco si se marca
    // «sin resultados»: así se colaba un texto sin respaldo, y quedaba en caché; auditoría, 2.3).
    await completar(env, jwt, fetchFn, reserva, modelo, rondas, uso, [], true);
    return {
      respuesta: 'No he consultado el archivo del BOE para responder a esto. Reformula la pregunta indicando qué publicaciones, organismos o fechas te interesan.',
      citas: [], sin_resultados: true, datos_hasta: ingesta?.fecha ?? null, datos_desde: env.COBERTURA_DESDE ?? null,
      preguntas_hoy: { usadas: reserva.usadas, limite: reserva.limite },
    };
  }
  const idsTexto = [...String(final.respuesta).matchAll(ID_BOE)].map((m) => m[0].toUpperCase());
  const citas = [...new Set([...final.citas, ...idsTexto])].filter((id) => vistos.has(id)).slice(0, 30);
  const respuesta = limpiarRespuesta(final.respuesta, vistos);
  await completar(env, jwt, fetchFn, reserva, modelo, rondas, uso, citas, final.sin_resultados);

  const cuerpo = {
    respuesta,
    citas: citas.map((id) => citaRenderizada(vistos.get(id))),
    sin_resultados: final.sin_resultados || (citas.length === 0 && !respuesta),
    datos_hasta: ingesta?.fecha ?? null,
    datos_desde: env.COBERTURA_DESDE ?? null,
  };
  await guardarRespuesta(env, jwt, fetchFn, reserva, cuerpo);
  return { ...cuerpo, preguntas_hoy: { usadas: reserva.usadas, limite: reserva.limite } };
}

// Guarda la respuesta para la caché (sin `preguntas_hoy`, que cambia). Si falla, la respuesta ya se entrega igual.
async function guardarRespuesta(env, jwt, fetchFn, reserva, cuerpo) {
  try {
    await rpc(env, 'guardar_respuesta', { p_id: reserva.id, p_token: reserva.token, p_respuesta: cuerpo }, { jwt, fetchFn });
  } catch (e) {
    console.error('guardar_respuesta:', e instanceof ErrorApi ? e.estado : String(e?.message ?? e).slice(0, 60));
  }
}

async function completar(env, jwt, fetchFn, reserva, modelo, rondas, uso, citas, sinResultados) {
  try {
    const ok = await rpc(env, 'completar_consulta', {
      p_id: reserva.id, p_token: reserva.token, p_modelo: modelo, p_rondas: rondas,
      p_tokens_entrada: uso.input_tokens + uso.cache_creation_input_tokens, p_tokens_salida: uso.output_tokens,
      p_tokens_cache: uso.cache_read_input_tokens, p_coste_usd: Number(costeUSD(uso).toFixed(5)),
      p_citas: citas, p_sin_resultados: sinResultados,
    }, { jwt, fetchFn });
    if (ok === false) console.error('completar_consulta: no se pudo completar (¿ya completada?)');
  } catch (e) {
    console.error('completar_consulta:', e instanceof ErrorApi ? e.estado : String(e?.message ?? e).slice(0, 60));
  }
}
