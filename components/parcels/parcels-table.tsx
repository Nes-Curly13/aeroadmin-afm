"use client";

// components/parcels/parcels-table.tsx
//
// ParcelsTable — v0.1 (port del V0 a nuestro proyecto).
//
// Sprint v0.1 — port de `docs/fumigation-management-dashboard/components/parcels/parcels-table.tsx`.
// Adaptaciones al proyecto actual:
//   - `ParcelSummary` (definido acá, no en V0 lib) compone tipos de
//     nuestro proyecto: DjiParcelRecord + DjiFumigationSchedule + status
//     calculado + counters. El caller lo arma con un query de tipo
//     "JOIN dji_parcels ⋈ dji_fumigation_schedule + counts".
//   - Sin primitive `Table` (todavía no existe) — usamos `<table>` HTML
//     semántico con Tailwind.
//   - Sin `Badge`/`Input` primitives — usamos divs con rounded-full y
//     `<input>` directo, mismo patrón que el resto de components/parcels/*.
//   - Sin `FieldSelect` para filtros (más simple que el V0): solo un
//     input de texto para buscar por nombre/hacienda. El spec del PO
//     para esta tabla es minimal — si después se necesitan filtros por
//     estado o tipo, se agregan.
//   - Sin paginación (el V0 tenía 1000+ filas con paginación client-side
//     pero acá NO). Razonamiento: esta tabla es para vista agregada
//     administrativa, no para consulta masiva. Si se vuelve lenta con
//     el dataset real (>5k filas), se agrega paginación client-side
//     en un PR aparte. El empty state y el "no matches" sí están.
//
// Columnas (6 + link):
//   1. Nombre           (sortable) — land_name
//   2. Hacienda         (sortable) — location_label (DJI's human address)
//   3. Área (ha)        (sortable) — declared_area_ha
//   4. Cadencia         (sortable) — schedule.recommended_cadence_days
//   5. Última fumigación (sortable) — parcel.last_fumigation_date
//   6. Estado           (sortable por severity) — chip de color
//   7. Ver detalle      (link a /parcels/[id])
//
// Regla de producto para "estado" (4 niveles, consistente con el resto
// del proyecto — ver `lib/fumigation-cadence.ts`):
//   - overdue    (rojo)    → ya pasó la próxima fecha objetivo
//   - due_soon   (amarillo) → vence en los próximos 7 días
//   - ok         (verde)   → en fecha
//   - no_history (gris)    → nunca se fumigó
//
// Decisión: el "estado" se ordena por severity (overdue primero, no_history
// al final, ok en el medio) — es lo que más le importa al supervisor.

import { ArrowUpDown, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
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
// Internals
// =====================================================================

type SortKey = "name" | "hacienda" | "area" | "cadence" | "last" | "status";
type SortDir = "asc" | "desc";

const COLUMN_LABELS: Record<SortKey, string> = {
  name: "Nombre",
  hacienda: "Hacienda",
  area: "Área",
  cadence: "Cadencia",
  last: "Última fumigación",
  status: "Estado"
};

// Severity order: overdue primero, ok al medio, no_history al final.
// Coincide con `STATUS_ORDER` en `components/map/parcels-list.tsx` para
// consistencia entre vistas.
const STATUS_SEVERITY: Record<FumigationStatus, number> = {
  overdue: 0,
  due_soon: 1,
  ok: 2,
  no_history: 3
};

// Color tokens del chip de estado (alineados con el resto del proyecto).
const STATUS_CHIP: Record<FumigationStatus, { className: string; testId: string }> = {
  overdue: { className: "bg-[#a93232]/15 text-[#a93232]", testId: "parcels-table-status-overdue" },
  due_soon: { className: "bg-[#d4b23c]/20 text-[#7a5f0d]", testId: "parcels-table-status-due-soon" },
  ok: { className: "bg-[#0b5f2d]/10 text-[#0b5f2d]", testId: "parcels-table-status-ok" },
  no_history: {
    className: "bg-[#cfd8d3] text-[#4a5b50]",
    testId: "parcels-table-status-no-history"
  }
};

function getSortValue(s: ParcelSummary, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return s.parcel.land_name ?? "";
    case "hacienda":
      // location_label viene de DJI (migration 20260709000000). Es
      // opcional — null se trata como string vacío para que el sort
      // alfabético funcione.
      return s.parcel.location_label ?? "";
    case "area":
      return s.parcel.declared_area_ha;
    case "cadence":
      return s.schedule?.recommended_cadence_days ?? null;
    case "last":
      return s.parcel.last_fumigation_date ?? null;
    case "status":
      return STATUS_SEVERITY[s.status];
  }
}

