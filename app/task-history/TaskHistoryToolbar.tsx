"use client";

/**
 * TaskHistoryToolbar — client component wrapper del toolbar.
 *
 * Vive en el `actions` slot del AppShell que envuelve /task-history
 * (Q1 Coder A, audit §4.1). Agrupa los tres controles que antes
 * vivían dentro del TaskHistoryClient:
 *   - DateRangePicker (rango de fechas)
 *   - FilterButton (filtros adicionales: parcelId, droneSerial, pilot, cropType)
 *   - ScreenshotButton (descarga PNG del contenido)
 *
 * El ScreenshotButton usa `targetSelector` para apuntar al contenedor
 * `data-testid="task-history-content"` dentro del TaskHistoryClient.
 * Esto evita que un ref tenga que cruzar la frontera server/client
 * (AppShell es server, el botón es client, el target está en otro
 * client component).
 *
 * Layout: rango a la izquierda, filtros + download a la derecha
 * (flex-wrap para mobile). Mismo verde teal (#0b5f2d) que el resto
 * del Task History.
 */

import { DateRangePicker } from "@/components/task-history/date-range-picker";
import { FilterButton } from "@/components/task-history/filter-button";
import { ScreenshotButton } from "@/components/task-history/screenshot-button";

const TASK_HISTORY_CONTENT_SELECTOR = "[data-testid='task-history-content']";

export interface TaskHistoryToolbarProps {
  /**
   * Rango activo (YYYY-MM-DD). Se pasa al ScreenshotButton para componer
   * el filename del download (ej. `task-history-2026-07-01_2026-07-15.png`).
   */
  from: string;
  to: string;
  /**
   * Cantidad de polígonos fumigados en el rango. Si es 0, el botón de
   * descarga se deshabilita (no tiene sentido capturar un mapa vacío).
   */
  polygonCount: number;
}

export function TaskHistoryToolbar({ from, to, polygonCount }: TaskHistoryToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="task-history-toolbar"
    >
      <DateRangePicker />
      <div className="flex items-center gap-2">
        <FilterButton />
        <ScreenshotButton
          dateRange={{ from, to }}
          filenamePrefix="task-history"
          omitMap
          polygonCount={polygonCount}
          targetSelector={TASK_HISTORY_CONTENT_SELECTOR}
        />
      </div>
    </div>
  );
}
