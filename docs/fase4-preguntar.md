# Fase 4 · Preguntas en lenguaje natural (`POST /v1/preguntar`)

Escrito el 14/11/2026. Código: `api/src/preguntar.js`, ruta en `api/src/app.js`, instrucciones del asistente en `skill/SKILL.md`, límite diario en `supabase/migrations/20261114140000_reservar_consulta.sql`.

## Cómo funciona
1. La API valida la sesión (igual que el resto) y **reserva** la pregunta en el límite diario del periodista (`reservar_consulta`, atómico en la base de datos: comprueba y apunta en un solo paso, serializado por persona). Si no queda cupo, responde 429 y **no se llama a Claude**.
2. Llama a Claude (Haiku 5.5, esfuerzo medio: con `low` es más propenso a responder sin buscar; se cambia con `ESFUERZO_PREGUNTAR`) con las instrucciones de `skill/SKILL.md` (iguales en todas las peticiones, con punto de caché) y tres herramientas: `buscar_publicaciones`, `contar_publicaciones` y `leer_publicacion`. Máximo **3 rondas**; en la cuarta petición se desactivan las herramientas y debe responder.
3. Las herramientas llaman a las MISMAS funciones SQL que el buscador, con la sesión del periodista: la privacidad (restringidas = solo título y enlace) la impone la base de datos. `leer_publicacion` solo lee publicaciones públicas, solo desde `boe.es` (se comprueba también el destino final), descarga como máximo 1,5 MB, recorta el texto (~11.000 caracteres) y le quita DNI/NIE y números enmascarados. A la respuesta final también se le quitan DNI, enlaces, dominios y esquemas peligrosos.
4. Claude devuelve JSON `{respuesta, citas, sin_resultados}`. El código **valida** cada identificador citado contra lo que devolvieron las herramientas, sustituye los que no existan por «[referencia no verificada]», elimina cualquier URL del texto y **pone los enlaces oficiales** desde la base de datos. Claude nunca escribe enlaces.
5. Se completa la consulta en `consultas` (modelo, rondas, tokens, caché, coste y citas) con el **token** que devolvió la reserva: solo quien reservó puede completar su fila (los ids son secuenciales y sin token se podría rellenar la reserva del Worker con coste 0). `registrar_consulta` (migración 4) se elimina por permitir filas inventadas. Se borra a los 90 días.
6. Si Claude responde sin haber consultado ninguna herramienta, **no se entrega lo que diga**: se devuelve un aviso neutro para que se reformule la pregunta.

## Caché de respuestas (migración 13, 21/11/2026)
Antes de reservar, la API pregunta a `respuesta_guardada`: si **el mismo periodista** ya hizo hoy la misma pregunta (normalizada: sin tildes, mayúsculas ni ¿?) y **no ha entrado ninguna ingesta después**, se devuelve la respuesta guardada con `en_cache: true`, sin llamar a Claude y sin gastar cupo. La respuesta final se guarda con `guardar_respuesta` (misma reserva y token). **La caché es por persona, no compartida:** el Worker escribe con la sesión del propio periodista, y con una caché compartida cualquiera podría guardar un texto inventado y servírselo a sus compañeros. Los avisos de «no he consultado el archivo» y los errores no se guardan. El texto se borra con `consultas` a los 90 días.

## Diseño del límite: sin «devolver» preguntas
No existe ninguna función para liberar una reserva: la podría llamar el propio periodista con su sesión y se saltaría el límite (reservar, liberar mientras Claude trabaja, repetir en paralelo). **Un fallo del servidor tras reservar consume una pregunta.** Es lo seguro y raro.

## Contrato para la web
`POST https://api-boe.alter-lego.workers.dev/v1/preguntar`, cabecera `Authorization: Bearer <access_token>`, JSON `{ "pregunta": "…" }` (3 a 1000 caracteres).

Respuesta 200:
```json
{
  "respuesta": "texto con las citas entre corchetes, p. ej. [BOE-A-2026-12345]",
  "citas": [{ "id": "BOE-A-2026-12345", "titulo": "…", "fecha": "2026-11-12", "organismo": "…", "seccion": "3",
              "nivel_privacidad": "publico", "url_html": "https://www.boe.es/…", "url_pdf": "https://www.boe.es/…", "avisos": ["puede estar derogada o modificada"] }],
  "sin_resultados": false,
  "datos_desde": "2026-08-13",
  "datos_hasta": "2026-11-14",
  "preguntas_hoy": { "usadas": 3, "limite": 30 }
}
```
- `respuesta` es **texto plano** (pintarlo escapado, sin HTML). Los `[ID]` del texto se pueden convertir en enlaces usando `citas` (solo los que están en `citas` son válidos).
- `url_html`/`url_pdf` pueden ser `null` (si no pasan la validación de dominio `boe.es`): no pintar ese botón.
- `sin_resultados: true` → mostrar aviso «No he encontrado…» con `respuesta`.
- Mostrar siempre «datos del `datos_desde` al `datos_hasta`» y que el resumen está generado por IA.
- Latencia: **10–30 s** (varias rondas). Respuesta única, sin streaming: la web muestra «Buscando…» y debe aceptar hasta ~60 s.

Errores `{error}`: 400 pregunta no válida · 401 sesión caducada (cerrar sesión y volver a entrar) · 403 no autorizado · 413/415 cuerpo · **429 límite diario alcanzado** (mostrar el mensaje) · 502 el asistente no produjo una respuesta válida (reintentar con otra formulación; **cuenta como pregunta**) · 503 asistente no disponible o no configurado · 504 tardó demasiado.

## Puesta en marcha (lo hace el usuario; despliegue, la sesión principal)
1. **Migración 12** en el SQL Editor (`20261114140000_reservar_consulta.sql`) y las pruebas `supabase/tests/fase4_consultas.sql` (debe terminar con `TODAS LAS PRUEBAS OK`).
2. **Clave de Anthropic propia del buscador**, distinta de la de la ingesta: en la Console de Anthropic, crear una clave nueva (por ejemplo «buscador-boe-worker») y, si se puede, en un espacio de trabajo con límite de gasto mensual. No pegarla en el chat.
3. Guardarla como secreto del Worker (pide el valor en el terminal):
   `cd api && npx wrangler secret put ANTHROPIC_API_KEY`
4. La sesión principal despliega `api-boe` y hace una prueba real (cuesta céntimos).

## Qué conviene saber
- **Coste:** Haiku 5.5 a 0,10/0,50 USD por millón de tokens (entrada/salida); el coste medido con Claude real es de **0,03–0,25 céntimos por pregunta** (tope teórico por pregunta ≈ 4 céntimos, con 3 rondas y textos largos). El tope real es el saldo prepago de la clave y el límite diario por periodista (30 por defecto, ajustable en `periodistas.limite_diario`).
- **Límites de Cloudflare (plan gratuito):** 10 ms de CPU por petición. Esperar a Claude no cuenta, pero la lectura de JSON grandes y del XML de `leer_publicacion` sí. Si salen errores 1102, el plan de pago (5 USD al mes) lo resuelve.
- **Caché de respuestas:** existe desde la migración 13 (21/11/2026), por periodista y no compartida; ver «Caché de respuestas» más arriba.
- El modelo se cambia con `MODELO_PREGUNTAR` en `api/wrangler.toml`; con otro modelo, el coste anotado es una estimación con los precios de Haiku.
- `COBERTURA_DESDE` (hoy `2026-08-13`) indica a Claude desde cuándo hay datos: **actualizarla si se carga más histórico**.
