// components/parcels/parcels-list.tsx
//
// Client island para la página /parcels (BUG 1 del audit ui-ux-2026-07).
// Renderiza la tabla completa de parcelas con paginación client-side y
// links al detalle. Estilo coherente con `components/history/history-table.tsx`
// y `components/overdue/overdue-list.tsx`.
//
// Por qué client island y no server-rendered directo:
//   - La page server hace getParcelsNormalized(1, 1000) y pasa la lista
//     completa (en este dataset 1207 filas). La paginación es client-side
//     para evitar un round-trip al server cuando el operador cambia de página.
//   - El sort y el filtro por texto viven en este componente (no se
//     delegan al server porque no hay params de URL todavía — si en el
//     futuro se quiere shareable, se mueven a `?page=`, `?sort=`).
//
// Sprint A — F1.1: la columna "Estado" ya NO es un chip "Pendiente"
// constante. Ahora muestra un dot de 3 colores basado en
// `days_since_last_fumigation` (calculado en SQL por la query unificada,
// no en el client — ver api/queries.ts).

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import type { DjiParcelRecord } from "@/lib/types";

export interface ParcelsListProps {
  parcels: DjiParcelRecord[];
  pageSize?: number;
}

const PAGE_SIZE_DEFAULT = 20;

type SortColumn = "name" | "fieldType" | "area" | "drone" | "status";
type SortDirection = "asc" | "desc";
interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

const COLUMN_LABELS: Record<SortColumn, string> = {
  name: "Nombre",
  fieldType: "Tipo",
  area: "Área (ha)",
  drone: "Dron canónico",
  status: "Cadencia"
};

// ============================================================
// F1.1 — Dot de cadencia
// ============================================================

/**
 * Estados posibles del dot. El color y label accesible vienen de acá;
 * el componente `<FumigationStatusDot>` es un thin wrapper.
 *
 * Umbrales (decisión de producto, no de dev):
 *   - "ok" (verde): <= 14 días desde la última fumigación.
 *   - "due_soon" (amarillo): entre 15 y 30 días.
 *   - "overdue" (rojo): > 30 días.
 *   - "no_history" (rojo, mismo color que overdue pero distinto label):
 *     nunca se fumigó. Se separa el caso porque el operador necesita
 *     distinguir "vencida" (actuar ya) de "nunca fumigada" (cargar
 *     historial primero).
 */
export type FumigationStatus = "ok" | "due_soon" | "overdue" | "no_history";

/**
 * Determina el estado de cadencia en función de los días. Pura — testeable
 * sin DOM. La entrada es `parcel.days_since_last_fumigation` (calculado
 * en SQL). Si el campo no está presente (fixtures de tests viejos),
 * devuelve "no_history".
 */
export function getFumigationStatus(
  daysSinceLast: number | null | undefined
): FumigationStatus {
  if (daysSinceLast === null || daysSinceLast === undefined) return "no_history";
  if (daysSinceLast <= 14) return "ok";
  if (daysSinceLast <= 30) return "due_soon";
  return "overdue";
}

const STATUS_DOT: Record<
  FumigationStatus,
  { dotClass: string; ariaLabel: string; testId: string }
> = {
  ok: {
    dotClass: "bg-[#16a34a]", // verde AFM
    ariaLabel: "En fecha",
    testId: "status-dot-ok"
  },
  due_soon: {
    dotClass: "bg-[#eab308]", // amarillo
    ariaLabel: "Vence pronto",
    testId: "status-dot-due-soon"
  },
  overdue: {
    dotClass: "bg-[#dc2626]", // rojo
    ariaLabel: "Vencida",
    testId: "status-dot-overdue"
  },
  no_history: {
    dotClass: "bg-[#dc2626]", // rojo
    ariaLabel: "Sin historial",
    testId: "status-dot-no-history"
  }
};

