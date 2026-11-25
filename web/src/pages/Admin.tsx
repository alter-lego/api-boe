import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminError, AltaError, admin, useEsAdmin, type Periodista } from '../admin';
import { api } from '../api';
import { useSesion } from '../auth';
import { Badge, Button, Field } from '../ds';
import { Esqueletos } from '../Estados';
import { useAsync } from '../useAsync';

const texto = (e: unknown) => (e instanceof AdminError ? e.message : 'No se pudo completar. Inténtalo de nuevo.');

function Alta({ alAlta }: { alAlta: () => void }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [limite, setLimite] = useState(30);
  const [esAdmin, setEsAdmin] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true); setMsg(null);
    try {
      const r = await admin.alta({ email, nombre, limite, esAdmin });
      setMsg({ ok: true, texto: `Dado de alta: ${r.periodista.email}. Ya puede entrar: que pida su enlace en la pantalla de entrada.${r.acceso_creado ? '' : ' Ya tenía acceso.'}` });
      setEmail(''); setNombre(''); setLimite(30); setEsAdmin(false);
      alAlta();
    } catch (err) {
      setMsg({ ok: false, texto: texto(err) });
      // Alta hecha o quizá hecha pero sin acceso: se recarga la lista para ofrecer «Crear acceso» en su fila.
      if (err instanceof AltaError && (err.periodistaCreado || err.quizaCreado || err.code === '409')) alAlta();
    }
    setEnviando(false);
  };

  return (
    <form className="panel" onSubmit={enviar}>
      <h2>Dar de alta</h2>
      <div className="admin__alta">
        <Field label="Correo" id="a-email"><input id="a-email" type="email" required className="bboe-input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nombre (opcional)" id="a-nombre"><input id="a-nombre" className="bboe-input" maxLength={200} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Preguntas al día" id="a-limite"><input id="a-limite" type="number" min={1} max={1000} className="bboe-input" value={limite} onChange={(e) => setLimite(Number(e.target.value))} /></Field>
      </div>
      <label className="multi__op"><input type="checkbox" checked={esAdmin} onChange={(e) => setEsAdmin(e.target.checked)} /> Administrador (puede dar de alta y gestionar periodistas)</label>
      <div><Button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Dar de alta'}</Button></div>
      {msg ? <p className={msg.ok ? 'bboe-meta' : 'admin__error'} role={msg.ok ? 'status' : 'alert'}>{msg.texto}</p> : null}
    </form>
  );
}

