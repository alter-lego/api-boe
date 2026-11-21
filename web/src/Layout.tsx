import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { MODO, api } from './api';
import { useEsAdmin } from './admin';
import { salir, useSesion } from './auth';
import { PREGUNTAR_ACTIVO } from './config';
import { FreshnessBar } from './ds';
import { useTema } from './tema';
import { fechaCorta, hoyMadrid, horaMadrid } from './labels';
import { useAsync } from './useAsync';

function Frescura() {
  const { data, error, cargando } = useAsync(() => api.salud(), 'salud');
  if (cargando) return <FreshnessBar state="warn">Comprobando la actualización de los datos…</FreshnessBar>;
  if (error || !data?.ultima_ingesta) return <FreshnessBar state="error">No se pudo comprobar la actualización de los datos.</FreshnessBar>;
  const { fecha, fin } = data.ultima_ingesta;
  const hoy = MODO === 'prueba' ? fecha : hoyMadrid();
  const dif = Math.round((Date.parse(hoy) - Date.parse(fecha)) / 86400000);
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(fin));
  const cuando = fin.slice(0, 10) === hoyMadrid() ? 'hoy' : `el ${fechaCorta(fin.slice(0, 10))}`;
  if (dif <= 0 || (dif === 1 && horaMadrid() < 10)) {
    return <FreshnessBar state="ok">Datos hasta el BOE del {fecha.split('-').reverse().join('/')} · actualizado {cuando} a las {hora}</FreshnessBar>;
  }
  if (dif <= 2) return <FreshnessBar state="warn">Aún no está cargado el BOE de hoy. Puede publicarse más tarde.</FreshnessBar>;
  return (
    <FreshnessBar state="error">
      Los datos pueden estar desactualizados (último BOE: {fecha.split('-').reverse().join('/')}). Consulta el BOE directamente.{' '}
      <a href="https://www.boe.es" target="_blank" rel="noopener noreferrer">boe.es ↗</a>
    </FreshnessBar>
  );
}

export function Layout() {
  const { cargando, email } = useSesion();
  const { esAdmin } = useEsAdmin(email);
  const { oscuro, alternar } = useTema();
  const loc = useLocation();
  // La pestaña activa sigue a la sección, también en el detalle (que recuerda desde dónde se abrió) y en los resultados.
  const origen = (loc.state as { origen?: string } | null)?.origen;
  const ruta = loc.pathname;
  const tab = ruta === '/' ? (PREGUNTAR_ACTIVO ? 'preguntar' : 'buscar') : ruta.startsWith('/dia') ? 'dia' : ruta.startsWith('/preguntar') ? 'preguntar' : ruta.startsWith('/admin') ? 'admin'
    : ruta.startsWith('/publicacion') ? (origen === 'dia' ? 'dia' : origen === 'preguntar' ? 'preguntar' : 'buscar') : 'buscar';
  const clase = (t: string) => () => (t === tab ? 'nav__a nav__a--on' : 'nav__a');
  if (MODO === 'api') {
    if (cargando) return <p className="bboe-meta" style={{ padding: 24 }}>Cargando…</p>;
    if (!email) return <Navigate to="/entrar" replace state={{ desde: `${loc.pathname}${loc.search}` }} />;
  }
  return (
    <div className="app">
      <header className="cabecera">
        <NavLink to="/" className="cabecera__logo" aria-label="Buscador del BOE, inicio">
          <img className="logo logo--claro" src="/logo.svg" alt="elDiario.es" />
          <img className="logo logo--oscuro" src="/logo-blanco.svg" alt="elDiario.es" />
        </NavLink>
        <nav className="nav" aria-label="Principal">
          {PREGUNTAR_ACTIVO ? <NavLink to="/" aria-current={tab === 'preguntar' ? 'page' : undefined} className={clase('preguntar')}>Preguntar</NavLink> : null}
          <NavLink to={PREGUNTAR_ACTIVO ? '/buscar' : '/'} aria-current={tab === 'buscar' ? 'page' : undefined} className={clase('buscar')}>Buscar</NavLink>
          <NavLink to="/dia" aria-current={tab === 'dia' ? 'page' : undefined} className={clase('dia')}>Resumen de hoy</NavLink>
          {esAdmin ? <NavLink to="/admin" aria-current={tab === 'admin' ? 'page' : undefined} className={clase('admin')}>Administración</NavLink> : null}
        </nav>
        {MODO === 'prueba' ? <span className="cabecera__modo" title="Datos de ejemplo; no hay sesión ni conexión con la API">Modo de prueba</span> : null}
        {email ? <span className="cabecera__usuario">{email} · <button type="button" className="enlace" onClick={() => salir()}>Salir</button></span> : null}
              <button type="button" className="tema-sw" role="switch" aria-checked={oscuro} aria-label="Modo oscuro" onClick={alternar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          <span className="tema-sw__pista"><span className="tema-sw__bola" /></span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
        </button>
      </header>
      <Frescura />
      <main className="contenido"><Outlet /></main>
    </div>
  );
}
