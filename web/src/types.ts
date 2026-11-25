export type Ficha = {
  id: string;
  fecha: string;
  seccion: string | null;
  seccion_nombre: string | null;
  departamento_codigo: string | null;
  departamento: string | null;
  epigrafe: string | null;
  titulo: string;
  rango: string | null;
  url_html: string | null;
  url_pdf: string | null;
  url_xml: string | null;
  resumen: string | null;
  temas: string[] | null;
  tipo_acto: string | null;
  nivel_privacidad: 'publico' | 'restringido';
  corrige_a: string | null;
  referencias: unknown;
  aviso_fuente?: string | null;
  ficha_revisar?: boolean | null;
  estatus_derogacion?: string | null;
  judicialmente_anulada?: boolean | null;
  vigencia_agotada?: boolean | null;
  vigencia_actualizada?: string | null;
};

export type Filtros = {
  q?: string;
  desde?: string;
  hasta?: string;
  seccion?: string;
  organismo?: string;
  tema?: string[];
  tipo?: string;
  orden?: 'relevancia' | 'recientes';
};

export type Salud = { ok: boolean; ultima_ingesta: { fecha: string; fin: string } | null };
// Resumen editorial del día: Claude cita las publicaciones por id; título y enlaces salen de las fichas del sumario.
export type LineaResumen = { tema: string; texto: string; ids: string[] };
export type BloqueResumen = { ids: string[]; titulo: string; resumen: string; por_que_importa: string | null };
export type ApartadoResumen = 'ayudas' | 'oposiciones' | 'impuestos' | 'automocion';
export type ResumenDia = {
  generado_en: string;
  titulares: LineaResumen[];
  secciones: { titulo: string; bloques: BloqueResumen[]; lineas: LineaResumen[] }[];
  apartados: Partial<Record<ApartadoResumen, { id: string; texto: string | null }[]>>;
};
export type Sumario = { fecha: string; total: number; secciones: { seccion: string; seccion_nombre: string; publicaciones: Ficha[] }[]; resumen?: ResumenDia | null };
export type Conteo = { agrupar: string; grupos: { grupo: string; n: number }[] };

export type Cita = {
  id: string;
  titulo: string;
  fecha: string;
  organismo: string | null;
  seccion: string | null;
  nivel_privacidad: 'publico' | 'restringido';
  url_html: string | null;
  url_pdf: string | null;
  avisos?: string[];
};
export type Respuesta = {
  respuesta: string;
  citas: Cita[];
  sin_resultados: boolean;
  datos_desde: string;
  datos_hasta: string;
  preguntas_hoy: { usadas: number; limite: number };
};

/** Dónde aparece el nombre buscado: exacto en el título o el resumen, completo y seguido en el texto, o con las palabras sueltas en el texto (lo menos fiable). */
export type Coincidencia = 'titulo' | 'resumen' | 'seguido' | 'texto';
export type ResultadoPersona = Ficha & { coincidencia: Coincidencia };
export type BusquedaPersona = { n: number; totales: Record<Coincidencia, number>; resultados: ResultadoPersona[] };
