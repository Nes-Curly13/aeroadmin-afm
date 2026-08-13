import Link from "next/link"
import { Calendar, ChevronRight, Droplets, History, Plus, Sprout } from "lucide-react"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton, SkeletonTable } from "@/components/ui/loading"
import { getRecentFumigations } from "@/api/repositories"
import { DRONE_MODELS, FUMIGATION_CATEGORIES } from "@/lib/data-constants"
import { fmtDate, fmtDateTime, fmtDec, fmtInt } from "@/lib/format"
import type { DjiFumigationEvent } from "@/lib/types"
import {
  buildPageUrl,
  parseCategorySlug,
  parseDate,
  parseDroneCode,
  parseIntId,
  parseSource,
  type FumigacionesSearchParams
} from "@/lib/fumigaciones-filters"

/**
 * /fumigaciones — listado global de fumigaciones (Sprint 2026-08-04).
 *
 * Cierra el pedido del operador: "quiero ver un /fumigaciones donde
 * esten los registros". Antes el operador tenia que abrir parcela
 * por parcela para ver su historial; ahora tiene un dashboard
 * unificado con todas las fumigaciones (DJI + manuales).
 *
 * Decisiones:
 *   - Server component (no client) para query directa a la BD via
 *     `getRecentFumigations`. Sin paginacion por ahora (12k vuelos
 *     → ~17k fumigaciones estimadas, se justifica cuando duplique).
 *   - Filtros server-side via searchParams: `?source=dji|manual`, `?q=<texto>`
 *     (busca en product, ICA, license, notes).
 *   - Click en una fila navega al detail de la parcela
 *     (`/parcelas/[id]`). El operador sigue viendo la fumigacion
 *     en el timeline del detail.
 *   - Boton "+ Nueva fumigacion" arriba a la derecha lleva a
 *     /parcelas (el operador elige la parcela y ahi usa el form del
 *     detail page). No abrimos un wizard de 2 pasos aca — es mas
 *     friccion que beneficio.
 *
 * S10 (2026-08-06): Suspense boundaries. El header + form se
 * renderizan instantaneamente; el <Suspense> envuelve la tabla y
 * los counts para que el usuario pueda tipear/filtrar mientras la
 * data carga (~500ms cold).
 *
 * Auth: el middleware ya filtra por /admin/* y /parcelas/*, pero
 * /fumigaciones es un path libre. Confiamos en que el caller es
 * admin (la navbar tiene el badge de rol). Si en el futuro queremos
 * gate explicito, agregar `await requireRole("viewer")` aca.
 */

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Fumigaciones | AFM Geovisor",
  description:
    "Listado unificado de fumigaciones DJI + manuales con filtros por fecha, parcela y fuente."
}

const PAGE_SIZE = 50

interface PageProps {
  searchParams: Promise<{
    page?: string
    q?: string
    source?: "dji" | "manual" | "all" | string
    /**
     * Sprint 2026-08-13 — sub-2. Filtro por categoría curada. Se pasa
     * el slug ("herbicida", "insecticida", etc.) en lugar del id para
     * que la URL sea legible y no se rompa si reasignamos ids.
     */
    category?: string
    /**
     * Sprint 2026-08-13 — polish v1. Filtros de rango temporal,
     * parcela específica y dron usado. Las fechas se pasan como
     * YYYY-MM-DD (formato nativo del <input type="date">). El parcel
     * es un id numérico (match con la URL del detail /parcelas/[id]).
     * El drone es el code numérico (0, 72, 201, 210).
     */
    from?: string
    to?: string
    parcel?: string
    drone?: string
  }>
}

