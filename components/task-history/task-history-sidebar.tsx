"use client";

/**
 * TaskHistorySidebar — sidebar de filtros + lista de items (v1.7 Track C).
 *
 * Reemplaza al TaskHistoryToolbar (que vivía en el AppShell actions)
 * y la lista de items (que vivía en el body del TaskHistoryClient).
 *
 * Layout (de arriba a abajo):
 *
 *   ┌──────────────────────────────────────┐
 *   │ Filtros               N parcelas  [X] │  ← FilterSidebar header
 *   │ ──────────────────────────────────── │
 *   │ PERIODO              1                │  ← FilterSidebarSection
 *   │   [DateRangePicker]                  │
 *   │ DRONES               0 / 12          │  ← FilterSidebarSection
 *   │   [input + datalist]                 │
 *   │ PILOTO               0               │  ← FilterSidebarSection
 *   │   [input]                            │
 *   │ PARCELA              0               │  ← FilterSidebarSection
 *   │   [input numérico]                   │
 *   │ ──────────────────────────────────── │
 *   │ [Descargar reporte]    (screenshot)  │  ← header actions
 *   │ ──────────────────────────────────── │
 *   │ 2026/07/08Wednesday                  │  ← DayCard 1 (en scroll)
 *   │   Agriculture       18.29 mu         │
 *   │   09:14 T40#45  Breiner 12.5mu 0.5h  │  ← sub-lista vuelos
 *   │   11:32 T40#45  Breiner  5.8mu 0.4h  │
 *   │ 2026/07/07Tuesday                   │  ← DayCard 2
 *   │   ...                                │
 *   └──────────────────────────────────────┘
 *
 * El scroll de la lista de items es INTERNO (no mueve el body) gracias
 * al `<ScrollablePanel maxHeight="...">`. Esto preserva el contexto
 * del operador: los filtros y el header quedan siempre visibles
 * mientras scrollea los items.
 *
 * v1.7 Track C — audit #11 + a11y:
 *   - Cada `<FilterSidebarSection>` muestra `count` (total de opciones
 *     disponibles) y `activeCount` (cuántas están aplicadas). Esto
 *     responde "cuántos registros pasan el filtro" sin tener que
 *     abrir el dropdown.
 *   - El `<FilterSidebar>` muestra `resultCount` (parcelas fumigadas
 *     en el rango, ya calculadas por la page) + `resultLabel="parcelas"`.
 *   - El botón "Limpiar filtros" en el header borra todos los params
 *     de filtro (preserva `from`/`to` porque el rango es independiente).
 *
 * Tests: tests/components/task-history/task-history-sidebar.test.tsx
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  FilterSidebar,
  FilterSidebarSection
} from "@/components/ui/filter-sidebar";
import { ScrollablePanel } from "@/components/ui/scrollable-panel";
import { DayCard } from "@/components/task-history/day-card";
import { DateRangePicker } from "@/components/task-history/date-range-picker";
import { ScreenshotButton } from "@/components/task-history/screenshot-button";
import { FlightDetailDrawer } from "@/components/task-history/flight-detail-drawer";
import type {
  DayCardWithFlights,
  FlightListItem
} from "@/lib/djiag-from-make/task-history";

const TASK_HISTORY_CONTENT_SELECTOR = "[data-testid='task-history-content']";
const SCROLL_MAX_HEIGHT = "calc(100vh - 560px)";

export interface TaskHistorySidebarProps {
  /** Date range activo (YYYY-MM-DD) — se pasa al ScreenshotButton y al DateRangePicker. */
  from: string;
  to: string;
  /**
   * Días enriquecidos con sus vuelos individuales (de
   * `aggregateNormalizedDaysWithFlights`). El sidebar renderiza
   * cada día como un DayCard, y si el día tiene vuelos, los muestra
   * como sub-lista dentro del card.
   */
  days: DayCardWithFlights[];
  /** Cantidad de polígonos fumigados en el rango (para ScreenshotButton disable). */
  polygonCount: number;
  /** Sugerencias de drones para el datalist del filtro de drones. */
  droneSuggestions: string[];
  /** Lookup de nombre de parcela por id (para el FlightDetailDrawer). */
  parcelNameById: Map<number, string>;
}

