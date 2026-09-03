import Link from "next/link"
import { History, Plus } from "lucide-react"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton, SkeletonTable } from "@/components/ui/loading"
import { FumigacionesDataLoader } from "@/app/(auth)/fumigaciones/data-loader"
import { FumigacionesTableClient } from "@/app/(auth)/fumigaciones/fumigaciones-table"
import { DRONE_MODELS, FUMIGATION_CATEGORIES } from "@/lib/data-constants"
import { fmtInt } from "@/lib/format"
import type { DjiFumigationEvent } from "@/lib/types"
import {
  parseCategorySlug,
  parseDate,
  parseDroneCode,
  parseIntId,
  parseSource
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
 *     /fumigaciones/nueva (wizard de 2 columnas con mapa satelital
 *     para selección visual de la parcela). Ver
 *     `app/fumigaciones/nueva/page.tsx`.
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
            <FumigacionesDataLoader sourceFilter={sourceFilter}>
              {(events) => <FumigacionesCounts events={events} sourceFilter={sourceFilter} />}
            </FumigacionesDataLoader>
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
                : "Mezcla de fumigaciones scrapeadas de DJI + manuales. Tildá filas para hacer bulk delete o reasignar categoría."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Suspense fallback={<SkeletonTable rows={10} cols={7} />}>
            <FumigacionesDataLoader
              query={query}
              sourceFilter={sourceFilter}
              categoryFilter={categoryFilter}
              fromDate={fromDate}
              toDate={toDate}
              parcelFilter={parcelFilter}
              droneFilter={droneFilter}
              page={page}
              rawSearchParams={sp}
            >
              {(events) => (
                <FumigacionesTableClient
                  events={events}
                  sourceFilter={sourceFilter}
                  categoryFilter={categoryFilter}
                  fromDate={fromDate}
                  toDate={toDate}
                  parcelFilter={parcelFilter}
                  droneFilter={droneFilter}
                  query={query}
                  page={page}
                  rawSearchParams={sp}
                />
              )}
            </FumigacionesDataLoader>
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// Sub-componentes (dentro de <Suspense>)
// ============================================================
// `FumigacionesDataLoader` vive en `./data-loader` (import arriba)
// para poder testearlo. Antes estaba inline en este archivo
// (Sprint Fase 2 / Q1, 2026-08-23).
//
// `FumigacionesTableClient` (con checkboxes + bulk actions) vive
// en `./fumigaciones-table` desde el Bloque F (2026-08-29) — es
// client component, se separa del server component padre.

function FumigacionesCounts({
  events,
  sourceFilter
}: {
  events: DjiFumigationEvent[];
  sourceFilter: "djiscraper" | "import" | "manual" | null;
}) {
  // El array `events` viene del `FumigacionesDataLoader` (compartido
  // con Table). NO hacemos fetch acá — Q1 fix.
  const djiCount = events.filter(
    (f) => f.source === "djiscraper" || f.source === "import"
  ).length;
  const manualCount = events.filter((f) => f.source === "manual").length;
  return (
    <p className="font-mono text-[11px] text-muted-foreground">
      {sourceFilter === "manual"
        ? `${manualCount} manuales`
        : sourceFilter === "djiscraper"
          ? `${djiCount} DJI`
          : `${fmtInt(events.length)} fumigaciones`}
    </p>
  );
}
