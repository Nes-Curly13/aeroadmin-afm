"use client";

import { useMemo } from "react";

import { formatArea, formatDate } from "@/lib/format";
import { getAlertLevel } from "@/lib/alerts";
import type { AlertLevel, DjiDailySummaryRecord } from "@/lib/types";

export interface RecentFlightsListProps {
  flights: DjiDailySummaryRecord[];
  alertFilter: AlertLevel | "ALL";
  onAlertFilterChange: (level: AlertLevel | "ALL") => void;
}

function escapeCsvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportFlightsToCsv(flights: DjiDailySummaryRecord[]): void {
  const headers = ["ID", "Fecha", "Categoria", "Area (mu)", "Salidas", "Litros", "Tiempo"];
  const rows = flights.map((flight) => [
    flight.id,
    flight.record_date,
    flight.category,
    flight.area_mu,
    flight.times_count,
    flight.usage_liters,
    flight.work_time_text
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dji_summaries_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Lista de vuelos recientes con filtro por nivel de alerta y exportación CSV.
 *
 * El filtro es a nivel client-side: el padre provee `alertFilter` (que es la
 * "preferencia" del usuario) y este componente filtra los flights visibles
 * según el level calculado con `getAlertLevel` (de `lib/alerts`).
 */
export function RecentFlightsList({ flights, alertFilter, onAlertFilterChange }: RecentFlightsListProps) {
  const filteredFlights = useMemo(() => {
    if (alertFilter === "ALL") return flights;
    return flights.filter((flight) => getAlertLevel(Number(flight.area_mu), Number(flight.times_count)) === alertFilter);
  }, [flights, alertFilter]);

  const onExport = () => {
    exportFlightsToCsv(flights);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-[#d2ddd6] px-6 py-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#121815]">Registro reciente</h3>
        <div className="flex gap-2">
          <select
            aria-label="Filtrar por nivel de alerta"
            className="rounded-lg border border-[#cfd8d3] px-3 py-1.5 text-sm text-[#4a5b50]"
            onChange={(e) => onAlertFilterChange(e.target.value as AlertLevel | "ALL")}
            value={alertFilter}
          >
            <option value="ALL">Todos</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <button
            className="rounded-lg bg-[#0b5f2d] px-3 py-1.5 text-sm font-semibold text-white"
            onClick={onExport}
            type="button"
          >
            Exportar CSV
          </button>
        </div>
      </div>
      <div className="divide-y divide-[#d2ddd6]">
        {filteredFlights.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[#4a5b50]">
            No hay vuelos que coincidan con el filtro seleccionado.
          </div>
        ) : (
          filteredFlights.map((flight) => (
            <div
              className="flex flex-col gap-5 px-6 py-5 md:flex-row md:items-center md:justify-between"
              data-flight-id={flight.id}
              key={flight.id}
            >
              <div className="flex items-center gap-5">
                <div className="flex h-16 w-24 items-center justify-center rounded-xl bg-[#0f1713] text-[10px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">
                  DJI
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <h4 className="text-base font-semibold text-[#121815]">{flight.category}</h4>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-[#4a5b50]">
                    <span>{formatDate(flight.record_date)}</span>
                    <span>{formatArea(Number(flight.area_mu))}</span>
                    <span>{flight.times_count} salidas</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 md:flex md:gap-10">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Litros</p>
                  <p className="font-semibold text-[#121815]">{Number(flight.usage_liters).toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Tiempo</p>
                  <p className="font-semibold text-[#121815]">{flight.work_time_text}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Tipo</p>
                  <p className="font-semibold text-[#0b5f2d]">{flight.category}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
