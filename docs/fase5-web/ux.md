# Fase 5 · UX de la web del Buscador del BOE (spec v2, tras revisar las maquetas)

Base para construir la web con Code. Las maquetas de baja fidelidad están en el lienzo de Claude Design «Maquetas Buscador del BOE» (7 pantallas) y mandan en caso de duda visual. El design system es «Buscador del BOE» (tokens, logo). Datos reales: `contrato-datos.md`. Dudas y dependencias: `preguntas-abiertas.md`.

## 0. Decisiones tomadas al revisar las maquetas (13/11/2026)
- **Lenguaje de periodista, sin jerga de la aplicación.** Nunca se ven «ficha», «restringida», «metadatos», «tipo de acto», «departamento» ni códigos de error. Las notas de diseño de las maquetas (cuadros punteados en cursiva) no forman parte de la interfaz.
- **Vocabulario**:
  | En los datos | En la interfaz |
  | --- | --- |
  | `departamento` | **Organismo** (ministerio, comunidad autónoma, institución…) |
  | `tipo_acto` | **Tipo de publicación** |
  | resumen de la IA | **Generado con IA** |
  | `nivel_privacidad = restringido` | anuncio de una sección con datos personales: «Sin resumen» |
  | sumario del día | **Resumen de hoy** (pestaña) y «Sumario del día» (pantalla) |
- **Cabecera**: logo de elDiario.es sin lema (SVG a color; blanco en tema oscuro), unos 40 px; pestañas **Buscar** y **Resumen de hoy**; sesión. **Sin pestaña «Preguntar»** hasta que exista la Fase 4.
- **Sin XML**: solo «BOE (HTML)» y «PDF».
- **Filtros en un menú desplegable «Filtros (n)»** bajo la caja de búsqueda; no hay listas largas a la vista. La portada enseña «Ejemplos de búsquedas que puedes hacer».
- **Tipo de publicación**: un desplegable con 18 opciones en 5 grupos (§5.2). **Tema**: texto informativo en la tarjeta, no pulsable.
- **Errores técnicos**: la persona no ve detalles; se avisa automáticamente a quien mantiene la herramienta (pendiente de construir).

## 1. Usuarios y principios
- ~20 periodistas identificados (tabla `periodistas`), acceso por magic link. Nadie más entra.
- Uso típico: mirar qué ha salido hoy, buscar un tema/organismo/tipo de publicación en un periodo, abrir el BOE oficial para citar.
- Principios: escritorio primero, móvil bien resuelto; sobrio; el enlace al BOE siempre visible; nunca ocultar que un resumen es generado con IA; accesible (teclado, contraste, lector de pantalla); español, tuteo.

## 2. Búsquedas de ejemplo (portada, estado vacío y pruebas)
1. Vivienda, última semana → tema + desde/hasta.
2. Lo publicado hoy por un ministerio → organismo + fecha.
3. Subvenciones y ayudas de la última semana, por organismo → tipo de publicación + desglose por organismo.
4. Contratación pública sobre «hospital» en un periodo → tipo (licitación/adjudicación) + texto libre + desglose por mes.

## 3. Mapa de pantallas
| Ruta | Pantalla | Función |
| --- | --- | --- |
| `/entrar` | Login | Magic link (sesión aparte) |
| `/` | Inicio | Buscador + «BOE de hoy» |
| `/buscar?...` | Resultados | Lista con filtros y recuento |
| `/publicacion/:id` | Detalle | Título oficial, resumen, enlaces |
| `/dia/:fecha` | Sumario del día | Publicaciones de una fecha por sección |
| `/preguntar` | Preguntar al BOE | Reservada (Fase 4); no visible en el MVP |
Cabecera fija: logo, pestañas «Buscar · Resumen de hoy», sesión (correo, salir). Línea de frescura bajo la cabecera.

## 4. Flujos
**Entrada.** Correo → «Te hemos enviado un enlace» → abre el enlace → `/`. Correo fuera de la lista: ver §6.1 y la sesión de login.
**Ver el día.** `/` muestra «BOE de hoy» (último día cargado, de `GET /v1/health`) con recuento por sección (sale del sumario del día, que la API ya devuelve agrupado por sección) y botón «Ver sumario completo».
**Buscar.** Texto y/o filtros → Buscar (o Intro) → resultados con total. Los filtros activos se ven como chips quitables y viven en la URL (compartible, vuelve atrás).
**Detalle.** Desde una tarjeta → título oficial, datos, resumen (si lo hay), enlaces, copiar cita.
**Preguntar.** No visible en el MVP; maqueta en §7.

## 5. Pantallas

