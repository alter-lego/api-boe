import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  // Una compilación (lo que se despliega) tiene que ser en modo api: en modo prueba la web no pide sesión y
  // enseña datos de ejemplo (auditoría del 26/11/2026, 1.7). Para compilar a propósito en modo prueba:
  // `vite build --mode prueba`. El servidor de desarrollo (`npm run dev`) no se ve afectado.
  if (command === 'build' && mode !== 'prueba') {
    const modo = process.env.VITE_MODO ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_MODO;
    if (modo !== 'api') {
      throw new Error(`VITE_MODO es «${modo ?? '(vacío)'}»: para desplegar hay que compilar con VITE_MODO=api (o usa --mode prueba si de verdad quieres una compilación de prueba).`);
    }
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
  };
});
