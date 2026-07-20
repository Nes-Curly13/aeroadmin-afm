"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ParcelSearch } from "@/components/map/parcel-search";
import { EmptyState } from "@/components/ui/empty-state";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

const MapClient = dynamic(() => import("@/components/map-client").then((module) => module.MapClient), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-220px)] items-center justify-center rounded-2xl bg-[#f4f7f4] text-sm font-semibold uppercase tracking-[0.2em] text-[#587064]">
      Cargando mapa
    </div>
  )
});

function parcelStyle(isOrchard: boolean) {
  return {
    color: isOrchard ? "#7b3f00" : "#0b5f2d",
    weight: 2,
    fillColor: isOrchard ? "#f4a460" : "#90EE90",
    fillOpacity: 0.35
  };
}

function ha(m2: number | null) {
  if (m2 === null || m2 === undefined) return "—";
  return `${(m2 / 10_000).toFixed(3)} ha`;
}

function mOrNull(v: number | null, suffix = "") {
  if (v === null || v === undefined) return "—";
  return `${v}${suffix}`;
}

export function MapView({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds
}: {
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
}) {
  const [layers, setLayers] = useState({
    parcels: true,
    waypoints: true,
    alerts: true,
    flights: true,
    // M3-M5 Track B: opt-in (default false) — renderiza la geometría
    // del plan DJI como polilínea dashed. Decisión: dos capas
    // independientes (waypoints = dots sueltos, flightPlans = plan
    // conectado), porque sirven casos de uso distintos.
    flightPlans: false
  });
  const [selectedParcelId, setSelectedParcelId] = useState<number | null>(
    parcels[0]?.id ?? null
  );

  const selectedParcel = useMemo(() => {
    return parcels.find((p) => p.id === selectedParcelId) ?? parcels[0];
  }, [parcels, selectedParcelId]);

  const selectedAlert = alerts[0];
  const toggleLayer = (layer: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));

  if (!parcels || parcels.length === 0) {
    return (
      <EmptyState
        cta={{ href: "/parcels", label: "Ver listado de parcelas" }}
        description="El mapa se habilita cuando el operador importa las parcelas desde DJI Agras. Si esperás ver datos acá y no aparecen, contactá al supervisor del operador."
        eyebrow="Estado espacial"
        testId="map-view-empty"
        title="Aún no hay parcelas para mostrar"
      />
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-220px)] overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-0">
        <MapClient
          alerts={alerts}
          flightPoints={flightPoints}
          flights={flights}
          fumigatedParcelIds={fumigatedParcelIds}
          layers={layers}
          parcels={parcels}
        />
      </div>

      {/* Leyenda inferior izquierda */}
      <div className="pointer-events-none absolute bottom-6 left-6 z-[400] flex gap-4">
        <section
          aria-label="Leyenda del mapa"
          className="flex items-center gap-4 rounded-xl border border-[#d2ddd6] bg-white px-4 py-2 shadow-lg"
          role="region"
        >
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-[#0b5f2d]/40 border-2 border-[#0b5f2d]" />
            <span className="text-[10px] font-bold uppercase text-[#4a5b50]">Farmland</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-[#f4a460]/40 border-2 border-[#7b3f00]" />
            <span className="text-[10px] font-bold uppercase text-[#4a5b50]">Orchards</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[#c7a43a]" />
            <span className="text-[10px] font-bold uppercase text-[#4a5b50]">Waypoint</span>
          </div>
          {flightPoints && flightPoints.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#22c55e] border border-[#0b5f2d]" />
              <span className="text-[10px] font-bold uppercase text-[#4a5b50]">Vuelo</span>
            </div>
          )}
        </section>
      </div>

      {/* Panel detalle de la parcela seleccionada */}
      <div className="absolute bottom-0 right-0 top-0 z-[400] w-full max-w-sm overflow-y-auto border-l border-[#d2ddd6] bg-white/95 p-5 backdrop-blur">
        <div className="mb-4 flex items-center justify-between">
          <span
            className={`rounded-full px-3 py-1 text-[12px] font-bold ${
              selectedParcel?.is_orchard
                ? "bg-[#7b3f00]/10 text-[#7b3f00]"
                : "bg-[#0b5f2d]/10 text-[#0b5f2d]"
            }`}
          >
            {selectedParcel?.field_type ?? "—"}
          </span>
        </div>

        <div className="mb-4">
          <p className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-[#587064]">Seleccionar parcela</p>
          <ParcelSearch
            onSelect={setSelectedParcelId}
            parcels={parcels}
            selectedId={selectedParcelId}
          />
        </div>

        <h3 className="text-2xl font-semibold text-[#121815]">
          {selectedParcel?.land_name ?? "Sin selección"}
        </h3>
        <p className="mb-5 mt-1 text-xs text-[#4a5b50]">
          {selectedParcel?.external_id}
        </p>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Área fumigable</p>
            <p className="text-2xl font-bold text-[#121815]">
              {ha(selectedParcel?.spray_area_m2 ?? null)}
            </p>
          </div>
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Waypoints</p>
            <p className="text-2xl font-bold text-[#0b5f2d]">
              {selectedParcel?.waypoint_count ?? 0}
            </p>
          </div>
        </div>

        {/* Configuración del dron */}
        <div className="mb-5 rounded-lg border border-[#e2e8e0] bg-white p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Dron</p>
          <p className="text-base font-semibold text-[#121815]">
            {selectedParcel?.drone_model_name ?? "—"}
          </p>
        </div>

        {/* Parámetros de aspersión */}
        <div className="mb-5 rounded-lg border border-[#e2e8e0] bg-white p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Parámetros de aspersión</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Ancho de swath</dt>
              <dd className="font-semibold text-[#121815]">{mOrNull(selectedParcel?.spray_width_m, " m")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Velocidad</dt>
              <dd className="font-semibold text-[#121815]">{mOrNull(selectedParcel?.work_speed_mps, " m/s")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Altura radar</dt>
              <dd className="font-semibold text-[#121815]">{mOrNull(selectedParcel?.radar_height_m, " m")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Heading óptimo</dt>
              <dd className="font-semibold text-[#121815]">{mOrNull(selectedParcel?.optimal_heading_deg, "°")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Gota</dt>
              <dd className="font-semibold text-[#121815]">{mOrNull(selectedParcel?.droplet_size, " µm")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#4a5b50]">Side spray</dt>
              <dd className="font-semibold text-[#121815]">
                {selectedParcel?.uses_side_spray === true ? "Sí" : selectedParcel?.uses_side_spray === false ? "No" : "—"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Toggle de capas */}
        <div className="rounded-xl border border-[#d2ddd6] bg-white p-4">
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#587064]">Capas del mapa</h4>
          <div className="space-y-2">
            {(["parcels", "waypoints", "alerts", "flights", "flightPlans"] as const).map((key) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-[#eef2ee] p-3">
                <span className="text-sm font-semibold capitalize text-[#121815]">
                  {key === "flights"
                    ? "Vuelos (DJI AG)"
                    : key === "flightPlans"
                    ? "Planes de vuelo"
                    : key}
                </span>
                <input
                  checked={layers[key]}
                  className="rounded text-[#0b5f2d] focus:ring-[#0b5f2d]"
                  onChange={() => toggleLayer(key)}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Link al detalle completo */}
        {selectedParcel && (
          <div className="rounded-xl border border-[#0b5f2d]/20 bg-[#f4f7f4] p-4">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#587064]">Más detalle</h4>
            <p className="mt-1 text-xs text-[#4a5b50]">
              Vista de página completa con áreas comparadas, plan de vuelo y acciones.
            </p>
            <Link
              className="mt-3 block rounded-full bg-[#0b5f2d] px-4 py-2 text-center text-sm font-semibold text-white"
              href={`/parcels/${selectedParcel.id}`}
            >
              Ver detalle completo →
            </Link>
          </div>
        )}

        {selectedAlert && (
          <div className="mt-4 rounded-xl border border-[#a93232]/30 bg-[#fff5f3] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a93232]">Última alerta</p>
            <p className="mt-1 text-sm font-semibold text-[#121815]">{selectedAlert.level}</p>
            <p className="mt-1 text-xs text-[#4a5b50]">{selectedAlert.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
