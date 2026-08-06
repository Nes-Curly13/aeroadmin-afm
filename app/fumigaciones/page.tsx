import Link from "next/link"
import { Calendar, Droplets, History, Plus, Sprout } from "lucide-react"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton, SkeletonTable } from "@/components/ui/loading"
import { getRecentFumigations } from "@/api/repositories"
import { fmtDate, fmtDateTime, fmtDec, fmtInt } from "@/lib/format"
import type { DjiFumigationEvent } from "@/lib/types"

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
  }>
}

function parseSource(v: string | undefined): "djiscraper" | "import" | "manual" | null {
  if (v === "dji") return "djiscraper"
  if (v === "manual") return "manual"
  if (v === "import") return "import"
  return null
}

export default async function FumigacionesPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const query = (sp.q ?? "").trim()
  const sourceFilter = parseSource(sp.source)

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
          <button
            type="submit"
            className="h-8 rounded-md border border-input bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
          >
            Filtrar
          </button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Suspense fallback={<Skeleton className="h-3 w-48" />}>
            <FumigacionesCounts sourceFilter={sourceFilter} />
          </Suspense>
          <Button
            size="sm"
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
            <FumigacionesTable query={query} sourceFilter={sourceFilter} page={page} />
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
  page
}: {
  query: string
  sourceFilter: "djiscraper" | "import" | "manual" | null
  page: number
}) {
  const all = await getRecentFumigations(2000)

  // Filtros aplicados en server (mismo patron que /admin/parcels).
  const filtered = all.filter((f) => {
    if (sourceFilter && f.source !== sourceFilter) return false
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
      {totalPages > 1 ? <Pagination page={safePage} totalPages={totalPages} /> : null}
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
            fumigaciones por URL propia. Sprint 2026-08-05. */}
        <Link
          href={`/fumigacion/${f.id}`}
          className="group flex flex-col text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
        >
          <p className="font-mono text-[10px] text-muted-foreground">
            {`#${f.id}`}
          </p>
          <p className="font-medium group-hover:text-primary">
            {f.product_used ?? "—"}
          </p>
        </Link>
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

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
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
          href={`?page=${page - 1}`}
          className="rounded-md border border-input bg-card px-2.5 py-1 text-xs hover:bg-muted"
        >
          ← Anterior
        </Link>
      ) : null}
      {items.map((i) => (
        <Link
          key={i}
          href={`?page=${i}`}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            i === page
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card hover:bg-muted"
          }`}
        >
          {i}
        </Link>
      ))}
      {page < totalPages ? (
        <Link
          href={`?page=${page + 1}`}
          className="rounded-md border border-input bg-card px-2.5 py-1 text-xs hover:bg-muted"
        >
          Siguiente →
        </Link>
      ) : null}
    </nav>
  )
}
