"use client";

/**
 * `FumigacionesTableClient` — wrapper client del listado de fumigaciones
 * con checkboxes + barra de bulk actions.
 *
 * Sprint 2026-08-29 — feature/bloque-f-bulk-operations.
 *
 * Reemplaza al `FumigacionesTable` server-component inline en
 * `app/fumigaciones/page.tsx`. Mantiene la misma API (recibe los
 * events ya cargados del `FumigacionesDataLoader`) y suma:
 *   - Checkbox por fila (primera columna)
 *   - Checkbox "select all" en el header (de la página actual)
 *   - Barra sticky inferior con `Borrar N` y `Asignar categoría`
 *     que aparece cuando hay >= 1 seleccionado
 *
 * Decisiones:
 *   - Server component padre (`page.tsx`) sigue siendo el que
 *     carga los datos via `FumigacionesDataLoader`. Acá solo
 *     recibimos el array y manejamos selection state.
 *   - Filtrado + paginación siguen siendo server-side-friendly JS
 *     (mismo algoritmo que la versión inline anterior). Lo movimos
 *     al client component para mantener la selección atada a la
 *     vista actual.
 *   - Selection state: `Set<number>` para O(1) lookup. Reset on
 *     filter/page change (un user que cambia de filtro no debería
 *     mantener selección de una vista distinta).
 *   - Confirmaciones nativas (`window.confirm`): la operación es
 *     destructiva (borrar N fumigaciones) y el UX nativo es
 *     suficiente. No agregamos un modal custom.
 *   - Llamada a la API: `fetch` directo a los 2 endpoints nuevos.
 *     Después del success, `router.refresh()` para re-render del
 *     server component y `setSelectedIds(new Set())` para limpiar.
 *   - Errores: `alert()` con el mensaje del server. Piola para
 *     v1, no construimos un toast system.
 *   - `isPending` local con useState (no useTransition con async
 *     fetch, mismo patrón que login-page).
 */

import { Calendar, ChevronRight, Droplets, History, Sprout } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FUMIGATION_CATEGORIES } from "@/lib/data-constants";
import { fmtDate, fmtDateTime, fmtDec, fmtInt } from "@/lib/format";
import type { DjiFumigationEvent } from "@/lib/types";
import {
  buildPageUrl,
  type FumigacionesSearchParams
} from "@/lib/fumigaciones-filters";

const PAGE_SIZE = 50;

interface FumigacionesTableClientProps {
  events: DjiFumigationEvent[];
  sourceFilter: "djiscraper" | "import" | "manual" | null;
  categoryFilter: number | null;
  fromDate: string | null;
  toDate: string | null;
  parcelFilter: number | null;
  droneFilter: number | null;
  query: string;
  page: number;
  rawSearchParams: FumigacionesSearchParams;
}