export function TaskHistorySidebar({
  from,
  to,
  days,
  polygonCount,
  droneSuggestions,
  parcelNameById
}: TaskHistorySidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Vuelo actualmente seleccionado en el FlightDetailDrawer.
  // `null` = drawer cerrado.
  const [activeFlight, setActiveFlight] = useState<FlightListItem | null>(null);

  const openFlightDetail = useCallback((flight: FlightListItem) => {
    setActiveFlight(flight);
  }, []);
  const closeFlightDetail = useCallback(() => {
    setActiveFlight(null);
  }, []);

  // El "Clear" del FilterSidebar: borra TODOS los filtros (parcelId,
  // droneSerial, pilot) pero PRESERVA from/to (el rango es independiente
  // de los filtros — un operador puede querer el mismo rango con
  // distintos filtros).
  const onClearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("parcelId");
    params.delete("droneSerial");
    params.delete("pilot");
    params.delete("cropType");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    router.refresh();
  }, [router, pathname, searchParams]);

  // Counts para los badges de a11y (audit #11).
  const droneFilterActive = searchParams.get("droneSerial") ? 1 : 0;
  const pilotFilterActive = searchParams.get("pilot") ? 1 : 0;
  const parcelFilterActive = searchParams.get("parcelId") ? 1 : 0;
  const totalActiveFilters =
    droneFilterActive + pilotFilterActive + parcelFilterActive;

  // Counts totales (cuántas opciones hay en cada categoría).
  // Estos NO se pueden calcular exacto en el cliente (dependen de la
  // query a la BD). Pasamos la longitud de las sugerencias cuando
  // aplique; para los demás usamos 0 (el caller puede extender si
  // quiere mostrar "N drones" exactos).
  const totalDrones = droneSuggestions.length;

  // Convertir DayCardWithFlights[] → DayCard[] (el shape que DayList
  // espera) preservando los flights en un Map por fecha para que
  // el DayCard los pueda lookupear.
  // (El DayCard ahora acepta flights como prop opcional, así que
  // podríamos pasarle cada día con su flight list directamente. Pero
  // DayList no sabe nada de flights — entonces hacemos un wrapper
  // acá o extendemos DayList. La opción más limpia: renderizar la
  // lista manualmente acá en lugar de usar DayList.)
  //
  // Decisión: renderizamos manualmente (más control sobre el layout
  // de la sidebar, sin acoplar DayList al shape extendido). DayList
  // sigue existiendo para usos legacy / tests.

  // Fallback visible: si `days` viene vacío, mostrar un mensaje.
  if (days.length === 0) {
    return (
      <FilterSidebar
        ariaLabel="Filtros del Task History"
        onClear={onClearFilters}
        resultCount={0}
        resultLabel="parcelas"
        testId="task-history-sidebar"
        title="Filtros"
      >
        <PeriodSection />
        <DroneSection droneSuggestions={droneSuggestions} totalDrones={totalDrones} />
        <PilotSection />
        <ParcelSection />
        <ScreenshotAction
          from={from}
          polygonCount={polygonCount}
          to={to}
        />
        <div
          className="mt-3 rounded-2xl border border-[#d2ddd6] bg-white p-6 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
          data-testid="task-history-sidebar-empty"
        >
          <p className="text-sm font-semibold text-[#4a5b50]">
            No hay fumigaciones en este rango
          </p>
        </div>
        <FlightDetailDrawer
          flight={activeFlight}
          onClose={closeFlightDetail}
          parcelNameById={parcelNameById}
        />
      </FilterSidebar>
    );
  }

  return (
    <FilterSidebar
      ariaLabel="Filtros del Task History"
      clearLabel={totalActiveFilters > 0 ? `Limpiar (${totalActiveFilters})` : "Limpiar"}
      onClear={totalActiveFilters > 0 ? onClearFilters : undefined}
      resultCount={polygonCount}
      resultLabel="parcelas"
      testId="task-history-sidebar"
      title="Filtros"
    >
      <PeriodSection />
      <DroneSection
        activeCount={droneFilterActive}
        count={totalDrones}
        droneSuggestions={droneSuggestions}
      />
      <PilotSection activeCount={pilotFilterActive} />
      <ParcelSection activeCount={parcelFilterActive} />
      <ScreenshotAction
        from={from}
        polygonCount={polygonCount}
        to={to}
      />
      <ScrollablePanel
        ariaLabel="Lista de días con fumigaciones"
        maxHeight={SCROLL_MAX_HEIGHT}
        testId="task-history-sidebar-items"
      >
        <ul
          className="flex flex-col gap-3"
          data-count={days.length}
          data-testid="task-history-day-list"
        >
          {days.map(({ day, flights }) => (
            <li data-date={day.date?.replace(/-/g, "/")} key={day.date ?? Math.random()}>
              <DayCard
                day={day}
                flights={flights}
                onFlightClick={openFlightDetail}
              />
            </li>
          ))}
        </ul>
      </ScrollablePanel>
      <FlightDetailDrawer
        flight={activeFlight}
        onClose={closeFlightDetail}
        parcelNameById={parcelNameById}
      />
    </FilterSidebar>
  );
}

