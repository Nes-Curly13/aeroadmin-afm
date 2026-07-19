"use client";

/**
 * TaskHistoryClient — orquestador client del Task History.
 *
 * Recibe la data ya agregada del server component y compone los
 * componentes interactivos del CUERPO (TabSwitcher, HeaderCard,
 * DayList, MapView). El h1/subtítulo y el toolbar (DateRangePicker,
 * FilterButton, ScreenshotButton) viven ahora en el `actions` slot
 * del AppShell que envuelve la page (ver audit §4.1 / Q1 Coder A).
 *
 * La logica de fetching vive en app/task-history/page.tsx (server).
 *
 * Estructura del DOM:
 *
 *   <section data-testid="task-history-content"> ← target del screenshot
 *     <TabSwitcher />
 *     <HeaderCard />
 *     <DayList />
 *     <MapView />
 *   </section>
 *
 * El `data-testid="task-history-content"` es el selector que usa
 * `ScreenshotButton.targetSelector` desde AppShell actions para
 * encontrar el contenedor a capturar.
 */

import { Suspense, useRef } from "react";
import dynamic from "next/dynamic";

import { DayList } from "@/components/task-history/day-list";
import { HeaderCard } from "@/components/task-history/header-card";
import { TabSwitcher } from "@/components/task-history/tab-switcher";
import type { DayCard as DayCardData, TaskHistoryTotals } from "@/lib/djiag-from-make/task-history";
import type { MapPolygon } from "@/components/task-history/map-view";

const TaskHistoryMap = dynamic(
  () => import("@/components/task-history/map-view").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[600px] animate-pulse rounded-2xl bg-[#f4f7f4]" data-testid="task-history-map-loading" />
    )
  }
);

export interface TaskHistoryClientProps {
  totals: TaskHistoryTotals;
  days: DayCardData[];
  polygons: MapPolygon[];
  selectedParcelId: number | null;
}

export function TaskHistoryClient({
  totals,
  days,
  polygons,
  selectedParcelId
}: TaskHistoryClientProps) {
  const contentRef = useRef<HTMLElement | null>(null);

  return (
    <div className="flex flex-col gap-6" data-testid="task-history-page">
      <TabSwitcher />

      <section
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"
        data-testid="task-history-content"
        ref={contentRef}
      >
        <div className="flex flex-col gap-4">
          <HeaderCard totals={totals} />
          {selectedParcelId !== null ? (
            <p
              className="rounded-md border border-[#0b5f2d] bg-[#f4f7f4] px-3 py-2 text-sm font-semibold text-[#0b5f2d]"
              data-testid="task-history-selected-banner"
            >
              Mostrando fumigaciones del parcel #{selectedParcelId}.
            </p>
          ) : null}
          <DayList days={days} />
        </div>
        <div className="min-h-[600px]">
          <Suspense
            fallback={
              <div
                className="h-[600px] animate-pulse rounded-2xl bg-[#f4f7f4]"
                data-testid="task-history-map-loading"
              />
            }
          >
            <TaskHistoryMap
              center={[3.5, -76.3]}
              polygons={polygons}
              selectedParcelId={selectedParcelId}
            />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
