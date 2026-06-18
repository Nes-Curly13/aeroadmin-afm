import { formatArea } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";

export interface ParcelDetailPanelProps {
  parcel: DjiParcelRecord | null;
  flightsCount: number;
  highAlertsCount: number;
}

const DASH = "—";

function formatNullableNumber(value: number | null, unit = ""): string {
  if (value === null || value === undefined) return DASH;
  return `${value}${unit}`;
}

function formatNullableArea(value: number | null): string {
  if (value === null) return DASH;
  return formatArea(value);
}

/**
 * Panel de detalle de la parcela seleccionada.
 * Muestra los parámetros del plan (drone, dimensiones, área fumigable, waypoints)
 * y un resumen de operación reciente.
 */
export function ParcelDetailPanel({ parcel, flightsCount, highAlertsCount }: ParcelDetailPanelProps) {
  if (!parcel) {
    return (
      <div className="rounded-xl border border-[#eef2ee] bg-[#f4f7f4] p-4 text-sm text-[#4a5b50]">
        Seleccione una parcela para ver el detalle.
      </div>
    );
  }

  const isOrchard = parcel.is_orchard;

  return (
    <div className="flex h-full flex-col gap-5">
      <div>
        <span className="inline-flex rounded-full bg-[#0b5f2d]/10 px-3 py-1 text-xs font-bold text-[#0b5f2d]">
          {parcel.land_name ?? "(sin nombre)"}
        </span>
        <h3 className="mt-3 text-2xl font-semibold text-[#121815]">{parcel.field_type}</h3>
        <p className="mt-1 text-sm text-[#4a5b50]">
          {isOrchard ? "Plantación con aspersión por árbol" : "Cultivo de cobertura con aspersión por swath"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Area declarada</dt>
          <dd className="font-semibold text-[#121815]">{formatNullableArea(parcel.declared_area_ha)}</dd>
        </div>
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Spray area</dt>
          <dd className="font-semibold text-[#121815]">
            {parcel.spray_area_m2 !== null ? `${parcel.spray_area_m2.toFixed(2)} m²` : DASH}
          </dd>
        </div>
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Drone</dt>
          <dd className="font-semibold text-[#121815]">{parcel.drone_model_name ?? DASH}</dd>
        </div>
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Spray width</dt>
          <dd className="font-semibold text-[#121815]">
            {formatNullableNumber(parcel.spray_width_m, " m")}
          </dd>
        </div>
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Velocidad</dt>
          <dd className="font-semibold text-[#121815]">
            {formatNullableNumber(parcel.work_speed_mps, " m/s")}
          </dd>
        </div>
        <div className="rounded-lg bg-[#f4f7f4] p-3">
          <dt className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Heading óptimo</dt>
          <dd className="font-semibold text-[#121815]">
            {formatNullableNumber(parcel.optimal_heading_deg, "°")}
          </dd>
        </div>
      </dl>

      <div className="mt-auto rounded-xl border border-[#d2ddd6] bg-white p-4">
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#587064]">Resumen</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4a5b50]">Waypoints</p>
            <p className="text-lg font-semibold text-[#121815]">{parcel.waypoint_count ?? DASH}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4a5b50]">Resúmenes (mes)</p>
            <p className="text-lg font-semibold text-[#121815]">{flightsCount}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4a5b50]">Alertas altas</p>
            <p className="text-lg font-semibold text-[#7a1d1d]">{highAlertsCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