// ============================================================
// Filter sections
// ============================================================

function PeriodSection() {
  // DateRangePicker ya hace todo: maneja from/to via URL.
  // Lo metemos dentro de un FilterSidebarSection para mantener la
  // consistencia visual con los otros grupos.
  // "Periodo" siempre cuenta como 1 (un único rango activo) y siempre
  // está activo (si no hay rango, hay default). El activeCount queda
  // en 1 de manera estable — refleja que el usuario TIENE un rango
  // seleccionado, no cuántos periodos hay disponibles.
  return (
    <FilterSidebarSection
      activeCount={1}
      count={1}
      testId="task-history-sidebar-section-period"
      title="Periodo"
    >
      <DateRangePicker />
    </FilterSidebarSection>
  );
}

function DroneSection({
  count,
  activeCount,
  droneSuggestions
}: {
  count?: number;
  activeCount?: number;
  droneSuggestions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("droneSerial") ?? "");

  // Sincronizar con URL changes (e.g. back/forward).
  useEffect(() => {
    const fromUrl = searchParams.get("droneSerial") ?? "";
    if (fromUrl !== value) setValue(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const apply = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) {
        params.set("droneSerial", next);
      } else {
        params.delete("droneSerial");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
    },
    [router, pathname, searchParams]
  );

  const inputId = "task-history-sidebar-drone";
  return (
    <FilterSidebarSection
      activeCount={activeCount}
      count={count}
      testId="task-history-sidebar-section-drone"
      title="Drones"
    >
      <label className="sr-only" htmlFor={inputId}>
        Filtrar por serial de dron
      </label>
      <input
        className="w-full rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
        data-testid={`${inputId}-input`}
        id={inputId}
        list="task-history-sidebar-drone-suggestions"
        onBlur={() => apply(value)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(value);
        }}
        placeholder="ej. 1581F5BKD23100045"
        type="text"
        value={value}
      />
      {droneSuggestions.length > 0 ? (
        <datalist id="task-history-sidebar-drone-suggestions">
          {droneSuggestions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      ) : null}
    </FilterSidebarSection>
  );
}

function PilotSection({ activeCount }: { activeCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("pilot") ?? "");

  useEffect(() => {
    const fromUrl = searchParams.get("pilot") ?? "";
    if (fromUrl !== value) setValue(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const apply = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) {
        params.set("pilot", next);
      } else {
        params.delete("pilot");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
    },
    [router, pathname, searchParams]
  );

  const inputId = "task-history-sidebar-pilot";
  return (
    <FilterSidebarSection
      activeCount={activeCount}
      testId="task-history-sidebar-section-pilot"
      title="Piloto"
    >
      <label className="sr-only" htmlFor={inputId}>
        Filtrar por nombre del piloto
      </label>
      <input
        className="w-full rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
        data-testid={`${inputId}-input`}
        id={inputId}
        onBlur={() => apply(value)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(value);
        }}
        placeholder="ej. Breiner"
        type="text"
        value={value}
      />
    </FilterSidebarSection>
  );
}

function ParcelSection({ activeCount }: { activeCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("parcelId") ?? "");

  useEffect(() => {
    const fromUrl = searchParams.get("parcelId") ?? "";
    if (fromUrl !== value) setValue(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const apply = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next && /^\d+$/.test(next)) {
        params.set("parcelId", next);
      } else {
        params.delete("parcelId");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
    },
    [router, pathname, searchParams]
  );

  const inputId = "task-history-sidebar-parcel";
  return (
    <FilterSidebarSection
      activeCount={activeCount}
      testId="task-history-sidebar-section-parcel"
      title="Parcela"
    >
      <label className="sr-only" htmlFor={inputId}>
        Filtrar por id de parcela
      </label>
      <input
        className="w-full rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
        data-testid={`${inputId}-input`}
        id={inputId}
        inputMode="numeric"
        onBlur={() => apply(value)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(value);
        }}
        placeholder="ej. 42"
        type="text"
        value={value}
      />
    </FilterSidebarSection>
  );
}

function ScreenshotAction({
  from,
  to,
  polygonCount
}: {
  from: string;
  to: string;
  polygonCount: number;
}) {
  return (
    <div className="flex items-center justify-end border-t border-[#d2ddd6] pt-3">
      <ScreenshotButton
        dateRange={{ from, to }}
        filenamePrefix="task-history"
        omitMap
        polygonCount={polygonCount}
        targetSelector={TASK_HISTORY_CONTENT_SELECTOR}
      />
    </div>
  );
}

export default TaskHistorySidebar;
