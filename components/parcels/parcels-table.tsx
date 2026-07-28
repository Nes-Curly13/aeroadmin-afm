"use client";

// components/parcels/parcels-table.tsx
//
// ParcelsTable — v0.2 (port del V0 a nuestro proyecto).
//
// Sprint v0.2 — port 1:1 de `docs/fumigation-management-dashboard/components/parcels/parcels-table.tsx`.
// Cambios respecto a v0.1:
//   - 8 columnas (V0): Parcela | Cliente/Hacienda | Área | Cadencia |
//     Última | Próxima | Eventos | Estado. Antes tenía 7 (sin
//     Cliente/Hacienda, Próxima, Eventos).
//   - 3 filtros: Search + Cliente (FieldSelect) + Estado (FieldSelect).
//     Antes solo tenía Search.
//   - Status chip con dot de color + label + delta (V0). Antes solo
//     tenía el chip con label.
//   - Sort por 5 columnas: name, area, last, due, events. Default sort
//     "due" asc (overdue primero, según V0).
//   - Status chip via `<Badge variant="outline">` (primitive ya creado
//     por el sprint S8). Dot de color + label + delta, igual al V0.
//   - Sin primitive `Slider` (no necesario en este componente — el
//     search input es un `<input type="search">` directo).
//
// Mapeo de campos V0 → proyecto:
//   - V0 name             → s.parcel.land_name ?? "—"
//   - V0 farm_name        → s.parcel.farm_name ?? "—"
//   - V0 client_name      → s.parcel.client_name ?? "—"
//   - V0 municipality     → s.parcel.municipality ?? "—"
//   - V0 variety          → s.parcel.variety ?? s.parcel.crop_type ?? "—"
//   - V0 drone_model_id   → s.parcel.drone_model_name ?? "—"
//   - V0 area_ha          → s.parcel.declared_area_ha
//   - V0 cadence_days     → s.schedule?.recommended_cadence_days
//   - V0 last_fumigation_at → s.parcel.last_fumigation_date
//   - V0 next_due_at      → s.schedule?.next_due_date
//   - V0 days_to_due      → s.daysUntilNextDue
//   - V0 status           → s.status (FumigationStatus)
//   - V0 fumigations_count → s.eventsCount
//   - V0 flights_count    → s.flightsCount
//
// Regla de producto para "estado" (4 niveles, consistente con el resto
// del proyecto — ver `lib/fumigation-cadence.ts`):
//   - overdue     (rojo)   → ya pasó la próxima fecha objetivo
//   - due_soon    (ámbar)  → vence en los próximos 7 días
//   - ok          (verde)  → en fecha
//   - no_history  (gris)   → nunca se fumigó
//
// El chip muestra: dot del color del estado + label + delta (signed en d).
// El delta sale del sort por defecto (due asc = overdue primero).

