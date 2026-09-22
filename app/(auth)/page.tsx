import {
  Building2,
  Droplets,
  Layers,
  Map as MapIcon,
  Plane,
  Sprout,
  TrendingUp
} from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { BarList, type BarListItem } from "@/components/dashboard/bar-list"
import { DashboardFilters } from "@/components/dashboard/dashboard-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PlanCompliance } from "@/components/dashboard/plan-compliance"
import { PlanningBoard } from "@/components/dashboard/planning-board"
import { TrendChart } from "@/components/dashboard/trend-chart"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonCard, SkeletonKpis } from "@/components/ui/loading"
import {
  getDashboardData,
  getDistinctDroneNicknames,
  getRecentParcelsForPicker,
  listFumigationPlans,
  searchFarms,
  type DashboardEstado
} from "@/api/repositories"
import { getViewerRole } from "@/lib/auth/role"
import { FUMIGATION_CATEGORIES } from "@/lib/data-constants"
import { fmtDec, fmtInt, getBogotaDateString } from "@/lib/format"

// `app/page.tsx` consulta la BD (Supabase) en cada request. Sin
// `force-dynamic`, Next.js intenta resolver las queries en build-time y
// revienta con ENETUNREACH contra Supabase.
export const dynamic = "force-dynamic"

interface DashboardSearchParams {
  range?: string
  farm?: string
  drone?: string
  estado?: string
  q?: string
}

const VALID_RANGES = new Set(["30", "90", "365", "all"])
const RANGE_DAYS: Record<string, number> = { "30": 30, "90": 90, "365": 365 }
const VALID_ESTADOS = new Set(["con_parcela", "sin_asignar", "revisar"])

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>
}) {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Panel de operaciones"
        description="Fumigaciones: volumen, cobertura real, tendencia, flota y cumplimiento de la planificación. Filtrá por período, hacienda, dron y estado."
        actions={
          <Button render={<Link href="/geovisor" />} nativeButton={false} size="sm">
            <MapIcon className="size-3.5" />
            Abrir geovisor
          </Button>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <Skeleton className="h-14 w-full rounded-lg" />
      <SkeletonKpis count={5} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )
}

