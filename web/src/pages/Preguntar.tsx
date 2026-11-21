import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, api } from '../api';
import { CopiarCita } from '../CopiarCita';
import { Badge, Button } from '../ds';
import { enlaceBoe } from '../enlaces';
import { fechaCorta } from '../labels';
import type { Respuesta } from '../types';

type Estado = { t: 'libre' } | { t: 'cargando' } | { t: 'ok'; r: Respuesta } | { t: 'error'; e: ApiError };

function mensajeError(e: ApiError): string {
  switch (e.status) {
    case 400: return 'Revisa la pregunta: debe tener entre 3 y 1000 caracteres.';
    case 401: return 'Tu sesión ha caducado.';
    case 403: return 'Tu correo no está en la lista de acceso de este buscador.';
    case 413: case 415: return 'No se pudo enviar la pregunta. Inténtalo de nuevo.';
    case 429: return e.message || 'Has alcanzado el límite de preguntas de hoy.';
    case 502: return 'No se ha podido responder; inténtalo de nuevo con otra formulación. Esta pregunta cuenta en tu límite de hoy.';
    default: return 'No se ha podido responder; inténtalo de nuevo.';
  }
}

// Texto plano escapado por React; los [BOE-…] se convierten en enlaces a su cita solo si el id está en `citas`.
function TextoRespuesta({ r }: { r: Respuesta }) {
  const orden = new Map(r.citas.map((c, i) => [c.id, i + 1]));
  const partes = r.respuesta.split(/(\[BOE-[A-Za-z0-9-]+\])/g);
  return (
    <p className="pregunta__texto">
      {partes.map((p, i) => {
        const id = /^\[(BOE-[A-Za-z0-9-]+)\]$/.exec(p)?.[1];
        const n = id ? orden.get(id) : undefined;
        if (id && n) {
          return <a key={i} className="cita-ref" href={`#cita-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cita-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>[{n}]</a>;
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

export function Preguntar() {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ t: 'libre' });
  const [segundos, setSegundos] = useState(0);
  const [cupo, setCupo] = useState<{ usadas: number; limite: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const cargando = estado.t === 'cargando';
  const largo = texto.trim().length;

  useEffect(() => {
    if (!cargando) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [cargando]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const lanzar = async (t: string) => {
    const l = t.trim().length;
    if (l < 3 || l > 1000 || cargando) return;
    ctrl.current = new AbortController();
    setEstado({ t: 'cargando' });
    try {
      const r = await api.preguntar(t.trim(), ctrl.current.signal);
      setCupo(r.preguntas_hoy);
      setEstado({ t: 'ok', r });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) { setEstado({ t: 'libre' }); return; }
      setEstado({ t: 'error', e: err instanceof ApiError ? err : new ApiError(502, '') });
    }
  };
  const preguntar = (e: React.FormEvent) => { e.preventDefault(); void lanzar(texto); };

  // Si llega desde la portada con la pregunta ya escrita, se envía una sola vez.
  const loc = useLocation();
  const inicial = (loc.state as { pregunta?: string } | null)?.pregunta;
  const yaEnviada = useRef(false);
  useEffect(() => {
    if (inicial && !yaEnviada.current) { yaEnviada.current = true; setTexto(inicial); void lanzar(inicial); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="preguntar">
      <h1>Preguntar al BOE</h1>
      <form onSubmit={preguntar} className="portada__caja">
        <label className="sr-only" htmlFor="pregunta">Tu pregunta</label>
        <textarea id="pregunta" maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void lanzar(texto); } }} placeholder="Ejemplo: ¿Qué ayudas al alquiler joven se han publicado esta semana?" disabled={cargando} />
        <div className="portada__pie">
          <span className="bboe-meta pregunta__contadores">
            <span>{largo} de 1000 caracteres</span>
            {cupo ? <span role="status">{cupo.usadas} de {cupo.limite} preguntas hoy</span> : null}
          </span>
          <Button type="submit" disabled={cargando || largo < 3}>Preguntar</Button>
        </div>
      </form>

      {cargando ? (
        <div className="aviso" role="status" aria-live="polite">
          <p>Buscando en el BOE… esto puede tardar hasta un minuto{segundos >= 5 ? ` (${segundos} s)` : ''}.</p>
          <p><button type="button" className="enlace" onClick={() => ctrl.current?.abort()}>Cancelar</button></p>
        </div>
      ) : null}

      {estado.t === 'error' ? (
        <div className="aviso" role="alert">
          <p>{mensajeError(estado.e)}</p>
          {estado.e.status === 429 || estado.e.status === 401 || estado.e.status === 403 ? null : <p className="bboe-meta">Puedes volver a intentarlo.</p>}
        </div>
      ) : null}

      {estado.t === 'ok' ? (
        <section className="panel pregunta__resp" aria-label="Respuesta">
          {estado.r.sin_resultados ? <div className="sec">No he encontrado nada</div> : <div className="sec">Respuesta</div>}
          <TextoRespuesta r={estado.r} />
          <p className="bboe-meta">Respuesta generada con IA a partir del archivo del BOE; comprueba siempre la fuente.</p>
          <p className="bboe-meta">Datos del {fechaCorta(estado.r.datos_desde)} al {fechaCorta(estado.r.datos_hasta)}.</p>

          {estado.r.citas.length ? (
            <>
              <div className="sec" style={{ marginTop: 8 }}>Fuentes</div>
              <ol className="cita-lista">
                {estado.r.citas.map((c, i) => {
                  const html = enlaceBoe(c.url_html);
                  const pdf = enlaceBoe(c.url_pdf);
                  return (
                    <li key={c.id} id={`cita-${c.id}`} className="bboe-card">
                      <div className="bboe-meta">[{i + 1}] {fechaCorta(c.fecha)}{c.organismo ? ` · ${c.organismo}` : ''}</div>
                      <Link className="bboe-card__title cita-tit" to={`/publicacion/${c.id}`} state={{ origen: 'preguntar' }}>{c.titulo}</Link>
                      {c.avisos?.length ? <div className="bboe-card__row">{c.avisos.map((a) => <Badge key={a} tone="warn">{a}</Badge>)}</div> : null}
                      <div className="bboe-card__links">
                        {html ? <a className="bboe-card__link" href={html} target="_blank" rel="noopener noreferrer">BOE (HTML) ↗</a> : null}
                        {pdf ? <a className="bboe-card__link" href={pdf} target="_blank" rel="noopener noreferrer">PDF ↗</a> : null}
                        {!html && !pdf ? <span className="bboe-meta">Sin enlace disponible</span> : null}
                        <CopiarCita x={c} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
