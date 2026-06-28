// Helpers puros para agregar dji_flights por día local.
//
// Contexto (Sprint 2 del roadmap de auditoría 2026-06-28):
//   - dji_flights tiene 1 fila por sortie individual del drone (7050 filas
//     para 30 días de data). Mucho más granular que dji_daily_summaries.
//   - Las pages del dashboard (/, /history, /map) consumen el shape
//     DjiDailySummaryRecord (rollup por día, area_mu en MU, etc.) que
//     venía de dji_daily_summaries.
//   - Este módulo agrega dji_flights en JS para preservar el shape sin
//     cambiar la UI. Cuando se dropee dji_daily_summaries, esta capa
//     será la única fuente de "resumen por día" para el dashboard.
//
// Decisiones:
//   - TZ America/Bogota (Colombia, donde opera el cliente). El cliente
//     pasa sus días laborales en hora local; agregamos por día local.
//   - Conversiones:
//       * area: dji_flights.area_m2 → area_mu (1 MU = 666.67 m²)
//       * usage: dji_flights.spray_usage_ml → usage_liters (÷ 1000)
//       * duration: dji_flights.duration_seconds → work_time_text
//         (formato legacy DJI: "5Hour24min40s")
//   - Todo pure JS — testeable sin BD ni browser.

/**
 * 1 MU (mu, "亩" en chino) = 1/15 ha ≈ 666.6667 m².
 * Definido en docs/DJI_AREA_UNITS.md. Estandar chino de área agrícola.
 */
export const MU_PER_HA_M2 = 10_000 / 15; // 666.6667

/** Convierte m² → MU. */
export function m2ToMu(m2: number): number {
  if (!Number.isFinite(m2) || m2 <= 0) return 0;
  return m2 / MU_PER_HA_M2;
}

/** Convierte mL → L. */
export function mlToLiters(ml: number): number {
  if (!Number.isFinite(ml) || ml <= 0) return 0;
  return ml / 1000;
}

/**
 * Formatea segundos al estilo legacy DJI:
 *   0           → "0s"
 *   88          → "1min28s"
 *   3600        → "1Hour"
 *   3600 + 60   → "1Hour1min"
 *   19480       → "5Hour24min40s"
 *
 * NO replica los bugs de DJI ("6Hour24s", "6Hour4min") — produce siempre
 * un formato consistente con la gramatica H?M?S?.
 */
