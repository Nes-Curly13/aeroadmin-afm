// lib/reports/fumigation-csv.ts
//
// Serializador CSV para UNA fumigación individual
// (feature/fumigacion-detail-v2 / sub-4).
//
// Shape: una sola fumigación con su metadata (parcela, dron, vuelos
// asociados). NO es un listado — es un detalle con secciones.
//
// Decisiones (mismas que parcel-csv.ts):
//   - Separador `;` + BOM para Excel-CO (BOM UTF-8 ayuda a Excel a
//     reconocer tildes y ñ sin pedir el wizard de encoding)
//   - RFC 4180 quoting (caracteres `"`, `;`, `\n` dentro de un valor
//     se escapan con `"..."`)
//   - **Decimales con coma** vía `Intl.NumberFormat("de-DE", ...)`.
//     Usamos de-DE (no es-CO) porque de-DE produce "12,50" mientras
//     que es-CO produce "12,50" también pero con símbolo de agrupación
//     por miles distinto. de-DE es el locale "neutral" que solo cambia
//     separador decimal a coma. Ver parcel-csv.ts y lib/csv.ts para
//     el mismo patrón.
//   - Función pura, sin I/O
//
// Diferencias con parcel-csv:
//   - Más compacto: 1 fumigación no necesita 4 secciones largas
//   - Vuelos asociados en tabla inline (no sección separada)
//
// Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.

import type { DjiFumigationEvent } from "@/lib/types";
import type { FumigationFlightRow } from "@/api/repositories";

export interface FumigationReportData {
  fumigation: DjiFumigationEvent;
  parcel: {
    id: number;
    land_name: string | null;
    external_id: string;
  } | null;
  drone: {
    code: number;
    name: string;
    tank_l: number;
  } | null;
  category: {
    id: number;
    slug: string;
    label: string;
    color: string;
  } | null;
  flights: FumigationFlightRow[];
}

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

function fmtDec(value: number | null, decimals: number): string {
  if (value === null) return "";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Genera el CSV de una fumigación individual. Devuelve el string
 * completo con BOM inicial y \n final.
 */
export function buildFumigationCsv(data: FumigationReportData): string {
  const f = data.fumigation;
  const p = data.parcel;
  const d = data.drone;
  const c = data.category;

  let csv = "\uFEFF";

  // Sección: Cabecera
  csv += row(["Sección", "Cabecera"]);
  csv += row(["ID fumigación", f.id]);
  csv += row(["Fecha de fumigación", f.fumigation_date]);
  csv += row(["Fuente", f.source]);
  csv += row(["Registrado por", f.recorded_by ?? ""]);
  csv += row(["Fecha de registro", f.recorded_at]);
  csv += row([]);

  // Sección: Parcela
  csv += row(["Sección", "Parcela"]);
  csv += row(["Parcela ID", p?.id ?? f.parcel_id]);
  csv += row(["Nombre del lote", p?.land_name ?? ""]);
  csv += row(["External ID", p?.external_id ?? ""]);
  csv += row([]);

  // Sección: Aplicación
  csv += row(["Sección", "Aplicación"]);
  csv += row(["Tipo (categoría)", c?.label ?? "Sin clasificar"]);
  csv += row(["Producto comercial", f.product_used ?? ""]);
  csv += row(["Dosis (L/ha)", fmtDec(f.dose_l_per_ha, 2)]);
  csv += row(["Área fumigada (m²)", fmtDec(f.area_fumigated_m2, 2)]);
  csv += row(["Duración (min)", f.duration_minutes ?? ""]);
  csv += row(["Dron usado", d ? `${d.name} (${d.tank_l} L)` : "Sin asignar"]);
  csv += row([]);

  // Sección: Compliance
  csv += row(["Sección", "Compliance"]);
  csv += row(["Registro ICA del producto", f.product_registered_ica ?? ""]);
  csv += row(["Licencia del piloto", f.pilot_license ?? ""]);
  csv += row([]);

  // Sección: Vuelos asociados (si hay)
  if (data.flights.length > 0) {
    csv += row(["Sección", `Vuelos asociados (${data.flights.length})`]);
    csv += row([
      "Flight ID",
      "Inicio",
      "Piloto",
      "Dron",
      "Área (m²)",
      "Duración (min)",
      "Volumen (L)"
    ]);
    for (const fl of data.flights) {
      csv += row([
        fl.flight_id,
        fl.start_at,
        fl.pilot_name ?? "",
        fl.drone_nickname ?? "",
        fmtDec(fl.area_m2, 2),
        fmtDec(fl.duration_min, 1),
        fl.spray_usage_ml != null ? fmtDec(fl.spray_usage_ml / 1000, 2) : ""
      ]);
    }
    csv += row([]);
  } else {
    csv += row(["Sección", "Vuelos asociados"]);
    csv += row(["(sin vuelos asociados)"]);
    csv += row([]);
  }

  // Sección: Notas
  csv += row(["Sección", "Notas operativas"]);
  csv += row([f.human_notes ?? ""]);
  if (f.notes && f.notes !== f.human_notes) {
    csv += row([]);
    csv += row(["Sección", "Metadata técnica (import)"]);
    csv += row([f.notes]);
  }

  return csv;
}
