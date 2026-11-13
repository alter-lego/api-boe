# Niveles de privacidad por sección (BOE)

Decidido el 13/11/2026 tras analizar 18 sumarios reales. **Sustituye a la tabla del documento v2**, que trataba toda la sección V como restringida.

| Sección | Código API | Nivel | Notas |
| --- | --- | --- | --- |
| I. Disposiciones generales | `1` | público | |
| II.A Nombramientos y ceses | `2A` | público | cargos y actos oficiales |
| II.B Oposiciones y concursos | `2B` | **restringido** | listas de aspirantes con nombres |
| III. Otras disposiciones | `3` | público | incluye indultos si aparecen; sanciones: por revisar |
| IV. Administración de Justicia | `4` | **restringido** | edictos y comunicaciones judiciales |
| V.A Contratación del Sector Público | `5A` | público | contratos: organismos y empresas |
| V.B Otros anuncios oficiales | `5B` | público, con excepciones | ver abajo |
| V.C Anuncios particulares | `5C` | **restringido** | particulares y empresas |
| T.C. Tribunal Constitucional | `T` | público | decidido por el responsable del proyecto |
| Suplemento de notificaciones | — | excluido | no se ingiere |

## Excepciones de V.B (restringido por título)

Una publicación de `5B` pasa a restringida si su título (sin tildes ni mayúsculas) contiene:
`subasta`; `expropiacion` o `levantamiento de actas`; o un trámite de título universitario
(`titulo universitario`, `extravio de titulo`, `duplicado de titulo`, `destruccion de titulo`).
Medido con 897 títulos reales de V.B: las palabras «notificación», «requerimiento» e «interesados»
(la propuesta inicial) no aparecen ni una vez. V.B es sobre todo concesiones de aguas y portuarias,
juntas de comunidades de regantes, subastas de Hacienda y extractos de ayudas.
La lista es de partida: se ajusta con la revisión manual de una muestra de fichas antes de cargar el histórico.
Implementada en `ingesta/lib/sumario.js` (`clasificarNivel`) y cubierta por pruebas.

## Cifras medidas (17 sumarios reales, 3.665 publicaciones)

Públicas el 62 %. Por sección: 1→93, 2A→299, 2B→581, 3→538, 4→528, 5A→682, 5B→908, 5C→21, T→15.
Nota sobre T: los títulos de sus sentencias nombran a los recurrentes («Promovido por don…»);
el título es oficial y siempre se muestra, pero el resumen de la ficha no debe repetir esos nombres.

## Notas de implementación

- El nivel se decide en la ingesta por sección y título; la base lo refuerza con un trigger que vacía la ficha de cualquier restringida y con un índice de búsqueda que ignora su resumen.
- Las restringidas no se leen: de ellas solo se guardan los metadatos del sumario (sin descargar el XML).
- La regla para la IA sigue vigente en las fichas públicas: nombrar cargos públicos en actos oficiales y no nombrar a particulares.
- Pendiente: check en la base que impida `publico` fuera de las secciones permitidas (ver revisión de seguridad, punto 11).