function compareSummaries(a: ParcelSummary, b: ParcelSummary, key: SortKey, dir: SortDir): number {
  const va = getSortValue(a, key);
  const vb = getSortValue(b, key);
  const dirSign = dir === "asc" ? 1 : -1;
  // nulls al final siempre, sin importar la dirección.
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  if (typeof va === "number" && typeof vb === "number") {
    return (va - vb) * dirSign;
  }
  return String(va).localeCompare(String(vb)) * dirSign;
}

function lastFumigationLabel(s: ParcelSummary): string {
  const dateStr = s.parcel.last_fumigation_date
    ? toDateString(s.parcel.last_fumigation_date)
    : null;
  if (!dateStr) return "Sin historial";
  // Si el row es overdue, agregamos el delta en días para contexto rápido.
  if (s.daysUntilNextDue !== null && s.daysUntilNextDue < 0) {
    return `${formatDate(dateStr)} (vencida hace ${Math.abs(s.daysUntilNextDue)} d)`;
  }
  return formatDate(dateStr);
}

// =====================================================================
// Componente
// =====================================================================

export function ParcelsTable({ summaries }: ParcelsTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc"); // "asc" en status = más urgente primero

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter((s) => {
      const name = (s.parcel.land_name ?? "").toLowerCase();
      const hacienda = (s.parcel.location_label ?? "").toLowerCase();
      return name.includes(q) || hacienda.includes(q);
    });
  }, [summaries, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => compareSummaries(a, b, sortKey, sortDir));
  }, [filtered, sortKey, sortDir]);

  function onHeaderClick(key: SortKey) {
    if (key === sortKey) {
      // Toggle direction.
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Defaults por tipo de columna (consistente con el V0):
      // - Texto (name, hacienda): asc (A→Z)
      // - Fecha (last): desc (más reciente primero — lo más útil para
      //   supervisores que quieren ver "qué se fumigó últimamente")
      // - Número (area, cadence): desc (el más relevante primero)
      // - Estado: asc (overdue primero, el más urgente)
      const defaultDir: SortDir =
        key === "name" || key === "hacienda" || key === "status" ? "asc" : "desc";
      setSortDir(defaultDir);
    }
  }

  return (
    <section className="flex flex-col gap-4" data-slot="parcels-table" data-testid="parcels-table">
      {/* Search + contador */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-label="Buscar por nombre o hacienda"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            data-testid="parcels-table-search"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o hacienda…"
            type="search"
            value={query}
          />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="parcels-table-counter">
          <strong className="text-foreground">{sorted.length}</strong> de {summaries.length}{" "}
          {summaries.length === 1 ? "parcela" : "parcelas"}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {(["name", "hacienda", "area", "cadence", "last", "status"] as SortKey[]).map(
                  (key) => {
                    const isActive = sortKey === key;
                    return (
                      <th key={key} scope="col">
                        <button
                          aria-label={`Ordenar por ${COLUMN_LABELS[key]}`}
                          aria-sort={
                            isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                          }
                          className={cn(
                            "inline-flex w-full items-center gap-1 px-3 py-2.5 text-left font-semibold transition",
                            isActive ? "text-foreground" : "hover:text-foreground"
                          )}
                          data-testid={`parcels-table-th-${key}`}
                          onClick={() => onHeaderClick(key)}
                          type="button"
                        >
                          {COLUMN_LABELS[key]}
                          <ArrowUpDown
                            aria-hidden
                            className={cn(
                              "size-3",
                              isActive ? "text-primary" : "text-muted-foreground/50"
                            )}
                          />
                        </button>
                      </th>
                    );
                  }
                )}
                <th className="px-3 py-2.5" scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.length === 0 ? (
                <tr data-testid="parcels-table-no-matches">
                  <td className="px-3 py-10 text-center text-sm text-muted-foreground" colSpan={7}>
                    No hay parcelas que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                sorted.map((s) => {
                  const chip = STATUS_CHIP[s.status];
                  const ha = s.parcel.declared_area_ha;
                  const cadence = s.schedule?.recommended_cadence_days ?? null;
                  return (
                    <tr
                      className="hover:bg-muted/30"
                      data-testid={`parcels-table-row-${s.parcel.id}`}
                      key={s.parcel.id}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-foreground">
                          {s.parcel.land_name ?? `Parcela #${s.parcel.id}`}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {s.parcel.external_id}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {s.parcel.location_label ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-foreground">
                        {ha !== null ? formatArea(ha) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">
                        {cadence !== null ? `${cadence} d` : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">
                        {lastFumigationLabel(s)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            chip.className
                          )}
                          data-testid={chip.testId}
                          title={
                            s.daysUntilNextDue !== null
                              ? `${statusLabel(s.status)} (${s.daysUntilNextDue >= 0 ? "+" : ""}${s.daysUntilNextDue} d)`
                              : statusLabel(s.status)
                          }
                        >
                          {statusLabel(s.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
                          data-testid={`parcels-table-detail-link-${s.parcel.id}`}
                          href={`/parcels/${s.parcel.id}`}
                        >
                          Ver detalle →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
