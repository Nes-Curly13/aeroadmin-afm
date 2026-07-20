// lib/csv.ts
//
// Helpers puros para generación de CSV en el cliente. Sin dependencias
// (no `papaparse`, no `csv-stringify`).
//
// Usado por:
//   - components/parcels/export-fumigations-csv-button.tsx
//     (export de fumigaciones desde /parcels/[id], audit Q3 #10)
//
// Decisiones de diseño:
//   - Separador ";" en vez de "," para evitar conflicto con los decimales
//     en locale es-CO (donde "1,5" es un número válido y rompería el
//     split por coma en Excel). El audit ui-ux-2026-07 §5.2 lo documenta.
//   - BOM (U+FEFF) al inicio para que Excel detecte UTF-8 y respete las
//     tildes/ñ cuando el operador abre el archivo en su PC.
//   - Quoting RFC 4180: campos que contengan ";", `"` o `\n` se envuelven
//     en `"` y las `"` internas se duplican. No se quota el resto (mantiene
//     el CSV legible para diffs y grep).
//   - Separador de líneas = "\n" (no "\r\n"). Coincide con lo que produce
//     Excel al guardar CSV UTF-8 y evita warnings de git diff.

/** Caracteres que disparan quoting RFC 4180. */
const QUOTE_NEEDED = /[";\n]/;

export interface CsvColumn<T> {
  /** Key del row a leer. */
  key: keyof T & string;
  /** Texto a usar como header en la primera fila. */
  label: string;
}

/** Devuelve la representación string de un valor cell. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Para Date, objetos: serialización simple. La UI nunca pasa estos
  // tipos pero la cobertura defensiva es barata.
  return String(value);
}

/** Quota un campo según RFC 4180 si contiene caracteres especiales. */
function quoteIfNeeded(value: string): string {
  if (!QUOTE_NEEDED.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Genera un string CSV (RFC 4180-ish) a partir de un array de rows.
 *
 * - Separador: `;` (Excel-amigable en locale es-CO).
 * - BOM al inicio (Excel UTF-8).
 * - Header con `label` de cada column, en el orden dado.
 * - Filas con keys en el mismo orden que headers.
 * - Quoting RFC 4180 (`"` → `""`, campos con `;`/`"`/`\n` entrecomillados).
 * - `null` / `undefined` → string vacío.
 * - Trailing `\n` único.
 */
export function toCsv<T>(
  rows: readonly T[],
  headers: ReadonlyArray<CsvColumn<T>>
): string {
  const lines: string[] = [];
  lines.push(headers.map((h) => h.label).join(";"));
  for (const row of rows) {
    const cells = headers.map((h) => {
      const raw = (row as Record<string, unknown>)[h.key];
      return quoteIfNeeded(cellToString(raw));
    });
    lines.push(cells.join(";"));
  }
  // BOM + líneas unidas por \n + \n final
  return "\uFEFF" + lines.join("\n") + "\n";
}

/** Sufijo de fecha YYYY-MM-DD en local del runner (Bogota, idealmente). */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Slugifica un display name y le agrega la fecha de hoy + extensión.
 * - lowercase
 * - acentos → ASCII (Normalize NFD + strip combining marks)
 * - no-alfanumérico → "-"
 * - múltiples "-" → uno solo
 * - trimea "-" de los extremos
 *
 * Ej: `slugFilename("Reporte R1", "csv")` → `"reporte-r1-2026-07-19.csv"`
 *
 * Usado para el filename de descarga del CSV de fumigaciones por parcela
 * (audit Q3 #10): el operador quiere un nombre legible y ordenado por
 * fecha, no un UUID ni un timestamp Unix.
 */
export function slugFilename(displayName: string, ext: string): string {
  // NFD separa "á" en "a" + combining acute; removemos los combining
  // marks con la clase Unicode \p{M} (Mark). Resultado: "a".
  const ascii = displayName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  // No-alfanumérico (incluye ASCII y letras acentuadas que ya quedaron
  // como ASCII) → "-"
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${todayIso()}.${ext}`;
}