export function FumigacionesTableClient({
  events,
  sourceFilter,
  categoryFilter,
  fromDate,
  toDate,
  parcelFilter,
  droneFilter,
  query,
  page,
  rawSearchParams
}: FumigacionesTableClientProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [isPending, setIsPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Filtrado (mismo algoritmo que la versión inline anterior).
  const filtered = useMemo(() => {
    return events.filter((f) => {
      if (sourceFilter && f.source !== sourceFilter) return false;
      if (categoryFilter != null && f.category_id !== categoryFilter) return false;
      if (parcelFilter != null && f.parcel_id !== parcelFilter) return false;
      if (droneFilter != null && f.drone_code_used !== droneFilter) return false;
      if (fromDate && f.fumigation_date < fromDate) return false;
      if (toDate && f.fumigation_date > toDate) return false;
      if (query) {
        const q = query.toLowerCase();
        const haystack = [
          f.product_used ?? "",
          f.notes ?? "",
          f.human_notes ?? "",
          f.product_registered_ica ?? "",
          f.pilot_license ?? "",
          f.recorded_by ?? "",
          String(f.parcel_id)
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    events,
    sourceFilter,
    categoryFilter,
    fromDate,
    toDate,
    parcelFilter,
    droneFilter,
    query
  ]);

  // Paginación
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  // Resetear selección cuando cambia la vista (filtro, página, query).
  // Sin esto, el user podría cambiar de página y "seleccionar" ids que
  // no están en la nueva vista — confuso. La selección vive en la vista.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    sourceFilter,
    categoryFilter,
    fromDate,
    toDate,
    parcelFilter,
    droneFilter,
    query,
    page
  ]);

  // Select all (de la página actual)
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (
      !window.confirm(
        `¿Borrar ${count} fumigacion${count === 1 ? "" : "es"}? La operación es reversible solo desde la BD (audit log conservado).`
      )
    ) {
      return;
    }
    setIsPending(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/fumigations/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMessage(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      const data = (await res.json()) as { deleted: number; skipped: number };
      setSelectedIds(new Set());
      setActionMessage(
        `Borradas ${data.deleted}, salteadas ${data.skipped}.`
      );
      router.refresh();
    } catch (err) {
      setActionMessage(
        `Error de red: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsPending(false);
    }
  };

  const handleBulkCategory = async (categoryId: number | null) => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const target =
      categoryId == null
        ? "Sin clasificar"
        : FUMIGATION_CATEGORIES.find((c) => c.id === categoryId)?.label ?? `#${categoryId}`;
    if (
      !window.confirm(
        `¿Asignar "${target}" a ${count} fumigacion${count === 1 ? "" : "es"}?`
      )
    ) {
      return;
    }
    setIsPending(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/fumigations/bulk-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), category_id: categoryId })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMessage(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      const data = (await res.json()) as { updated: number; skipped: number };
      setSelectedIds(new Set());
      setActionMessage(
        `Actualizadas ${data.updated}, salteadas ${data.skipped}.`
      );
      router.refresh();
    } catch (err) {
      setActionMessage(
        `Error de red: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-y border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas las fumigaciones de esta página"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                  className="size-4 cursor-pointer disabled:cursor-not-allowed"
                />
              </th>
              <th className="px-3 py-2.5 text-left font-semibold">Fecha</th>
              <th className="px-3 py-2.5 text-left font-semibold">Parcela</th>
              <th className="px-3 py-2.5 text-left font-semibold">Producto</th>
              <th className="px-3 py-2.5 text-right font-semibold">Dosis</th>
              <th className="px-3 py-2.5 text-right font-semibold">Área</th>
              <th className="px-3 py-2.5 text-left font-semibold">Fuente</th>
              <th className="px-3 py-2.5 text-left font-semibold">Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  Sin fumigaciones con esos filtros. Probá limpiar la búsqueda o cambiar la fuente.
                </td>
              </tr>
            ) : (
              rows.map((f) => <FumigationRow key={f.id} f={f} selected={selectedIds.has(f.id)} onToggle={() => toggleOne(f.id)} />)
            )}
          </tbody>
        </table>
      </div>

      {actionMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="border-t border-border bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground"
        >
          {actionMessage}
        </p>
      ) : null}

      {selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          isPending={isPending}
          onDelete={handleBulkDelete}
          onCategory={handleBulkCategory}
        />
      ) : null}

      {totalPages > 1 ? (
        <Pagination
          searchParams={rawSearchParams}
          page={safePage}
          totalPages={totalPages}
        />
      ) : null}
      <p className="border-t border-border px-3 py-2 text-center font-mono text-[11px] text-muted-foreground">
        {`página ${safePage} de ${totalPages} · ${fmtInt(total)} resultados`}
      </p>
    </>
  );
}

function FumigationRow({
  f,
  selected,
  onToggle
}: {
  f: DjiFumigationEvent;
  selected: boolean;
  onToggle: () => void;
}) {
  const sourceVariant: "default" | "secondary" =
    f.source === "manual" ? "default" : "secondary";
  const sourceLabel = f.source === "manual" ? "Manual" : "DJI";

  const category =
    f.category ??
    (f.category_id != null
      ? FUMIGATION_CATEGORIES.find((c) => c.id === f.category_id) ?? null
      : null);

  return (
    <tr
      className={`border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 ${
        selected ? "bg-primary/5" : ""
      }`}
    >
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          aria-label={`Seleccionar fumigación #${f.id}`}
          checked={selected}
          onChange={onToggle}
          className="size-4 cursor-pointer"
        />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Calendar className="size-3.5 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums">
              {fmtDate(f.fumigation_date)}
            </p>
            {f.recorded_at ? (
              <p className="font-mono text-[10px] text-muted-foreground">
                {fmtDateTime(f.recorded_at)}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/parcelas/${f.parcel_id}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
        >
          <Sprout className="size-3.5 text-muted-foreground" aria-hidden />
          {`#${f.parcel_id}`}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/fumigacion/${f.id}`}
          aria-label={`Ver detalle de la fumigación #${f.id} (${f.product_used ?? "sin producto"})${category ? `, tipo ${category.label}` : ", sin clasificar"}`}
          className="group -mx-1 inline-flex max-w-full cursor-pointer flex-col gap-0.5 rounded-sm px-1 py-0.5 text-foreground transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <p className="font-mono text-[10px] text-muted-foreground">
            {`#${f.id}`}
          </p>
          <p className="inline-flex items-center gap-1 font-medium text-primary group-hover:underline">
            <span className="truncate">{f.product_used ?? "—"}</span>
            <ChevronRight
              className="size-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          </p>
        </Link>
        {category ? (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {category.label}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] italic text-muted-foreground">
            Sin clasificar
          </p>
        )}
        {f.product_registered_ica ? (
          <p className="font-mono text-[10px] text-muted-foreground">
            ICA {f.product_registered_ica}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {f.dose_l_per_ha !== null ? `${fmtDec(f.dose_l_per_ha)} L/ha` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {formatArea(f.area_fumigated_m2)}
      </td>
      <td className="px-3 py-2.5">
        <Badge variant={sourceVariant} className="text-[10px]">
          {sourceLabel}
        </Badge>
        {f.n_matched_flights !== undefined && f.n_matched_flights !== null ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {f.n_matched_flights} vuelos
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Droplets className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground">
            {f.recorded_by ?? "—"}
          </span>
        </div>
      </td>
    </tr>
  );
}

function BulkActionBar({
  count,
  isPending,
  onDelete,
  onCategory
}: {
  count: number;
  isPending: boolean;
  onDelete: () => void;
  onCategory: (categoryId: number | null) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Acciones en bulk"
      className="sticky bottom-0 z-10 flex flex-col items-stretch gap-2 border-t-2 border-primary bg-background/95 px-3 py-2.5 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-xs font-semibold text-foreground">
        {count} fumigacion{count === 1 ? "" : "es"} seleccionada{count === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Asignar categoría:
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onCategory(null)}
          disabled={isPending}
          aria-label="Asignar 'Sin clasificar' a las fumigaciones seleccionadas"
        >
          Sin clasificar
        </Button>
        {FUMIGATION_CATEGORIES.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant="ghost"
            onClick={() => onCategory(c.id)}
            disabled={isPending}
            aria-label={`Asignar categoría ${c.label} a las fumigaciones seleccionadas`}
          >
            {c.label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button
          size="sm"
          variant="destructive"
          onClick={onDelete}
          disabled={isPending}
          aria-label="Borrar fumigaciones seleccionadas (soft-delete)"
        >
          {isPending ? "Procesando…" : `Borrar ${count}`}
        </Button>
      </div>
    </div>
  );
}

function Pagination({
  searchParams,
  page,
  totalPages
}: {
  searchParams: FumigacionesSearchParams;
  page: number;
  totalPages: number;
}) {
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const items: number[] = [];
  for (let i = start; i <= end; i++) items.push(i);
  return (
    <nav
      className="flex items-center justify-center gap-1 border-t border-border px-3 py-3"
      aria-label="Paginación"
    >
      {page > 1 ? (
        <Link
          href={buildPageUrl(searchParams, page - 1)}
          className="rounded-md border border-input bg-card px-2.5 py-1 text-xs hover:bg-muted"
          aria-label={`Página anterior (${page - 1})`}
        >
          ← Anterior
        </Link>
      ) : null}
      {items.map((i) => (
        <Link
          key={i}
          href={buildPageUrl(searchParams, i)}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            i === page
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card hover:bg-muted"
          }`}
          aria-label={i === page ? `Página actual (${i})` : `Ir a página ${i}`}
        >
          {i}
        </Link>
      ))}
      {page < totalPages ? (
        <Link
          href={buildPageUrl(searchParams, page + 1)}
          className="rounded-md border border-input bg-card px-2.5 py-1 text-xs hover:bg-muted"
          aria-label={`Página siguiente (${page + 1})`}
        >
          Siguiente →
        </Link>
      ) : null}
    </nav>
  );
}

function formatArea(m2: number | null | undefined): string {
  if (m2 == null) return "—";
  const ha = m2 / 10_000;
  return `${(Math.round(ha * 100) / 100).toFixed(2)} ha`;
}
