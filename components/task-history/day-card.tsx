/**
 * DayCard — server component.
 *
 * Una card por día dentro del stack de DayList. Reproduce el bloque que
 * se ve en la imagen del Figma (frame B del Task History):
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 2026/07/08Wednesday                                  │  ← title (pegados)
 *   │ ──────────────────────────────────────────────────── │
 *   │ Agriculture                          18.29mu         │
 *   │ ▲ 22times            💧 365.2L                       │
 *   │ ▼ -                  ⏱ 1Hour44min53s                  │
 *   └──────────────────────────────────────────────────────┘
 *
 * El `weekday` va pegado al `date` (sin espacio) porque el UI de DJI
 * los concatena directamente. La grilla 2x2 es la misma que en
 * `HeaderCard` — se reusa `MetricsGrid` (mismo archivo, server-safe).
 *
 * Tipos importados de `@/lib/djiag-from-make/task-history`.
 */

import type { DayCard as DayCardData } from "@/lib/djiag-from-make/task-history";

import { MetricsGrid } from "./metrics-grid";

export interface DayCardProps {
  day: DayCardData;
  /** Opcional: sobreescribe el label "Agriculture" (default: "Agriculture"). */
  categoryLabel?: string;
  /** Opcional: aria-label para accesibilidad del card. */
  ariaLabel?: string;
}

const DEFAULT_CATEGORY_LABEL = "Agriculture";
const DEFAULT_ARIA_LABEL_PREFIX = "Fumigaciones del";

export function DayCard({
  day,
  categoryLabel = DEFAULT_CATEGORY_LABEL,
  ariaLabel
}: DayCardProps) {
  const computedAria = ariaLabel ?? `${DEFAULT_ARIA_LABEL_PREFIX} ${day.date}${day.weekday ? ` ${day.weekday}` : ""}`;
  return (
    <article
      aria-label={computedAria}
      className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-date={day.date}
      data-testid="task-history-day-card"
    >
      <header className="mb-3">
        <h3 className="text-base font-bold tracking-tight text-[#121815]">
          {day.date}
          <span className="font-bold text-[#121815]">{day.weekday}</span>
        </h3>
      </header>
      <div className="border-t border-[#d2ddd6]" data-testid="task-history-day-card-divider" />
      <div className="mt-3 mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[#121815]">{categoryLabel}</p>
        <p
          className="text-xl font-black tracking-tight text-[#0b5f2d]"
          data-testid="task-history-day-card-area"
        >
          {day.areaMu.toFixed(2)}<span className="ml-1 text-xs font-semibold uppercase text-[#0b5f2d]">mu</span>
        </p>
      </div>
      <MetricsGrid
        durationDjiFormat={day.duration.djiFormat}
        liters={day.liters}
        size="sm"
        testIdPrefix="task-history-day-card-grid"
        times={day.times}
      />
    </article>
  );
}
