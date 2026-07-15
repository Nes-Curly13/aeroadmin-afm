"use client";

/**
 * TaskHistoryClient — orquestador client del Task History.
 *
 * Recibe la data ya agregada del server component y compone los
 * componentes interactivos (DateRangePicker, FilterButton,
 * ScreenshotButton, TabSwitcher, MapView).
 *
 * La logica de fetching vive en app/task-history/page.tsx (server).
 */

import { Suspense, useRef } from "react";
import dynamic from "next/dynamic";

import { DayList } from "@/components/task-history/day-list";
import { DateRangePicker } from "@/components/task-history/date-range-picker";
import { FilterButton } from "@/components/task-history/filter-button";
import { HeaderCard } from "@/components/task-history/header-card";
import { ScreenshotButton } from "@/components/task-history/screenshot-button";
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
  /**
   * Rango de fechas activo (YYYY-MM-DD). Necesario para componer el
   * filename del download del ScreenshotButton con el rango visible,
   * así el operador distingue múltiples descargas del mismo día.
   * Computado en el server component desde `searchParams` (ver
   * `app/task-history/page.tsx`).
   */
  from: string;
  to: string;
}

export function TaskHistoryClient({
  totals,
  days,
  polygons,
  selectedParcelId,
  from,
  to
}: TaskHistoryClientProps) {
  const contentRef = useRef<HTMLElement | null>(null);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col gap-6 p-4 md:p-6 lg:p-8"
      data-testid="task-history-page"
    >
      <header className="flex flex-col gap-4 border-b border-[#d2ddd6] pb-4">
        <h1 className="text-2xl font-black tracking-tight text-[#121815]">Task History</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DateRangePicker />
          <div className="flex items-center gap-2">
            <FilterButton />
            <ScreenshotButton
              dateRange={{ from, to }}
              filenamePrefix="task-history"
              omitMap
              polygonCount={polygons.length}
              targetRef={contentRef as React.RefObject<HTMLElement | null>}
            />
          </div>
        </div>
        <TabSwitcher />
      </header>

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
    </main>
  );
}
