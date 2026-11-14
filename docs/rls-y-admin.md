# RLS como segunda barrera y rol admin

Decidido el 14/11/2026. Migraciones `20261114120000_rls_y_admin.sql` (10) y `20261114130000_endurecer_admin.sql` (11, tras una revisión independiente de la 10). Pruebas: `supabase/tests/fase1_seguridad.sql` y `fase1b_rls_admin.sql`.

## Decisión

1. **Las funciones `security definer` siguen siendo la única vía de lectura.** No se da ningún permiso de tabla a `anon` ni a `authenticated`. Las políticas RLS son una **segunda barrera**: no cambian lo que ve nadie hoy, pero protegen si un `GRANT` por error abriera una tabla.
2. **Rol admin** (`periodistas.es_admin`): da de alta, modifica y da de baja periodistas desde la web, con las funciones `admin_*`. Es además un periodista normal: no ve más publicaciones ni consultas ajenas.
3. **Auditoría** (`periodistas_log`): un trigger sobre `periodistas` anota quién cambió qué, venga de una función admin, del SQL Editor o de cualquier otra vía.
4. **Tope de sesión en la base de datos** (migración 11): 24 h desde el inicio de sesión, impuesto por `sesion_vigente()` y no solo por el Worker, porque la web y cualquiera con un token pueden llamar directamente a PostgREST.

## Políticas (todas `to authenticated`; `anon` no tiene ninguna)

| Tabla | Quién lee | Escritura |
| --- | --- | --- |
| `publicaciones` | periodista activo con sesión vigente, **solo filas públicas** | nadie (ingesta con `service_role`) |
| `periodistas` | admin: todas; periodista: solo la suya | solo admin (insert/update); nadie borra |
| `periodistas_log` | solo admin | solo el trigger |
| `consultas` | cada periodista, solo las suyas (ni el admin ve las ajenas) | solo `registrar_consulta` |
| `boletines`, `sumarios` | periodista activo | nadie |
| `ingestas` | nadie (el campo `error` puede tener detalles internos) | `service_role` |

**Columnas privadas.** Una RLS no oculta columnas. Por eso, por vía directa, las publicaciones restringidas no se ven en absoluto (ni título, ni `tsv_texto`, ni resumen). Lo que de una restringida se puede mostrar (título, metadatos, enlaces) sale solo por `_ficha()`. En las públicas, `tsv_texto` sería legible por vía directa, pero es texto público del BOE.

## Funciones admin (las llama la web con la sesión del usuario, por `supabase.rpc()`)

`es_admin()` · `admin_listar_periodistas()` · `admin_alta_periodista(email, nombre, limite_diario, es_admin)` · `admin_modificar_periodista(email, nombre, limite_diario, activo, es_admin)` (null = no cambiar) · `admin_ver_log(limite)`.

Salvaguardas:
- Correo normalizado a minúsculas y validado (solo ASCII), límite entre 1 y 1000.
- **La baja (`activo = false`) quita también el rol de admin**; reactivar a alguien no se lo devuelve (hay que dárselo aparte). No se borra a nadie.
- **Siempre queda al menos un admin activo**, por dos vías: las funciones (con un bloqueo que serializa los cambios y una segunda comprobación de admin tras él) y un *constraint trigger* diferible que lo exige también por SQL directo (se comprueba al terminar la transacción y solo si se toca a un admin activo).
- `search_path` fijo en todas las funciones.

## Errores que ve la web

| Código | HTTP | Significado |
| --- | --- | --- |
| `PT401` | 401 | sesión caducada (más de 24 h, sin `amr`, o método distinto de enlace por correo). La web vuelve a pedir el enlace. |
| `42501` | 403 | no autorizado (sesión buena, pero el correo no está en la lista, está de baja, o no es admin) |
| `22023` | 400 | dato no válido |
| `23505` | 409 | el correo ya existe |
| `23514` | 400 | debe quedar al menos un administrador activo |
| `P0002` | 404 | no existe ese periodista |

