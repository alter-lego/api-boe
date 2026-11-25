// Datos de ejemplo para probar la web sin sesión ni API. NO son publicaciones reales.
import type { BusquedaPersona, Conteo, Ficha, Filtros, Respuesta, Salud, Sumario } from './types';
import { SECCIONES } from './labels';

const MIN_IMG = 'https://www.boe.es';
const base = (o: Partial<Ficha> & Pick<Ficha, 'id' | 'fecha' | 'titulo'>): Ficha => ({
  seccion: '3', seccion_nombre: 'III. Otras disposiciones', departamento_codigo: null, departamento: null, epigrafe: null,
  rango: null, url_html: `${MIN_IMG}/diario_boe/txt.php?id=${o.id}`, url_pdf: `${MIN_IMG}/boe/dias/${o.fecha.replaceAll('-', '/')}/pdfs/${o.id}.pdf`, url_xml: null,
  resumen: null, temas: null, tipo_acto: null, nivel_privacidad: 'publico', corrige_a: null, referencias: null,
  aviso_fuente: null, ficha_revisar: false, estatus_derogacion: 'N', judicialmente_anulada: false, vigencia_agotada: false, vigencia_actualizada: null,
  ...o,
});

const VIV = 'Ministerio de Vivienda y Agenda Urbana';
const HAC = 'Ministerio de Hacienda';
const JEF = 'Jefatura del Estado';
const SAN = 'Ministerio de Sanidad';

function dia(f: string, n: string): Ficha[] {
  return [
    base({ id: `BOE-A-2026-${n}01`, fecha: f, seccion: '1', seccion_nombre: 'I. Disposiciones generales', departamento: JEF, rango: 'Real Decreto-ley', tipo_acto: 'norma', temas: ['vivienda'],
      titulo: 'Real Decreto-ley 24/2026, de 10 de noviembre, de medidas urgentes en materia de vivienda.', ficha_revisar: true }),
    base({ id: `BOE-A-2026-${n}02`, fecha: f, seccion: '1', seccion_nombre: 'I. Disposiciones generales', departamento: VIV, rango: 'Orden', tipo_acto: 'modificacion_norma', temas: ['vivienda'],
      titulo: 'Orden VAU/1301/2026, de 4 de noviembre, por la que se modifican las bases reguladoras de las ayudas al alquiler.',
      resumen: 'Amplía a 35 años la edad máxima para pedir la ayuda y simplifica la documentación.' }),
    base({ id: `BOE-A-2026-${n}03`, fecha: f, seccion: '1', seccion_nombre: 'I. Disposiciones generales', departamento: VIV, rango: 'Orden', tipo_acto: 'correccion_errores', temas: ['vivienda'], corrige_a: 'BOE-A-2026-21877',
      titulo: 'Corrección de errores de la Orden VAU/1234/2026, de 20 de octubre, por la que se regulan las ayudas al alquiler joven.',
      resumen: 'Corrige un error en la tabla de cuantías de las ayudas al alquiler joven.' }),
    base({ id: `BOE-A-2026-${n}04`, fecha: f, seccion: '2A', seccion_nombre: 'II.A. Nombramientos y ceses', departamento: HAC, rango: 'Real Decreto', tipo_acto: 'nombramiento', temas: ['empleo_publico_y_administracion'],
      titulo: 'Real Decreto 1020/2026, de 10 de noviembre, por el que se nombra Director General de Tributos a un alto cargo del Ministerio de Hacienda.',
      resumen: 'Nombra a la persona que dirigirá la Dirección General de Tributos del Ministerio de Hacienda.' }),
    base({ id: `BOE-A-2026-${n}05`, fecha: f, seccion: '2B', seccion_nombre: 'II.B. Oposiciones y concursos', departamento: SAN, nivel_privacidad: 'restringido',
      titulo: 'Resolución de 5 de noviembre de 2026, de la Dirección General de Ordenación Profesional, por la que se aprueba la lista definitiva de aspirantes admitidos y excluidos.' }),
    base({ id: `BOE-A-2026-${n}06`, fecha: f, seccion: '3', departamento: VIV, rango: 'Resolución', tipo_acto: 'convenio', temas: ['vivienda'],
      titulo: 'Resolución de 5 de noviembre de 2026, de la Secretaría de Estado de Vivienda, por la que se publica el Convenio con la Comunidad de Madrid para el fomento del alquiler asequible.',
      resumen: 'Convenio para financiar viviendas de alquiler asequible en la región. Fija una aportación estatal de 18 millones de euros y un plazo de ejecución de cuatro años.' }),
    base({ id: `BOE-A-2026-${n}07`, fecha: f, seccion: '3', departamento: SAN, rango: 'Resolución', tipo_acto: 'subvencion_ayuda', temas: ['sanidad'],
      titulo: 'Extracto de la Resolución de 3 de noviembre de 2026, de la Secretaría de Estado de Sanidad, por la que se convocan ayudas para proyectos de investigación en salud pública.',
      resumen: 'Convoca ayudas para proyectos de investigación en salud pública. El plazo de solicitud es de veinte días hábiles.' }),
    base({ id: `BOE-A-2026-${n}08`, fecha: f, seccion: '4', seccion_nombre: 'IV. Administración de Justicia', nivel_privacidad: 'restringido', departamento: 'Administración de Justicia',
      titulo: 'Edicto del Juzgado de Primera Instancia número 12 de Valencia por el que se notifica sentencia.' }),
    base({ id: `BOE-A-2026-${n}09`, fecha: f, seccion: '5A', seccion_nombre: 'V.A. Contratación del Sector Público', departamento: SAN, tipo_acto: 'contrato_licitacion', temas: ['contratacion_publica', 'sanidad'],
      titulo: 'Anuncio de licitación de: Dirección General de Gestión Económica del Ministerio de Sanidad. Objeto: suministro de equipamiento para el Hospital Central de la Defensa.',
      resumen: 'Licita el suministro de equipamiento sanitario para un hospital militar. Presupuesto base de licitación de 2,4 millones de euros.' }),
    base({ id: `BOE-A-2026-${n}10`, fecha: f, seccion: '5A', seccion_nombre: 'V.A. Contratación del Sector Público', departamento: VIV, tipo_acto: 'contrato_adjudicacion', temas: ['contratacion_publica', 'vivienda'],
      titulo: 'Anuncio de formalización de contratos de: Dirección General de Vivienda y Suelo. Objeto: obras de rehabilitación de 120 viviendas.',
      resumen: 'Adjudica las obras de rehabilitación de 120 viviendas públicas por 7,9 millones de euros.' }),
    base({ id: `BOE-A-2026-${n}11`, fecha: f, seccion: '5B', seccion_nombre: 'V.B. Otros anuncios oficiales', departamento: HAC, nivel_privacidad: 'restringido',
      titulo: 'Anuncio de la Delegación de Economía y Hacienda por el que se convoca subasta pública de bienes inmuebles.' }),
    base({ id: `BOE-A-2026-${n}12`, fecha: f, seccion: '5B', seccion_nombre: 'V.B. Otros anuncios oficiales', departamento: JEF, tipo_acto: 'informacion_publica', temas: ['medio_ambiente_y_agua'],
      titulo: 'Anuncio de la Confederación Hidrográfica del Ebro por el que se somete a información pública la solicitud de concesión de aguas para riego.',
      resumen: 'Abre un periodo de información pública sobre una concesión de aguas para riego en la cuenca del Ebro.',
      estatus_derogacion: 'D', aviso_fuente: 'El texto oficial cita una fecha que no coincide con la de la resolución.' }),
  ];
}

