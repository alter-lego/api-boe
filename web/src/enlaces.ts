// Solo se pintan enlaces https hacia el BOE (boe.es o *.boe.es). Cualquier otra cosa no se muestra.
export function enlaceBoe(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return null;
    const h = x.hostname.toLowerCase();
    return h === 'boe.es' || h.endsWith('.boe.es') ? x.toString() : null;
  } catch {
    return null;
  }
}