function Fila({ p, alCambio }: { p: Periodista; alCambio: () => void }) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'baja' | 'quitar-admin' | 'reactivar'>('ver');
  const [nombre, setNombre] = useState(p.nombre ?? '');
  const [limite, setLimite] = useState(p.limite_diario);
  const [esAdmin, setEsAdmin] = useState(p.es_admin);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const crearAcceso = async () => {
    setError(null); setInfo(null);
    try {
      const r = await admin.acceso(p.email);
      setInfo(r.acceso_creado ? 'Acceso creado. Ya puede pedir su enlace en la pantalla de entrada.' : 'Ya tenía acceso.');
    } catch (e) { setError(texto(e)); }
  };

  const ejecutar = async (cambio: Parameters<typeof admin.modificar>[1]) => {
    setError(null);
    try { await admin.modificar(p.email, cambio); setModo('ver'); alCambio(); } catch (e) { setError(texto(e)); }
  };
  const guardar = () => {
    if (p.es_admin && !esAdmin && modo !== 'quitar-admin') { setModo('quitar-admin'); return; }
    void ejecutar({ nombre, limite, esAdmin });
  };

  return (
    <div className={`admin__fila${p.activo ? '' : ' admin__fila--baja'}`}>
      <div className="admin__datos">
        <strong>{p.email}</strong>
        <span className="bboe-meta">{p.nombre ?? 'Sin nombre'} · {p.limite_diario} preguntas al día · hoy: {p.consultas_hoy}</span>
        <span className="bboe-card__row">
          {p.activo ? <Badge tone="neutral">Activo</Badge> : <Badge tone="warn">De baja</Badge>}
          {p.es_admin ? <Badge tone="restricted">Administrador</Badge> : null}
        </span>
      </div>
      <div className="admin__acciones">
        {modo === 'ver' ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => { setNombre(p.nombre ?? ''); setLimite(p.limite_diario); setEsAdmin(p.es_admin); setModo('editar'); }}>Editar</Button>
            {p.activo ? <Button variant="secondary" size="sm" onClick={() => void crearAcceso()}>Crear acceso</Button> : null}
            {p.activo ? <Button variant="secondary" size="sm" onClick={() => setModo('baja')}>Dar de baja</Button> : <Button variant="secondary" size="sm" onClick={() => (p.es_admin ? setModo('reactivar') : void ejecutar({ activo: true }))}>Reactivar</Button>}
          </>
        ) : null}
      </div>
      {modo === 'editar' || modo === 'quitar-admin' ? (
        <div className="admin__edicion">
          <Field label="Nombre" id={`n-${p.email}`}><input id={`n-${p.email}`} className="bboe-input" maxLength={200} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
          <Field label="Preguntas al día" id={`l-${p.email}`}><input id={`l-${p.email}`} type="number" min={1} max={1000} className="bboe-input" value={limite} onChange={(e) => setLimite(Number(e.target.value))} /></Field>
          <label className="multi__op"><input type="checkbox" checked={esAdmin} onChange={(e) => setEsAdmin(e.target.checked)} /> Administrador</label>
          {modo === 'quitar-admin' ? <p className="admin__confirma" role="alert">¿Quitar el rol de administrador a {p.email}? Dejará de ver esta pantalla.</p> : null}
          <div className="admin__botones">
            <Button size="sm" onClick={guardar}>{modo === 'quitar-admin' ? 'Sí, quitar el rol' : 'Guardar'}</Button>
            <Button variant="secondary" size="sm" onClick={() => { setModo('ver'); setError(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {modo === 'reactivar' ? (
        <div className="admin__edicion">
          <p className="admin__confirma" role="alert">¿Reactivar a {p.email}? Era administrador y recupera también ese rol: podrá dar de alta y gestionar periodistas.</p>
          <div className="admin__botones">
            <Button size="sm" onClick={() => void ejecutar({ activo: true })}>Sí, reactivar</Button>
            <Button variant="secondary" size="sm" onClick={() => { setModo('ver'); setError(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {modo === 'baja' ? (
        <div className="admin__edicion">
          <p className="admin__confirma" role="alert">¿Dar de baja a {p.email}? No podrá entrar ni buscar. Puedes reactivarlo cuando quieras; no se borra nada.</p>
          <div className="admin__botones">
            <Button size="sm" onClick={() => void ejecutar({ activo: false })}>Sí, dar de baja</Button>
            <Button variant="secondary" size="sm" onClick={() => { setModo('ver'); setError(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {info ? <p className="bboe-meta admin__info" role="status">{info}</p> : null}
      {error ? <p className="admin__error" role="alert">{error}</p> : null}
    </div>
  );
}

const mesLargo = (iso: string) => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const dinero = (usd: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd)} $`;
const miles = (n: number) => new Intl.NumberFormat('es-ES').format(n);

// Primer día del mes en curso en Madrid, como lo devuelve la API («2026-11-01»).
const mesActual = () => `${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7)}-01`;

function Gasto() {
  const { data, cargando, error, reintentar } = useAsync(() => api.gasto(3), 'gasto');
  const actual = data?.find((m) => m.mes === mesActual());
  return (
    <section className="panel">
      <h2>Gasto en IA</h2>
      <p className="bboe-meta">Coste de la IA por mes (últimos tres): las preguntas de los periodistas y los resúmenes que genera la carga diaria del BOE. No muestra qué pregunta nadie. El gasto de los resúmenes se registra desde el 25 de noviembre de 2026.</p>
      {cargando ? <p className="bboe-meta">Cargando…</p> : error ? (
        <p className="admin__error">No se pudo cargar el gasto. <button type="button" className="enlace" onClick={reintentar}>Reintentar</button></p>
      ) : data?.length ? (
        <>
          <p className="gasto__mes">
            Este mes, hasta hoy: <strong>{dinero((actual?.coste_usd ?? 0) + (actual?.ingesta_coste_usd ?? 0))}</strong>
            <span className="bboe-meta"> · preguntas {dinero(actual?.coste_usd ?? 0)} · resúmenes {dinero(actual?.ingesta_coste_usd ?? 0)}</span>
          </p>
          <div className="filas">
            {data.map((m) => (
              <div key={m.mes} className="fila">
                <span>
                  <strong>{mesLargo(m.mes)}</strong>{' '}
                  <span className="bboe-meta">
                    {miles(m.preguntas)} preguntas · {m.usuarios} {m.usuarios === 1 ? 'persona' : 'personas'} · {dinero(m.coste_usd)}
                    {' · '}{miles(m.ingesta_fichas)} resúmenes · {dinero(m.ingesta_coste_usd)}
                  </span>
                </span>
                <span><strong>{dinero(m.coste_usd + m.ingesta_coste_usd)}</strong></span>
              </div>
            ))}
          </div>
        </>
      ) : <p className="bboe-meta">Aún no hay gasto este periodo.</p>}
    </section>
  );
}

function Registro() {
  const [abierto, setAbierto] = useState(false);
  const { data, cargando, error } = useAsync(() => (abierto ? admin.log() : Promise.resolve(null)), `log-${abierto}`);
  return (
    <details className="panel" onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}>
      <summary><h2 style={{ display: 'inline' }}>Registro de cambios</h2></summary>
      {abierto ? (cargando ? <p className="bboe-meta">Cargando…</p> : error ? <p className="admin__error">{error.message || 'No se pudo cargar el registro.'}</p> : (
        <div className="filas">
          {data?.length ? data.map((f) => (
            <div key={f.id} className="fila">
              <span><strong>{f.accion}</strong> {f.email ?? ''} <span className="bboe-meta">por {f.actor}</span></span>
              <span className="bboe-meta">{new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(f.creado_en))}</span>
            </div>
          )) : <p className="bboe-meta">Aún no hay cambios.</p>}
        </div>
      )) : null}
    </details>
  );
}

export function Admin() {
  const { email } = useSesion();
  const { cargando: cargandoRol, esAdmin } = useEsAdmin(email);
  const [v, setV] = useState(0);
  const lista = useAsync(() => (esAdmin ? admin.listar() : Promise.resolve([])), `lista-${esAdmin}-${v}`);

  if (cargandoRol) return <Esqueletos n={1} />;
  if (!esAdmin) return <div className="aviso"><h2>No tienes permiso para ver esta página</h2><p><Link className="enlace" to="/">← Volver al buscador</Link></p></div>;

  return (
    <div className="admin">
      <h1>Administración de periodistas</h1>
      <p className="bboe-meta">Quién puede entrar en el buscador y cuántas preguntas puede hacer al día. Dar de baja no borra a nadie.</p>
      <Alta alAlta={() => setV((n) => n + 1)} />
      <section className="panel">
        <h2>Periodistas</h2>
        {lista.cargando ? <p className="bboe-meta">Cargando…</p> : lista.error ? <p className="admin__error">{lista.error.message || 'No se pudo cargar la lista.'} <button type="button" className="enlace" onClick={lista.reintentar}>Reintentar</button></p> : (
          <div className="admin__lista">{lista.data?.map((p) => <Fila key={p.email} p={p} alCambio={() => setV((n) => n + 1)} />)}</div>
        )}
      </section>
      <Gasto />
      <Registro />
    </div>
  );
}
