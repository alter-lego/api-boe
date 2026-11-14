// Nombres de la interfaz para los valores de la base (docs/fase5-web/etiquetas.md).

export const TEMAS: [string, string][] = [
  ['agricultura_pesca_y_alimentacion', 'Agricultura, pesca y alimentación'],
  ['ciencia_e_investigacion', 'Ciencia e investigación'],
  ['consumo', 'Consumo'],
  ['contratacion_publica', 'Contratación pública'],
  ['cultura_y_patrimonio', 'Cultura y patrimonio'],
  ['deporte', 'Deporte'],
  ['economia_y_hacienda', 'Economía y Hacienda'],
  ['educacion_y_universidades', 'Educación y universidades'],
  ['empleo_publico_y_administracion', 'Empleo público y Administración'],
  ['empleo_y_trabajo', 'Empleo y trabajo'],
  ['energia', 'Energía'],
  ['exteriores_y_cooperacion', 'Exteriores y cooperación'],
  ['igualdad_y_derechos_sociales', 'Igualdad y derechos sociales'],
  ['industria_y_comercio', 'Industria y comercio'],
  ['inmigracion_y_extranjeria', 'Inmigración y extranjería'],
  ['fiscalidad', 'Impuestos'],
  ['instituciones_y_parlamento', 'Instituciones y Parlamento'],
  ['justicia', 'Justicia'],
  ['medio_ambiente_y_agua', 'Medio ambiente y agua'],
  ['memoria_democratica', 'Memoria democrática'],
  ['politica_territorial_y_local', 'Política territorial y local'],
  ['sanidad', 'Sanidad'],
  ['seguridad_social_y_pensiones', 'Seguridad Social y pensiones'],
  ['seguridad_y_defensa', 'Seguridad y defensa'],
  ['telecomunicaciones_y_digital', 'Telecomunicaciones y digital'],
  ['transporte_y_movilidad', 'Transporte y movilidad'],
  ['turismo', 'Turismo'],
  ['vivienda', 'Vivienda'],
  ['otros', 'Otros'],
];

export const TIPOS: { grupo: string; items: [string, string][] }[] = [
  { grupo: 'Normas', items: [['norma', 'Ley o norma general'], ['modificacion_norma', 'Modificación o derogación de una norma'], ['correccion_errores', 'Corrección de errores']] },
  { grupo: 'Personal y empleo', items: [['nombramiento', 'Nombramiento'], ['cese', 'Cese'], ['destino_situacion', 'Destinos y situaciones del personal'], ['convocatoria', 'Convocatoria de empleo, becas o premios']] },
  { grupo: 'Dinero y contratos públicos', items: [['subvencion_ayuda', 'Subvenciones y ayudas'], ['convenio', 'Convenio'], ['contrato_licitacion', 'Licitación de contratos'], ['contrato_adjudicacion', 'Adjudicación de contratos'], ['concesion_autorizacion', 'Concesiones y autorizaciones']] },
  { grupo: 'Justicia y trámites', items: [['sentencia_recurso', 'Sentencias y recursos'], ['indulto_sancion', 'Indultos y sanciones'], ['informacion_publica', 'Información pública']] },
  { grupo: 'Organización', items: [['organizacion_estatutos', 'Estatutos y organización'], ['convocatoria_reunion', 'Convocatoria de juntas y asambleas']] },
  { grupo: '', items: [['otros', 'Otros']] },
];

export const SECCIONES: [string, string][] = [
  ['1', 'I · Disposiciones generales'],
  ['2A', 'II.A · Nombramientos y ceses'],
  ['2B', 'II.B · Oposiciones y concursos'],
  ['3', 'III · Otras disposiciones'],
  ['4', 'IV · Administración de Justicia'],
  ['5A', 'V.A · Contratación del sector público'],
  ['5B', 'V.B · Otros anuncios oficiales'],
  ['5C', 'V.C · Anuncios particulares'],
  ['T', 'T.C. · Tribunal Constitucional'],
];

const mapaTemas = new Map(TEMAS);
const mapaTipos = new Map(TIPOS.flatMap((g) => g.items));
const mapaSecciones = new Map(SECCIONES);

export const etiquetaTema = (v: string) => mapaTemas.get(v) ?? v;
export const etiquetaTipo = (v: string) => mapaTipos.get(v) ?? v;
export const etiquetaSeccion = (v: string) => mapaSecciones.get(v) ?? v;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function partes(f: string) {
  const [a, m, d] = f.split('-').map(Number);
  return { a, m, d };
}
export const fechaCorta = (f: string) => { const { a, m, d } = partes(f); return `${d} ${MESES[m - 1]} ${a}`; };
export const fechaLarga = (f: string) => { const { a, m, d } = partes(f); return `${d} de ${MESES_LARGOS[m - 1]} de ${a}`; };
export const fechaConDia = (f: string) => {
  const { a, m, d } = partes(f);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${fechaCorta(f)}`;
};
export const sumarDias = (f: string, n: number) => {
  const { a, m, d } = partes(f);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
export const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
export const horaMadrid = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()));
