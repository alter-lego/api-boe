// Componentes del design system «Buscador del BOE» (ver Claude Design). Usan components.css y tokens.css.
import { ConInicioDestacado } from '../destacar';
import type { ReactNode } from 'react';
import { enlaceBoe } from '../enlaces';
import { etiquetaTema, etiquetaTipo, fechaCorta } from '../labels';
import type { Ficha } from '../types';

export function Button({ variant = 'primary', size = 'md', type = 'button', ...p }: { variant?: 'primary' | 'secondary'; size?: 'md' | 'sm'; type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void; children: ReactNode; 'aria-label'?: string; 'aria-expanded'?: boolean }) {
  return <button type={type} className={`bboe-btn bboe-btn--${variant} bboe-btn--${size}`} {...p} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn' | 'danger' | 'restricted'; children: ReactNode }) {
  return <span className={`bboe-badge bboe-badge--${tone}`}>{children}</span>;
}

export function FreshnessBar({ state, children }: { state: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className="bboe-fresh" role="status">
      <span className={`bboe-dot bboe-dot--${state}`} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="bboe-field">
      <label className="bboe-field__label" htmlFor={id}>{label}</label>
      {children}
      {hint ? <span className="bboe-meta">{hint}</span> : null}
    </div>
  );
}

function indicadores(f: Ficha) {
  const out: { tone: 'warn' | 'danger'; text: string }[] = [];
  if (f.estatus_derogacion && f.estatus_derogacion !== 'N') out.push({ tone: 'warn', text: 'Derogada' });
  if (f.judicialmente_anulada) out.push({ tone: 'danger', text: 'Anulada judicialmente' });
  if (f.vigencia_agotada) out.push({ tone: 'warn', text: 'Vigencia agotada' });
  if (f.aviso_fuente) out.push({ tone: 'warn', text: f.aviso_fuente });
  return out;
}

export const estadoResumen = (f: Ficha): 'summary' | 'noSummary' | 'review' | 'pending' =>
  f.nivel_privacidad === 'restringido' ? 'noSummary' : f.ficha_revisar ? 'review' : f.resumen ? 'summary' : 'pending';

export function IA() {
  return (
    <span className="bboe-card__ai" tabIndex={0} title="Generado por IA a partir del texto oficial. Consulta siempre el BOE antes de citar.">
      Generado con IA ⓘ
    </span>
  );
}

export function EnlacesBoe({ f }: { f: Ficha }) {
  const html = enlaceBoe(f.url_html);
  const pdf = enlaceBoe(f.url_pdf);
  const links = [html && { label: 'BOE (HTML)', href: html }, pdf && { label: 'PDF', href: pdf }].filter(Boolean) as { label: string; href: string }[];
  return (
    <div className="bboe-card__links">
      {links.length ? links.map((l) => <a key={l.label} className="bboe-card__link" href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>) : <span className="bboe-meta">Sin enlace disponible</span>}
    </div>
  );
}

export function ResultCard({ f, ocultarTipo, enlace }: { f: Ficha; ocultarTipo?: boolean; enlace: ReactNode }) {
  const status = estadoResumen(f);
  const meta = [fechaCorta(f.fecha), f.seccion_nombre, f.departamento].filter(Boolean).join(' · ');
  const tema = f.temas?.length ? f.temas.map(etiquetaTema).join(', ') : null;
  const ind = indicadores(f);
  return (
    <article className="bboe-card">
      <div className="bboe-meta">{meta}</div>
      {!ocultarTipo && f.tipo_acto && status !== 'noSummary' ? <div className="bboe-card__kicker">{etiquetaTipo(f.tipo_acto)}</div> : null}
      {enlace}
      {f.corrige_a ? <p className="bboe-meta">Corrige: {f.corrige_a}</p> : null}
      {status === 'summary' ? <p className="bboe-card__summary"><ConInicioDestacado texto={f.resumen ?? ''} /> <IA /></p> : null}
      {status === 'noSummary' ? (
        <div className="bboe-card__row">
          <Badge tone="restricted">Sin resumen</Badge>
          <span className="bboe-meta">Esta sección puede incluir datos personales; por eso no generamos resumen. Consulta el texto en el BOE.</span>
        </div>
      ) : null}
      {status === 'review' ? <div className="bboe-card__row"><Badge tone="warn">Resumen pendiente de revisión</Badge></div> : null}
      {status === 'pending' ? <p className="bboe-meta">Resumen aún no disponible</p> : null}
      {tema && status !== 'noSummary' ? <p className="bboe-meta">Tema: {tema}</p> : null}
      {ind.length ? <div className="bboe-card__row">{ind.map((x, i) => <Badge key={i} tone={x.tone}>{x.text}</Badge>)}</div> : null}
      <EnlacesBoe f={f} />
    </article>
  );
}
