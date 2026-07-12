/**
 * DayList — server component.
 *
 * Stack vertical de DayCard. Si el rango activo no tiene días con
 * fumigaciones, muestra un mensaje de fallback en lugar de renderizar
 * una lista vacía (más útil para el usuario y más accesible que un
 * stack vacío).
 *
 *   <div data-testid="task-history-day-list">
 *     <DayCard day={...} />
 *     <DayCard day={...} />
 *     ...
 *   </div>
 *
 * No depende de estado: el padre (server component) pasa el array `days`
 * ya filtrado/agregado. El orden se respeta tal cual viene (la API
 * debería devolver DESC por fecha).
 */

import type { DayCard as DayCardData } from "@/lib/djiag-from-make/task-history";

import { DayCard } from "./day-card";

export interface DayListProps {
  days: DayCardData[];
  /** Opcional: sobreescribe el mensaje cuando no hay días. */
  emptyMessage?: string;
  /** Opcional: aria-label para la sección. */
  ariaLabel?: string;
  /** Opcional: separador visual entre cards. Default: spacing de Tailwind gap-3. */
  spacingClass?: string;
}

const DEFAULT_EMPTY_MESSAGE = "No hay fumigaciones en este rango";
const DEFAULT_ARIA_LABEL = "Lista de días con fumigaciones";
const DEFAULT_SPACING_CLASS = "flex flex-col gap-3";

export function DayList({
  days,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  ariaLabel = DEFAULT_ARIA_LABEL,
  spacingClass = DEFAULT_SPACING_CLASS
}: DayListProps) {
  if (days.length === 0) {
    return (
      <div
        aria-label={ariaLabel}
        className="rounded-2xl border border-[#d2ddd6] bg-white p-8 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
        data-testid="task-history-day-list-empty"
      >
        <p className="text-sm font-semibold text-[#4a5b50]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className={spacingClass}
      data-count={days.length}
      data-testid="task-history-day-list"
    >
      {days.map((day) => (
        <DayCard day={day} key={day.date} />
      ))}
    </div>
  );
}
