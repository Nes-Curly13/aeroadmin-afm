/**
 * lib/reports/date-range.ts
 *
 * Helpers para los rangos de fecha de /reportes.
 *
 * Sprint S9.2 (2026-08-29) — feature/s9-2-reports-date-range.
 *
 * `quickRange` y `defaultWindow` se usan en `app/reportes/page.tsx`
 * para los botones de "7d / 30d / 90d / Mes / Año" y el default
 * "últimos 30 días". Se extraen a este archivo para poder
 * testearlos sin levantar el server component.
 *
 * Decisiones:
 *   - Las funciones reciben `todayParts` (array [y, m, d]) en vez
 *     de computar la fecha internamente. Esto permite tests
 *     deterministas (sin depender del reloj del sistema).
 *   - Las fechas se computan en UTC. El server component ya
 *     usa Bogota TZ para "hoy" antes de llamar a estas funciones,
 *     así que el resultado es consistente.
 *   - Los presets son inclusivos en ambos extremos: `from` y `to`
 *     son fechas válidas, la query SQL usa BETWEEN que es
 *     semi-cerrado en PostgreSQL (`>= from AND < to+1`).
 */

/**
 * Formatea un array [y, m, d] a string YYYY-MM-DD con padding
 * zero-padded. Helper interno.
 */
function fmtDate(parts: readonly number[]): string {
  const [y, m, d] = parts;
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    throw new Error(`quickRange: todayParts inválido (${JSON.stringify(parts)})`);
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Construye el rango de fechas para un preset, dado el array
 * `[year, month, day]` de "hoy" (Bogota, ya computado por el caller).
 *
 * Presets:
 *   - "7d"  → últimos 7 días (to = hoy, from = to - 7)
 *   - "30d" → últimos 30 días
 *   - "90d" → últimos 90 días
 *   - "month" → mes actual (from = día 1 del mes, to = hoy)
 *   - "year" → año actual (from = 1-ene, to = hoy)
 */
export function quickRange(
  todayParts: readonly number[],
  kind: "7d" | "30d" | "90d" | "month" | "year"
): { from: string; to: string } {
  const to = fmtDate(todayParts);
  const [y, m, d] = todayParts;
  // Crear la fecha con UTC para evitar drift por timezone del
  // entorno (tests o containers con TZ distinto).
  const today = new Date(Date.UTC(y!, m! - 1, d!));
  let from: Date;
  switch (kind) {
    case "7d":
    case "30d":
    case "90d": {
      const days = kind === "7d" ? 7 : kind === "30d" ? 30 : 90;
      from = new Date(today);
      from.setUTCDate(from.getUTCDate() - days);
      break;
    }
    case "month":
      from = new Date(Date.UTC(y!, m! - 1, 1));
      break;
    case "year":
      from = new Date(Date.UTC(y!, 0, 1));
      break;
  }
  return { from: fmtDate([from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate()]), to };
}

/**
 * Devuelve el default del rango: últimos 30 días hasta hoy.
 * Mismo patrón que la función original en `app/reportes/page.tsx`
 * — extraída acá para testeo.
 */
export function defaultWindow(
  todayParts: readonly number[]
): { from: string; to: string } {
  return quickRange(todayParts, "30d");
}
