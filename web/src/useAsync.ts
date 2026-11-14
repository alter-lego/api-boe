import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export function useAsync<T>(fn: () => Promise<T>, clave: string) {
  const [estado, setEstado] = useState<{ data: T | null; error: ApiError | null; cargando: boolean }>({ data: null, error: null, cargando: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    fnRef.current().then(
      (data) => vivo && setEstado({ data, error: null, cargando: false }),
      (e) => vivo && setEstado({ data: null, error: e instanceof ApiError ? e : new ApiError(502, ''), cargando: false }),
    );
    return () => { vivo = false; };
  }, [clave, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  return { ...estado, reintentar };
}
