// «Buscar a una persona»: busca un nombre en todo el BOE cargado y agrupa los resultados según dónde aparece.
// Los grupos los decide la base de datos (buscar_persona, migración 15): nombre exacto en el título, en el
// resumen, o solo en el texto completo, donde puede ser otra persona o un apellido parecido.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Button, Field, ResultCard } from '../ds';
import { ErrorCarga, Esqueletos } from '../Estados';
import { fechaCorta } from '../labels';
import type { Coincidencia, ResultadoPersona } from '../types';
import { useAsync } from '../useAsync';

const GRUPOS: { clave: Coincidencia; titulo: string; nota?: string }[] = [
  { clave: 'titulo', titulo: 'Con el nombre en el título' },
  { clave: 'resumen', titulo: 'Con el nombre en el resumen' },
  {
    clave: 'texto',
    titulo: 'Con el nombre en el texto',
    nota: 'Coinciden en el texto completo, pero puede ser otra persona o un apellido parecido (al buscar «Herrero» también salen «Herrera» o «herreros»). Compruébalo siempre en el BOE.',
  },
];

function Formulario({ nombre, desde, hasta }: { nombre: string; desde: string; hasta: string }) {
  const nav = useNavigate();
  const [n, setN] = useState(nombre);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (n.trim()) p.set('nombre', n.trim());
    if (d) p.set('desde', d);
    if (h) p.set('hasta', h);
    nav(`/persona?${p}`);
  };
  return (
    <form onSubmit={enviar} className="buscador persona__form">
      <div className="buscador__fila">
        <Field label="Nombre y apellidos" id="nombre">
          <input id="nombre" className="bboe-input bboe-input--lg" value={n} onChange={(e) => setN(e.target.value)} placeholder="Por ejemplo: Ana Pérez Gil" autoComplete="off" required minLength={2} maxLength={100} aria-describedby="nombre-pista" />
        </Field>
        <div className="buscador__botones"><Button type="submit">Buscar</Button></div>
      </div>
      <p id="nombre-pista" className="bboe-meta persona__pista">Sin tildes ni mayúsculas también vale. Mejor con los dos apellidos.</p>
      <div className="persona__fechas">
        <Field label="Desde (opcional)" id="p-desde"><input id="p-desde" type="date" className="bboe-input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Hasta (opcional)" id="p-hasta"><input id="p-hasta" type="date" className="bboe-input" value={h} onChange={(e) => setH(e.target.value)} /></Field>
      </div>
    </form>
  );
}

function Resultados({ nombre, desde, hasta }: { nombre: string; desde: string; hasta: string }) {
  const { data, error, cargando, reintentar } = useAsync(() => api.personas(nombre, desde || undefined, hasta || undefined), `${nombre}|${desde}|${hasta}`);
  if (cargando) return <Esqueletos />;
  if (error) {
    return error.status === 400 && error.message
      ? <div className="aviso" role="alert"><h2>Revisa el nombre</h2><p>{error.message.charAt(0).toUpperCase() + error.message.slice(1)}.</p></div>
      : <ErrorCarga error={error} reintentar={reintentar} />;
  }
  if (!data) return null;
  const rango = desde || hasta ? ` · ${desde ? fechaCorta(desde) : '…'} – ${hasta ? fechaCorta(hasta) : '…'}` : '';
  if (data.n === 0) {
    return (
      <div className="aviso" aria-live="polite">
        <p>No hay ninguna publicación con «{nombre}»{rango}.</p>
        <p className="bboe-meta">Prueba solo con los apellidos, o sin el segundo nombre.</p>
      </div>
    );
  }
  const total = data.totales.titulo + data.totales.resumen + data.totales.texto;
  return (
    <>
      <h2 aria-live="polite">{total} publicacion{total === 1 ? '' : 'es'} con «{nombre}»{rango}</h2>
      {data.n < total ? <p className="bboe-meta">Se muestran las {data.n} primeras: primero las que tienen el nombre en el título o el resumen. Acota las fechas para ver el resto.</p> : null}
      {GRUPOS.map((g) => {
        const lista: ResultadoPersona[] = data.resultados.filter((x) => x.coincidencia === g.clave);
        const n = data.totales[g.clave];
        if (!n) return null;
        return (
          <section key={g.clave} className="persona__grupo" aria-labelledby={`grupo-${g.clave}`}>
            <h3 id={`grupo-${g.clave}`}>{g.titulo} <span className="num">({n}{lista.length < n ? `, se muestran ${lista.length}` : ''})</span></h3>
            {g.nota ? <p className="bboe-meta">{g.nota}</p> : null}
            {lista.length ? (
              <div className="lista">
                {lista.map((x) => (
                  <ResultCard key={x.id} f={x} enlace={<Link className="bboe-card__title" to={`/publicacion/${x.id}`} state={{ origen: 'buscar' }}>{x.titulo}</Link>} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

export function Persona() {
  const [params] = useSearchParams();
  const nombre = params.get('nombre')?.trim() ?? '';
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';
  return (
    <div className="resultados persona">
      <p><Link className="enlace" to="/buscar">← Buscar por palabras y filtros</Link></p>
      <h1>Buscar a una persona</h1>
      <p className="bboe-meta">
        Busca un nombre en todo el BOE cargado. Primero salen las publicaciones con ese nombre exacto en el título o en el resumen;
        después, las que lo tienen en el texto. De los anuncios con datos personales (justicia, oposiciones y particulares) solo verás el título y el enlace al BOE.
      </p>
      <Formulario key={params.toString()} nombre={nombre} desde={desde} hasta={hasta} />
      {nombre ? <Resultados nombre={nombre} desde={desde} hasta={hasta} /> : null}
    </div>
  );
}
