# Web del Buscador del BOE

Vite + React + TypeScript. Sin Tailwind: el estilo sale del design system «Buscador del BOE» (`src/ds/tokens.css` y `src/ds/components.css`, copiados de Claude Design). Diseño y textos: `../docs/fase5-web/`.

## Arrancar
```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # comprueba tipos y genera dist/
```

## Modos (`.env`, ver `.env.example`)
- `VITE_MODO=prueba` (por defecto): datos de ejemplo de `src/mock.ts`, sin sesión ni API. Para probar la interfaz.
- `VITE_MODO=api`: exige sesión (magic link de Supabase Auth, `/entrar`) y llama a la API (`VITE_API_URL`) con el token. Necesita `VITE_SUPABASE_ANON_KEY` (clave pública) en `web/.env`, que no va al repo. El enlace del correo vuelve a `window.location.origin`: ese origen y `http://localhost:5173` deben estar en Supabase → Authentication → URL Configuration (Site URL y Redirect URLs).
- `VITE_PREGUNTAR=si`: muestra la pestaña «Preguntar» y la portada «Preguntar primero» (en modo prueba sale siempre).

## Reglas
- Solo clave anon de Supabase y sesión del usuario; nunca `service_role` ni claves de Anthropic.
- Los datos salen de la API (`../docs/fase5-web/contrato-datos.md`); no se accede a tablas ni a RPC de Supabase, salvo la pantalla de administración (funciones `admin_*` y Edge Function de alta).

## Despliegue
Publicada (modo `api`, con `VITE_PREGUNTAR=si`) en https://buscador-boe.alter-lego.workers.dev como Worker con activos estáticos (`wrangler.toml` de esta carpeta: `dist/` con fallback de SPA; `public/_headers` pone `noindex`). Cloudflare ya no recomienda «Pages» para proyectos nuevos, por eso el dominio es `workers.dev`.
```bash
cd web && npm run build && npx wrangler deploy
```
Ojo: el despliegue publica el modo que tenga el `.env` en el momento del `build`.

## Pendiente
Registro de errores y decisiones menores de `../docs/fase5-web/preguntas-abiertas.md`. La pantalla «Preguntar» ya está hecha y el dominio de la web ya está en `ALLOWED_ORIGINS` de la API.
