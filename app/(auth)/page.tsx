import {
  Building2,
  Droplets,
  Gauge,
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
  getRecentParcelsForPicker,
  listFumigationPlans,
  searchClients,
  searchFarms
} from "@/api/repositories"
import { getViewerRole } from "@/lib/auth/role"
import { DRONE_MODELS, FUMIGATION_CATEGORIES } from "@/lib/data-constants"
import { fmtDec, fmtInt, getBogotaDateString } from "@/lib/format"

// `app/page.tsx` consulta la BD (Supabase) en cada request. Sin
// `force-dynamic`, Next.js intenta resolver las queries en build-time y
// revienta con ENETUNREACH contra Supabase.
export const dynamic = "force-dynamic"

interface DashboardSearchParams {
  range?: string
  client?: string
  farm?: string
}

const VALID_RANGES = new Set(["30", "90", "365", "all"])
const RANGE_DAYS: Record<string, number> = { "30": 30, "90": 90, "365": 365 }

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>
}) {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Panel de operaciones"
        description="Gestión de fumigaciones: volumen, cobertura, tendencia, flota y cumplimiento de la planificación. Filtrá por período y cliente/hacienda."
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
  const clientId = sp.client && /^\d+$/.test(sp.client) ? Number(sp.client) : null
  const farmId = sp.farm && /^\d+$/.test(sp.farm) ? Number(sp.farm) : null
  const grain: "week" | "month" = range === "365" || range === "all" ? "month" : "week"

  const days = RANGE_DAYS[range] ?? null
  const fromDate = days === null ? null : getBogotaDateString(-days)
  const toDate = getBogotaDateString()

  const [data, clients, farms, plans, recentParcels, role] = await Promise.all([
    getDashboardData({ fromDate, toDate, clientId, farmId, grain }),
    searchClients("", 50),
    clientId ? searchFarms("", { clientId, limit: 50 }) : Promise.resolve([]),
    listFumigationPlans({ limit: 200 }),
    getRecentParcelsForPicker(500),
    getViewerRole()
  ])

  const canManage = role === "admin" || role === "supervisor"
  const k = data.kpis
  const coverage =
    k.parcelas_total === 0 ? 0 : Math.round((k.parcelas_cubiertas / k.parcelas_total) * 100)
  const rangeLabel = days === null ? "histórico" : `últimos ${days} d`

  const fleetItems: BarListItem[] = data.fleet.map((f) => ({
    key: `drone-${f.drone_code}`,
    label:
      DRONE_MODELS.find((m) => m.id === f.drone_code)?.name ??
      (f.drone_code === 0 ? "Sin asignar" : `Dron ${f.drone_code}`),
    value: f.ha,
    valueLabel: `${fmtDec(f.ha)} ha`,
    hint: `${fmtInt(f.fumigaciones)} fum.`
  }))

  const categoryItems: BarListItem[] = data.categories.map((c) => ({
    key: c.slug,
    label: FUMIGATION_CATEGORIES.find((x) => x.slug === c.slug)?.label ?? c.slug,
    value: c.ha,
    valueLabel: `${fmtDec(c.ha)} ha`,
    hint: `${fmtInt(c.fumigaciones)} fum.`
  }))

  const clientItems: BarListItem[] = data.clients.map((c) => ({
    key: `client-${c.client_id ?? "none"}`,
    label: c.client_name,
    value: c.ha,
    valueLabel: `${fmtDec(c.ha)} ha`,
    hint: `${fmtInt(c.parcelas)} parcelas`,
    barClass: "bg-chart-3"
  }))

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <DashboardFilters
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        farms={farms.map((f) => ({ id: f.id, name: f.name }))}
        range={range}
        clientId={clientId !== null ? String(clientId) : ""}
        farmId={farmId !== null ? String(farmId) : ""}
      />

      {/* 5 KPIs — cada uno con delta vs período anterior. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          icon={Droplets}
          label={`Fumigaciones (${rangeLabel})`}
          value={fmtInt(k.fumigaciones)}
          hint="eventos registrados"
          delta={delta(k.fumigaciones, k.prev.fumigaciones)}
        />
        <KpiCard
          icon={Sprout}
          label={`Hectáreas (${rangeLabel})`}
          value={`${fmtDec(k.hectareas)} ha`}
          hint={`${fmtDec(k.prev.hectareas)} ha período previo`}
          delta={delta(k.hectareas, k.prev.hectareas)}
        />
        <KpiCard
          icon={Layers}
          label="Parcelas cubiertas"
          value={`${coverage}%`}
          hint={`${fmtInt(k.parcelas_cubiertas)} de ${fmtInt(k.parcelas_total)}`}
          delta={delta(k.parcelas_cubiertas, k.prev.parcelas_cubiertas)}
        />
        <KpiCard
          icon={Gauge}
          label="Dosis media"
          value={k.dosis_media === null ? "—" : `${fmtDec(k.dosis_media)} L/ha`}
          hint={`${fmtDec(k.volumen_l)} L aplicados`}
          delta={
            k.dosis_media === null || k.prev.dosis_media === null
              ? null
              : delta(k.dosis_media, k.prev.dosis_media)
          }
        />
        <KpiCard
          icon={Plane}
          label={`Vuelos (${rangeLabel})`}
          value={fmtInt(k.vuelos)}
          hint="sorties DJI"
          delta={delta(k.vuelos, k.prev.vuelos)}
        />
      </div>

      {/* Tendencia (2/3) + cumplimiento de planificación (1/3). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col">
          <TrendChart data={data.trend} grain={grain} />
        </div>
        <PlanCompliance data={data.planCompliance} />
      </div>

      {/* Flota + Mix por categoría. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="Flota por hectáreas"
          description="Uso de cada dron en el período."
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

      {/* Cobertura por cliente + planificación manual. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <BarList
            title="Cobertura por cliente"
            description="Top clientes por hectáreas tratadas en el período."
            icon={Building2}
            items={clientItems}
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
