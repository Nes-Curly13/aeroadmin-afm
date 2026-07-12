/**
 * HeaderCard — server component.
 *
 * Card superior de la vista Task History (ver docs/audit/figma-vs-bd.md
 * frame B). Muestra los totales agregados del rango activo:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Agriculture                          5462.23mu       │  ← header
 *   │ ───────────────────────────────────────────────────  │
 *   │ ▲ 8028times            💧 100884.1L                   │  ← grid 2x2
 *   │ ▼ -                    ⏱ 631Hour11min23s              │
 *   └──────────────────────────────────────────────────────┘
 *
 * El border verde 2px y la paleta vienen del design system del repo
 * (#0b5f2d primario). Iconos como SVG inline (no emojis, no lucide).
 *
 * Tipos importados de `@/lib/djiag-from-make/task-history` (la fuente de
 * verdad del shape que viene del API).
 */

import type { TaskHistoryTotals } from "@/lib/djiag-from-make/task-history";

import { MetricsGrid } from "./metrics-grid";

export interface HeaderCardProps {
  totals: TaskHistoryTotals;
  /** Opcional: sobreescribe el label "Agriculture" (default: "Agriculture"). */
  categoryLabel?: string;
  /** Opcional: aria-label para accesibilidad del card. */
  ariaLabel?: string;
}

const DEFAULT_CATEGORY_LABEL = "Agriculture";
const DEFAULT_ARIA_LABEL = "Resumen del rango de fumigaciones";

export function HeaderCard({
  totals,
  categoryLabel = DEFAULT_CATEGORY_LABEL,
  ariaLabel = DEFAULT_ARIA_LABEL
}: HeaderCardProps) {
  return (
    <article
      aria-label={ariaLabel}
      className="rounded-2xl border-2 border-[#0b5f2d] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="task-history-header-card"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-base font-semibold text-[#121815]">{categoryLabel}</p>
        <p
          className="text-2xl font-black tracking-tight text-[#0b5f2d]"
          data-testid="task-history-header-area"
        >
          {totals.areaMu.toFixed(2)}<span className="ml-1 text-sm font-semibold uppercase text-[#0b5f2d]">mu</span>
        </p>
      </div>
      <MetricsGrid
        durationDjiFormat={totals.duration.djiFormat}
        liters={totals.liters}
        size="md"
        testIdPrefix="task-history-header"
        times={totals.times}
      />
    </article>
  );
}
