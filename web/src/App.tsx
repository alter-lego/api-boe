import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { Admin } from './pages/Admin';
import { Detalle } from './pages/Detalle';
import { Entrar } from './pages/Entrar';
import { Inicio } from './pages/Inicio';
import { Preguntar } from './pages/Preguntar';
import { Resultados } from './pages/Resultados';
import { PREGUNTAR_ACTIVO } from './config';
import { DiaDeHoy, Sumario } from './pages/Sumario';

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/buscar" element={<Resultados />} />
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