### 5.1 Inicio
Escritorio: a la izquierda caja de búsqueda grande con botón «Filtros ▾» y «Buscar», y debajo «Ejemplos de búsquedas que puedes hacer» (los 4 ejemplos como lista de texto plano: no son botones ni enlaces y no lanzan ninguna búsqueda); a la derecha «BOE de hoy»: fecha, nº de publicaciones, recuento por sección (I, II.A, II.B, III, IV, V.A, V.B, V.C y T.C.) y «Ver sumario completo». Móvil: buscador arriba y debajo una tarjeta «BOE de hoy» reducida (fecha, total de publicaciones y «Ver sumario completo»), sin el recuento por sección.

### 5.2 Buscador y resultados
- **Filtros (menú «Filtros (n)», n = filtros aplicados)**: Desde / Hasta (con atajos «Hoy», «7 días», «30 días»); Sección; **Organismo** (texto con sugerencias: «Ministerio, comunidad, institución…»); Tema (varios); **Tipo de publicación** (una opción); Orden (Relevancia | Más recientes). Botones «Borrar filtros» y «Aplicar».
- **Tipo de publicación, opciones agrupadas** (nombres llanos; se muestran al abrir el desplegable; «Cualquiera» por defecto):
  - Normas: Ley o norma general · Modificación o derogación de una norma · Corrección de errores.
  - Personal y empleo: Nombramiento · Cese · Destinos y situaciones del personal · Convocatoria de empleo, becas o premios.
  - Dinero y contratos públicos: Subvenciones y ayudas · Convenio · Licitación de contratos · Adjudicación de contratos · Concesiones y autorizaciones.
  - Justicia y trámites: Sentencias y recursos · Indultos y sanciones · Información pública.
  - Organización: Estatutos y organización · Convocatoria de juntas y asambleas.
  - Otros.
  Correspondencia con los valores de `tipo_acto`: ver `docs/listas-fichas.md` (norma, modificacion_norma, correccion_errores, nombramiento, cese, destino_situacion, convocatoria, subvencion_ayuda, convenio, contrato_licitacion, contrato_adjudicacion, concesion_autorizacion, sentencia_recurso, indulto_sancion, informacion_publica, organizacion_estatutos, convocatoria_reunion, otros).
- **Tema**: los 29 valores de `docs/listas-fichas.md` con nombres llanos; etiquetas por decidir al construir.
- Escritorio: menú de filtros desplegado bajo la barra de búsqueda; móvil: «Filtros (n)» abre un panel a pantalla completa con «Borrar» y «Aplicar» fijos abajo.
- Cabecera de resultados: «128 resultados · 7–13 nov 2026», chips de filtros quitables y botón «Desglose» (por mes, organismo o tipo de publicación, con `GET /v1/conteos`).
- Máximo 100 resultados por búsqueda: al llegar, «Mostrando los 100 primeros; afina con filtros o fechas».
- «Orden: Relevancia» solo con texto; sin texto se ordena por fecha.
- Una búsqueda con tema o tipo de publicación no alcanza anuncios sin resumen. **Aviso aprobado**, que solo aparece cuando hay un tema o tipo elegido, bajo el filtro: «Al filtrar por tema o tipo no salen los anuncios sin resumen (justicia, oposiciones y particulares).»
- **Regla general: un anuncio sin resumen se muestra igualmente con su título oficial** (en resultados, sumario y cualquier listado). Al pulsar el título se abre el detalle con todo lo que haya: título, datos (sección, organismo, epígrafe, rango), enlaces al BOE y la explicación de por qué no hay resumen. Solo se omiten, sin dejar huecos, el resumen, el tipo, el tema y las referencias.

### 5.3 Tarjeta de resultado
De arriba abajo:
1. Línea gris: fecha · sección · organismo.
2. **Antetítulo** discreto en mayúsculas con el tipo de publicación (p. ej. «CONVENIO»). Se oculta si ya se ha filtrado por tipo.
3. **Título oficial** (enlace al detalle), tal cual, sin recortar.
4. Resumen (2-3 líneas) con la etiqueta «Generado con IA ⓘ»; no es un botón: al pasar el cursor (o enfocar con el teclado) sale un globo que explica: «Generado por IA a partir del texto oficial. Consulta siempre el BOE antes de citar.»
5. «Tema: Vivienda» como texto plano gris (sin fondo ni borde, no parece botón).
6. Indicadores si hay dato: derogada, anulada judicialmente, vigencia agotada, aviso sobre el texto oficial.
7. Enlaces siempre: «BOE (HTML)» y «PDF», solo los que tengan URL; si no hay ninguno, «Sin enlace disponible» y se registra el fallo.
Variantes:
- **Anuncio de una sección con datos personales** (justicia, oposiciones, anuncios de particulares): etiqueta «Sin resumen» y «Esta sección puede incluir datos personales; por eso no generamos resumen. Consulta el texto en el BOE.» Sin tipo ni tema.
- **Resumen pendiente de revisión**: etiqueta «Resumen pendiente de revisión», sin texto de resumen. Si no se conoce el motivo en la base, «Resumen aún no disponible».
- **Corrección** (`corrige_a`): «Corrige: BOE-A-…» con enlace al detalle (o solo el identificador si no está en la base).
- **Vigencia**: insignias «Derogada», «Anulada judicialmente», «Vigencia agotada» solo si hay dato; si falta, no se muestra nada.
Nunca DNI/NIF: se muestra solo el título oficial y el resumen de la base.

