"use client";

import dynamic from "next/dynamic";
import type { Map as MlMap } from "maplibre-gl";

import { MapLegend } from "@/components/map/map-legend";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";
import type { MapFumigationEvent } from "@/lib/map-filter-types";

/**
 * v2.0 (2026-07-28) — migración Leaflet → MapLibre.
 *
 * El wrapper dinámico de `MapClient` (Leaflet) se reemplaza por
 * `MapLibreView` (MapLibre GL JS). El contrato de props se mantiene
 * 1:1 para no tocar los callers (`app/map/page.tsx`,
 * `app/map/map-page-client.tsx`).
 *
 * Próximos pasos del sprint (no en este commit):
 *   - Eliminar `components/map-client.tsx` y `react-leaflet`/`leaflet` deps.
 *   - Migrar `components/parcels/parcel-mini-map.tsx` a MapLibre.
 *   - Reemplazar Leaflet `<LayersControl>` por panel de toggles propio
 *     en `MapPageClient` (los props `showParcels`, `showWaypoints`, etc.
 *     ya están en `MapLibreView`).
 *
 * v2.1 (sprint S6) — se agregan las props `onMapReady` y `fumigationEvents`
 * para que el padre pueda hacer fitBounds programático y para plumbrar
 * los eventos de fumigación (render de markers en el mapa es TODO S6.1).
 */
const MapLibreView = dynamic(
  () => import("@/components/map/maplibre-view").then((m) => m.MapLibreView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[60vh] items-center justify-center rounded-2xl bg-[#f4f7f4] text-sm font-semibold uppercase tracking-[0.2em] text-[#587064]">
        Cargando mapa
      </div>
    )
  }
);

export interface MapViewProps {
  // (S2 / 2026-07-01) Solo DjiParcelRecord. El legacy DjiAssetRecord (3-rows-per-field)
  // se eliminó junto con getParcels() y el endpoint /api/parcels. La tabla
  // dji_land_assets se dropeó en la migración 20260628120000.
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  // M6: footprints minimos de sorties. Plot se hace en MapLibreView.
  flightPoints?: FlightPointRecord[];
  // M3-M5 Track A: Set<number> de parcel_ids fumigados en los últimos 6m.
  // Si undefined o vacío, todas se ven como fumigadas (backwards compat).
  fumigatedParcelIds?: Set<number>;
  // v1.8 — opcional: si viene, se renderiza como overlay absoluto en la
  // esquina superior derecha del mapa. Usado por app/map/page.tsx para
  // montar el botón "Filtros" cuando el sidebar está colapsado.
  topRightSlot?: React.ReactNode;
  // v2.0 — parcel seleccionada (opcional). MapLibreView hace fly-to + highlight.
  selectedParcelId?: number | null;
  onSelect?: (id: number | null) => void;
  /**
   * v2.1 (sprint S6) — callback invocado una vez cuando el map está listo.
   * El padre guarda la ref y puede llamar `map.flyTo({ bounds })` /
   * `map.fitBounds(...)` desde sus propios useEffect.
   */
  onMapReady?: (map: MlMap) => void;
  /**
   * v2.1 (sprint S6) — eventos de fumigación aplanados para el data
   * plumbing del V0 port. El render de markers en el mapa es TODO
   * (sprint S6.1); en este commit la prop se acepta pero no se usa.
   */
  fumigationEvents?: MapFumigationEvent[];
}

/**
 * MapView — wrapper client-side del MapLibre GL JS map.
 *
 * v2.0 (2026-07-28) — swap Leaflet → MapLibre. Layout y UX intactos:
 *   - Mapa + leyenda abajo-izquierda.
 *   - topRightSlot para filtros/chips del page header.
 *   - Click en polígono → popup con detalle + onSelect (v2.0 nuevo).
 *
 * v2.1 (2026-07-28) — agrega forward de `onMapReady` y `fumigationEvents`
 * al MapLibreView.
 */
export function MapView({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  topRightSlot,
  selectedParcelId,
  onSelect,
  onMapReady,
  fumigationEvents
}: MapViewProps) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-0">
        <MapLibreView
          alerts={alerts}
          flightPoints={flightPoints}
          flights={flights}
          fumigatedParcelIds={fumigatedParcelIds}
          fumigationEvents={fumigationEvents}
          onMapReady={onMapReady}
          onSelect={onSelect}
          parcels={parcels}
          selectedParcelId={selectedParcelId}
        />
      </div>

      {/* Leyenda (bottom-left) — overlay absoluto, no tapa el zoom control */}
      <div className="pointer-events-auto absolute bottom-6 left-6 z-[400]">
        <MapLegend />
      </div>

      {/* Top-right slot: filtros / chips del page header */}
      {topRightSlot ? (
        <div className="pointer-events-none absolute right-4 top-4 z-[500] flex items-start gap-2">
          {topRightSlot}
        </div>
      ) : null}
    </div>
  );
}

