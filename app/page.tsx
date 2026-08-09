import { Droplets, Map as MapIcon, Plane, Sprout } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { CompliancePanel } from "@/components/dashboard/compliance-panel"
import { HealthPanel } from "@/components/dashboard/health-panel"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { type MonthlyBar, MonthlyChart } from "@/components/dashboard/monthly-chart"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton, SkeletonCard, SkeletonKpis } from "@/components/ui/loading"
import type { CyclePhase } from "@/lib/crop-cycle"
import {
  DRONE_MODELS,
  getFlights,
  getFumigations,
  getFumigationsMonthly,
  getHealth,
  getImportBatches,
  getParcelSummaries,
  getParcels,
  getParcelsWithCycle,
  NOW,
} from "@/lib/data"
import { fmtDec, fmtInt, fmtLiters } from "@/lib/format"

// `app/page.tsx` consulta la BD (Supabase) en cada request vía los repos
// del proyecto. Sin `force-dynamic`, Next.js intenta resolver las queries
// en build-time y revienta con ENETUNREACH contra Supabase (la build
// corre en el runner, no en el runtime con la red del operador).
export const dynamic = "force-dynamic"

const DAY = 86400000

export default function DashboardPage() {
  // S10 (2026-08-06): el header se renderiza instantaneamente (sin
  // queries). El contenido va dentro de un <Suspense> con skeleton
  // fallback — el usuario ve "Panel de operaciones" + skeletons de
  // KPIs/cards mientras se cargan las queries. Antes: el await de las
  // 5 queries bloqueaba TODO el render hasta que llegara la data.
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Panel de operaciones"
        description="Portafolio consolidado de parcelas, fumigaciones y vuelos desde DJI AG."
        actions={
          <Button render={<Link href="/geovisor" />} nativeButton={false} size="sm">
            <MapIcon className="size-3.5" />
            Abrir geovisor
          </Button>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}

/**
 * Skeleton fallback del dashboard. Se muestra mientras
 * <DashboardContent> espera las queries. Patron shadcn: cada bloque
 * importante tiene un skeleton equivalente para que la transicion
 * skeleton → contenido real sea sin "saltos" visuales.
 */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <SkeletonKpis count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  )
}

async function DashboardContent() {
  // Promise.all para paralelizar las 5 queries independientes. Cada una
  // tiene su propio cache (fetchParcelsNormalizedCached, etc) asi que
  // el segundo render es casi instant. La primera vez tarda ~200ms
  // por query contra Supabase.
  const [
    parcels,
    summaries,
    fumigations,
    flights,
    health,
    batches,
    parcelsWithCycle,
    monthly
  ] = await Promise.all([
    getParcels(),
    getParcelSummaries(),
    getFumigations(),
    getFlights(),
    getHealth(),
    getImportBatches(),
    // Sprint 2026-08-01 — "Fase de cultivo": el compliance panel muestra
    // un chip de fase al lado del status dot. `getParcelsWithCycle()`
    // mergea los cycle fields (planting_date, cycle_phase) a cada parcel
    // con un try/catch resilente (degrada a null si la migration no
    // se aplicó). Acá derivamos un Map<parcelId, cyclePhase> que es lo
    // único que el panel necesita (no pasa el array entero).
    getParcelsWithCycle(),
    // Serie mensual (12 meses) — Sprint H2 follow-up: viene de la
    // materialized view `mv_fumigations_monthly`. Cache 5min TTL.
    getFumigationsMonthly()
  ])

  const cycleByParcelId = new Map<string, CyclePhase | null>(
    parcelsWithCycle.map((p) => [p.id, p.cycle_phase])
  )

  const inWindow = (iso: string, fromDays: number, toDays: number) => {
    const t = new Date(iso).getTime()
    return t > NOW.getTime() - fromDays * DAY && t <= NOW.getTime() - toDays * DAY
  }

  const last30 = fumigations.filter((f) => inWindow(f.executed_at, 30, 0))
  const prev30 = fumigations.filter((f) => inWindow(f.executed_at, 60, 30))
  const flights30 = flights.filter((f) => inWindow(f.started_at, 30, 0))
  const flightsPrev30 = flights.filter((f) => inWindow(f.started_at, 60, 30))

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
  const delta = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100)

  const ha30 = sum(last30.map((f) => f.area_treated_ha))
  const haPrev = sum(prev30.map((f) => f.area_treated_ha))
  const vol30 = sum(last30.map((f) => f.volume_l))
  const volPrev = sum(prev30.map((f) => f.volume_l))

  const fleet = DRONE_MODELS.filter((m) => m.id !== 0).map((m) => ({
    model: m,
    flights: flights.filter((f) => f.drone_model_id === m.id).length,
    ha: sum(flights.filter((f) => f.drone_model_id === m.id).map((f) => f.area_ha)),
  }))
  const fleetMaxHa = Math.max(1, ...fleet.map((f) => f.ha))
  const totalHa = sum(parcels.map((p) => p.area_ha))

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Sprout}
          label="Parcelas"
          value={fmtInt(parcels.length)}
          hint={`${fmtDec(totalHa)} ha`}
        />
        <KpiCard
          icon={Plane}
          label="Vuelos"
          value={fmtInt(flights.length)}
          hint={`${fmtInt(flights30.length)} últimos 30d`}
          delta={delta(flights30.length, flightsPrev30.length)}
        />
        <KpiCard
          icon={Droplets}
          label="Fumigaciones"
          value={fmtInt(fumigations.length)}
          hint={`${fmtInt(last30.length)} últimos 30d`}
          delta={delta(last30.length, prev30.length)}
        />
        <KpiCard
          icon={MapIcon}
          label="Hectáreas fumigadas (30d)"
          value={fmtLiters(ha30)}
          hint={
            delta(ha30, haPrev) !== null
              ? `${delta(ha30, haPrev)! >= 0 ? "+" : ""}${delta(ha30, haPrev)?.toFixed(1)}% vs 30d previos`
              : "—"
          }
          delta={delta(ha30, haPrev)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CompliancePanel
          summaries={summaries}
          cycleByParcelId={cycleByParcelId}
        />
        <HealthPanel health={health} batches={batches} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Volumen fumigado por mes</CardTitle>
          <CardDescription>Últimos 12 meses · Hectáreas tratadas (barras) y eventos (línea).</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyChart data={monthly} />
        </CardContent>
      </Card>

      <RecentActivity
        fumigations={fumigations}
        parcelById={new Map(parcels.map((p) => [p.id, p]))}
      />
    </div>
  )
}
