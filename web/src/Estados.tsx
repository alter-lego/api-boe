import { Link } from 'react-router-dom';
import type { ApiError } from './api';

export function Esqueletos({ n = 3 }: { n?: number }) {
  return (
    <div aria-live="polite" aria-busy="true">
      <p className="bboe-meta">Buscando…</p>
      <div className="lista">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="bboe-card">
            <div className="sk" style={{ width: '40%' }} /><div className="sk" style={{ width: '90%' }} /><div className="sk" style={{ width: '75%' }} /><div className="sk" style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorCarga({ error, reintentar }: { error: ApiError; reintentar: () => void }) {
  if (error.status === 400) {
    return (
      <div className="aviso" role="alert">
        <h2>Búsqueda demasiado genérica</h2>
        <p>Con eso no podemos buscar. Escribe alguna palabra más concreta: un nombre, un tema o un organismo.</p>
        <p className="bboe-meta">Palabras sueltas como 'de' o 'la' no bastan. Prueba, por ejemplo, con 'vivienda', 'subvenciones alquiler', 'Ministerio de Hacienda' o 'licitación hospital'.</p>
      </div>
    );
  }
  if (error.status === 401) {
    return (
      <div className="aviso" role="alert">
        <h2>Tu sesión ha caducado</h2>
        <p>Por seguridad, se cierra tras [X] días sin usar el buscador.</p>
        <p><Link className="enlace" to="/entrar">Entrar de nuevo</Link></p>
      </div>
    );
  }
  if (error.status === 403) {
    return (
      <div className="aviso" role="alert">
        <h2>Sin acceso</h2>
        <p>Tu correo no está en la lista de acceso de este buscador.</p>
        <p className="bboe-meta">El acceso es solo para periodistas autorizados.</p>
      </div>
    );
  }
  return (
    <div className="aviso" role="alert">
      <h2>No se pudo cargar</h2>
      <p><button type="button" className="enlace" onClick={reintentar}>Reintentar</button></p>
    </div>
  );
}
