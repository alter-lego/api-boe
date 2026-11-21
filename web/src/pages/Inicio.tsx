import { Link } from 'react-router-dom';
import { api } from '../api';
import { BuscadorForm } from '../BuscadorForm';
import { ErrorCarga } from '../Estados';
import { fechaConDia } from '../labels';
import { useAsync } from '../useAsync';

function BoeDeHoy() {
  const { data, error, cargando, reintentar } = useAsync(async () => {
    const s = await api.salud();
    if (!s.ultima_ingesta) return null;
    return api.sumario(s.ultima_ingesta.fecha);
  }, 'boe-hoy');
  return (
    <aside className="panel" aria-label="BOE de hoy">
      <div className="sec">BOE de hoy</div>
      {cargando ? <p className="bboe-meta">Cargando…</p> : error ? <ErrorCarga error={error} reintentar={reintentar} /> : !data ? <p className="bboe-meta">Aún no hay datos cargados.</p> : (
        <>
          <h2>{fechaConDia(data.fecha)}</h2>
          <p className="bboe-meta">{data.total} publicaciones</p>
          <div className="filas">
            {data.secciones.map((s) => (
              <div key={s.seccion} className="fila"><span>{s.seccion_nombre}</span><span className="num">{s.publicaciones.length}</span></div>
            ))}
          </div>
          <Link className="bboe-btn bboe-btn--primary bboe-btn--md boton-enlace" to={`/dia/${data.fecha}`}>Ver sumario completo</Link>
        </>
      )}
    </aside>
  );
}

export function Inicio() {
  return (
    <div className="inicio">
      <div className="inicio__izq">
        <h1>Buscar en el BOE</h1>
        <BuscadorForm inicial={{}} />
      </div>
      <BoeDeHoy />
    </div>
  );
}
