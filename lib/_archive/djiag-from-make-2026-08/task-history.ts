// task-history.ts
//
// Wrapper tipado que replica el comportamiento del blueprint Make.com
// `www_djiag_com_records_1920w_default.make` (que navega a
// https://www.djiag.com/records y captura el rollup diario de fumigaciones
// + la lista de días con detalles por día).
//
// Source del design: archivo Figma `AFM_SIG`, frame del Task History
// (ver docs/audit/figma-vs-bd.md para la matriz UI ↔ BD completa).
//
// Vista del UI: dos tabs (Map / List). En la imagen del Figma se ve:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ Agriculture     5462.23mu                                        │  ← header card
//   │ ▲ 8028times   💧 100884.1L                                       │
//   │ ▼ -           ⏱ 631Hour11min23s                                 │
//   └──────────────────────────────────────────────────────────────────┘
//   ┌─────────────────────────────────────┐
//   │ 2026/07/08Wednesday                  │
//   │ Agriculture        18.29mu          │
//   │ ▲ 22times         💧 365.2L         │
//   │ ▼ -              ⏱ 1Hour44min53s   │
//   ├─────────────────────────────────────┤
//   │ 2026/07/07Tuesday                   │
//   │ Agriculture        20.91mu          │
//   │ ▲ 27times         💧 416.9L         │
//   │ ▼ -              ⏱ 1Hour43min33s   │
//   └─────────────────────────────────────┘
//
// Cada DayCard tiene: date + weekday + areaMu + times + liters + duration.
//
// Diferencia importante: el UI muestra "Agriculture" como única categoría
// (no hay separación por tipo de operación). El backend de DJI distingue
// entre flights (vuelos) y fumigations (fumigaciones registradas), pero
// para paridad con el UI, agregamos ambos en un solo rollup por día.
//
// Units: `mu` (亩) es unidad china de área. 1 mu = 666.67 m² = 0.0667 ha.
//        L (litros) igual en ambos lados.

import { type NormalizedFumigationDay } from "@/lib/djiag-fumigations-fetcher";
import { toLocalDateString } from "@/lib/dji-flights-aggregate";

/** Duración formateada al estilo DJI: "1Hour44min53s" o "631Hour11min23s". */
export interface FormattedDuration {
  hours: number;
  minutes: number;
  seconds: number;
  /** Formato DJI: "1Hour44min53s" o "631Hour11min23s". */
  djiFormat: string;
}

/** Una card de día tal como aparece en el UI. */
export interface DayCard {
  /** Fecha YYYY/MM/DD (formato DJI). */
  date: string;
  /** Día de la semana en inglés (Monday, Tuesday, ...). DJI lo muestra concatenado. */
  weekday: string;
  /** Área fumigada en mu (亩). */
  areaMu: number;
  /** Cantidad de vuelos/operaciones. */
  times: number;
  /** Litros totales. */
  liters: number;
  /** Duración formateada. */
  duration: FormattedDuration;
}

/** Totales del header del screen. */
export interface TaskHistoryTotals {
  areaMu: number;
  times: number;
  liters: number;
  duration: FormattedDuration;
}

/** Snapshot completo del screen Task History. */
export interface TaskHistorySnapshot {
  dateRange: { from: string; to: string };
  totals: TaskHistoryTotals;
  days: DayCard[];
}

/** Convierte un NormalizedFumigationDay (de djiag-fumigations-fetcher)
 *  en una DayCard (lo que muestra el UI de DJI). */
export function dayToCard(day: NormalizedFumigationDay): DayCard {
  const dateStr = day.date ?? "";
  const dateObj = dateStr ? new Date(dateStr) : new Date(NaN);
  const weekday = Number.isNaN(dateObj.getTime())
    ? ""
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        dateObj.getUTCDay()
      ];
  return {
    date: dateStr.replace(/-/g, "/"),
    weekday,
    areaMu: muFromM2(day.workAreaM2 ?? 0),
    times: day.sortieCount ?? 0,
    liters: day.sprayUsageL ?? 0,
    duration: formatDuration(day.workTimeSec ?? 0)
  };
}

/** Rollups en mu desde m². 1 mu = 666.67 m² (1/0.0015 ha). */
export function muFromM2(m2: number): number {
  return Math.round((m2 / 666.67) * 100) / 100;
}

