import { crearApp } from './app.js';
// Las instrucciones del asistente se leen de skill/SKILL.md (wrangler las incluye como texto, ver wrangler.toml).
import INSTRUCCIONES from '../../skill/SKILL.md';

export default crearApp({ instrucciones: INSTRUCCIONES });