function FumigationStatusDot({ daysSinceLast }: { daysSinceLast: number | null | undefined }) {
  const status = getFumigationStatus(daysSinceLast);
  const cfg = STATUS_DOT[status];
  const detail =
    daysSinceLast === null || daysSinceLast === undefined
      ? "Nunca fumigada"
      : daysSinceLast === 0
        ? "Fumigada hoy"
        : `${daysSinceLast} día${daysSinceLast === 1 ? "" : "s"} desde última fumigación`;
  return (
    <span
      aria-label={`${cfg.ariaLabel} — ${detail}`}
      className="inline-flex items-center gap-2"
      data-status={status}
      data-testid={cfg.testId}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${cfg.dotClass}`}
        title={`${cfg.ariaLabel} · ${detail}`}
      />
      <span className="sr-only">{`${cfg.ariaLabel} (${detail})`}</span>
    </span>
  );
}

function getSortValue(parcel: DjiParcelRecord, column: SortColumn): number | string | null {
  switch (column) {
    case "name":
      return parcel.land_name ?? "";
    case "fieldType":
      return parcel.field_type;
    case "area":
      return parcel.declared_area_ha;
    case "drone":
      return parcel.drone_model_name ?? "";
    case "status":
      // Orden: ok < due_soon < overdue < no_history
      return { ok: 0, due_soon: 1, overdue: 2, no_history: 3 }[
        getFumigationStatus(parcel.days_since_last_fumigation)
      ];
  }
}

function compareParcels(a: DjiParcelRecord, b: DjiParcelRecord, sort: SortState): number {
  const va = getSortValue(a, sort.column);
  const vb = getSortValue(b, sort.column);
  let cmp = 0;
  if (va === null && vb === null) {
    cmp = 0;
  } else if (va === null) {
    cmp = 1; // nulls al final
  } else if (vb === null) {
    cmp = -1;
  } else if (typeof va === "number" && typeof vb === "number") {
    cmp = va - vb;
  } else {
    cmp = String(va).localeCompare(String(vb));
  }
  return sort.direction === "asc" ? cmp : -cmp;
}

function formatHa(ha: number | null): string {
  if (ha === null || ha === undefined) return "—";
  return `${ha.toFixed(2)} ha`;
}

export function ParcelsList({ parcels, pageSize = PAGE_SIZE_DEFAULT }: ParcelsListProps) {
  const [sort, setSort] = useState<SortState>({ column: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parcels;
    // F1.2: el supervisor puede buscar por 5 campos: land_name,
    // external_id (DJI ID), crop_type, owner_name, drone_model_name.
    // El OR es inclusivo — matchear CUALQUIERA devuelve la fila.
    // El case-insensitive es via lowercase() en ambos lados.
    return parcels.filter((p) => {
      const name = (p.land_name ?? "").toLowerCase();
      const external = p.external_id.toLowerCase();
      const crop = (p.crop_type ?? "").toLowerCase();
      const owner = (p.owner_name ?? "").toLowerCase();
      const drone = (p.drone_model_name ?? "").toLowerCase();
      return (
        name.includes(q) ||
        external.includes(q) ||
        crop.includes(q) ||
        owner.includes(q) ||
        drone.includes(q)
      );
    });
  }, [parcels, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => compareParcels(a, b, sort));
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

  if (parcels.length === 0) {
    return (
      <EmptyState
        cta={{ href: "/map", label: "Ir al mapa" }}
        description="Cuando el operador importe las parcelas desde DJI Agras, aparecerán acá. Si esperás ver datos y no aparecen, contactá al supervisor."
        eyebrow="Vista agregada"
        testId="parcels-list-empty"
        title="Aún no hay parcelas para mostrar"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Búsqueda + contador */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]"
            htmlFor="parcels-list-search"
          >
            Buscar
          </label>
          <input
            aria-label="Buscar parcela por nombre, ID DJI, cultivo o propietario"
            className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-1.5 text-sm text-[#121815] focus:border-[#0b5f2d] focus:outline-none"
            data-testid="parcels-list-search"
            id="parcels-list-search"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, ID DJI, cultivo o propietario…"
            type="search"
            value={query}
          />
        </div>
        <p className="text-sm text-[#4a5b50]">
          <strong className="text-[#121815]">{sorted.length}</strong>{" "}
          {sorted.length === 1 ? "parcela" : "parcelas"}
          {query && (
            <button
              className="ml-2 text-[#0b5f2d] underline"
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              type="button"
            >
              Limpiar
            </button>
          )}
        </p>
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
        data-testid="parcels-list-table"
      >
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
                        {isActive ? (
                          <span aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                  );
                })}
                <th className="px-4 py-3" scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d2ddd6]">
              {visible.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-[#4a5b50]" colSpan={6}>
                    No hay parcelas que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                visible.map((parcel) => (
                  <tr className="hover:bg-[#f7f9fb]" key={parcel.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#121815]">
                        {parcel.land_name ?? `Parcela #${parcel.id}`}
                      </div>
                      <div className="text-[11px] text-[#587064]">{parcel.external_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${
                          parcel.is_orchard
                            ? "bg-[#7b3f00]/10 text-[#7b3f00]"
                            : "bg-[#0b5f2d]/10 text-[#0b5f2d]"
                        }`}
                      >
                        {parcel.field_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#121815]">{formatHa(parcel.declared_area_ha)}</td>
                    <td className="px-4 py-3 text-[#4a5b50]">
                      {parcel.drone_model_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <FumigationStatusDot daysSinceLast={parcel.days_since_last_fumigation} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        className="rounded-full border border-[#0b5f2d]/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#0b5f2d] transition hover:bg-[#0b5f2d]/10"
                        data-testid={`parcels-list-detail-link-${parcel.id}`}
                        href={`/parcels/${parcel.id}`}
                      >
                        Ver detalle →
                      </Link>
                    </td>
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
    </div>
  );
}