### 5.4 Detalle de publicación
- Enlace «← Volver a los resultados» (conserva filtros).
- Código (p. ej. BOE-A-2026-22345) y fecha; título oficial grande (serif); línea «Tipo de publicación: … · Tema: …» en texto gris.
- Bloque «Resumen» con la etiqueta «Generado con IA ⓘ» (no es un botón; la explicación sale al pasar el cursor). «Referencias»: normas anteriores citadas.
- Columna derecha: **Fuente oficial** («Abrir en el BOE ↗», «PDF ↗», **Copiar cita**); **Datos** (sección, organismo, epígrafe, rango); **Vigencia y avisos** si hay dato.
- **Copiar cita**: copia una referencia lista para pegar: título oficial, identificador (p. ej. BOE-A-2026-22306; los datos no traen el número del BOE), fecha y enlace al BOE. Al pasar el ratón (o enfocar con el teclado) aparece un globo con la explicación y un ejemplo; al pulsar, el botón dice «Copiado ✓» unos segundos.
- Anuncio con datos personales: sin resumen ni referencias; título, datos y enlaces, con la explicación de por qué no hay resumen.
- «Corregida por»: pendiente (ver preguntas abiertas).

### 5.5 Sumario del día
Título «Sumario del día», selector de fecha con ◀ ▶ y buscador «Buscar en este día». Secciones plegables en orden BOE con recuento; dentro, publicaciones por organismo en formato compacto: título oficial, el resumen a continuación (con «Generado con IA»; o «Sin resumen» / «Resumen pendiente de revisión» según el caso) y «HTML ↗» «PDF ↗». Hasta 2.000 al día: la primera sección desplegada, el resto plegadas y «Mostrar más». Día sin BOE: «Ese día no se publicó BOE»; día aún no cargado: «Este día aún no está cargado» (mensajes distintos).

### 5.6 Preguntar al BOE (reservado)
No aparece en la cabecera en el MVP. La pantalla del lienzo (§7) queda como referencia para la Fase 4.

## 6. Estados y textos

### 6.1 Login (sesión aparte; solo lo ya decidido)
- Título: «Entrar al buscador del BOE». Campo: «Correo electrónico». Botón: «Enviarme el enlace».
- Enviado: «Te hemos enviado un enlace a {correo}. Ábrelo desde este dispositivo. Caduca en 1 hora.» + «Reenviar» (espera de 60 s).
- Enlace caducado o usado: «Este enlace ya no es válido. Pide uno nuevo.»
- Sin conexión: «No hemos podido enviar el enlace. Inténtalo de nuevo en un minuto.»
- Correo no autorizado: se decide en la sesión de login (si se revela o no la lista). Pantalla «Sin acceso»: «Tu correo ({correo}) no está en la lista de acceso de este buscador. El acceso es solo para periodistas autorizados.» Sin dirección de contacto y sin botón «Salir» (queda pendiente cómo cambiar de cuenta; se trata en login).

