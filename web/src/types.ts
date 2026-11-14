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
export type Sumario = { fecha: string; total: number; secciones: { seccion: string; seccion_nombre: string; publicaciones: Ficha[] }[] };
export type Conteo = { agrupar: string; grupos: { grupo: string; n: number }[] };
