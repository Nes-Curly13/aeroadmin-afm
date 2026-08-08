// lib/reports/parcel-csv.ts
//
// Serializador CSV para el reporte de una parcela (feature/reports-level-1).
// Mismo shape de data que el PDF (`ParcelReportData`) pero orientado a
// análisis: una sección de header (key/value), una tabla de fumigaciones
// con todas las columnas, y una sección de totales al final.
//
// Decisiones:
//   - **Separador `;`** y **BOM `\uFEFF`**: Excel-CO lo abre bien y
//     respeta tildes/ñ. Mismo patrón que `lib/csv.ts` (usado por el
//     botón de export de fumigaciones en /parcelas/[id]).
//   - **RFC 4180 quoting**: caracteres `"`, `;`, `\n` dentro de un
//     valor se escapan con `"..."` y las `"` internas se duplican.
//   - **Decimales con coma**: Excel-CO usa coma como separador decimal.
//     `Number.toLocaleString("de-DE")` produce "12,50".
//   - **4 secciones delimitadas** por filas que empiezan con "Sección":
//     Cabecera, Parcela, Fumigaciones, Totales. Las filas vacías entre
//     secciones ayudan al lector a identificarlas.
//   - **Función pura**: no toca BD, no lee filesystem. El caller
//     (route handler) ya tiene el `ParcelReportData` cacheado.
//
// Out of scope (este sprint):
//   - CSV por hacienda (nivel 2) — usa otra shape de data.
//   - CSV multi-parcela (nivel 3) — usa otra shape de data.

import type {
  CadenceStatus,
  ParcelReportData,
  ParcelReportEvent
} from "./fetch-parcel-report-data";

/** Caracteres que disparan quoting RFC 4180 (mismo que lib/csv.ts). */
const QUOTE_NEEDED = /[";\n\r]/;

/** Escapa un valor individual según RFC 4180. null/undefined → "". */
function quoteValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!QUOTE_NEEDED.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Une los valores de una fila con `;` y agrega `\n` final. */
function row(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(quoteValue).join(";") + "\n";
}

/** Formato es-CO: 12,50 (coma decimal). */
function fmtDec(value: number, decimals: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Mapea el status de cadencia a label humano (mismo que el PDF). */
function statusLabel(status: CadenceStatus): string {
  switch (status) {
    case "ok":
      return "Al día";
    case "due_soon":
      return "Por vencer";
    case "overdue":
      return "Vencida";
    case "no_history":
    default:
      return "Sin historial";
  }
}

/** Convierte un evento del reporte en una fila del CSV. */
function eventToRow(e: ParcelReportEvent): string {
  const areaHa =
    e.area_fumigated_ha === null ? null : fmtDec(e.area_fumigated_ha, 2);
  const duration = e.duration_minutes === null ? null : e.duration_minutes;
  const volume =
    e.dose_l_per_ha !== null && e.area_fumigated_ha !== null
      ? fmtDec(e.dose_l_per_ha * e.area_fumigated_ha, 2)
      : null;
  return row([
    e.fumigation_date,
    e.drone_nickname,
    e.pilot_name ?? e.recorded_by,
    areaHa,
    duration,
    volume,
    e.product_used,
    e.notes
  ]);
}

/** Construye el CSV de un reporte de parcela.
 *  Devuelve un string con BOM + 4 secciones (Cabecera, Parcela,
 *  Fumigaciones, Totales) delimitadas por filas "Sección;...". */
export function buildParcelReportCsv(data: ParcelReportData): string {
  let out = "\uFEFF"; // BOM único al inicio

  // --- Sección: Cabecera ---
  out += row(["Sección", "Cabecera"]);
  out += row(["Campo", "Valor"]);
  out += row(["Operador", data.operatorName]);
  out += row(["Región", data.operatorRegion]);
  out += row(["Generado", data.generatedAt]);
  out += row(["Ventana desde", data.window.from]);
  out += row(["Ventana hasta", data.window.to]);
  out += "\n";

  // --- Sección: Parcela ---
  out += row(["Sección", "Parcela"]);
  out += row(["Campo", "Valor"]);
  out += row(["ID interno", String(data.parcel.id)]);
  out += row(["ID externo", data.parcel.external_id]);
  out += row(["Nombre", data.parcel.land_name]);
  out += row(["Tipo", data.parcel.field_type]);
  out += row([
    "Área declarada (ha)",
    data.parcel.declared_area_ha === null
      ? null
      : fmtDec(data.parcel.declared_area_ha, 2)
  ]);
  out += row([
    "Área fumigable (ha)",
    data.parcel.spray_area_m2 === null
      ? null
      : fmtDec(data.parcel.spray_area_m2 / 10_000, 2)
  ]);
  out += row(["Cultivo", data.parcel.crop_type]);
  out += row(["Fecha de siembra", data.parcel.planting_date]);
  out += row(["Propietario", data.parcel.owner_name]);
  out += row([
    "Cadencia recomendada (días)",
    data.cadence.recommended_cadence_days
  ]);
  out += row(["Estado de cadencia", statusLabel(data.cadence.status)]);
  out += row(["Última fumigación", data.cadence.last_fumigation_date]);
  out += row(["Próxima fumigación", data.cadence.next_due_date]);
  out += row(["Notas del supervisor", data.parcel.supervisor_notes]);
  out += "\n";

  // --- Sección: Fumigaciones (tabla) ---
  const capNote = data.totals.capReached
    ? `, mostrando primeras ${data.events.length}`
    : "";
  out += row(["Sección", `Fumigaciones (${data.totals.count}${capNote})`]);
  out += row([
    "Fecha",
    "Dron",
    "Piloto/Registrador",
    "Área fumigada (ha)",
    "Duración (min)",
    "Volumen (L)",
    "Producto",
    "Notas"
  ]);
  for (const e of data.events) {
    out += eventToRow(e);
  }
  out += "\n";

  // --- Sección: Totales ---
  out += row(["Sección", "Totales"]);
  out += row(["Concepto", "Valor"]);
  out += row(["Fumigaciones en el rango", String(data.totals.count)]);
  out += row([
    "Área fumigada total (ha)",
    fmtDec(data.totals.totalAreaHa, 2)
  ]);
  out += row([
    "Volumen aplicado total (L)",
    fmtDec(data.totals.totalLiters, 2)
  ]);
  out += row([
    "Área promedio por fumigación (ha)",
    data.totals.count > 0 ? fmtDec(data.totals.averageAreaHa, 2) : null
  ]);
  out += row(["Última fumigación del rango", data.totals.lastFumigationDate]);
  out += row([
    "Cobertura del mes — área fumigable (ha)",
    data.coverage.areaFumigableHa === null ||
      data.coverage.areaFumigableHa === undefined
      ? null
      : fmtDec(data.coverage.areaFumigableHa, 2)
  ]);
  out += row([
    "Cobertura del mes — área fumigada (ha)",
    fmtDec(data.coverage.areaFumigadaHa, 2)
  ]);
  out += row([
    "Cobertura del mes — porcentaje (%)",
    data.coverage.coveragePct === null
      ? null
      : fmtDec(data.coverage.coveragePct, 1)
  ]);

  return out;
}
