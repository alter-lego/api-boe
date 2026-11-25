# Listas cerradas de las fichas (aprobadas; en uso con `FICHA_VERSION = 3`)

Salen de los 399 títulos públicos reales ya ingeridos (12 y 13/11/2026) y de lo que un periodista suele preguntar.
Claude Haiku solo puede elegir valores de estas listas (salida estructurada con `enum`); la ficha guarda además `ficha_version`.

## Tipo de acto (uno por publicación)

| Valor | Cuándo |
| --- | --- |
| `norma` | Ley, real decreto, orden u otra disposición de carácter general |
| `modificacion_norma` | Modifica, deroga o prorroga una norma anterior |
| `correccion_errores` | Corrección de errores de otra publicación |
| `nombramiento` | Nombra a una persona para un cargo o plaza |
| `cese` | Cese de un cargo |
| `destino_situacion` | Destinos, comisiones de servicio, jubilaciones, excedencias, libre designación |
| `convocatoria` | Convoca empleo, oposiciones, becas, premios o pruebas (no ayudas económicas) |
| `subvencion_ayuda` | Convoca, regula o concede subvenciones y ayudas, incluidos los extractos |
| `convenio` | Publica un convenio o una encomienda de gestión |
| `contrato_licitacion` | Anuncio de licitación de un contrato público |
| `contrato_adjudicacion` | Adjudicación o formalización de un contrato público |
| `concesion_autorizacion` | Concesiones y autorizaciones administrativas (aguas, puertos, minería, energía) |
| `informacion_publica` | Somete a información pública un proyecto, plan o expediente |
| `sentencia_recurso` | Sentencias, providencias, conflictos de competencia, emplazamientos por recursos |
| `organizacion_estatutos` | Estatutos, estructura orgánica, planes de estudios |
| `indulto_sancion` | Indultos y resoluciones sancionadoras |
| `convocatoria_reunion` | Convoca juntas o asambleas (comunidades de regantes, entidades) |
| `otros` | Cualquier otro; se usa poco |

## Temas (de 1 a 3 por publicación)

`vivienda`, `empleo_y_trabajo`, `seguridad_social_y_pensiones`, `sanidad`, `educacion_y_universidades`,
`ciencia_e_investigacion`, `cultura_y_patrimonio`, `deporte`, `medio_ambiente_y_agua`, `energia`,
`transporte_y_movilidad`, `agricultura_pesca_y_alimentacion`, `industria_y_comercio`, `turismo`,
`telecomunicaciones_y_digital`, `economia_y_hacienda`, `fiscalidad`, `contratacion_publica`, `justicia`,
`seguridad_y_defensa`, `inmigracion_y_extranjeria`, `empleo_publico_y_administracion`,
`politica_territorial_y_local`, `igualdad_y_derechos_sociales`, `consumo`, `exteriores_y_cooperacion`,
`instituciones_y_parlamento`, `memoria_democratica`, `otros`.

Las listas en uso viven en `ingesta/lib/listas.js`; las etiquetas que ve la interfaz, en `docs/fase5-web/etiquetas.md`.

## Reglas para el resumen (resumen histórico; las vigentes están en `skill/FICHA.md`)

- 2–3 líneas, en castellano claro, solo con lo que dice el texto oficial; nada de valoraciones.
- Cargos públicos en actos oficiales sí se nombran; particulares no (incluidas las partes de sentencias).
- Importes, plazos y fechas clave, si están y caben.
- Si el texto no permite resumir con seguridad, la ficha se marca para revisión en lugar de inventar.
