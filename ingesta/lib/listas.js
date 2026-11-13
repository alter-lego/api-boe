// Listas cerradas de las fichas (aprobadas el 13/11/2026). Fuente de verdad para el esquema y la
// validación; una prueba comprueba que skill/FICHA.md recoge exactamente estos valores.

export const FICHA_VERSION = 2;

export const TIPOS_ACTO = [
  'norma', 'modificacion_norma', 'correccion_errores', 'nombramiento', 'cese', 'destino_situacion',
  'convocatoria', 'subvencion_ayuda', 'convenio', 'contrato_licitacion', 'contrato_adjudicacion',
  'concesion_autorizacion', 'informacion_publica', 'sentencia_recurso', 'organizacion_estatutos',
  'indulto_sancion', 'convocatoria_reunion', 'otros',
];

export const TEMAS = [
  'vivienda', 'empleo_y_trabajo', 'seguridad_social_y_pensiones', 'sanidad', 'educacion_y_universidades',
  'ciencia_e_investigacion', 'cultura_y_patrimonio', 'deporte', 'medio_ambiente_y_agua', 'energia',
  'transporte_y_movilidad', 'agricultura_pesca_y_alimentacion', 'industria_y_comercio', 'turismo',
  'telecomunicaciones_y_digital', 'economia_y_hacienda', 'fiscalidad', 'contratacion_publica', 'justicia',
  'seguridad_y_defensa', 'inmigracion_y_extranjeria', 'empleo_publico_y_administracion',
  'politica_territorial_y_local', 'igualdad_y_derechos_sociales', 'consumo', 'exteriores_y_cooperacion',
  'instituciones_y_parlamento', 'memoria_democratica', 'otros',
];

/** Esquema de la salida estructurada (output_config.format). */
export const ESQUEMA_FICHA = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    temas: { type: 'array', items: { type: 'string', enum: TEMAS } },
    tipo_acto: { type: 'string', enum: TIPOS_ACTO },
    revisar: { type: 'boolean' },
    motivo_revision: { type: ['string', 'null'] },
    aviso_fuente: { type: ['string', 'null'] },
  },
  required: ['resumen', 'temas', 'tipo_acto', 'revisar', 'motivo_revision', 'aviso_fuente'],
  additionalProperties: false,
};

// Lo que pasa por un recorte o por la extracción no es un dato del acto ni un error de la fuente.
export const COMENTA_EXTRACCION = /\btexto (recibido|recortado)\b|\brecortad[oa]\b|no figuran? en el texto|\[…\]/i;

/** Un «aviso de la fuente» que solo habla del recorte no es un aviso: se descarta. */
export function limpiarAviso(ficha) {
  if (typeof ficha?.aviso_fuente === 'string' && /\brecortad[oa]\b|\[…\]/i.test(ficha.aviso_fuente)) {
    return { ...ficha, aviso_fuente: null };
  }
  return ficha;
}

/** Valida la ficha que devuelve el modelo. Lo que el esquema no puede exigir se exige aquí. */
export function validarFicha(f) {
  const errores = [];
  if (!f || typeof f !== 'object') return { ok: false, errores: ['no es un objeto'] };

  if (typeof f.resumen !== 'string' || f.resumen.trim().length < 10) errores.push('resumen vacío o demasiado corto');
  else if (f.resumen.length > 900) errores.push('resumen demasiado largo');
  else if (/https?:\/\/|www\./i.test(f.resumen)) errores.push('el resumen contiene una URL');
  else if (COMENTA_EXTRACCION.test(f.resumen)) errores.push('el resumen comenta la extracción del texto');

  if (!Array.isArray(f.temas) || f.temas.length < 1 || f.temas.length > 3) errores.push('temas debe tener de 1 a 3 valores');
  else if (f.temas.some((t) => !TEMAS.includes(t)) || new Set(f.temas).size !== f.temas.length) errores.push('temas fuera de la lista o repetidos');

  if (!TIPOS_ACTO.includes(f.tipo_acto)) errores.push('tipo_acto fuera de la lista');
  if (typeof f.revisar !== 'boolean') errores.push('revisar no es booleano');
  for (const campo of ['motivo_revision', 'aviso_fuente']) {
    if (f[campo] !== null && typeof f[campo] !== 'string') errores.push(`${campo} debe ser texto o null`);
  }
  return errores.length ? { ok: false, errores } : { ok: true, errores: [] };
}
