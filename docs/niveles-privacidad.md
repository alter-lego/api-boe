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

> Los títulos nobiliarios (sucesión, rehabilitación) son públicos: no son excepción.

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
el título es oficial y siempre se muestra, y el resumen puede nombrarlos (decisión del 13/11/2026).

## Notas de implementación

- El nivel se decide en la ingesta por sección y título; la base lo refuerza con un trigger que vacía la ficha de cualquier restringida y con un índice de búsqueda que ignora su resumen.
- **Búsqueda de nombres (decisión del 13/11/2026):** se guarda un índice de búsqueda (solo lexemas, no el texto) del cuerpo de TODAS las publicaciones, públicas y restringidas. Así un nombre que solo está en el cuerpo se encuentra, y de una restringida solo se muestra título, metadatos y enlace al BOE. No se genera ficha de las restringidas. Endurecido en la migración 8 tras la revisión de seguridad: el índice de las restringidas se guarda sin posiciones (las frases entre comillas se tratan como «y»: no se puede reconstruir el texto palabra a palabra) y sin números de 3 o más cifras (DNI enmascarados, números de edicto); la relevancia solo usa título y resumen; se rechazan búsquedas solo con exclusiones. Riesgo asumido que queda: probando palabras sueltas se puede deducir si una restringida contiene una palabra; aceptable con 20 periodistas identificados, y el texto íntegro es público en boe.es. Pendiente de valorar por el responsable (RGPD): finalidad, plazo de conservación y supresión del índice de nombres, sobre todo del histórico.
- Los resúmenes pueden nombrar a quien figure con nombre en el **título oficial**; los títulos nobiliarios son públicos.
- Regla para la IA en las fichas públicas: se nombra a quien figure en el título oficial y a los cargos públicos; no a personas físicas que solo aparecen en el cuerpo del texto. Nunca DNI/NIF de personas físicas.
- Pendiente: check en la base que impida `publico` fuera de las secciones permitidas (ver revisión de seguridad, punto 11).