/** Formatea segundos al estilo DJI: "1Hour44min53s" / "631Hour11min23s". */
export function formatDuration(totalSeconds: number): FormattedDuration {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return {
    hours,
    minutes,
    seconds,
    djiFormat: `${hours}Hour${minutes}min${seconds}s`
  };
}

/** Suma totales desde days[], en el mismo shape que muestra el UI. */
export function computeTotals(days: DayCard[]): TaskHistoryTotals {
  let areaMu = 0;
  let times = 0;
  let liters = 0;
  let durationSeconds = 0;
  for (const d of days) {
    areaMu += d.areaMu;
    times += d.times;
    liters += d.liters;
    durationSeconds += d.duration.hours * 3600 + d.duration.minutes * 60 + d.duration.seconds;
  }
  return {
    areaMu: Math.round(areaMu * 100) / 100,
    times,
    liters: Math.round(liters * 100) / 100,
    duration: formatDuration(durationSeconds)
  };
}

/** Helper que arma un snapshot desde days pre-agregados (lo devuelve el
 *  fetcher existente) + un dateRange. Útil para tests y para
 *  `aggregate-daily-summaries.mjs`. */
export function buildTaskHistorySnapshot(
  days: NormalizedFumigationDay[],
  dateRange: { from: string; to: string }
): TaskHistorySnapshot {
  const cards = days.map(dayToCard);
  return {
    dateRange,
    days: cards,
    totals: computeTotals(cards)
  };
}

/** Shape mínima de fila de `dji_flights` que necesita el agregador.
 *  Igual a `FlightRow` en `lib/dji-flights-aggregate.ts` pero copiada
 *  acá para no acoplar el wrapper del Figma al agregador del dashboard
 *  (cambios en uno no deben propagar al otro).
 *
 *  v1.7 Track C: extendida con `drone_serial`, `pilot_name`, `parcel_id`
 *  para soportar la sub-lista de vuelos por día en el DayCard. Los
 *  campos nuevos son opcionales (los callers legacy que solo quieren
 *  el rollup pueden seguir pasando filas sin ellos).
 *
 *  `area_m2` y `spray_usage_ml` son nullable porque la BD los declara
 *  como tales (algunos flights viejos tienen NULLs en estas columnas).
 *  Los agregadores hacen `r.area_m2 ?? 0` para tratar el null como 0. */
export interface FlightLikeRow {
  id: number;
  flight_id: number | string;
  start_at: Date | string;
  duration_seconds: number;
  area_m2: number | null;
  spray_usage_ml: number | null;
  /** Opcional (v1.7): serial del dron (e.g. "1581F5BKD23100045"). */
  drone_serial?: string | null;
  /** Opcional (v1.7): nombre del piloto. */
  pilot_name?: string | null;
  /** Opcional (v1.7): id de parcela fumigada (join espacial). */
  parcel_id?: number | null;
}

const M2_PER_MU = 666.67;
const ML_PER_L = 1000;
const MS_PER_SEC = 1000;

/**
 * Convierte una fecha YYYY-MM-DD (Bogota-local) a seconds-since-epoch
 * (UTC midnight). Lo que `djiag-fumigations-fetcher.js` llama
 * `createTimestamp` en `NormalizedFumigationDay`.
 *
 * Usamos `new Date('YYYY-MM-DD')` que JS interpreta como UTC midnight
 * (no local). Luego `.getTime() / 1000` da el epoch en segundos.
 */
function dateStringToEpochSec(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = new Date(yyyyMmDd).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / MS_PER_SEC);
}

/**
 * Agrega una lista de filas de `dji_flights` por día local (Bogota) y
 * devuelve un array de `NormalizedFumigationDay` listo para pasar a
 * `buildTaskHistorySnapshot`.
 *
 * Decisiones:
 *   - Días sin vuelos se omiten (el caller no quiere gaps en el UI).
 *   - area se reporta en m² (lo que `dayToCard` luego pasa a mu).
 *     NOTA: `dji_flights.area_m2` representa el área fumigable del CAMPO,
 *     no la fracción fumigada por ese vuelo. Promediamos por día para no
 *     multiplicar el área por N vuelos (ver `scripts/aggregate-daily-summaries.mjs`
 *     para la justificación de AVG vs SUM).
 *   - Hora local: America/Bogota. Misma TZ que el agregador del dashboard
 *     para que dos consumidores del mismo `dji_flights` no se contradigan.
 *   - `hasAgriculture: true` siempre (DJI AG solo hace fumigación agrícola;
 *     si en el futuro hay otra categoría, leer de `dji_flights.mode_name`).
 */
