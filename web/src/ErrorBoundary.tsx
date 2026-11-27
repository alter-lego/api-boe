// Si una pantalla falla al pintarse, se enseña un aviso en vez de dejar la página en blanco (auditoría, apartado 3).
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };
  static getDerivedStateFromError() { return { fallo: true }; }
  componentDidCatch(e: unknown) { console.error('error al pintar la página:', e); }
  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div className="aviso" role="alert">
        <h2>Algo ha fallado al mostrar esta página</h2>
        <p><a className="enlace" href="/">← Volver al buscador</a></p>
      </div>
    );
  }
}
