"use client";

import { useCallback, useState } from "react";

import { MapFilterSidebar } from "@/components/map/map-filter-sidebar";
import { MapView } from "@/components/map-view";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

/**
 * components/map/map-page-client.tsx
 *
 * v1.8 — wrapper cliente del body completo de `/map`.
 *
 * Por qué existe (separado de app/map/page.tsx):
 *   - La page es server-side y hace queries paralelas a la DB. Pero
 *     el estado del drawer de filtros (collapsed / open) y el header
 *     con chip "X Parcelas" + botón "Filtros" son UI client-only.
 *   - Server Component → Client Component: la page pasa los datos
 *     ya hidratados al client; este componente los monta en el layout
 *     y maneja la interactividad.
 *
 * Layout (mockup usuario 2026-07-27):
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  Page header: logo + "Mapa de Parcelas" + subtítulo corto   │
 *   │                                            [chip] [Filtros] │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │                                                              │
 *   │                              │   ┌──────────────────────┐  │
 *   │                              │   │ Filtros del mapa  <  │  │
 *   │            MAPA              │   │ 200 Parcelas          │  │
 *   │         (full bleed)         │   │  Drones [...]         │  │
 *   │                              │   │  Cultivo [...]        │  │
 *   │                              │   │  Fumigadas (6m) [...] │  │
 *   │                              │   │  [Limpiar filtros]    │  │
 *   │                              │   └──────────────────────┘  │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Decisiones:
 *   - **El page header vive acá** (no en AppShell). El chip "X Parcelas"
 *     se re-renderea con cada cambio de filtro (URL navigation), y eso
 *     requiere client-side. AppShell recibe `hidePageHeader={true}` para
 *     no pintar el bloque default.
 *   - **Drawer default cerrado** (`filterCollapsed = true`). El mapa
 *     ocupa todo el viewport en la carga inicial. El operador abre el
 *     drawer con el botón "Filtros" del header.
 *   - **El drawer es overlay absolute** (no flex column). Así el mapa
 *     mantiene el 100% del ancho cuando el drawer está cerrado.
 */

type ParcelsSummaryRow = {
  total_parcels: string;
  total_orchards: string;
  total_farmlands: string;
  total_spray_area_m2: string | null;
  avg_spray_area_m2: string | null;
  drone_model_code: number | null;
  drone_model_name: string | null;
  count_by_drone: string;
};

export interface MapPageClientProps {
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  flightPoints?: FlightPointRecord[];
  fumigatedParcelIds: Set<number>;
  summary: ParcelsSummaryRow[];
  resultCount: number;
}

export function MapPageClient({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  summary,
  resultCount
}: MapPageClientProps) {
  // v1.8 — estado del drawer de filtros. Default CERRADO para que el
  // mapa ocupe todo el viewport en la carga inicial.
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const toggleFilters = useCallback(() => {
    setFilterCollapsed((c) => !c);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Page header compacto: logo + título + subtítulo + (der) chip + botón Filtros */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="map-page-header"
      >
        {/* Left: logo + título + subtítulo */}
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b5f2d]/10 text-[#0b5f2d]"
          >
            <span className="text-2xl" role="img" aria-label="Mapa">🗺️</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#121815] sm:text-3xl">
              Mapa de Parcelas
            </h1>
            <p className="mt-0.5 text-sm text-[#4a5b50]">
              Mapa operativo de parcelas DJI con geometría y configuración de vuelo
            </p>
          </div>
        </div>

        {/* Right: chip "X Parcelas" + botón "Filtros" */}
        <div className="flex items-center gap-2">
          <span
            aria-label={`${resultCount} parcelas`}
            className="inline-flex items-center gap-2 rounded-full border border-[#0b5f2d]/25 bg-[#dbe7df] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#0b5f2d]"
            data-testid="map-page-header-parcel-count"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#0b5f2d]" />
            {resultCount} Parcelas
          </span>
          <button
            aria-expanded={!filterCollapsed}
            aria-label={filterCollapsed ? "Abrir filtros" : "Cerrar filtros"}
            className="inline-flex items-center gap-2 rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#121815] shadow-sm transition hover:border-[#0b5f2d]/40 hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
            data-testid="map-page-header-filters-button"
            onClick={toggleFilters}
            type="button"
          >
            <span aria-hidden="true" className="text-sm leading-none">⚲</span>
            Filtros
          </button>
        </div>
      </div>

      {/*
        Body: contenedor relativo. El mapa es full-bleed, el drawer
        es overlay absoluto a la derecha cuando está abierto.
      */}
      <div className="relative lg:h-[calc(100vh-220px)]">
        {/* Mapa — siempre ocupa todo el ancho */}
        <div className="h-full min-h-[60vh] w-full lg:min-h-0">
          <MapView
            alerts={alerts}
            flightPoints={flightPoints}
            flights={flights}
            fumigatedParcelIds={fumigatedParcelIds}
            parcels={parcels}
          />
        </div>

        {/*
          Drawer de filtros (overlay absoluto a la derecha).
          Cuando `filterCollapsed` = true, no se renderiza.
        */}
        {!filterCollapsed ? (
          <div
            className="absolute right-4 top-4 z-[1100] w-[320px] max-w-[calc(100vw-2rem)]"
            data-testid="map-filter-drawer"
          >
            <div className="relative">
              <MapFilterSidebar
                collapsed={false}
                onToggle={toggleFilters}
                resultCount={resultCount}
                summary={summary}
              />
              {/* Botón cerrar superpuesto (chevron `<`) en la esquina
                  superior izquierda del drawer, igual que en el mockup. */}
              <button
                aria-label="Cerrar filtros"
                className="absolute -left-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#cfd8d3] bg-white text-[#121815] shadow-md transition hover:border-[#0b5f2d]/40 hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
                data-testid="map-filter-drawer-close"
                onClick={toggleFilters}
                type="button"
              >
                <span aria-hidden="true" className="text-base leading-none">‹</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