export function aggregateNormalizedDays(rows: FlightLikeRow[]): NormalizedFumigationDay[] {
  // Agrupa por fecha local (Bogota)
  const buckets = new Map<string, FlightLikeRow[]>();
  for (const row of rows) {
    const startAt = row.start_at instanceof Date ? row.start_at : new Date(row.start_at);
    const dateStr = toLocalDateString(startAt, "America/Bogota");
    const bucket = buckets.get(dateStr) ?? [];
    bucket.push(row);
    buckets.set(dateStr, bucket);
  }

  // Ordena fechas DESC (más reciente primero, igual que el UI de DJI)
  const sortedDates = [...buckets.keys()].sort((a, b) => b.localeCompare(a));

  return sortedDates.map((dateStr) => {
    const rowsForDay = buckets.get(dateStr)!;
    const flightCount = rowsForDay.length;
    const totalAreaM2 = rowsForDay.reduce((sum, r) => sum + (r.area_m2 ?? 0), 0);
    const totalSprayMl = rowsForDay.reduce((sum, r) => sum + (r.spray_usage_ml ?? 0), 0);
    const totalDurationSec = rowsForDay.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);

    // AVG de area_m2 por día (ver nota arriba)
    const avgAreaM2 = flightCount > 0 ? totalAreaM2 / flightCount : 0;
    const sprayL = totalSprayMl / ML_PER_L;

    return {
      createTimestamp: dateStringToEpochSec(dateStr),
      date: dateStr,
      workAreaM2: round2(avgAreaM2),
      workTimeSec: totalDurationSec,
      workTimeMin: Math.round(totalDurationSec / 60),
      sortieCount: flightCount,
      sprayUsageMl: totalSprayMl,
      sprayUsageL: round2(sprayL),
      // doseLPerHa = sprayL / (areaHa). areaHa = m² / 10000.
      // Si area es 0 evitamos NaN devolviendo 0.
      doseLPerHa:
        avgAreaM2 > 0 ? round2(sprayL / (avgAreaM2 / 10000)) : 0,
      hasAgriculture: true
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// v1.7 Track C — sub-lista de vuelos por día
// ============================================================

/** Vista de un vuelo "para mostrar" en la sub-lista del DayCard.
 *  Contiene los campos mínimos que el UI necesita para renderizar la
 *  fila (drone, piloto, duración, área) más el id para el detail
 *  drawer. Es un sub-set de `FlightLikeRow`. */
export interface FlightListItem {
  id: number;
  /** YYYY-MM-DD de la fecha local del vuelo (Bogota). */
  localDate: string;
  /** Hora local (HH:MM) en Bogota — útil para ordenar dentro del día. */
  localTime: string;
  durationSeconds: number;
  areaMu: number;
  liters: number;
  droneSerial: string | null;
  pilotName: string | null;
  parcelId: number | null;
}

/** Una card de día enriquecida con los vuelos individuales que la componen. */
export interface DayCardWithFlights {
  /** El rollup diario (mismo shape que `NormalizedFumigationDay`). */
  day: ReturnType<typeof aggregateNormalizedDays>[number];
  /** Vuelos que componen este día, ordenados por `start_at` ASC. */
  flights: FlightListItem[];
}

/**
 * Variante de `aggregateNormalizedDays` que además devuelve los vuelos
 * individuales por día. Pensado para la sub-lista del DayCard (v1.7).
 *
 * Mismas decisiones que `aggregateNormalizedDays` (TZ America/Bogota,
 * AVG de area_m2, etc.) — solo agrega que en vez de descartar las
 * filas después de agregar, las devuelve con metadata útil para el UI.
 *
 * Si `rows` viene vacío, devuelve `[]`. Si un día tiene 1 vuelo, ese
 * día tiene `flights: [1]`. Sin truncado: el caller decide cuántos
 * mostrar (típicamente top 3-5 + "ver más").
 */
export function aggregateNormalizedDaysWithFlights(
  rows: FlightLikeRow[]
): DayCardWithFlights[] {
  if (rows.length === 0) return [];

  // Agrupa por fecha local (Bogota) — reusamos la misma helper de
  // timezone que aggregateNormalizedDays. Exportada en este módulo
  // (toLocalDateString de dji-flights-aggregate). Para evitar acoplar
  // el wrapper del Figma al agregador del dashboard, replicamos el
  // map de offsets mínimo (UTC-5 Bogota, sin DST).
  const buckets = new Map<string, FlightLikeRow[]>();
  for (const row of rows) {
    const startAt =
      row.start_at instanceof Date ? row.start_at : new Date(row.start_at);
    const dateStr = toLocalDateStringBogota(startAt);
    const bucket = buckets.get(dateStr) ?? [];
    bucket.push(row);
    buckets.set(dateStr, bucket);
  }

  // Ordena fechas DESC.
  const sortedDates = [...buckets.keys()].sort((a, b) => b.localeCompare(a));

  return sortedDates.map((dateStr) => {
    const rowsForDay = buckets.get(dateStr)!;
    const flightCount = rowsForDay.length;
    const totalAreaM2 = rowsForDay.reduce(
      (sum, r) => sum + (r.area_m2 ?? 0),
      0
    );
    const totalSprayMl = rowsForDay.reduce(
      (sum, r) => sum + (r.spray_usage_ml ?? 0),
      0
    );
    const totalDurationSec = rowsForDay.reduce(
      (sum, r) => sum + (r.duration_seconds ?? 0),
      0
    );
    const avgAreaM2 = flightCount > 0 ? totalAreaM2 / flightCount : 0;
    const sprayL = totalSprayMl / ML_PER_L;

    // Construir la lista de vuelos individuales, ordenada por start_at
    // ASC (el orden cronológico de cómo ocurrieron en el día).
    const flights: FlightListItem[] = [...rowsForDay]
      .sort((a, b) => {
        const aT = a.start_at instanceof Date ? a.start_at : new Date(a.start_at);
        const bT = b.start_at instanceof Date ? b.start_at : new Date(b.start_at);
        return aT.getTime() - bT.getTime();
      })
      .map((r) => {
        const startAt = r.start_at instanceof Date ? r.start_at : new Date(r.start_at);
        return {
          id: r.id,
          localDate: dateStr,
          localTime: toLocalTimeStringBogota(startAt),
          durationSeconds: r.duration_seconds ?? 0,
          areaMu: round2((r.area_m2 ?? 0) / M2_PER_MU),
          liters: round2((r.spray_usage_ml ?? 0) / ML_PER_L),
          droneSerial: r.drone_serial ?? null,
          pilotName: r.pilot_name ?? null,
          parcelId: r.parcel_id ?? null
        };
      });

    return {
      day: {
        createTimestamp: dateStringToEpochSec(dateStr),
        date: dateStr,
        workAreaM2: round2(avgAreaM2),
        workTimeSec: totalDurationSec,
        workTimeMin: Math.round(totalDurationSec / 60),
        sortieCount: flightCount,
        sprayUsageMl: totalSprayMl,
        sprayUsageL: round2(sprayL),
        doseLPerHa: avgAreaM2 > 0 ? round2(sprayL / (avgAreaM2 / 10000)) : 0,
        hasAgriculture: true
      },
      flights
    };
  });
}

/**
 * Replica local de `toLocalDateString('America/Bogota')` de
 * `lib/dji-flights-aggregate.ts`. Mantenida acá para no acoplar el
 * wrapper del Figma al agregador del dashboard. Bogota = UTC-5, sin DST.
 */
function toLocalDateStringBogota(date: Date): string {
  const offsetMin = -5 * 60; // -300
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Hora local HH:MM (Bogota) para mostrar en la sub-lista de vuelos. */
function toLocalTimeStringBogota(date: Date): string {
  const offsetMin = -5 * 60; // -300
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const h = String(local.getUTCHours()).padStart(2, "0");
  const m = String(local.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
