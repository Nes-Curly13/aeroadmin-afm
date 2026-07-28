"use client";

/**
 * ParcelsList — rail derecho con la lista de parcelas visibles en el mapa.
 *
 * v2.0 (sprint S5) — adaptación del patrón del V0
 * (`docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx`):
 * el operador ve la lista al costado del mapa, con el estado de cadencia
 * de cada parcela (color dot + label), nombre, área y un contador.
 * Click selecciona → highlight en el mapa + flyTo.
 *
 * Estructura del componente:
 *   - Si hay `selectedParcel`: header expandido con detalle + botón "Ver hoja de vida".
 *   - Si no: header simple con el conteo.
 *   - Lista scrollable, ordered por status de cadencia (overdue primero).
 *
 * Accesibilidad:
 *   - `<aside>` con `aria-label="Lista de parcelas"`.
 *   - Items son `<button>` con `aria-pressed` para selección (NO listbox —
 *     el patrón listbox + aria-activedescendant es más complejo y acá el
 *     pattern de "selección visual" se reduce a highlight + flyTo).
 *   - `aria-current` no aplica (no es navegación entre páginas).
 *   - Empty state accesible (texto "No hay parcelas que cumplan los filtros").
 */

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  getFumigationStatus,
  statusLabel,
  type FumigationStatus
} from "@/lib/fumigation-cadence";
import { formatArea, formatDateWithWeekday } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<FumigationStatus, string> = {
  overdue: "#a93232",
  due_soon: "#c7a43a",
  ok: "#2c7f44",
  no_history: "#5a4136"
};

// Orden de prioridad: más urgente primero.
const STATUS_ORDER: FumigationStatus[] = ["overdue", "due_soon", "no_history", "ok"];

export interface ParcelsListProps {
  parcels: DjiParcelRecord[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /**
   * Map<parcelId, count> de fumigaciones en el rango activo (sirve para
   * mostrar el contador de aplicaciones en cada item). Si se omite,
   * muestra "—" en el contador.
   */
  countsByParcel?: Map<number, number>;
  /** Cadencia por defecto si la parcela no tiene `cadence_days` propio. */
  defaultCadenceDays?: number;
}

export function ParcelsList({
  parcels,
  selectedId,
  onSelect,
  countsByParcel,
  defaultCadenceDays = 14
}: ParcelsListProps) {
  // Decorar parcelas con status + count + última fumigación.
  // v2.0 (sprint S5): cadence por ahora es fija via `defaultCadenceDays`
  // porque DjiParcelRecord no expone `cadence_days` (vive en la tabla
  // dji_fumigation_schedule). Si en el futuro el query incluye el join,
  // se pasa por-parcela.
  const items = parcels
    .map((p) => {
      const status = getFumigationStatus(p.last_fumigation_date, defaultCadenceDays);
      return {
        parcel: p,
        status,
        count: countsByParcel?.get(p.id) ?? null
      };
    })
    // Orden: status de mayor urgencia primero, después por id estable.
    .sort((a, b) => {
      const sa = STATUS_ORDER.indexOf(a.status);
      const sb = STATUS_ORDER.indexOf(b.status);
      if (sa !== sb) return sa - sb;
      return a.parcel.id - b.parcel.id;
    });

  const selectedItem = items.find((i) => i.parcel.id === selectedId) ?? null;

  return (
    <aside
      aria-label="Lista de parcelas en el filtro"
      className="flex h-full flex-col border-l border-border bg-card"
      data-testid="parcels-list"
    >
      {selectedItem ? (
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                Parcela seleccionada
              </p>
              <h3 className="truncate text-base font-bold tracking-tight">
                {selectedItem.parcel.land_name ?? `Parcela #${selectedItem.parcel.id}`}
              </h3>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: STATUS_COLOR[selectedItem.status] }}
            >
              {statusLabel(selectedItem.status)}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Área</dt>
              <dd className="font-mono font-medium">
                {selectedItem.parcel.declared_area_ha !== null
                  ? formatArea(selectedItem.parcel.declared_area_ha)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Cadencia</dt>
              <dd className="font-mono font-medium">{defaultCadenceDays} días</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Última aplic.</dt>
              <dd className="font-mono font-medium">
                {selectedItem.parcel.last_fumigation_date
                  ? formatDateWithWeekday(selectedItem.parcel.last_fumigation_date)
                  : "sin historial"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">En el rango</dt>
              <dd className="font-mono font-medium">
                {selectedItem.count !== null ? `${selectedItem.count} aplic.` : "—"}
              </dd>
            </div>
          </dl>
          <Link
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none transition hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="parcels-list-view-detail"
            href={`/parcels/${selectedItem.parcel.id}`}
          >
            Ver hoja de vida
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-bold tracking-tight">Parcelas en el filtro</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.length === 0
              ? "No hay parcelas que cumplan los filtros."
              : "Hacé click en un polígono o en la lista para ver el detalle."}
          </p>
        </div>
      )}

      <ul
        aria-label={`${items.length} parcelas`}
        className="flex-1 divide-y divide-border overflow-y-auto"
        role="list"
      >
        {items.map(({ parcel, status, count }) => {
          const active = parcel.id === selectedId;
          return (
            <li key={parcel.id}>
              <button
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  "hover:bg-muted",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                  active && "bg-muted"
                )}
                data-testid={`parcels-list-item-${parcel.id}`}
                onClick={() => onSelect(active ? null : parcel.id)}
                type="button"
              >
                <span
                  aria-hidden
                  className="mt-0.5 size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: STATUS_COLOR[status] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {parcel.land_name ?? `(Parcela #${parcel.id})`}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {parcel.declared_area_ha !== null
                      ? `${parcel.declared_area_ha.toFixed(1)} ha`
                      : "área desconocida"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold tabular-nums">
                    {count !== null ? count : "—"}
                  </span>
                  <span className="block text-[10px] uppercase text-muted-foreground">aplic.</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
