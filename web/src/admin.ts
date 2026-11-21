// Administración de periodistas: llama a las funciones `admin_*` de Supabase con la sesión del usuario.
// La seguridad real está en la base de datos (solo un administrador activo puede usarlas); la web solo muestra u oculta la pantalla.
import { useEffect, useState } from 'react';
import { MODO } from './api';
import { cerrarPorCaducidad, getToken } from './auth';
import { FUNCION_ALTA } from './config';
import { CLAVE_PUBLICA, supabase } from './supabase';

export type Periodista = { email: string; nombre: string | null; limite_diario: number; activo: boolean; es_admin: boolean; consultas_hoy: number };
export type FilaLog = { id: number; creado_en: string; actor: string; accion: string; email: string | null; detalle: unknown };

export class AdminError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function mensajeError(code?: string): string {
  switch (code) {
    case '42501': return 'No tienes permiso para hacer esto.';
    case '22023': return 'Dato no válido: revisa el correo, el límite (de 1 a 1000) y el nombre (máximo 200 caracteres).';
    case '23505': return 'Ese correo ya está dado de alta.';
    case '23514': return 'Debe quedar al menos un administrador activo.';
    case 'P0002': return 'Ese periodista no existe.';
    default: return 'No se pudo completar. Inténtalo de nuevo.';
  }
}

export class AltaError extends AdminError {
  periodistaCreado: boolean;
  quizaCreado: boolean;
  constructor(code: string, message: string, o: { periodistaCreado?: boolean; quizaCreado?: boolean } = {}) {
    super(code, message);
    this.periodistaCreado = !!o.periodistaCreado;
    this.quizaCreado = !!o.quizaCreado;
  }
}
export type ResultadoAcceso = { periodista: Partial<Periodista> & { email: string }; acceso_creado: boolean };

// Llama a la Edge Function (alta + acceso en un paso). La autorización la decide la base de datos con la sesión del administrador.
async function funcionAlta(cuerpo: Record<string, unknown>): Promise<ResultadoAcceso> {
  const token = await getToken();
  if (!token || !CLAVE_PUBLICA) throw new AltaError('401', 'Tu sesión ha caducado.');
  let r: Response;
  try {
    r = await fetch(FUNCION_ALTA, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: CLAVE_PUBLICA, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  } catch {
    throw new AltaError('red', 'No se pudo conectar. Inténtalo de nuevo.');
  }
  let j: { ok?: boolean; error?: string; periodista?: ResultadoAcceso['periodista']; acceso_creado?: boolean; periodista_creado?: boolean; periodista_quiza_creado?: boolean } = {};
  try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (r.ok && j.periodista) return { periodista: j.periodista, acceso_creado: !!j.acceso_creado };
  const esAcceso = cuerpo.accion === 'acceso';
  switch (r.status) {
    case 400: throw new AltaError('400', 'Dato no válido: revisa el correo, el límite (de 1 a 1000) y el nombre (máximo 200 caracteres).');
    case 401: await cerrarPorCaducidad(); throw new AltaError('401', 'Tu sesión ha caducado.');
    case 403: throw new AltaError('403', 'No tienes permiso para hacer esto.');
    case 404: throw new AltaError('404', 'Ese correo no está dado de alta.');
    case 409: throw new AltaError('409', esAcceso ? 'Ese periodista está de baja: reactívalo antes de crear su acceso.' : 'Ese correo ya está dado de alta. Si no puede entrar, pulsa «Crear acceso» en su fila.');
    case 413: case 415: throw new AltaError(String(r.status), 'No se pudo enviar la petición.');
    case 502:
      if (j.periodista_creado) throw new AltaError('502', 'El alta está hecha, pero no se pudo crear su acceso. Pulsa «Crear acceso» en su fila para reintentarlo.', { periodistaCreado: true });
      if (j.periodista_quiza_creado) throw new AltaError('502', 'No se pudo confirmar el alta. Mira la lista: si aparece, pulsa «Crear acceso» en su fila.', { quizaCreado: true });
      throw new AltaError('502', mensajeError());
    default: throw new AltaError(String(r.status), mensajeError());
  }
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new AdminError('', mensajeError());
  const { data, error, status } = await supabase.rpc(fn, args);
  if (error) {
    // Sesión de más de 24 h (o token no válido): igual que en el resto de la web, se cierra la sesión local y se lleva a /entrar.
    if (status === 401 || error.code === 'PT401' || error.code === 'PGRST301') await cerrarPorCaducidad();
    throw new AdminError(error.code ?? '', mensajeError(error.code));
  }
  return data as T;
}

// ---- Datos de ejemplo para el modo prueba ----
let ejemplo: Periodista[] = [
  { email: 'admin.ejemplo@example.com', nombre: 'Cuenta de pruebas', limite_diario: 30, activo: true, es_admin: true, consultas_hoy: 3 },
  { email: 'periodista.ejemplo@example.com', nombre: null, limite_diario: 30, activo: true, es_admin: false, consultas_hoy: 0 },
  { email: 'baja.ejemplo@example.com', nombre: 'Persona de ejemplo', limite_diario: 50, activo: false, es_admin: false, consultas_hoy: 0 },
];
let logEjemplo: FilaLog[] = [{ id: 1, creado_en: '2026-11-13T09:00:00Z', actor: 'admin.ejemplo@example.com', accion: 'alta', email: 'periodista.ejemplo@example.com', detalle: null }];
const espera = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));
const norm = (s: string) => s.trim().toLowerCase();