### 6.2 Estados generales
| Situación | Texto / comportamiento |
| --- | --- |
| Cargando | Tres esqueletos de tarjeta y «Buscando…»; los filtros siguen activos |
| Sin resultados | «No hay resultados para “{texto}” con estos filtros.» + botones «Quitar filtros» y «Ampliar fechas» + «Prueba con otras palabras, o con:» y los ejemplos de §2 |
| Búsqueda demasiado genérica | Título: «Búsqueda demasiado genérica». «Con eso no podemos buscar. Escribe alguna palabra más concreta: un nombre, un tema o un organismo.» «Palabras sueltas como 'de' o 'la' no bastan. Prueba, por ejemplo, con 'vivienda', 'subvenciones alquiler', 'Ministerio de Hacienda' o 'licitación hospital'.» Los ejemplos son solo texto: no se lanza ninguna búsqueda. Sale bajo la caja y lo escrito se conserva. |
| Sesión caducada | «Tu sesión ha caducado. Por seguridad, la sesión dura 24 horas desde que entras.» + «Entrar de nuevo». **Decidido por el usuario (14/11/2026): 24 horas desde el login por enlace**, aunque se renueve el token. La API devuelve 401 pasadas las 24 h; la web cierra la sesión local una sola vez (sin bucles) y lleva a `/entrar`, donde dice «Tu sesión ha caducado. Por seguridad, dura 24 horas desde que entras. Pide un enlace nuevo.». La pantalla de entrada también avisa: «La sesión dura 24 horas desde que entras.» |
| Sin acceso | Ver §6.1 |
| Error de carga | «No se pudo cargar. Reintentar». «Reintentar» repite la misma petición. No se muestran detalles técnicos; el fallo se avisa solo a quien mantiene la herramienta (pendiente) |
| Publicación no encontrada | «No encontramos esa publicación» + «← Volver a los resultados» |
| Resultados al límite | «Mostrando los 100 primeros resultados. Afina con filtros o fechas.» |

### 6.3 Frescura (`GET /v1/health`, no exige sesión)
Línea fija bajo la cabecera, con punto de color y texto: «Datos hasta el BOE del 13/11/2026 · actualizado hoy a las 08:40».
- **Al día** (verde): último BOE = hoy, o el último día con BOE.
- **Retraso** (ámbar): falta el BOE de hoy pasadas las 10:00 (Madrid): «Aún no está cargado el BOE de hoy. Puede publicarse más tarde.»
- **Desactualizado** (rojo): más de 2 días sin carga: «Los datos pueden estar desactualizados (último BOE: 10/11/2026). Consulta el BOE directamente.» + enlace a boe.es.
- **Sin comprobar** (rojo): «No se pudo comprobar la actualización de los datos.»
- El cálculo de ámbar y rojo es de la web (`/v1/health` solo da `fecha` y `fin` de la última carga).
- Pendiente: «Cobertura desde {fecha}» mientras se carga el histórico (no hay función que lo dé).

## 7. Reservado: «Preguntar al BOE» (Fase 4)
Maqueta 5 del lienzo, no visible en el MVP:
- Caja de pregunta y botón «Preguntar». Contador «Has usado 3 de 30 consultas hoy · se restablece a las 00:00» (`consultas_de_hoy`: `usadas`, `limite`). Al agotarse: «Has alcanzado el límite de hoy (30). Se restablece a las 00:00.» y la caja se desactiva.
- Cargando: «Buscando en el BOE… esto puede tardar unos segundos» y «Cancelar».
- Respuesta: texto breve con marcadores [1], [2], la nota «Respuesta generada por IA a partir de publicaciones del BOE. Verifica en las fuentes antes de publicar.» y el bloque **Fuentes**: lista numerada con título oficial, fecha y enlace al BOE. Cada fuente es una publicación real de la base; sin fuente, no hay afirmación. Los anuncios con datos personales pueden aparecer solo con título y enlace.
- Sin resultados: «No he encontrado publicaciones que respondan a esto. Prueba a reformular o usa el buscador.»
- Error: «No se pudo obtener la respuesta. Tu consulta no se ha contado. Reintentar.»
- Privacidad: «Tu pregunta se guarda 90 días para controlar el coste y la calidad.»
- Diferencia con Buscar: Buscar devuelve la lista de publicaciones que coinciden, sin IA; Preguntar redacta una respuesta con IA a partir de lo que encuentra, cuesta dinero por consulta (límite diario) y hay que verificarla.

## 8. Accesibilidad y responsive
- Contraste AA mínimo; foco visible; navegación completa por teclado; etiquetas en todos los campos; chips quitables con botón «Quitar filtro X»; resultados anunciados con `aria-live`; el color nunca es el único indicador (insignias con texto).
- Tamaño táctil ≥ 44 px en móvil; filtros en panel a pantalla completa; la tarjeta no usa tablas.
- Puntos de ruptura: ≥1024 px dos columnas; 640-1023 filtros plegables; <640 una columna.
- Idioma `es`; fechas «13 nov 2026»; zona Madrid.

## 9. Reglas que la interfaz debe garantizar
- Solo clave anon y sesión del usuario; nunca `service_role` ni claves de Anthropic en el navegador.
- Los enlaces al BOE salen de `url_html` y `url_pdf`; no se construyen a partir del id.
- Ningún DNI/NIF: se muestra solo el título oficial y el resumen de la base.
- De un anuncio con datos personales solo se muestra título, datos y enlaces.
- El resumen siempre lleva «Generado con IA».
- Ningún texto de la interfaz usa jerga interna (ver §0).