export const DATOS: Ficha[] = [
  ...dia('2026-11-13', '223'),
  ...dia('2026-11-12', '222'),
  ...dia('2026-11-11', '221'),
  ...dia('2026-11-10', '220'),
];
export const ULTIMO_DIA = '2026-11-13';
let preguntasHoy = 2;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const espera = <T,>(v: T, ms = 350) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function filtrar(f: Filtros): Ficha[] {
  const palabras = sinTildes(f.q ?? '').split(/\s+/).filter((p) => p.length > 2 && !p.startsWith('-'));
  if (f.q && f.q.trim() && palabras.length === 0) throw Object.assign(new Error('La búsqueda no contiene palabras útiles; reformúlala con otros términos'), { status: 400 });
  return DATOS.filter((x) => {
    if (f.desde && x.fecha < f.desde) return false;
    if (f.hasta && x.fecha > f.hasta) return false;
    if (f.seccion && x.seccion !== f.seccion) return false;
    if (f.organismo && !sinTildes(x.departamento ?? '').includes(sinTildes(f.organismo))) return false;
    if (f.tema?.length && !(x.nivel_privacidad === 'publico' && x.temas?.some((t) => f.tema!.includes(t)))) return false;
    if (f.tipo && !(x.nivel_privacidad === 'publico' && x.tipo_acto === f.tipo)) return false;
    if (palabras.length) {
      const texto = sinTildes(`${x.titulo} ${x.resumen ?? ''}`);
      if (!palabras.every((p) => texto.includes(p))) return false;
    }
    return true;
  }).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}

