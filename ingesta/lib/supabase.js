// Cliente mínimo de la API REST de Supabase con la clave secreta (solo ingesta, nunca en la web).
// Sin dependencias: fetch directo a PostgREST.

export function crearCliente({ url, claveSecreta, fetchFn = fetch }) {
  if (!url || !claveSecreta) throw new Error('faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const cabeceras = {
    apikey: claveSecreta,
    Authorization: `Bearer ${claveSecreta}`,
    'Content-Type': 'application/json',
  };

  async function peticion(ruta, { method = 'GET', body, prefer } = {}) {
    const res = await fetchFn(`${base}/${ruta}`, {
      method,
      headers: { ...cabeceras, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detalle = (await res.text()).slice(0, 300);
      throw new Error(`Supabase ${method} ${ruta.split('?')[0]} → HTTP ${res.status}: ${detalle}`);
    }
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  return {
    /** Inserta o actualiza. Solo se actualizan las columnas presentes en las filas. */
    upsert: (tabla, filas, conflicto) =>
      peticion(`${tabla}?on_conflict=${conflicto}`, {
        method: 'POST',
        body: filas,
        prefer: 'resolution=merge-duplicates,return=representation',
      }),
    /** Actualiza las filas que cumplen el filtro (p. ej. 'id=eq.BOE-A-2026-1'). */
    parchear: (tabla, filtro, cuerpo) =>
      peticion(`${tabla}?${filtro}`, { method: 'PATCH', body: cuerpo, prefer: 'return=minimal' }),
    insertar: (tabla, fila) =>
      peticion(tabla, { method: 'POST', body: fila, prefer: 'return=minimal' }),
    seleccionar: (ruta) => peticion(ruta),
  };
}