export function formatDurationDjI(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}Hour`);
  if (m > 0) parts.push(`${m}min`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join("") || "0s";
}

/**
 * Devuelve la fecha local en formato YYYY-MM-DD usando la zona horaria
 * provista. Implementación manual (sin Intl.DateTimeFormat) porque
 * jsdom tiene bugs con `en-CA` que cuelgan el test runner.
 *
 * Soporte actual: America/Bogota (UTC-5, sin DST). Para otras TZ, agregar
 * al switch y al map de offsets.
 */
export function toLocalDateString(date: Date, timeZone = "America/Bogota"): string {
  const offsetMin = getTimezoneOffsetMinutes(timeZone);
  // Sumar el offset al UTC para obtener "wall clock" local
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Devuelve el nombre del día de la semana en la zona local (en-US, para
 * match con el shape legacy DJI "Wednesday").
 */
export function toLocalWeekdayName(date: Date, timeZone = "America/Bogota"): string {
  const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // Construir wall clock local y leer día de la semana
  const offsetMin = getTimezoneOffsetMinutes(timeZone);
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  return WEEKDAYS_EN[local.getUTCDay()];
}

/**
 * Offset en minutos de la TZ respecto a UTC. Hardcodeado por ahora.
 * America/Bogota = UTC-5 (sin DST desde hace décadas).
 * Positivo = al este de UTC, negativo = al oeste.
 */
function getTimezoneOffsetMinutes(timeZone: string): number {
  switch (timeZone) {
    case "America/Bogota":
      return -5 * 60; // -300
    case "UTC":
      return 0;
    default:
      // TZ no soportada — fallback a UTC. Loggear sería ideal pero evita
      // side effects en este helper puro.
      return 0;
  }
}

/**
 * Shape mínimo de fila de dji_flights que necesita el agregador.
 * Definido acá (no importado de @/lib/types) para que el módulo sea
 * puro testeable sin BD.
 */
export interface FlightRow {
  id: number;
  flight_id: number | string;
  start_at: Date | string;
  duration_seconds: number;
  area_m2: number;
  spray_usage_ml: number;
}

/**
 * Shape que devuelven getFlights/getAlerts hoy (compatible con
 * DjiDailySummaryRecord en lib/types.ts). El agregador produce este shape
 * desde rows de dji_flights para no tocar la UI.
 */
export interface DailySummaryLike {
  id: number;
  record_date: string;
  weekday: string | null;
  category: string;
  area_mu: number;
  times_count: number;
  usage_liters: number;
  work_time_text: string;
  raw_text: string;
}

/**
 * Agrupa una lista de vuelos por día local y devuelve un array de
 * DjiDailySummaryRecord-compatible. Ordenado por fecha DESC (más reciente
 * primero, igual que el query legacy de dji_daily_summaries).
 *
 * category se hardcodea a "Agriculture" — DJI AG solo hace fumigación
 * agrícola, no hay otra categoría. Si en el futuro se agrega otra, leer
 * de dji_flights.mode_name.
 *
 * `id` se regenera por día (1, 2, 3...) — antes era el id de la fila
 * de dji_daily_summaries. La UI no usa el id para nada crítico.
 */
export function aggregateFlightsByDay(
  rows: FlightRow[],
  options: { timeZone?: string; now?: Date } = {}
): DailySummaryLike[] {
  const timeZone = options.timeZone ?? "America/Bogota";

  // Agrupar por fecha local
  const buckets = new Map<string, FlightRow[]>();
  for (const row of rows) {
    const startAt = row.start_at instanceof Date
      ? row.start_at
      : new Date(row.start_at);
    const dateStr = toLocalDateString(startAt, timeZone);
    const bucket = buckets.get(dateStr) ?? [];
    bucket.push(row);
    buckets.set(dateStr, bucket);
  }

  // Ordenar fechas DESC
  const sortedDates = [...buckets.keys()].sort((a, b) => b.localeCompare(a));
  const result: DailySummaryLike[] = [];

  sortedDates.forEach((dateStr, idx) => {
    const rowsForDay = buckets.get(dateStr)!;
    const areaMuTotal = rowsForDay.reduce((sum, r) => sum + m2ToMu(r.area_m2), 0);
    const litersTotal = rowsForDay.reduce((sum, r) => sum + mlToLiters(r.spray_usage_ml), 0);
    const secondsTotal = rowsForDay.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);

    // weekday: usar el primer vuelo del día como referencia
    const firstStart = rowsForDay[0].start_at instanceof Date
      ? rowsForDay[0].start_at
      : new Date(rowsForDay[0].start_at);
    const weekday = toLocalWeekdayName(firstStart, timeZone);

    const timesCount = rowsForDay.length;
    const workTimeText = formatDurationDjI(secondsTotal);

    // raw_text legacy (compatibilidad con UI): formato pegado tipo DJI v1
    // "YYYY/MM/DDWeekdayAgricultureX.XXmuNtimesY.YL-Duration"
    const dateForRaw = dateStr.replace(/-/g, "/");
    const areaMuStr = areaMuTotal.toFixed(2);
    const litersStr = litersTotal.toFixed(1);
    const rawText = `${dateForRaw}${weekday}Agriculture${areaMuStr}mu${timesCount}times${litersStr}L-${workTimeText}`;

    result.push({
      id: idx + 1,
      record_date: dateStr,
      weekday,
      category: "Agriculture",
      area_mu: Math.round(areaMuTotal * 100) / 100,
      times_count: timesCount,
      usage_liters: Math.round(litersTotal * 10) / 10,
      work_time_text: workTimeText,
      raw_text: rawText
    });
  });

  return result;
}