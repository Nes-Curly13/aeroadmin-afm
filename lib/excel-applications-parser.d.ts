/**
 * Tipos del parser del Excel del operador fumigador.
 * Vive en .d.ts para que los tests en TS lo importen con tipos.
 */

export interface ExcelApplicationRow {
  source: { sheet: string; row_idx: number };
  fecha: Date | null;
  hacienda: string | null;
  suerte: string | null;
  piloto: string | null;
  drone: string | null;
  transporte: string | null;
  tipo_aplicacion: string | null;
  altura_m: number | null;
  velocidad_m_s: number | null;
  area_aplicada: number | null;
  unidad_area: "ha" | "m2";
  area_ot: number | null;
  ancho_franja_m: number | null;
  dosis_l_ha: number | null;
  volumen_l: number | null;
  zona: string | null;
  cliente: string | null;
  numero_factura: string | null;
  fecha_facturacion: Date | null;
  valor_factura_cop: number | null;
  cancelada: string | null;
  horas_planta: number | null;
}

export interface ParseExcelOptions {
  areaUnit?: "ha" | "m2";
  sheets?: string[];
}

export function parseExcelApplications(
  xlsxPath: string,
  options?: ParseExcelOptions
): ExcelApplicationRow[];
