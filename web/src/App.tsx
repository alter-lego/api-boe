import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { Admin } from './pages/Admin';
import { Confirmar } from './pages/Confirmar';
import { Detalle } from './pages/Detalle';
import { Entrar } from './pages/Entrar';
import { Inicio } from './pages/Inicio';
import { Persona } from './pages/Persona';
import { Portada } from './pages/Portada';
import { Preguntar } from './pages/Preguntar';
import { Buscar } from './pages/Resultados';
import { PREGUNTAR_ACTIVO } from './config';
import { DiaDeHoy, Sumario } from './pages/Sumario';

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/confirmar" element={<Confirmar />} />
      <Route element={<Layout />}>
        <Route path="/" element={PREGUNTAR_ACTIVO ? <Portada /> : <Inicio />} />
        <Route path="/buscar" element={<Buscar />} />
        <Route path="/persona" element={<Persona />} />
        <Route path="/publicacion/:id" element={<Detalle />} />
        {PREGUNTAR_ACTIVO ? <Route path="/preguntar" element={<Preguntar />} /> : null}
        <Route path="/admin" element={<Admin />} />
        <Route path="/dia" element={<DiaDeHoy />} />
        <Route path="/dia/:fecha" element={<Sumario />} />
        <Route path="*" element={<div className="aviso"><h2>No encontramos esa página</h2><p><Link className="enlace" to="/">← Volver al buscador</Link></p></div>} />
      </Route>
    </Routes>
  );
}