function delta(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

async function DashboardContent({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>
}) {
  const sp = await searchParams
  const range = sp.range && VALID_RANGES.has(sp.range) ? sp.range : "90"
  const farmId = sp.farm && /^\d+$/.test(sp.farm) ? Number(sp.farm) : null
  const drone = sp.drone && sp.drone.trim() !== "" ? sp.drone.trim() : null
  const estado: DashboardEstado | null =
    sp.estado && VALID_ESTADOS.has(sp.estado) ? (sp.estado as DashboardEstado) : null
  const query = sp.q && sp.q.trim() !== "" ? sp.q.trim() : null
  const grain: "week" | "month" = range === "365" || range === "all" ? "month" : "week"

  const days = RANGE_DAYS[range] ?? null
  const fromDate = days === null ? null : getBogotaDateString(-days)
  const toDate = getBogotaDateString()

  const [data, farms, drones, plans, recentParcels, role] = await Promise.all([
    getDashboardData({ fromDate, toDate, clientId: null, farmId, drone, estado, query, grain }),
    searchFarms("", { limit: 500 }),
    getDistinctDroneNicknames(),
    listFumigationPlans({ limit: 200 }),
    getRecentParcelsForPicker(500),
    getViewerRole()
  ])

  const canManage = role === "admin" || role === "supervisor"
  const k = data.kpis
  const rangeLabel = days === null ? "histórico" : `últimos ${days} d`

  const fleetItems: BarListItem[] = data.fleet.map((f) => ({
    key: `drone-${f.drone}`,
    label: f.drone,
    value: f.ha,
    valueLabel: `${fmtDec(f.ha)} ha`,
    hint: `${fmtInt(f.fumigaciones)} fum.`
  }))

  const farmItems: BarListItem[] = data.farms.map((f) => ({
    key: `farm-${f.farm_id ?? "none"}`,
    label: f.farm_name,
    value: f.ha,
    valueLabel: `${fmtDec(f.ha)} ha`,
    hint: `${fmtInt(f.parcelas)} parcelas`,
    barClass: "bg-chart-3"
  }))

  const hasCategoryData = data.categories.some((c) => c.slug !== "otro")
  const categoryItems: BarListItem[] = data.categories
    .filter((c) => c.slug !== "otro")
    .map((c) => ({
      key: c.slug,
      label: FUMIGATION_CATEGORIES.find((x) => x.slug === c.slug)?.label ?? c.slug,
      value: c.ha,
      valueLabel: `${fmtDec(c.ha)} ha`,
      hint: `${fmtInt(c.fumigaciones)} fum.`
    }))

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <DashboardFilters
        farms={farms.map((f) => ({ id: f.id, name: f.name }))}
        drones={drones}
        range={range}
        farmId={farmId !== null ? String(farmId) : ""}
        drone={drone ?? ""}
        estado={estado ?? ""}
        query={query ?? ""}
      />

      {/* KPIs con datos reales del pipeline (área reportada, cobertura, volumen). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          icon={Sprout}
          label={`Fumigaciones (${rangeLabel})`}
          value={fmtInt(k.fumigaciones)}
          hint="eventos registrados"
          delta={delta(k.fumigaciones, k.prev.fumigaciones)}
        />
        <KpiCard
          icon={Layers}
          label="Área aplicada"
          value={`${fmtDec(k.hectareas)} ha`}
          hint={`${fmtDec(k.prev.hectareas)} ha período previo`}
          delta={delta(k.hectareas, k.prev.hectareas)}
        />
        <KpiCard
          icon={Layers}
          label="Cobertura real"
          value={`${fmtDec(k.cobertura_ha)} ha`}
          hint="unión de trazos volados"
          delta={delta(k.cobertura_ha, k.prev.cobertura_ha)}
        />
        <KpiCard
          icon={Droplets}
          label="Volumen"
          value={`${fmtInt(Math.round(k.volumen_l))} L`}
          hint="spray real de los vuelos"
          delta={delta(k.volumen_l, k.prev.volumen_l)}
        />
        <KpiCard
          icon={Plane}
          label={`Vuelos (${rangeLabel})`}
          value={fmtInt(k.vuelos)}
          hint="sorties DJI"
          delta={delta(k.vuelos, k.prev.vuelos)}
        />
      </div>

      {k.por_revisar > 0 ? (
        <Link
          href="/admin/calidad"
          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-700/15 px-3 py-2 text-xs text-amber-700 hover:bg-amber-700/20 dark:text-amber-300"
        >
          <span className="font-semibold">{fmtInt(k.por_revisar)}</span>
          <span>
            fumigaciones sobre parcelas automáticas <span className="font-medium">por revisar</span>.
          </span>
          <span className="ml-auto font-semibold">Revisar →</span>
        </Link>
      ) : null}

      {/* Tendencia (2/3) + cumplimiento de planificación (1/3). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col lg:col-span-2">
          <TrendChart data={data.trend} grain={grain} />
        </div>
        <PlanCompliance data={data.planCompliance} />
      </div>

      {/* Flota + Mix por categoría (solo si hay categorías clasificadas). */}
      {hasCategoryData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarList
            title="Flota por hectáreas"
            description="Uso de cada dron en el período (según los vuelos)."
            icon={Plane}
            items={fleetItems}
          />
          <BarList
            title="Mix por categoría"
            description="Qué se aplicó: hectáreas por tipo de producto."
            icon={TrendingUp}
            items={categoryItems}
          />
        </div>
      ) : (
        <BarList
          title="Flota por hectáreas"
          description="Uso de cada dron en el período (según los vuelos)."
          icon={Plane}
          items={fleetItems}
        />
      )}

      {/* Cobertura por hacienda + planificación manual. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <BarList
            title="Cobertura por hacienda"
            description="Top haciendas por hectáreas tratadas en el período."
            icon={Building2}
            items={farmItems}
          />
        </div>
        <div className="lg:col-span-5">
          <PlanningBoard
            plans={plans}
            parcels={recentParcels}
            today={toDate}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  )
}
