"use client";

import dynamic from "next/dynamic";

import { MapLegend } from "@/components/map/map-legend";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

const MapClient = dynamic(() => import("@/components/map-client").then((module) => module.MapClient), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[60vh] items-center justify-center rounded-2xl bg-[#f4f7f4] text-sm font-semibold uppercase tracking-[0.2em] text-[#587064]">
      Cargando mapa
    </div>
  )
});

export interface MapViewProps {
  // (S2 / 2026-07-01) Solo DjiParcelRecord. El legacy DjiAssetRecord (3-rows-per-field)
  // se eliminó junto con getParcels() y el endpoint /api/parcels. La tabla
  // dji_land_assets se dropeó en la migración 20260628120000.
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  // M6: footprints minimos de sorties. Plot se hace en MapClient.
  flightPoints?: FlightPointRecord[];
  // M3-M5 Track A: Set<number> de parcel_ids fumigados en los últimos 6m.
  // Si undefined o vacío, todas se ven como fumigadas (backwards compat).
  fumigatedParcelIds?: Set<number>;
  // v1.8 — opcional: si viene, se renderiza como overlay absoluto en la
  // esquina superior derecha del mapa. Usado por app/map/page.tsx para
  // montar el botón "Filtros" cuando el sidebar está colapsado.
  topRightSlot?: React.ReactNode;
}

/**
 * MapView — wrapper client-side del Leaflet MapContainer.
 *
 * v1.8 (2026-07-27) — **simplificación de layout** según mockup del
 * operador:
 *   - Antes (v1.7): el componente renderizaba un panel permanente a la
 *     derecha con buscador, datos del dron, parámetros de aspersión,
 *     toggles de capa y link al detalle. Ocupaba ~384px de ancho
 *     constante y ensuciaba el viewport.
 *   - Ahora (v1.8): la pieza es **solo el mapa + leyenda abajo-izquierda**.
 *     El detalle de la parcela se ve en el popup de Leaflet al hacer
 *     click en el polígono (con un link "Ver detalle completo →" al
 *     `/parcels/[id]`). Los toggles de capa viven en el `<LayersControl>`
 *     nativo de Leaflet (esquina superior derecha).
 *   - El page (`app/map/page.tsx`) monta ahora el `topRightSlot` con
 *     el botón "Filtros" y el chip "X Parcelas", que aparecen sobre
 *     el mapa como overlay absoluto (en vez de vivir en una sidebar).
 *
 * El estado de layers y la parcela seleccionada se removieron — ya no
 * hay panel que los muestre. La "selección" ahora es implícita via
 * el popup que Leaflet abre al click.
 */
export function MapView({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  topRightSlot
}: MapViewProps) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-0">
        <MapClient
          alerts={alerts}
          flightPoints={flightPoints}
          flights={flights}
          fumigatedParcelIds={fumigatedParcelIds}
          parcels={parcels}
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
