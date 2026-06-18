"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { DjiAlertRecord, DjiAssetRecord, DjiDailySummaryRecord, DjiParcelRecord } from "@/lib/types";

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
  alerts
}: {
  // Aceptamos ambos tipos: DjiParcelRecord (nuevo, normalizado) o DjiAssetRecord (legacy).
  // El runtime hoy pasa DjiParcelRecord desde app/map/page.tsx, pero el componente
  // puede recibir cualquier shape compatible (cobertura para tests / fallback).
  parcels: DjiParcelRecord[] | DjiAssetRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
}) {
  const [layers, setLayers] = useState({ parcels: true, waypoints: true, alerts: true });
  const [selectedParcelId, setSelectedParcelId] = useState<number | null>(
    (parcels as DjiParcelRecord[])[0]?.id ?? null
  );

  const selectedParcel = useMemo(() => {
    const list = parcels as DjiParcelRecord[];
    return list.find((p) => p.id === selectedParcelId) ?? list[0];
  }, [parcels, selectedParcelId]);

  const selectedAlert = alerts[0];
  const toggleLayer = (layer: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));

  const parcelsList = parcels as DjiParcelRecord[];

  if (!parcels || parcels.length === 0) {
    return (
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-8 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Estado espacial</p>
        <h2 className="mt-3 text-3xl font-black text-[#121815]">No hay parcelas importadas</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#4a5b50]">
          El modelo normalizado <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-xs">dji_parcels</code> está vacío.
          Corre <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-xs">npm run db:init:v2</code> para popularla desde los assets en
          <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-xs"> djiag_exports/land_files/</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-220px)] overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-0">
        <MapClient
          alerts={alerts}
          flights={flights}
          layers={layers}
          parcels={parcelsList as unknown as DjiAssetRecord[]}
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
          <label htmlFor="parcel-selector" className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-[#587064]">Seleccionar parcela</label>
          <select
            id="parcel-selector"
            className="w-full rounded-lg border border-[#cfd8d3] p-2 text-sm"
            onChange={(e) => setSelectedParcelId(Number(e.target.value))}
            value={selectedParcelId ?? ""}
          >
            {parcelsList.map((parcel) => (
              <option key={parcel.id} value={parcel.id}>
                {parcel.land_name || parcel.external_id}
              </option>
            ))}
          </select>
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
            {(["parcels", "waypoints", "alerts"] as const).map((key) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-[#eef2ee] p-3">
                <span className="text-sm font-semibold capitalize text-[#121815]">{key}</span>
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
