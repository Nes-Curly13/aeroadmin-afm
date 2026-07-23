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
// Sprint B — F1.11: extiende el CSV con
//   1. Header de metadata (operador, fecha de generación, parcela) en
//      las 3 primeras filas — antes del header de columnas. Cada fila
//      tiene el label en col 1 y celdas vacías en el resto, así Excel
//      las muestra como "metadata header" en la parte de arriba de la
//      hoja sin romper la tabla de eventos.
//   2. Sección de totales al final (después de un separador de fila
//      vacía): área fumigada (mes), total fumigaciones (mes), promedio
//      de área por fumigación, última fumigación. Mismo formato: label
//      en col 1, vacío en el resto.
//
// Por qué no usamos comentarios "#" al inicio:
//   Excel NO trata "#" como comentario — los mostraría como la primera
//   fila de la tabla, desalineando el header. La alternativa que usa
//   el spec (label en col 1, vacío en el resto) es la más limpia y se
//   ve bien en Excel y en cualquier otro lector CSV (LibreOffice,
//   Google Sheets, pandas, etc).
//
// Columnas de la tabla de eventos (en este orden, según spec del audit):
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

/** Cantidad de columnas en la tabla de eventos. La metadata y los totales
 *  usan esto para saber cuántas celdas vacías agregar después del label. */
const NUM_COLUMNS = HEADERS.length;

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

/**
 * Construye las 3 filas de metadata header (Operador, Fecha de
 * generación, Parcela). Cada fila tiene el label en col 1 y celdas
 * vacías en el resto — así Excel las trata como "una celda con texto"
 * y no desalinea la tabla de eventos que viene después.
 */
function buildMetadataRows(
  meta: { operatorName: string; generatedAt: string; parcelLabel: string },
  numCols: number
): string[] {
  const emptyCells = Array(numCols - 1).fill("").join(";");
  return [
    `Operador: ${meta.operatorName};${emptyCells}`,
    `Fecha de generación: ${meta.generatedAt};${emptyCells}`,
    `Parcela: ${meta.parcelLabel};${emptyCells}`
  ];
}

/**
 * Calcula los totales del rango a partir de los eventos. Retorna
 * null/undefined donde no haya data suficiente (ej: events vacío).
 */
function computeTotals(
  events: readonly DjiFumigationEvent[]
): {
  totalAreaHa: number;
  count: number;
  averageAreaHa: number;
  lastFumigationDate: string | null;
} {
  const count = events.length;
  if (count === 0) {
    return { totalAreaHa: 0, count: 0, averageAreaHa: 0, lastFumigationDate: null };
  }
  let totalAreaM2 = 0;
  let lastDate: string | null = null;
  for (const e of events) {
    if (e.area_fumigated_m2 !== null) totalAreaM2 += e.area_fumigated_m2;
    const d = toDateString(e.fumigation_date);
    if (d !== null && (lastDate === null || d > lastDate)) lastDate = d;
  }
  const totalAreaHa = totalAreaM2 / 10_000;
  return {
    totalAreaHa,
    count,
    averageAreaHa: totalAreaHa / count,
    lastFumigationDate: lastDate
  };
}

/**
 * Construye las filas de totales al final del CSV. Mismo formato que
 * la metadata: label en col 1, celdas vacías en el resto. Va
 * precedida por una fila vacía como separador visual.
 */
function buildTotalsRows(
  totals: ReturnType<typeof computeTotals>,
  numCols: number
): string[] {
  const emptyCells = Array(numCols - 1).fill("").join(";");
  return [
    "", // separador
    `Total área fumigada (mes): ${formatNumber(totals.totalAreaHa, 2)} ha;${emptyCells}`,
    `Total fumigaciones (mes): ${totals.count};${emptyCells}`,
    `Promedio área por fumigación: ${formatNumber(totals.averageAreaHa, 2)} ha;${emptyCells}`,
    `Última fumigación: ${totals.lastFumigationDate ?? "—"  };${emptyCells}`
  ];
}

/**
 * Helper exportado para construir el CSV final (metadata + tabla + totales).
 * Se exporta para que los tests puedan verificar el output sin necesidad
 * de mockear el download.
 */
export function buildFumigationsCsv(args: {
  events: readonly DjiFumigationEvent[];
  parcelDroneName: string | null;
  meta: { operatorName: string; generatedAt: string; parcelLabel: string };
}): string {
  const rows = buildRows(args.events, args.parcelDroneName);
  const tableCsv = toCsv(rows, HEADERS);

  // `toCsv` retorna "<BOM><header>\n<rows>\n<trailing newline>". Le
  // sacamos el BOM y el trailing newline para intercalar metadata
  // (arriba) y totales (abajo) y volver a poner el BOM al inicio.
  const innerCsv = tableCsv.replace(/^\uFEFF/, "").replace(/\n$/, "");

  const metaRows = buildMetadataRows(args.meta, NUM_COLUMNS);
  const totals = computeTotals(args.events);
  const totalsRows = buildTotalsRows(totals, NUM_COLUMNS);

  // Orden final: BOM + meta + tabla + totales + trailing \n
  return (
    "\uFEFF" +
    metaRows.join("\n") +
    "\n" +
    innerCsv +
    "\n" +
    totalsRows.join("\n") +
    "\n"
  );
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
  /** Metadata para las 3 primeras filas del CSV. Si se omite, el CSV
   *  NO incluye header de metadata (compat con callers viejos que no
   *  tienen acceso a process.env.OPERATOR_NAME — ej: tests sin meta). */
  csvMeta?: { operatorName: string; generatedAt: string; parcelLabel: string };
}

export function ExportFumigationsCsvButton({
  events,
  parcelName,
  parcelDroneName = null,
  filenameBase,
  label = "Exportar CSV",
  csvMeta
}: ExportFumigationsCsvButtonProps) {
  function handleClick() {
    const csv = csvMeta
      ? buildFumigationsCsv({ events, parcelDroneName, meta: csvMeta })
      : toCsv(buildRows(events, parcelDroneName), HEADERS);
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
