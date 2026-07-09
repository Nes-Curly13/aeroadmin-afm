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
