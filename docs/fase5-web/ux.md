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

### 5.6 Preguntar al BOE (Fase 4)
Pantalla `/preguntar`, construida el 15/11/2026 según el contrato de `docs/fase4-preguntar.md` (ver §7). La pestaña «Preguntar» solo se muestra si el build lleva `VITE_PREGUNTAR=si` (o en modo prueba); mientras la API real no esté desplegada, queda oculta.

### 5.7 Administración de periodistas (solo administradores; añadida el 14/11/2026)
Ruta `/admin`, con la pestaña «Administración» visible solo si `es_admin()` devuelve true (la seguridad real está en la base de datos). Contenido:
- **Dar de alta:** correo, nombre (opcional), preguntas al día (1-1000, por defecto 30) y casilla «Administrador». El alta crea también su acceso (Edge Function de Supabase) y la web avisa: «Ya puede entrar: que pida su enlace en la pantalla de entrada.»
- **Periodistas:** lista con correo, nombre, límite, preguntas de hoy, «Activo/De baja» y «Administrador»; acciones «Editar», «Crear acceso» (repara a alguien dado de alta sin usuario de acceso), «Dar de baja» / «Reactivar». Antes de una baja o de quitar el rol de administrador pide confirmación en la propia fila. No se borra a nadie.
- **Registro de cambios:** plegable, con quién hizo qué y cuándo (últimos 100).
- **Errores en español:** sin permiso, dato no válido, correo ya dado de alta, «Debe quedar al menos un administrador activo» y periodista inexistente.
- Excepción a la regla «la web solo habla con la API»: esta pantalla llama a las funciones `admin_*` de Supabase con la sesión del usuario (`supabase.rpc`). Requiere la migración `20261114120000_rls_y_admin.sql`.

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

## 7. «Preguntar al BOE» (Fase 4; construida, pendiente de la API real)
**Cómo es la pantalla construida (15/11/2026):** caja de pregunta (3-1000 caracteres, contador), botón «Preguntar»; mientras espera, «Buscando en el BOE… esto puede tardar hasta un minuto» con los segundos y «Cancelar» (respuesta única, sin streaming, hasta ~65 s); la respuesta es **texto plano escapado** (sin HTML ni enlaces automáticos), con los `[BOE-…]` convertidos en `[1]`, `[2]`… que llevan a su fuente solo si el id está en `citas`; lista de **Fuentes** con fecha, organismo, título (enlace al detalle), avisos, «BOE (HTML)» y «PDF» solo si existen y son del BOE, y «Copiar cita»; leyenda fija «Respuesta generada con IA a partir del archivo del BOE; comprueba siempre la fuente.» y «Datos del {desde} al {hasta}»; contador «{usadas} de {límite} preguntas hoy» tras cada respuesta; si `sin_resultados`, se muestra el texto con la etiqueta «No he encontrado nada». Errores: 401 cierra sesión y lleva a `/entrar`; 429 muestra el mensaje del servidor (límite diario) sin reintentar; 502 «No se ha podido responder; inténtalo de nuevo con otra formulación. Esta pregunta cuenta en tu límite de hoy.»; 503/504 «No se ha podido responder; inténtalo de nuevo.»; 400/413/415, mensaje de validación.
**Diseño original (referencia):**
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

## 10. Ajustes del 21/11/2026 (primer lote de mejoras)
- **Pestañas:** la activa sigue a la sección: «Buscar» en la portada, los resultados y el detalle abierto desde ellos; «Resumen de hoy» en el sumario y en el detalle abierto desde él; «Preguntar» en la pantalla de preguntas y en el detalle abierto desde sus fuentes.
- **Sumario del día:** el recuento va junto al título («Sumario del día · 282 publicaciones»); las flechas son botones con texto («← 20 nov», «22 nov →»), centrados, y el del futuro aparece desactivado.
- **Filtros:** el menú se cierra al clicar fuera o con Esc.
- **Resultados:** «Desglose» pasa a «Agrupar resultados por…».
- **Citas de «Preguntar»:** sin hueco entre `[n]` y el signo que le sigue.

