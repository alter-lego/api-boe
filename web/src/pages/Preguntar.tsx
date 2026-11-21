import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, api } from '../api';
import { CopiarCita } from '../CopiarCita';
import { partirInicio } from '../destacar';
import { Badge, Button } from '../ds';
import { enlaceBoe } from '../enlaces';
import { fechaCorta } from '../labels';
import { evaluar, type Duda } from '../dudosa';
import type { Respuesta } from '../types';

type Estado = { t: 'libre' } | { t: 'cargando' } | { t: 'ok'; r: Respuesta } | { t: 'error'; e: ApiError };

function mensajeError(e: ApiError): string {
  switch (e.status) {
    case 400: return e.message || 'Revisa la pregunta: debe tener entre 3 y 1000 caracteres.';
    case 401: return 'Tu sesión ha caducado.';
    case 403: return 'Tu correo no está en la lista de acceso de este buscador.';
    case 413: case 415: return 'No se pudo enviar la pregunta. Inténtalo de nuevo.';
    case 429: return e.message || 'Has alcanzado el límite de preguntas de hoy.';
    case 502: return 'No se ha podido responder; inténtalo de nuevo con otra formulación. Esta pregunta cuenta en tu límite de hoy.';
    default: return 'No se ha podido responder; inténtalo de nuevo.';
  }
}