export default async function FumigacionesPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const query = (sp.q ?? "").trim()
  const sourceFilter = parseSource(sp.source)
  const categoryFilter = parseCategorySlug(sp.category)
  const fromDate = parseDate(sp.from)
  const toDate = parseDate(sp.to)
  const parcelFilter = parseIntId(sp.parcel)
  const droneFilter = parseDroneCode(sp.drone)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Fumigaciones"
        description="Registro unificado de fumigaciones DJI + manuales. Click una fila para ver el detalle de la parcela."
      />

      {/* Filtros + acción — sync, sin queries */}
      <form
        method="get"
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="q"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Buscar
            </label>
            <input
              id="q"
              name="q"
              defaultValue={query}
              placeholder="Producto, ICA, licencia, parcela…"
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm sm:w-72"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="source"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Fuente
            </label>
            <select
              id="source"
              name="source"
              defaultValue={sourceFilter ?? "all"}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">Todas</option>
              <option value="dji">DJI</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="category"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Tipo
            </label>
            <select
              id="category"
              name="category"
              defaultValue={sp.category ?? ""}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Todos</option>
              {FUMIGATION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="from"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Desde
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromDate ?? ""}
              max={toDate ?? undefined}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-36"
              aria-label="Fecha de inicio del rango"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="to"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Hasta
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toDate ?? ""}
              min={fromDate ?? undefined}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-36"
              aria-label="Fecha de fin del rango"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="parcel"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Parcela #
            </label>
            <input
              id="parcel"
              name="parcel"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              defaultValue={sp.parcel ?? ""}
              placeholder="ej. 3107"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-28"
              aria-label="ID de parcela específica"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="drone"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Dron
            </label>
            <select
              id="drone"
              name="drone"
              defaultValue={sp.drone ?? ""}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Todos</option>
              {DRONE_MODELS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id === 0 ? "Sin asignar" : `${d.name} (${d.tank_l} L)`}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="h-8 rounded-md border border-input bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
          >
            Filtrar
          </button>
          {(sp.from || sp.to || sp.parcel || sp.drone) ? (
            <Link
              href="/fumigaciones"
              className="h-8 self-end rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-label="Limpiar todos los filtros"
            >
              Limpiar
            </Link>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Suspense fallback={<Skeleton className="h-3 w-48" />}>
            <FumigacionesCounts sourceFilter={sourceFilter} />
          </Suspense>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link href="/fumigaciones/nueva" aria-label="Registrar nueva fumigación (página completa)" />
            }
          >
            <Plus className="size-3.5" aria-hidden />
            Nueva fumigación
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" aria-hidden />
            Registro de fumigaciones
          </CardTitle>
          <CardDescription>
            {sourceFilter === "manual"
              ? "Solo fumigaciones manuales (alta del operador fumigador)."
              : sourceFilter === "djiscraper" || sourceFilter === "import"
                ? "Solo fumigaciones del scrape de DJI."
                : "Mezcla de fumigaciones scrapeadas de DJI + manuales."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Suspense fallback={<SkeletonTable rows={10} cols={7} />}>
            <FumigacionesTable
              query={query}
              sourceFilter={sourceFilter}
              categoryFilter={categoryFilter}
              fromDate={fromDate}
              toDate={toDate}
              parcelFilter={parcelFilter}
              droneFilter={droneFilter}
              page={page}
              rawSearchParams={sp}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// Sub-componentes async (dentro de <Suspense>)
// ============================================================

async function FumigacionesCounts({
  sourceFilter
}: {
  sourceFilter: "djiscraper" | "import" | "manual" | null
}) {
  // Reutilizamos la misma query (cada una va al cache `afm:recent-fumigations`).
  const all = await getRecentFumigations(2000)
  const djiCount = all.filter(
    (f) => f.source === "djiscraper" || f.source === "import"
  ).length
  const manualCount = all.filter((f) => f.source === "manual").length
  return (
    <p className="font-mono text-[11px] text-muted-foreground">
      {sourceFilter === "manual"
        ? `${manualCount} manuales`
        : sourceFilter === "djiscraper"
          ? `${djiCount} DJI`
          : `${fmtInt(all.length)} fumigaciones`}
    </p>
  )
}

async function FumigacionesTable({
  query,
  sourceFilter,
  categoryFilter,
  fromDate,
  toDate,
  parcelFilter,
  droneFilter,
  page,
  rawSearchParams
}: {
  query: string
  sourceFilter: "djiscraper" | "import" | "manual" | null
  /** Sprint 2026-08-13 — sub-2. id de FUMIGATION_CATEGORIES o null. */
  categoryFilter: number | null
  /** Sprint 2026-08-13 — polish v1. Filtros temporales (YYYY-MM-DD). */
  fromDate: string | null
  toDate: string | null
  parcelFilter: number | null
  droneFilter: number | null
  page: number
  /**
   * SearchParams crudos del padre. Necesarios para que Pagination
   * preserve los filtros activos al cambiar de página (fix bug
   * pre-existente + polish v1).
   */
  rawSearchParams: FumigacionesSearchParams
}) {
  const all = await getRecentFumigations(2000)

  // Filtros aplicados en server (mismo patron que /admin/parcels).
  const filtered = all.filter((f) => {
    if (sourceFilter && f.source !== sourceFilter) return false
    if (categoryFilter != null && f.category_id !== categoryFilter) return false
    if (parcelFilter != null && f.parcel_id !== parcelFilter) return false
    if (droneFilter != null && f.drone_code_used !== droneFilter) return false
    if (fromDate && f.fumigation_date < fromDate) return false
    if (toDate && f.fumigation_date > toDate) return false
    if (query) {
      const q = query.toLowerCase()
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
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  // Paginación simple (slice en memoria).
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const rows = filtered.slice(start, start + PAGE_SIZE)

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-y border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
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
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  Sin fumigaciones con esos filtros. Probá limpiar la búsqueda o cambiar la fuente.
                </td>
              </tr>
            ) : (
              rows.map((f) => <FumigationRow key={f.id} f={f} />)
            )}
          </tbody>
        </table>
      </div>
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
  )
}

function FumigationRow({ f }: { f: DjiFumigationEvent }) {
  // Variante del badge por fuente: DJI = secondary (gris, automático),
  // manual = default (primary, destacado, viene del operador).
  const sourceVariant: "default" | "secondary" =
    f.source === "manual" ? "default" : "secondary"
  const sourceLabel = f.source === "manual" ? "Manual" : "DJI"

  // Sprint 2026-08-13 — sub-2. Badge de categoría curada. Resolvemos
  // por el objeto hidratado (JOIN) o por el id contra el catálogo
  // client-side (caso tests con mocks parciales).
  const category =
    f.category ??
    (f.category_id != null
      ? FUMIGATION_CATEGORIES.find((c) => c.id === f.category_id) ?? null
      : null)

  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
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
        {/* El producto + ID de fumigación son links a la ficha individual.
            Esto resuelve el pedido del operador de poder navegar
            fumigaciones por URL propia. Sprint 2026-08-05.
            Fix visual v2 (2026-08-13): el link no se percibía como
            clickeable (texto negro sobre negro, sin affordance). Se
            agrega color primary, hover bg sutil, chevron al final y
            focus ring explícito. */}
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
  )
}

/**
 * Formatea el área fumigada de m² a ha con 2 decimales. Si el valor
 * es null o no es number, devuelve "—". Helper fuera del componente
 * FumigationRow para que TS infiera el tipo de `area_fumigated_m2`
 * correctamente (number | null del query, no number | bigint | string).
 */
function formatArea(m2: number | null | undefined): string {
  if (m2 == null) return "—"
  // ha con 2 decimales. fmtInt formatea a string con separador de
  // miles, asi que NO se puede dividir despues — operamos con number.
  const ha = m2 / 10_000
  return `${(Math.round(ha * 100) / 100).toFixed(2)} ha`
}

function Pagination({
  searchParams,
  page,
  totalPages
}: {
  /**
   * Sprint 2026-08-13 — polish v1. SearchParams activos. La paginación
   * los preserva al cambiar de página — fix de bug pre-existente
   * (antes cambiar de página perdía los filtros `q`, `source`, etc.).
   */
  searchParams: FumigacionesSearchParams
  page: number
  totalPages: number
}) {
  // Paginación básica. 5 links visibles: 2 antes, actual, 2 después.
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 4)
  const items: number[] = []
  for (let i = start; i <= end; i++) items.push(i)
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
  )
}
