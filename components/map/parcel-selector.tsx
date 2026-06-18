"use client";

import { formatArea } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";

export interface ParcelSelectorProps {
  parcels: DjiParcelRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  emptyStateText?: string;
}

function formatParcelLabel(parcel: DjiParcelRecord): string {
  const name = parcel.land_name ?? "(sin nombre)";
  const area = parcel.declared_area_ha !== null ? ` · ${formatArea(parcel.declared_area_ha)}` : "";
  return `${name} — ${parcel.field_type}${area}`;
}

/**
 * Selector de parcelas normalizadas para el panel del mapa.
 * Cada option muestra: nombre, tipo de campo, y área declarada (si existe).
 */
export function ParcelSelector({
  parcels,
  selectedId,
  onSelect,
  emptyStateText = "No hay parcelas importadas. Ejecute el scraper para cargar geometría."
}: ParcelSelectorProps) {
  if (parcels.length === 0) {
    return (
      <div className="rounded-xl border border-[#eef2ee] bg-[#f4f7f4] p-4 text-sm text-[#4a5b50]">{emptyStateText}</div>
    );
  }

  return (
    <select
      aria-label="Seleccionar parcela"
      className="w-full rounded-lg border border-[#cfd8d3] p-2 text-sm"
      onChange={(e) => onSelect(Number(e.target.value))}
      value={selectedId ?? ""}
    >
      {parcels.map((parcel) => (
        <option key={parcel.id} value={parcel.id}>
          {formatParcelLabel(parcel)}
        </option>
      ))}
    </select>
  );
}
