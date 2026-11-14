import { enlaceBoe } from './enlaces';
import { fechaLarga } from './labels';

// Referencia lista para pegar: título oficial, identificador, fecha y enlace al BOE (solo si es un enlace válido).
export function textoCita(x: { titulo: string; id: string; fecha: string; url_html: string | null }) {
  const url = enlaceBoe(x.url_html);
  return `${x.titulo} ${x.id}, de ${fechaLarga(x.fecha)}.${url ? ` ${url}` : ''}`;
}