export const mock = {
  health: (): Promise<Salud> => espera({ ok: true, ultima_ingesta: { fecha: ULTIMO_DIA, fin: `${ULTIMO_DIA}T07:40:00Z` } }, 150),
  buscar: (f: Filtros) => espera(filtrar(f).slice(0, 100)),
  conteos: (f: Filtros, agrupar: string): Promise<Conteo> => {
    const filas = filtrar(f);
    const clave = (x: Ficha) => agrupar === 'mes' ? x.fecha.slice(0, 7) : agrupar === 'organismo' ? x.departamento ?? '(sin organismo)' : agrupar === 'tipo' ? (x.nivel_privacidad === 'publico' && x.tipo_acto) || 'sin clasificar' : 'total';
    const m = new Map<string, number>();
    filas.forEach((x) => m.set(clave(x), (m.get(clave(x)) ?? 0) + 1));
    return espera({ agrupar, grupos: [...m.entries()].map(([grupo, n]) => ({ grupo, n })).sort((a, b) => b.n - a.n) });
  },
  // Simula «Buscar a una persona» con datos inventados. «zzz» → sin resultados; menos de 3 letras → 400.
  personas: (nombre: string): Promise<BusquedaPersona> => {
    const limpio = nombre.trim();
    if (sinTildes(limpio).replace(/[^a-z]/g, '').length < 3) return Promise.reject(Object.assign(new Error('escribe al menos un nombre o apellido de 3 letras o más'), { status: 400 }));
    if (sinTildes(limpio).includes('zzz')) return espera({ n: 0, totales: { titulo: 0, resumen: 0, seguido: 0, texto: 0 }, resultados: [] });
    const resultados = [
      { ...base({ id: 'BOE-A-2026-23901', fecha: '2026-11-12', departamento: 'Ministerio de Justicia', rango: 'Real Decreto', tipo_acto: 'indulto_sancion', temas: ['justicia'],
        titulo: `Real Decreto 1101/2026, de 10 de noviembre, por el que se indulta a don ${limpio} (ejemplo inventado).`,
        resumen: 'Indulta parcialmente la pena impuesta. Ejemplo inventado para probar la interfaz.' }), coincidencia: 'titulo' as const },
      { ...base({ id: 'BOE-A-2026-23655', fecha: '2026-10-30', seccion: '2A', seccion_nombre: 'II.A. Nombramientos y ceses', departamento: 'Ministerio de Hacienda', tipo_acto: 'nombramiento', temas: ['empleo_publico_y_administracion'],
        titulo: 'Orden HAC/1190/2026, de 27 de octubre, por la que se resuelve convocatoria de libre designación.',
        resumen: `Adjudica el puesto de subdirector general a ${limpio}. Ejemplo inventado.` }), coincidencia: 'resumen' as const },
      ...DATOS.filter((x) => x.nivel_privacidad === 'publico' && x.seccion === '3').slice(0, 1).map((x) => ({ ...x, coincidencia: 'seguido' as const })),
      ...DATOS.filter((x) => x.nivel_privacidad === 'restringido').slice(0, 3).map((x) => ({ ...x, coincidencia: 'texto' as const })),
    ];
    return espera({ n: resultados.length, totales: { titulo: 1, resumen: 1, seguido: 1, texto: 214 }, resultados });
  },
  publicacion: (id: string) => espera(DATOS.find((x) => x.id === id) ?? null),
  sumario: (fecha: string): Promise<Sumario> => {
    const del = DATOS.filter((x) => x.fecha === fecha);
    const secciones = SECCIONES.map(([s, nombre]) => ({ seccion: s, seccion_nombre: nombre, publicaciones: del.filter((x) => x.seccion === s) })).filter((s) => s.publicaciones.length);
    return espera({ fecha, total: del.length, secciones });
  },
  // Simula «Preguntar»: palabras clave para probar los casos (límite → 429, fallo → 502, nada/zzz → sin resultados).
  preguntar: async (pregunta: string): Promise<Respuesta> => {
    await espera(null, 2200);
    const t = sinTildes(pregunta);
    if (t.includes('limite')) throw Object.assign(new Error('Has alcanzado el límite de preguntas de hoy (30). Se restablece a las 00:00.'), { status: 429 });
    if (t.includes('fallo')) throw Object.assign(new Error(''), { status: 502 });
    if (t.includes('caducada')) throw Object.assign(new Error(''), { status: 401 });
    preguntasHoy += 1;
    const base = { datos_desde: '2026-08-13', datos_hasta: ULTIMO_DIA, preguntas_hoy: { usadas: preguntasHoy, limite: 30 } };
    if (t.includes('nada') || t.includes('zzz')) {
      return { ...base, respuesta: 'No he encontrado publicaciones que respondan a esto en el archivo. Prueba a reformular la pregunta o usa el buscador.', citas: [], sin_resultados: true };
    }
    const cita = (id: string) => { const x = DATOS.find((d) => d.id === id)!; return { id: x.id, titulo: x.titulo, fecha: x.fecha, organismo: x.departamento, seccion: x.seccion, nivel_privacidad: x.nivel_privacidad, url_html: x.url_html, url_pdf: x.url_pdf, avisos: x.id.endsWith('12') ? ['puede estar derogada o modificada'] : [] }; };
    return {
      ...base,
      respuesta: 'Esta semana se han publicado dos disposiciones sobre ayudas al alquiler: una orden que modifica las bases reguladoras [BOE-A-2026-22302] y la corrección de errores de la orden anterior [BOE-A-2026-22303]. Además, un convenio con la Comunidad de Madrid fija 18 millones para alquiler asequible [BOE-A-2026-22306]. Una referencia que el sistema no pudo comprobar: [referencia no verificada].',
      citas: [cita('BOE-A-2026-22302'), cita('BOE-A-2026-22303'), cita('BOE-A-2026-22306')],
      sin_resultados: false,
    };
  },
};
