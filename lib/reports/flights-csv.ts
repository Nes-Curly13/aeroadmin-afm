// lib/reports/flights-csv.ts
//
// Serializer CSV del export "todos los vuelos" (feature TBD, 2026-08-30).
//
// Mismo patrón que `farms-csv.ts` / `fumigation-csv.ts`:
//   - Separador `;`, BOM UTF-8, RFC 4180 quoting
//   - Decimales con coma (es-CO) via `Intl.NumberFormat("de-DE")`
//   - 4 secciones delimitadas por filas "Sección;..."
//   - Función pura, no toca BD ni filesystem
//
// Shape del CSV (orden):
//   1. Cabecera: operador, ventana, filtros, totales
//   2. Vuelos (wide table) — 1 fila por flight, 42 columnas
//
// Decisión wide (42 columnas, ver `docs/reviews/flights-csv-export-review.md`
// §7.1): el destino es Excel / Google Sheets / análisis cruzado. Wide
// siempre es más fácil de pivotar que long (varias tablas).

import type { FlightsExportRow, FlightsReportData } from "./fetch-flights-report-data";

const QUOTE_NEEDED = /[";\n\r]/;

function quoteValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  if (!QUOTE_NEEDED.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function row(values: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return values.map(quoteValue).join(";") + "\n";
}

function fmtDec(value: number | string | null, decimals: number): string {
  if (value === null) return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n);
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(n);
}

function renderHeaderCsv(data: FlightsReportData): string {
  let out = "";
  out += row(["Sección", "Cabecera"]);
  out += row(["Campo", "Valor"]);
  out += row(["Operador", data.operatorName]);
  out += row(["Región", data.operatorRegion]);
  out += row(["Generado", data.generatedAt]);
  out += row(["Ventana desde", data.window.from]);
  out += row(["Ventana hasta", data.window.to]);
  out += row(["Filtro drone", data.filters.droneId != null ? `#${data.filters.droneId}` : "Todos"]);
  out += row([
    "Filtro piloto",
    data.filters.pilot ? `ILIKE '%${data.filters.pilot}%'` : "Todos"
  ]);
  out += row([
    "Filtro parcela",
    data.filters.parcelId != null ? `#${data.filters.parcelId}` : "Todas"
  ]);
  out += row(["Incluir orphan", data.filters.includeOrphans ? "Sí" : "No"]);
  out += row(["Incluir default team", data.filters.includeDefaultTeam ? "Sí" : "No"]);
  out += row(["Total flights", fmtInt(data.totals.nFlights)]);
  out += row(["Con parcel", fmtInt(data.totals.nWithParcel)]);
  out += row([
    "Sin parcel (orphan)",
    data.filters.includeOrphans ? fmtInt(data.totals.nOrphans) : "(filtrado)"
  ]);
  out += row([
    "Default team flights",
    data.filters.includeDefaultTeam ? fmtInt(data.totals.nDefaultTeam) : "(filtrado)"
  ]);
  if (data.capReached) {
    out += row([
      "⚠ Cap alcanzado",
      `El resultado se truncó a ${fmtInt(data.cap)} filas. Ajustá los filtros.`
    ]);
  }
  return out;
}

// Header de la tabla "Vuelos". 42 columnas en orden — debe matchear
// exactamente el orden de `renderFlightRowCsv`.
const FLIGHTS_TABLE_HEADER: ReadonlyArray<string> = [
  "flight_id",
  "parcel_id",
  "parcel_name",
  "parcel_external_id",
  "client_name",
  "farm_name",
  "municipality",
  "start_at",
  "end_at",
  "duration_seconds",
  "duration_min",
  "duration_human",
  "area_m2",
  "area_ha",
  "spray_usage_ml",
  "spray_usage_l",
  "drone_serial",
  "drone_nickname",
  "drone_model",
  "drone_model_code",
  "drone_registration",
  "pilot_name",
  "is_default_team",
  "is_orphan",
  "district",
  "location",
  "lng",
  "lat",
  "mode",
  "manual_mode",
  "work_speed_m_s",
  "spray_width_m",
  "radar_height_m",
  "fumigations_count",
  "fumigations_total_area_m2",
  "fumigations_total_volume_l",
  "source",
  "captured_at",
  "notes_summary"
];

function renderFlightRowCsv(f: FlightsExportRow): string {
  return row([
    f.flight_id,
    f.parcel_id,
    f.parcel_name,
    f.parcel_external_id,
    f.client_name,
    f.farm_name,
    f.municipality,
    f.start_at,
    f.end_at,
    f.duration_seconds,
    fmtDec(f.duration_min, 1),
    f.duration_human,
    fmtDec(f.area_m2, 2),
    fmtDec(f.area_ha, 2),
    f.spray_usage_ml,
    fmtDec(f.spray_usage_l, 2),
    f.drone_serial,
    f.drone_nickname,
    f.drone_model,
    f.drone_model_code,
    f.drone_registration,
    f.pilot_name,
    f.is_default_team,
    f.is_orphan,
    f.district,
    f.location,
    fmtDec(f.lng, 7),
    fmtDec(f.lat, 7),
    f.mode,
    f.manual_mode,
    fmtDec(f.work_speed_m_s, 2),
    fmtDec(f.spray_width_m, 2),
    fmtDec(f.radar_height_m, 2),
    f.fumigations_count,
    fmtDec(f.fumigations_total_area_m2, 2),
    fmtDec(f.fumigations_total_volume_l, 2),
    f.source,
    f.captured_at,
    f.notes_summary
  ]);
}

function renderFlightsCsv(flights: FlightsExportRow[]): string {
  let out = "";
  out += row(["Sección", `Vuelos (${flights.length})`]);
  out += row(FLIGHTS_TABLE_HEADER);
  for (const f of flights) {
    out += renderFlightRowCsv(f);
  }
  return out;
}

/**
 * Construye el CSV del reporte de todos los vuelos.
 * Devuelve string con BOM UTF-8 al inicio.
 */
export function buildFlightsReportCsv(data: FlightsReportData): string {
  let out = "\uFEFF"; // BOM único al inicio (Excel-friendly, ñ y tildes)
  out += renderHeaderCsv(data);
  out += "\n";
  out += renderFlightsCsv(data.flights);
  return out;
}
