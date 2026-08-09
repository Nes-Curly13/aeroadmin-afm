// lib/reports/farms-csv.ts
//
// Serializer CSV para el reporte de fumigaciones por hacienda /
// multi-hacienda (nivel 2 de feature/reports-level, 2026-08-08).
//
// Mismo patrón que `parcel-csv.ts`:
//   - Separador `;`, BOM UTF-8, RFC 4180 quoting
//   - Decimales con coma (es-CO)
//   - 4 secciones delimitadas por filas "Sección;..."
//   - Función pura, no toca BD ni filesystem
//
// Shape del CSV (orden):
//   1. Cabecera: operador, región, generado, ventana, hacienda (si aplica)
//   2. Última fumigación destacada (key/value) — 1 fila
//   3. Totales (key/value) — 4 filas
//   4. Por parcela (tabla) — N filas
//   5. Fumigaciones (tabla) — N filas (sin cap, todo el rango)

import type {
  FarmsFumigationRow,
  FarmsLastFumigation,
  FarmsParcelAgg,
  FarmsReportData
} from "./fetch-farms-report-data";

const QUOTE_NEEDED = /[";\n\r]/;

function quoteValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!QUOTE_NEEDED.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function row(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(quoteValue).join(";") + "\n";
}

function fmtDec(value: number, decimals: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(n);
}

function renderLastFumigationCsv(last: FarmsLastFumigation | null): string {
  let out = "";
  out += row(["Sección", "Última fumigación del rango"]);
  out += row(["Campo", "Valor"]);
  if (!last) {
    out += row(["Resultado", "Sin fumigaciones registradas en el rango."]);
    return out;
  }
  out += row(["Fecha", last.fumigation_date]);
  out += row(["Hacienda", last.farm_name]);
  out += row(["Parcela", last.parcel_name]);
  out += row(["Piloto", last.pilot_name]);
  out += row(["Dron", last.drone_nickname]);
  out += row(["Producto", last.product_used]);
  out += row([
    "Área fumigada (ha)",
    last.area_fumigated_ha === null ? null : fmtDec(last.area_fumigated_ha, 2)
  ]);
  out += row([
    "Volumen aplicado (L)",
    last.dose_l_per_ha !== null && last.area_fumigated_ha !== null
      ? fmtDec(last.dose_l_per_ha * last.area_fumigated_ha, 2)
      : null
  ]);
  return out;
}

function renderTotalsCsv(data: FarmsReportData): string {
  let out = "";
  out += row(["Sección", "Totales"]);
  out += row(["Concepto", "Valor"]);
  out += row(["Fumigaciones en el rango", String(data.totals.nFumigations)]);
  out += row(["Área fumigada total (ha)", fmtDec(data.totals.totalAreaHa, 2)]);
  out += row(["Volumen aplicado total (L)", fmtDec(data.totals.totalLiters, 2)]);
  out += row(["Parcelas activas", String(data.totals.nParcels)]);
  return out;
}

function renderParcelsCsv(parcels: FarmsParcelAgg[]): string {
  let out = "";
  out += row(["Sección", `Por parcela (${parcels.length})`]);
  out += row([
    "Parcela",
    "Hacienda",
    "Fumigaciones",
    "Área total (ha)",
    "Litros totales (L)",
    "Última fumigación"
  ]);
  for (const p of parcels) {
    out += row([
      p.parcel_name,
      p.farm_name,
      fmtInt(p.n_fumigations),
      fmtDec(p.total_area_ha, 2),
      fmtDec(p.total_liters, 2),
      p.last_fumigation_date
    ]);
  }
  return out;
}

function renderFumigationsCsv(fumigations: FarmsFumigationRow[]): string {
  let out = "";
  out += row(["Sección", `Fumigaciones (${fumigations.length})`]);
  out += row([
    "Fecha",
    "Parcela",
    "Hacienda",
    "Piloto",
    "Dron",
    "Área (ha)",
    "Volumen (L)",
    "Producto",
    "Registrador",
    "Notas"
  ]);
  for (const f of fumigations) {
    out += row([
      f.fumigation_date,
      f.parcel_name,
      f.farm_name,
      f.pilot_name,
      f.drone_nickname,
      f.area_fumigated_ha === null ? null : fmtDec(f.area_fumigated_ha, 2),
      f.dose_l_per_ha !== null && f.area_fumigated_ha !== null
        ? fmtDec(f.dose_l_per_ha * f.area_fumigated_ha, 2)
        : null,
      f.product_used,
      f.recorded_by,
      f.notes
    ]);
  }
  return out;
}

/** Construye el CSV del reporte de fumigaciones por hacienda. */
export function buildFarmsReportCsv(data: FarmsReportData): string {
  let out = "\uFEFF"; // BOM único al inicio

  // --- Sección: Cabecera ---
  out += row(["Sección", "Cabecera"]);
  out += row(["Campo", "Valor"]);
  out += row(["Operador", data.operatorName]);
  out += row(["Región", data.operatorRegion]);
  out += row(["Generado", data.generatedAt]);
  out += row(["Ventana desde", data.window.from]);
  out += row(["Ventana hasta", data.window.to]);
  out += row(["Filtro hacienda", data.farmName ?? "Todas"]);
  out += "\n";

  // --- Sección: Última fumigación ---
  out += renderLastFumigationCsv(data.lastFumigation);
  out += "\n";

  // --- Sección: Totales ---
  out += renderTotalsCsv(data);
  out += "\n";

  // --- Sección: Por parcela ---
  out += renderParcelsCsv(data.parcels);
  out += "\n";

  // --- Sección: Fumigaciones ---
  out += renderFumigationsCsv(data.fumigations);

  return out;
}
