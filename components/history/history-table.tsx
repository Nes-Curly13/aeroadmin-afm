"use client";

import { useMemo, useState } from "react";

import { formatArea, formatDate } from "@/lib/format";
import type { DjiDailySummaryRecord } from "@/lib/types";

export interface HistoryTableProps {
  flights: DjiDailySummaryRecord[];
  pageSize?: number;
}

type SortColumn = "date" | "category" | "area" | "times" | "liters" | "time";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

const PAGE_SIZE_DEFAULT = 20;

const COLUMN_LABELS: Record<SortColumn, string> = {
  date: "Fecha",
  category: "Categoría",
  area: "Área (ha)",
  times: "Salidas",
  liters: "Litros",
  time: "Tiempo"
};

function getSortValue(flight: DjiDailySummaryRecord, column: SortColumn): number | string {
  switch (column) {
    case "date":
      return flight.record_date;
    case "category":
      return flight.category;
    case "area":
      return Number(flight.area_mu);
    case "times":
      return Number(flight.times_count);
    case "liters":
      return Number(flight.usage_liters);
    case "time":
      return flight.work_time_text;
  }
}

function compareFlights(a: DjiDailySummaryRecord, b: DjiDailySummaryRecord, sort: SortState): number {
  const va = getSortValue(a, sort.column);
  const vb = getSortValue(b, sort.column);
  let cmp = 0;
  if (typeof va === "number" && typeof vb === "number") {
    cmp = va - vb;
  } else {
    cmp = String(va).localeCompare(String(vb));
  }
  return sort.direction === "asc" ? cmp : -cmp;
}

/**
 * Tabla ordenable y paginada del historial de fumigación.
 * - Click en el header de columna cambia la columna de sort; segundo click invierte la dirección.
 * - Filtro por categoría (client-side).
 * - Paginación client-side (20 por página por default).
 */
export function HistoryTable({ flights, pageSize = PAGE_SIZE_DEFAULT }: HistoryTableProps) {
  const [sort, setSort] = useState<SortState>({ column: "date", direction: "desc" });
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const categories = useMemo(() => {
    const set = new Set(flights.map((f) => f.category));
    return ["ALL", ...[...set].sort()];
  }, [flights]);

  const filtered = useMemo(() => {
    return categoryFilter === "ALL" ? flights : flights.filter((f) => f.category === categoryFilter);
  }, [flights, categoryFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => compareFlights(a, b, sort));
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  const onSortClick = (column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: "asc" };
    });
  };

  if (flights.length === 0) {
    return (
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-10 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <p className="text-sm text-[#4a5b50]">No hay resúmenes importados aún.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 border-b border-[#d2ddd6] px-6 py-4 md:flex-row md:items-center md:justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#121815]">
          Historial de fumigación ({filtered.length})
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]" htmlFor="history-category">
            Categoría
          </label>
          <select
            aria-label="Filtrar por categoría"
            className="rounded-lg border border-[#cfd8d3] px-3 py-1.5 text-sm text-[#4a5b50]"
            id="history-category"
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            value={categoryFilter}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "ALL" ? "Todas" : cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f4f7f4] text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            <tr>
              {(Object.keys(COLUMN_LABELS) as SortColumn[]).map((col) => {
                const isActive = sort.column === col;
                return (
                  <th
                    aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className="px-4 py-3"
                    key={col}
                    scope="col"
                  >
                    <button
                      className={`inline-flex items-center gap-1 transition ${
                        isActive ? "text-[#0b5f2d]" : "hover:text-[#121815]"
                      }`}
                      onClick={() => onSortClick(col)}
                      type="button"
                    >
                      {COLUMN_LABELS[col]}
                      {isActive ? <span aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#d2ddd6]">
            {visible.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-[#4a5b50]" colSpan={6}>
                  No hay vuelos que coincidan con el filtro.
                </td>
              </tr>
            ) : (
              visible.map((flight) => (
                <tr className="hover:bg-[#f4f7f4]" key={flight.id}>
                  <td className="px-4 py-3 font-medium text-[#121815]">{formatDate(flight.record_date)}</td>
                  <td className="px-4 py-3 text-[#4a5b50]">{flight.category}</td>
                  <td className="px-4 py-3 text-[#121815]">{formatArea(Number(flight.area_mu))}</td>
                  <td className="px-4 py-3 text-[#121815]">{flight.times_count}</td>
                  <td className="px-4 py-3 text-[#121815]">{Number(flight.usage_liters).toFixed(1)} L</td>
                  <td className="px-4 py-3 text-[#4a5b50]">{flight.work_time_text}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[#d2ddd6] px-6 py-4 text-sm text-[#4a5b50]">
        <span>
          Página {safePage} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-[#cfd8d3] px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            type="button"
          >
            Anterior
          </button>
          <button
            className="rounded-lg border border-[#cfd8d3] px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            type="button"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