// Texto plano escapado por React; los [BOE-…] se convierten en enlaces a su cita solo si el id está en `citas`.
// Las líneas que empiezan por «- » se muestran como lista, con las primeras palabras de cada punto en negrita.
function TextoRespuesta({ r }: { r: Respuesta }) {
  const orden = new Map(r.citas.map((c, i) => [c.id, i + 1]));
  const conCitas = (texto: string, clave: string) => texto.split(/(\[BOE-[A-Za-z0-9-]+\])/g).map((p, i) => {
    const id = /^\[(BOE-[A-Za-z0-9-]+)\]$/.exec(p)?.[1];
    const n = id ? orden.get(id) : undefined;
    if (id && n) {
      return <a key={`${clave}${i}`} className="cita-ref" href={`#cita-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cita-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>[{n}]</a>;
    }
    return <span key={`${clave}${i}`}>{p}</span>;
  });
  const bloques: Array<{ lista: boolean; lineas: string[] }> = [];
  for (const linea of r.respuesta.split('\n')) {
    const punto = /^\s*[-•*]\s+(.*)$/.exec(linea);
    const lista = punto !== null;
    const texto = punto ? punto[1] : linea;
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.lista === lista) ultimo.lineas.push(texto); else bloques.push({ lista, lineas: [texto] });
  }
  return (
    <div className="pregunta__texto">
      {bloques.map((b, bi) => b.lista ? (
        <ul key={bi} className="pregunta__lista">
          {b.lineas.map((l, li) => {
            const [lead, resto] = partirInicio(l);
            return <li key={li}><strong className="destacado">{conCitas(lead, `${bi}-${li}-a`)}</strong>{conCitas(resto, `${bi}-${li}-b`)}</li>;
          })}
        </ul>
      ) : (
        <p key={bi}>{conCitas(b.lineas.join('\n'), `${bi}-p`)}</p>
      ))}
    </div>
  );
}

export function Preguntar() {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ t: 'libre' });
  const [segundos, setSegundos] = useState(0);
  const [cupo, setCupo] = useState<{ usadas: number; limite: number } | null>(null);
  const [enviada, setEnviada] = useState('');
  const [duda, setDuda] = useState<Duda | null>(null);
  const [atenuando, setAtenuando] = useState(false);
  const caja = useRef<HTMLTextAreaElement | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const cargando = estado.t === 'cargando';
  const largo = texto.trim().length;
  // Mientras se busca y al mostrar la respuesta, la caja se pliega: la pregunta queda en una línea, no en la caja.
  const plegada = cargando || estado.t === 'ok';

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
    setEnviada(t.trim());
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
  // Antes de gastar una pregunta, avisa si es dudosa; «Preguntar igualmente» la envía tal cual.
  const intentar = (t: string) => {
    const d = evaluar(t);
    if (d && t.trim().length >= 3) { setDuda(d); setAtenuando(false); return; }
    setDuda(null);
    void lanzar(t);
  };
  const preguntar = (e: React.FormEvent) => { e.preventDefault(); intentar(texto); };
  const reformular = () => {
    caja.current?.focus();
    caja.current?.select();
    setAtenuando(true);
    setTimeout(() => { setDuda(null); setAtenuando(false); }, 400);
  };
  const nueva = () => {
    setEstado({ t: 'libre' });
    setTimeout(() => { caja.current?.focus(); caja.current?.select(); }, 50);
  };
  const igualmente = () => { setDuda(null); void lanzar(texto); };

  // Si llega desde la portada con la pregunta ya escrita, se envía una sola vez.
  const loc = useLocation();
  const inicial = (loc.state as { pregunta?: string } | null)?.pregunta;
  const yaEnviada = useRef(false);
  useEffect(() => {
    if (inicial && !yaEnviada.current) { yaEnviada.current = true; setTexto(inicial); intentar(inicial); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="preguntar">
      <h1>Preguntar al BOE</h1>
      <form onSubmit={preguntar} className={`portada__caja caja-plegable${plegada ? ' caja-plegable--fuera' : ''}`}>
        <label className="sr-only" htmlFor="pregunta">Tu pregunta</label>
        <textarea id="pregunta" ref={caja} maxLength={1000} value={texto} onChange={(e) => { setTexto(e.target.value); setDuda(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); intentar(texto); } }} placeholder="Ejemplo: ¿Qué ayudas al alquiler joven se han publicado esta semana?" disabled={cargando} />
        <div className="portada__pie">
          <span className="bboe-meta pregunta__contadores">
            <span>{largo} de 1000 caracteres</span>
            {cupo ? <span role="status">{cupo.usadas} de {cupo.limite} preguntas hoy</span> : null}
          </span>
          <Button type="submit" disabled={cargando || largo < 3}>Preguntar</Button>
        </div>
      </form>

      {duda && !cargando ? (
        <div className={`aviso aviso--duda${atenuando ? ' aviso--fuera' : ''}`} role="alert">
          {duda === 'sinsentido' ? (
            <>
              <strong>Esto no parece una pregunta</strong>
              <p>No se puede enviar así. Escríbela con palabras, por ejemplo: «ayudas al alquiler joven».</p>
            </>
          ) : duda === 'rara' ? (
            <>
              <strong>Esto no parece una pregunta</strong>
              <p>Si la envías, el asistente buscará igualmente, pero es probable que no encuentre nada útil. La pregunta contaría en tu límite de hoy{cupo ? ` (${cupo.usadas} de ${cupo.limite})` : ''}.</p>
            </>
          ) : (
            <>
              <strong>Con una sola palabra la respuesta será poco precisa</strong>
              <p>Añade qué quieres saber: un organismo, un periodo o un tema. Por ejemplo: «ayudas al alquiler publicadas esta semana».</p>
            </>
          )}
          <div className="aviso__acciones">
            <Button onClick={reformular}>{duda === 'corta' ? 'Añadir detalle' : 'Reformular'}</Button>
            {duda !== 'sinsentido' ? <Button variant="secondary" onClick={igualmente}>Preguntar igualmente</Button> : null}
          </div>
        </div>
      ) : null}

      {cargando ? (
        <div className="espera" role="status" aria-live="polite">
          <div className="bboe-meta">Tu pregunta · «{enviada}»</div>
          <p>
            Buscando en el BOE<span className="espera__puntos" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{' '}
            {segundos >= 15 ? 'Está tardando más de lo normal; puede llegar a un minuto.' : 'Suele tardar unos 10 segundos.'}
          </p>
          <div className="espera__barra" aria-hidden="true" />
          <p><button type="button" className="enlace" onClick={() => ctrl.current?.abort()}>Cancelar</button>{segundos >= 5 ? <span className="bboe-meta"> ({segundos} s)</span> : null}</p>
        </div>
      ) : null}

      {estado.t === 'error' ? (
        <div className="aviso" role="alert">
          <p>{mensajeError(estado.e)}</p>
          {estado.e.status === 429 || estado.e.status === 401 || estado.e.status === 403 ? null : <p className="bboe-meta">Puedes volver a intentarlo.</p>}
        </div>
      ) : null}

      {estado.t === 'ok' ? (
        <div className="pregunta__tarjeta">
          <div><div className="sec">Tu pregunta</div><p className="pregunta__enviada">{enviada}</p>{cupo ? <p className="bboe-meta">{cupo.usadas} de {cupo.limite} preguntas hoy</p> : null}</div>
          <button type="button" className="enlace" onClick={nueva}>Nueva pregunta</button>
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
