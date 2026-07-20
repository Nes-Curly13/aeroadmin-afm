"use client";

// components/parcels/export-fumigations-csv-button.tsx
//
// Botón "Exportar CSV" en /parcels/[id]. Genera un CSV con el historial
// de fumigaciones de la parcela para que el operador fumigador del Valle
// del Cauca se lo lleve al campo (sin internet).
//
// Audit Q3 #10 (ui-ux-2026-07 §5.2). El reporte complementa al
// "Descargar reporte" de /task-history con foco en UNA parcela y formato
// Excel-amigable: separador ";" (decimales es-CO), BOM (tildes),
// slug+fecha en el filename.
//
// Columnas (en este orden, según spec del audit):
//   Fecha, Dron, Piloto, Área (ha), Duración (min), Volumen (L),
//   Producto, Notas
//
// Decisiones:
//   - "Dron" = parcelDroneName (drone_model_name de la parcela). Es el
//     dron canónico configurado para esa parcela. Para fumigaciones
//     manuales no hay un drone específico (drone_code_used es opcional
//     y se ignora — usar el modelo de la parcela es más útil para el
//     reporte que mostrar un código numérico opaco).
//   - "Piloto" = event.recorded_by (operador humano que registró la
//     fumigación). Para fumigaciones scrapeadas de DJI este campo suele
//     estar null — queda vacío en la celda, lo cual es honesto.
//   - "Volumen (L)" = dose_l_per_ha × area_ha (cuando ambos están
//     disponibles). Si falta uno de los dos, la celda queda vacía.
//   - "Notas" se omite si parece un blob JSON de provenance
//     (ver `lib/format.ts:isProvenanceNotes`) — esa metadata es
//     trazabilidad de ingesta, no una nota del operador.

import { isProvenanceNotes, m2ToHa, toDateString } from "@/lib/format";
import { slugFilename, toCsv, type CsvColumn } from "@/lib/csv";
import type { DjiFumigationEvent } from "@/lib/types";

interface ExportRow {
  fecha: string;
  dron: string;
  piloto: string;
  areaHa: string;
  duracionMin: string;
  volumenL: string;
  producto: string;
  notas: string;
}

const HEADERS: ReadonlyArray<CsvColumn<ExportRow>> = [
  { key: "fecha", label: "Fecha" },
  { key: "dron", label: "Dron" },
  { key: "piloto", label: "Piloto" },
  { key: "areaHa", label: "Área (ha)" },
  { key: "duracionMin", label: "Duración (min)" },
  { key: "volumenL", label: "Volumen (L)" },
  { key: "producto", label: "Producto" },
  { key: "notas", label: "Notas" }
];

function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function buildRows(
  events: readonly DjiFumigationEvent[],
  parcelDroneName: string | null
): ExportRow[] {
  return events.map((e) => {
    const areaHa = m2ToHa(e.area_fumigated_m2);
    const volumeL =
      e.dose_l_per_ha !== null && areaHa !== null
        ? e.dose_l_per_ha * areaHa
        : null;

    // Notas humanas: solo si NO parece un blob de provenance del backfill
    // (ver lib/format.ts:isProvenanceNotes para el detalle del shape).
    const notas = e.notes && !isProvenanceNotes(e.notes) ? e.notes : "";

    return {
      fecha: toDateString(e.fumigation_date) ?? "",
      dron: parcelDroneName ?? "",
      piloto: e.recorded_by ?? "",
      areaHa: areaHa === null ? "" : formatNumber(areaHa, 2),
      duracionMin: e.duration_minutes === null ? "" : String(e.duration_minutes),
      volumenL: volumeL === null ? "" : formatNumber(volumeL, 2),
      producto: e.product_used ?? "",
      notas
    };
  });
}

function downloadCsv(csv: string, filename: string): void {
  // BOM ya viene dentro de `csv` (lo antepone `toCsv`). Lo agregamos
  // explícito de nuevo NO — el Blob lo respeta porque es UTF-8.
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ExportFumigationsCsvButtonProps {
  events: readonly DjiFumigationEvent[];
  parcelName: string;
  /** Nombre del dron canónico de la parcela (`dji_parcels.drone_model_name`). */
  parcelDroneName?: string | null;
  /** Slug prefijo para el filename (default: parcelName). */
  filenameBase?: string;
  /** Etiqueta del botón. */
  label?: string;
}

export function ExportFumigationsCsvButton({
  events,
  parcelName,
  parcelDroneName = null,
  filenameBase,
  label = "Exportar CSV"
}: ExportFumigationsCsvButtonProps) {
  function handleClick() {
    const rows = buildRows(events, parcelDroneName);
    const csv = toCsv(rows, HEADERS);
    const base = filenameBase ?? parcelName;
    const filename = slugFilename(base, "csv");
    downloadCsv(csv, filename);
  }

  return (
    <button
      className="rounded-full bg-[#0b5f2d] px-3 py-1.5 text-[11px] font-semibold text-white"
      data-testid="export-fumigations-csv-button"
      onClick={handleClick}
      type="button"
    >
      {label}
    </button>
  );
}