## 11. Portada «Preguntar primero» (decidida el 21/11/2026)
- **Con la pestaña «Preguntar» activada** (`VITE_PREGUNTAR=si` o modo prueba): la portada `/` pasa a ser la pregunta: titular «Lo que dice el BOE, a una pregunta de distancia», una frase de apoyo, una caja de pregunta grande con «Preguntar», ejemplos de preguntas (texto plano, no pulsables), el enlace «¿Prefieres buscar por palabras y filtros? Buscar con filtros →» y una línea «BOE de hoy · … · N publicaciones · Ver el sumario». Al enviar, se abre `/preguntar` y la pregunta se envía sola una vez.
- **Navegación:** «Preguntar · Buscar · Resumen de hoy» (+ «Administración»). «Buscar» lleva a `/buscar`, que sin filtros muestra la pantalla de búsqueda de antes (buscador con filtros, ejemplos y «BOE de hoy») y con filtros, los resultados.
- **Sin la pestaña «Preguntar»:** todo queda como antes (portada = buscador, «Buscar» en `/`).
- **Aún sin hacer** (decisiones pendientes en `preguntas-abiertas.md`): el aviso para preguntas dudosas, la jerarquía nueva de la respuesta, el refresco visual «editorial cálido» y la página «Cómo funciona».

## 12. Ruta `/confirmar` (acceso por enlace sin gastarlo)

El correo de acceso debe enlazar a `{{ .SiteURL }}/confirmar?token_hash={{ .TokenHash }}&type=email` (plantilla «Magic Link» de Supabase), no directamente a supabase.co, porque algunos filtros de correo abren el enlace antes que el periodista y lo gastan (es de un solo uso).

- `/confirmar` es pública (fuera del Layout, como `/entrar`) y **no verifica al cargar**: muestra «Confirmar acceso» y un botón «Entrar al buscador». Solo al pulsarlo llama a `verifyOtp({ token_hash, type: 'email' })`; si va bien, navega a `/`.
- Solo acepta `type=email`; sin `token_hash` o con otro tipo, redirige a `/entrar`. El token se guarda en memoria y se quita de la URL al cargar.
- Errores: enlace caducado o ya usado → «Este enlace ya no es válido. Pide uno nuevo» con enlace a `/entrar` (sin revelar si el correo está autorizado); fallo de red → botón «Reintentar» (sin reintentos automáticos).

## 13. «Lo más destacado» en el Sumario del día (añadido el 25/11/2026)

La versión web del resumen que llega por correo a la redacción cada mañana (workflow de n8n `boe-spec`), generada aquí sobre las fichas de la base.

- **Dónde:** arriba del Sumario del día (`/dia/:fecha`), antes de «Todas las publicaciones». Se oculta mientras se busca en el día. Si hoy aún no hay resumen: «El resumen de hoy aún se está preparando. Mientras, aquí tienes todas las publicaciones.» Los días anteriores sin resumen muestran solo el sumario.
- **Plegado:** a la vista solo el enlace «Ir a todas las publicaciones (N) ↓», la cabecera y los titulares; «Ver el resumen completo (N temas) ▾» despliega secciones y apartados (se recuerda en el navegador). Un titular cuyo asunto está desarrollado abajo enlaza a ese bloque («Más detalle ↓» o «N publicaciones ↓»), que se despliega y recibe el foco. Revisión de diseño del 25/11/2026.
- **Contenido:** «Lo más destacado» con «Generado con IA» y la nota «Redactado con IA a las HH:MM · comprueba siempre el BOE antes de publicar»; titulares (3-6); secciones por tema con bloques (titular, resumen, «Por qué importa») y líneas cortas; y los cuatro apartados fijos (Ayudas y subvenciones, Oposiciones y empleo público, Impuestos, tributos y tasas, Automoción y vehículo eléctrico): plegados con «· n» si tienen algo; los vacíos, en una línea «Sin novedades hoy en: …».
- **Enlaces:** el titular de un bloque con una sola publicación enlaza a su página; debajo, organismo y rango en gris y «BOE (HTML)» y «PDF» desde `url_html`/`url_pdf`. Con varias, una fila por publicación. En líneas y titulares sin bloque, el enlace es el rango, numerado si se repite («Resolución 1», «Resolución 2»), con el título oficial en el nombre accesible. Claude nunca escribe enlaces: cita ids y la web los busca entre las fichas del sumario (si un id no está, la pieza no se pinta).
- **En la portada (26/11/2026):** la tarjeta «BOE de hoy» enseña, si ya hay resumen, «Lo más destacado» con «Generado con IA», los 3 primeros titulares (también en móvil), «Leer lo más destacado» (lleva a `/dia/{fecha}#rd-titulo`) con «y N titulares más · M temas», y «Ver el sumario completo» (`#todas`). Sin resumen hoy: «El resumen de lo más destacado se está preparando…»; días anteriores sin resumen: la tarjeta de siempre.
- **Generación:** `ingesta/resumen-dia.js` (paso «Resumen del día» de la ingesta), con Claude Sonnet 5.5 e instrucciones en `skill/RESUMEN-DIA.md`; se guarda en `resumenes_dia` y llega en `GET /v1/sumarios/{fecha}` como `resumen`. Detalles en `contrato-datos.md`.