**Orden de comprobaciones:** primero la sesión (para cualquiera, esté o no en la lista), después la lista. Así un token sin sesión válida no averigua si su correo está autorizado: un intruso con sesión vieja recibe `PT401`, y con sesión buena `42501`.

**Cómo se mide la sesión.** El JWT de Supabase lleva `amr`, una lista de `{method, timestamp}`. Se exige un método `otp` o `magiclink` y que la marca **más antigua** tenga ≤ 24 h. Sin `amr` o ilegible, no vale.

## Permisos de `service_role` (migración 11)

`service_role` solo puede **leer** `periodistas` y `periodistas_log`: no puede escribirlas ni borrarlas, ni usar la secuencia del log, ni ejecutar las funciones admin. La ingesta no toca esas tablas (comprobado con grep en `ingesta/` y `.github/`). La clave vive solo en la ingesta (GitHub Secrets); no está en el Worker ni en la web. `TRUNCATE` de ambas tablas está bloqueado para todos, incluido el dueño (hay que quitar el trigger a propósito si algún día hiciera falta).

Consecuencia: las altas y bajas se hacen **solo** con `admin_alta_periodista`/`admin_modificar_periodista` (desde la web) o con el SQL Editor (rol `postgres`). Quien tenga acceso al SQL Editor o a la clave de base de datos sí puede modificar o borrar filas del log: **ningún rol de la API puede, el dueño de la base sí**. Si en el futuro se vuelve a ejecutar un `grant all on all tables ... to service_role`, hay que repetir esos `revoke`.

## Rendimiento

- Las políticas envuelven cada llamada en `(select ...)`: Postgres la evalúa una vez por consulta (InitPlan) y no por fila. Las pruebas lo comprueban con `EXPLAIN`.
- Los índices necesarios ya existen (`periodistas(email)`, `consultas(usuario, creado_en desc)`); el log lleva `periodistas_log(creado_en desc)`.
- Las funciones de lectura y la ingesta no pasan por las políticas (el dueño de las funciones y `service_role` se saltan RLS). `sesion_vigente()` solo lee el JWT: no consulta ninguna tabla.

## Pasos obligatorios fuera de la base de datos (los hace una persona)

1. **Primer admin**, una vez, en el SQL Editor (instrucción en la cabecera de la migración 10).
2. **Alta de un periodista = dos pasos.** (a) `admin_alta_periodista`, desde la pantalla de admin de la web, autoriza el correo. (b) Una persona crea a mano su usuario en Supabase → Authentication → Users → Add user, con la confirmación de correo automática. **Sin el paso (b) el periodista no puede entrar.** Se descartó automatizarlo (un `POST /v1/entrar` en el Worker que creara el usuario) para no ampliar la exposición de la clave `service_role`; el código quedó aparcado en la rama local `aparcado/entrar` y nunca se desplegó. Si algún día se automatiza, la alternativa recomendada es un Worker con su propia clave secreta revocable, no la `service_role` de la ingesta.
3. **Requisitos de Supabase Auth** (los comprueba una persona en el panel, antes de abrir a más gente): confirmación de correo obligatoria (solo sesiones con correo verificado, ningún proveedor que acepte correos sin verificar); **«Secure email change»** activado; **registros nuevos y usuarios anónimos desactivados**; y **Redirect URLs** y Site URL con solo las direcciones exactas de la web. Todo el control de acceso se apoya en el correo del JWT.

## Riesgos y pendientes

- **Escalada de privilegios:** un admin puede crear otros admins. Se limita con el log, que solo leen los admins, y con que ningún rol de la API puede editarlo.
- **Escritura directa.** Si algún día se concedieran permisos de escritura sobre `periodistas`, las políticas dejarían escribir a un admin sin pasar por la lógica de las funciones (aunque el trigger del último admin y la auditoría sí se aplican).
- **Ventana de 24 h.** Un periodista dado de baja pierde el acceso de inmediato (la lista se consulta en cada llamada); lo que dura 24 h es la sesión de quien sigue autorizado.
- Sigue pendiente la valoración RGPD del índice de nombres (ver `niveles-privacidad.md`).
