"use client";

/**
 * TaskHistoryClient — orquestador client del Task History (v1.7 Track C).
 *
 * Layout nuevo (sprint v1.7): patrón bento "map main + sidebar" igual
 * al que ya usa track B. El cliente renderiza:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  TabSwitcher (Map / List)                                │
 *   ├────────────────────────────────────┬─────────────────────┤
 *   │                                    │  FilterSidebar      │
 *   │                                    │   - Periodo         │
 *   │                                    │   - Drones          │
 *   │   <MapView />                      │   - Piloto          │
 *   │   (leaflet, polígonos fumigados)   │   - Parcela         │
 *   │                                    │   - [Descargar]     │
 *   │                                    │   - DayCard 1       │
 *   │                                    │     ...sub-lista    │
 *   │                                    │   - DayCard 2       │
 *   │                                    │     ...sub-lista    │
 *   │                                    │   - ... (scroll)    │
 *   └────────────────────────────────────┴─────────────────────┘
 *
 * El scroll de la lista de items es INTERNO al sidebar (gracias a
 * `ScrollablePanel`), no del body. El operador nunca pierde de vista
 * los filtros mientras scrollea los días.
 *
 * El h1 + el subtítulo del AppShell siguen siendo el header del screen
 * (no se renderizan acá). El DateRangePicker, FilterButton y
 * ScreenshotButton se movieron del `actions` del AppShell al sidebar
 * (v1.7 Track C). Ver `TaskHistorySidebar.tsx` para esos detalles.
 *
 * El `data-testid="task-history-content"` se mantiene como target del
 * ScreenshotButton (que vive en la sidebar).
 *
 * Estructura del DOM:
 *
 *   <section data-testid="task-history-content"> ← target del screenshot
 *     <TabSwitcher />
 *     <div flex row>
 *       <MapView />  ← izquierda (~60%)
 *       <TaskHistorySidebar />  ← derecha (~40%)
 *     </div>
 *   </section>
 */

import { Suspense } from "react";
import dynamic from "next/dynamic";

import { TabSwitcher } from "@/components/task-history/tab-switcher";
import { TaskHistorySidebar } from "@/components/task-history/task-history-sidebar";
import type { DayCardWithFlights } from "@/lib/djiag-from-make/task-history";
import type { MapPolygon } from "@/components/task-history/map-view";

const TaskHistoryMap = dynamic(
  () => import("@/components/task-history/map-view").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full min-h-[600px] animate-pulse rounded-2xl bg-[#f4f7f4]"
        data-testid="task-history-map-loading"
      />
    )
  }
);

export interface TaskHistoryClientProps {
  /** Rango activo — se pasa al ScreenshotButton y al DateRangePicker. */
  from: string;
  to: string;
  /** Días enriquecidos con sus vuelos individuales. */
  days: DayCardWithFlights[];
  polygons: MapPolygon[];
  selectedParcelId: number | null;
  /** Sugerencias de drones para el datalist del filtro. */
  droneSuggestions: string[];
  /** Lookup de nombre de parcela por id. */
  parcelNameById: Map<number, string> | Record<number, string>;
}

export function TaskHistoryClient({
  from,
  to,
  days,
  polygons,
  selectedParcelId,
  droneSuggestions,
  parcelNameById
}: TaskHistoryClientProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="task-history-page">
      <TabSwitcher />

      <section
        className="flex h-[calc(100vh-220px)] min-h-[640px] flex-col gap-4 lg:flex-row"
        data-testid="task-history-content"
      >
        {/* Mapa principal — ~60% del ancho en desktop. */}
        <div className="relative min-h-[480px] flex-[3] lg:min-h-0">
          <Suspense
            fallback={
              <div
                className="h-full min-h-[600px] animate-pulse rounded-2xl bg-[#f4f7f4]"
                data-testid="task-history-map-loading"
              />
            }
          >
            <TaskHistoryMap
              center={[3.5, -76.3]}
              height="100%"
              polygons={polygons}
              selectedParcelId={selectedParcelId}
            />
          </Suspense>
          {selectedParcelId !== null ? (
            <p
              className="absolute right-3 bottom-3 z-[1000] rounded-md border border-[#0b5f2d] bg-white/90 px-3 py-2 text-xs font-semibold text-[#0b5f2d] shadow"
              data-testid="task-history-selected-banner"
            >
              Filtrando por parcela #{selectedParcelId}.
            </p>
          ) : null}
        </div>

        {/* Sidebar — ~40% del ancho en desktop, ~400px máx. */}
        <div className="flex w-full shrink-0 flex-col lg:w-[400px]">
          <TaskHistorySidebar
            days={days}
            droneSuggestions={droneSuggestions}
            from={from}
            parcelNameById={parcelNameById}
            polygonCount={polygons.length}
            to={to}
          />
        </div>
      </section>
    </div>
  );
}