import { ArrowUpDown, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { FieldSelect } from "@/components/ui/field-select";
import { statusLabel, type FumigationStatus } from "@/lib/fumigation-cadence";
import { formatArea, formatDate, toDateString } from "@/lib/format";
import type { DjiFumigationSchedule, DjiParcelRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

// =====================================================================
// Tipos públicos
// =====================================================================

/**
 * Parcela enriquecida con su schedule, status de cadencia y contadores.
 * Lo que devuelve (en un futuro) `getParcelSummaries()` en
 * `api/repositories.ts` — por ahora, los callers arman este shape a
 * mano con queries separadas (ver `app/parcels/[id]/page.tsx`).
 */
export interface ParcelSummary {
  parcel: DjiParcelRecord;
  schedule: DjiFumigationSchedule | null;
  status: FumigationStatus;
  /** Positivo = futuro, negativo = vencido. null = sin historial. */
  daysUntilNextDue: number | null;
  /** Total de fumigaciones registradas para la parcela. */
  eventsCount: number;
  /** Total de vuelos registrados para la parcela. */
  flightsCount: number;
}

export interface ParcelsTableProps {
  summaries: ParcelSummary[];
}

// =====================================================================
// Status meta (V0 usaba STATUS_META, lo adaptamos a FumigationStatus)
// =====================================================================

/**
 * Color + label por estado. Los hex coinciden con los tokens del
 * proyecto (ver `STATUS_CHIP` de la versión v0.1 que reemplazamos) —
 * verde olivo para `ok`, ámbar para `due_soon`, rojo para `overdue`,
 * gris para `no_history`. Mantenerlos en sync con `lib/fumigation-cadence.ts`.
 */
const STATUS_META: Record<FumigationStatus, { label: string; color: string }> = {
  ok: { label: statusLabel("ok"), color: "#0b5f2d" },
  due_soon: { label: statusLabel("due_soon"), color: "#7a5f0d" },
  overdue: { label: statusLabel("overdue"), color: "#a93232" },
  no_history: { label: statusLabel("no_history"), color: "#4a5b50" }
};

// =====================================================================
// Helpers
// =====================================================================

type SortKey = "name" | "area" | "last" | "due" | "events";

/** Formatea una fecha YYYY-MM-DD o devuelve "—" si es null. */
function fmtDateOrDash(date: string | null | undefined): string {
  const normalized = date ? toDateString(date) : null;
  if (!normalized) return "—";
  return formatDate(normalized);
}

// =====================================================================
// Componente
// =====================================================================

export function ParcelsTable({ summaries }: ParcelsTableProps) {
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [sort, setSort] = useState<SortKey>("due");
  const [asc, setAsc] = useState(true);

  // Empty state cuando NO hay summaries (dataset vacío). Distinto del
  // "no matches" del filtro.
  if (summaries.length === 0) {
    return (
      <div data-slot="parcels-table">
        <EmptyState
          cta={{ href: "/map", label: "Ir al mapa" }}
          description="Cuando el operador importe parcelas desde DJI Agras, aparecerán acá con su schedule de fumigación calculado automáticamente."
          eyebrow="Vista agregada"
          testId="parcels-table-empty"
          title="Aún no hay parcelas para mostrar"
        />
      </div>
    );
  }

  // Mapeo de campos V0 → proyecto (memo para que el sort estable dependa
  // solo de `summaries`).
  const rows = useMemo(
    () =>
      summaries.map((s) => {
        const p = s.parcel;
        return {
          id: p.id,
          name: p.land_name ?? "—",
          farm: p.farm_name ?? "—",
          client: p.client_name ?? "—",
          municipality: p.municipality ?? "—",
          variety: p.variety ?? p.crop_type ?? "—",
          model: p.drone_model_name ?? "—",
          area: p.declared_area_ha,
          cadence: s.schedule?.recommended_cadence_days ?? null,
          last: p.last_fumigation_date ?? null,
          due: s.schedule?.next_due_date ?? null,
          daysToDue: s.daysUntilNextDue,
          status: s.status,
          events: s.eventsCount,
          flights: s.flightsCount
        };
      }),
    [summaries]
  );

  // Clientes únicos para el FieldSelect. Excluimos "—" (filas sin
  // client_name) porque filtrar por "—" no tiene sentido — el "todos"
  // ya las incluye.
  const clients = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.client).filter((c): c is string => c !== "—"))
      ).sort(),
    [rows]
  );

  // Filtros + sort. El sort usa el mismo comparador que el V0.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (client !== "todos" && r.client !== client) return false;
      if (status !== "todos" && r.status !== status) return false;
      if (!q) return true;
      return [r.name, r.farm, r.client, r.municipality, r.variety].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
    const dir = asc ? 1 : -1;
    return [...out].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "area":
          return ((a.area ?? 0) - (b.area ?? 0)) * dir;
        case "events":
          return (a.events - b.events) * dir;
        case "last":
          return (a.last ?? "").localeCompare(b.last ?? "") * dir;
        default: // "due" — por delta de días a la próxima fumigación
          return ((a.daysToDue ?? 9999) - (b.daysToDue ?? 9999)) * dir;
      }
    });
  }, [rows, query, client, status, sort, asc]);

  // Mismo toggle que el V0: si la columna es la misma, invierte asc.
  // Si es nueva, default = asc para name y due, desc para el resto.
  function toggleSort(key: SortKey) {
    if (key === sort) {
      setAsc(!asc);
    } else {
      setSort(key);
      setAsc(key === "name" || key === "due");
    }
  }

  return (
    <section
      className="flex flex-col gap-4"
      data-slot="parcels-table"
      data-testid="parcels-table"
    >
      {/* Filters: search + cliente + estado */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar parcela, hacienda, municipio o variedad…"
            aria-label="Buscar parcela"
            data-testid="parcels-table-search"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
        </div>
        <FieldSelect
          label="Cliente"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="sm:w-48"
        >
          <option value="todos">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="Estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="sm:w-40"
        >
          <option value="todos">Todos</option>
          {(Object.keys(STATUS_META) as FumigationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </FieldSelect>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Ordenar por Parcela"
                    aria-sort={sort === "name" ? (asc ? "ascending" : "descending") : "none"}
                    data-testid="parcels-table-th-name"
                  >
                    Parcela
                    <ArrowUpDown
                      className={cn(
                        "size-3",
                        sort === "name" ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    />
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Cliente / Hacienda
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort("area")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Ordenar por Área"
                    aria-sort={sort === "area" ? (asc ? "ascending" : "descending") : "none"}
                    data-testid="parcels-table-th-area"
                  >
                    Área
                    <ArrowUpDown
                      className={cn(
                        "size-3",
                        sort === "area" ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    />
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Cadencia
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort("last")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Ordenar por Última"
                    aria-sort={sort === "last" ? (asc ? "ascending" : "descending") : "none"}
                    data-testid="parcels-table-th-last"
                  >
                    Última
                    <ArrowUpDown
                      className={cn(
                        "size-3",
                        sort === "last" ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    />
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort("due")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Ordenar por Próxima"
                    aria-sort={sort === "due" ? (asc ? "ascending" : "descending") : "none"}
                    data-testid="parcels-table-th-due"
                  >
                    Próxima
                    <ArrowUpDown
                      className={cn(
                        "size-3",
                        sort === "due" ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    />
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort("events")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Ordenar por Eventos"
                    aria-sort={sort === "events" ? (asc ? "ascending" : "descending") : "none"}
                    data-testid="parcels-table-th-events"
                  >
                    Eventos
                    <ArrowUpDown
                      className={cn(
                        "size-3",
                        sort === "events" ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    />
                  </button>
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr
                    key={r.id}
                    data-testid={`parcels-table-row-${r.id}`}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/parcels/${r.id}`}
                        className="font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {`${r.variety} · ${r.model}`}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-foreground">{r.client}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {`${r.farm} · ${r.municipality}`}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {r.area !== null ? formatArea(r.area) : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">
                      {r.cadence !== null ? `${r.cadence} d` : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">
                      {fmtDateOrDash(r.last)}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">
                      {fmtDateOrDash(r.due)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {r.events}
                      <span className="text-muted-foreground">{` / ${r.flights} v`}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        className="gap-1.5 border-border font-medium"
                        data-testid={`parcels-table-status-${
                          r.status === "due_soon"
                            ? "due-soon"
                            : r.status === "no_history"
                              ? "no-history"
                              : r.status
                        }`}
                        title={
                          r.daysToDue !== null
                            ? `${meta.label} (${r.daysToDue >= 0 ? "+" : ""}${r.daysToDue} d)`
                            : meta.label
                        }
                        variant="outline"
                      >
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        {meta.label}
                        {r.daysToDue !== null ? (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {r.daysToDue >= 0 ? `+${r.daysToDue}d` : `${r.daysToDue}d`}
                          </span>
                        ) : null}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr data-testid="parcels-table-no-matches">
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-sm text-muted-foreground"
                  >
                    No hay parcelas que coincidan con los filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p
        className="font-mono text-[11px] text-muted-foreground"
        data-testid="parcels-table-counter"
      >
        {`${filtered.length} de ${rows.length} parcelas`}
      </p>
    </section>
  );
}
