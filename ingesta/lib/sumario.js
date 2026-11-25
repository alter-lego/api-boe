// Funciones puras para leer el sumario JSON del BOE. Sin red ni base de datos: así se prueban
// con muestras reales (ingesta/fixtures/).

const aLista = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

export function quitarTildes(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// ───────────── Niveles de privacidad (ver docs/niveles-privacidad.md) ─────────────

const SECCIONES_PUBLICAS = new Set(['1', '2A', '3', '5A', '5B', 'T']);
const SECCIONES_RESTRINGIDAS = new Set(['2B', '4', '5C']);

// En V.B el título decide: subastas, expropiaciones con afectados y trámites de títulos
// universitarios nombran a particulares. Medido con 897 títulos reales (no «notificación»,
// «requerimiento» ni «interesados»: no aparecen).
// Desde el 26/11/2026 también la «necesidad de ocupación» y la «relación de bienes y derechos afectados»:
// son listas de propietarios afectados por una obra (expropiación en la práctica). Si cambia esta lista,
// cambiar también la migración de reclasificación (20261126110000_restringir_ocupaciones.sql).
const V_B_RESTRINGIDA = [
  /subasta/,
  /expropiacion|levantamiento de actas/,
  /necesidad de (la )?ocupacion|bienes y derechos afectados/,
  /titulo universitario|extravio de(l)? titulo|duplicado de(l)? titulo|destruccion de titulo/,
];

/** @returns {'publico'|'restringido'} Una sección desconocida es restringida por prudencia. */
export function clasificarNivel(codigoSeccion, titulo) {
  const cod = String(codigoSeccion ?? '').toUpperCase();
  if (SECCIONES_RESTRINGIDAS.has(cod)) return 'restringido';
  if (!SECCIONES_PUBLICAS.has(cod)) return 'restringido';
  if (cod === '5B') {
    const t = quitarTildes(titulo);
    if (V_B_RESTRINGIDA.some((re) => re.test(t))) return 'restringido';
  }
  return 'publico';
}

// ───────────── Lectura del sumario ─────────────

/** «20261112» → «2026-11-12» */
export function fechaISO(aaaammdd) {
  const s = String(aaaammdd ?? '');
  if (!/^\d{8}$/.test(s)) throw new Error(`fecha no válida: ${aaaammdd}`);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Los diarios extraordinarios traen sección, departamento y epígrafe con su contenido envuelto
// en un campo `texto` (visto el 4/11/2026). Se aplana para leer los dos formatos igual.
const desenvolver = (o) =>
  o && typeof o.texto === 'object' && o.texto !== null && !Array.isArray(o.texto) ? { ...o, ...o.texto } : o;

function itemsDeDepartamento(depCrudo) {
  const dep = desenvolver(depCrudo);
  const salida = [];
  for (const it of aLista(dep.item)) salida.push({ item: it, epigrafe: null });
  for (const epCrudo of aLista(dep.epigrafe)) {
    const ep = desenvolver(epCrudo);
    for (const it of aLista(ep.item)) salida.push({ item: it, epigrafe: ep.nombre ?? null });
  }
  return salida;
}

/**
 * Convierte la respuesta JSON del sumario en diarios con sus publicaciones normalizadas.
 * Un día puede traer varios diarios: el ordinario y los extraordinarios.
 */
export function parsearSumario(json) {
  const sumario = json?.data?.sumario;
  if (!sumario) throw new Error('respuesta sin data.sumario');
  const fecha = fechaISO(sumario.metadatos?.fecha_publicacion);
  const diarios = [];

  for (const diario of aLista(sumario.diario)) {
    const cabecera = diario.sumario_diario ?? {};
    const publicaciones = [];

    for (const seccionCruda of aLista(diario.seccion)) {
      const seccion = desenvolver(seccionCruda);
      for (const depCrudo of aLista(seccion.departamento)) {
        const dep = desenvolver(depCrudo);
        for (const { item, epigrafe } of itemsDeDepartamento(dep)) {
          if (!item?.identificador) continue;
          publicaciones.push({
            id: item.identificador,
            boletin: 'BOE',
            fecha,
            seccion: String(seccion.codigo),
            seccion_nombre: seccion.nombre ?? null,
            departamento_codigo: dep.codigo ?? null,
            departamento: dep.nombre ?? null,
            epigrafe,
            titulo: item.titulo,
            url_html: item.url_html ?? null,
            url_pdf: item.url_pdf?.texto ?? null,
            url_xml: item.url_xml ?? null,
            nivel_privacidad: clasificarNivel(seccion.codigo, item.titulo),
          });
        }
      }
    }

    diarios.push({
      numero: String(diario.numero),
      identificador: cabecera.identificador ?? null,
      url_pdf: cabecera.url_pdf?.texto ?? null,
      publicaciones,
    });
  }

  return { fecha, diarios };
}

/** Resumen legible para el registro de la ingesta y la prueba en seco. */
export function resumir({ fecha, diarios }) {
  const publicaciones = diarios.flatMap((d) => d.publicaciones);
  const porNivel = { publico: 0, restringido: 0 };
  for (const p of publicaciones) porNivel[p.nivel_privacidad] += 1;
  return { fecha, diarios: diarios.length, total: publicaciones.length, ...porNivel };
}
