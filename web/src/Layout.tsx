import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { MODO, api } from './api';
import { useEsAdmin } from './admin';
import { salir, useSesion } from './auth';
import { FreshnessBar } from './ds';
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
  const { esAdmin } = useEsAdmin();
  const loc = useLocation();
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
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav__a nav__a--on' : 'nav__a')}>Buscar</NavLink>
          <NavLink to="/dia" className={({ isActive }) => (isActive ? 'nav__a nav__a--on' : 'nav__a')}>Resumen de hoy</NavLink>
          {esAdmin ? <NavLink to="/admin" className={({ isActive }) => (isActive ? 'nav__a nav__a--on' : 'nav__a')}>Administración</NavLink> : null}
        </nav>
        {MODO === 'prueba' ? <span className="cabecera__modo" title="Datos de ejemplo; no hay sesión ni conexión con la API">Modo de prueba</span> : null}
        {email ? <span className="cabecera__usuario">{email} · <button type="button" className="enlace" onClick={() => salir()}>Salir</button></span> : null}
      </header>
      <Frescura />
      <main className="contenido"><Outlet /></main>
    </div>
  );
}