export const admin = {
  async esAdmin(): Promise<boolean> {
    if (MODO === 'prueba') return true;
    try { return (await rpc<boolean>('es_admin')) === true; } catch { return false; }
  },
  async listar(): Promise<Periodista[]> {
    if (MODO === 'prueba') return espera([...ejemplo]);
    return rpc<Periodista[]>('admin_listar_periodistas');
  },
  async alta(p: { email: string; nombre: string; limite: number; esAdmin: boolean }): Promise<ResultadoAcceso> {
    if (MODO === 'prueba') {
      const email = norm(p.email);
      if (!/^\S+@\S+\.\S+$/.test(email) || p.limite < 1 || p.limite > 1000) throw new AdminError('22023', mensajeError('22023'));
      if (ejemplo.some((x) => x.email === email)) throw new AltaError('409', 'Ese correo ya está dado de alta. Si no puede entrar, pulsa «Crear acceso» en su fila.');
      const n = { email, nombre: p.nombre.trim() || null, limite_diario: p.limite, activo: true, es_admin: p.esAdmin, consultas_hoy: 0 };
      ejemplo = [...ejemplo, n];
      logEjemplo = [{ id: logEjemplo.length + 1, creado_en: new Date().toISOString(), actor: 'tú (prueba)', accion: 'alta', email, detalle: null }, ...logEjemplo];
      await espera(null);
      // Para probar el fallo parcial: un correo que empiece por «fallo@» queda dado de alta pero sin acceso.
      if (email.startsWith('fallo@')) throw new AltaError('502', 'El alta está hecha, pero no se pudo crear su acceso. Pulsa «Crear acceso» en su fila para reintentarlo.', { periodistaCreado: true });
      return { periodista: n, acceso_creado: true };
    }
    return funcionAlta({ accion: 'alta', email: p.email.trim(), nombre: p.nombre.trim() || undefined, limite_diario: p.limite, es_admin: p.esAdmin });
  },
  async acceso(email: string): Promise<ResultadoAcceso> {
    if (MODO === 'prueba') {
      const p = ejemplo.find((x) => x.email === email);
      if (!p) throw new AltaError('404', 'Ese correo no está dado de alta.');
      if (!p.activo) throw new AltaError('409', 'Ese periodista está de baja: reactívalo antes de crear su acceso.');
      return espera({ periodista: p, acceso_creado: !email.startsWith('jotocuen') });
    }
    return funcionAlta({ accion: 'acceso', email });
  },
  async modificar(email: string, c: { nombre?: string | null; limite?: number; activo?: boolean; esAdmin?: boolean }): Promise<Periodista> {
    if (MODO === 'prueba') {
      const nuevo = ejemplo.map((x) => (x.email === email ? { ...x, nombre: c.nombre === undefined ? x.nombre : c.nombre || null, limite_diario: c.limite ?? x.limite_diario, activo: c.activo ?? x.activo, es_admin: c.esAdmin ?? x.es_admin } : x));
      if (!nuevo.some((x) => x.activo && x.es_admin)) throw new AdminError('23514', mensajeError('23514'));
      ejemplo = nuevo;
      logEjemplo = [{ id: logEjemplo.length + 1, creado_en: new Date().toISOString(), actor: 'tú (prueba)', accion: 'modificar', email, detalle: null }, ...logEjemplo];
      return espera(nuevo.find((x) => x.email === email)!);
    }
    return rpc<Periodista>('admin_modificar_periodista', {
      p_email: email,
      p_nombre: c.nombre === undefined ? null : c.nombre,
      p_limite_diario: c.limite ?? null,
      p_activo: c.activo ?? null,
      p_es_admin: c.esAdmin ?? null,
    });
  },
  async log(): Promise<FilaLog[]> {
    if (MODO === 'prueba') return espera([...logEjemplo]);
    return rpc<FilaLog[]>('admin_ver_log', { p_limite: 100 });
  },
};

// `email`: correo de la sesión; sin sesión no se pregunta nada a la base de datos.
export function useEsAdmin(email: string | null) {
  const [r, setR] = useState<{ cargando: boolean; esAdmin: boolean }>({ cargando: true, esAdmin: false });
  useEffect(() => {
    if (MODO === 'api' && !email) { setR({ cargando: false, esAdmin: false }); return; }
    let vivo = true;
    admin.esAdmin().then((v) => vivo && setR({ cargando: false, esAdmin: v }));
    return () => { vivo = false; };
  }, [email]);
  return r;
}
