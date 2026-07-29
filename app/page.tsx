import { Droplets, Map as MapIcon, Plane, Sprout } from "lucide-react"
import Link from "next/link"
import { CompliancePanel } from "@/components/dashboard/compliance-panel"
import { HealthPanel } from "@/components/dashboard/health-panel"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { type MonthlyBar, MonthlyChart } from "@/components/dashboard/monthly-chart"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DRONE_MODELS,
  getFlights,
  getFumigations,
  getHealth,
  getImportBatches,
  getParcelSummaries,
  getParcels,
  NOW,
} from "@/lib/data"
import { fmtDec, fmtInt, fmtLiters } from "@/lib/format"

// `app/page.tsx` consulta la BD (Supabase) en cada request vía los repos
// del proyecto. Sin `force-dynamic`, Next.js intenta resolver las queries
// en build-time y revienta con ENETUNREACH contra Supabase (la build
// corre en el runner, no en el runtime con la red del operador).
export const dynamic = "force-dynamic"

const DAY = 86400000

export default async function DashboardPage() {
  const parcels = await getParcels()
  const summaries = await getParcelSummaries()
  const fumigations = await getFumigations()
  const flights = await getFlights()
  const health = await getHealth()
  const batches = await getImportBatches()
  const parcelById = new Map(parcels.map((p) => [p.id, p]))

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

  // Serie mensual (12 meses)
  const monthly: MonthlyBar[] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - (11 - i), 1))
    const start = d.getTime()
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime()
    const evs = fumigations.filter((f) => {
      const t = new Date(f.executed_at).getTime()
      return t >= start && t < end
    })
    return {
      label: d.toLocaleDateString("es-CO", { month: "short", timeZone: "UTC" }),
      ha: Math.round(sum(evs.map((e) => e.area_treated_ha))),
      flights: sum(evs.map((e) => e.flights_count)),
    }
  })

  const fleet = DRONE_MODELS.filter((m) => m.id !== 0).map((m) => ({
    model: m,
    flights: flights.filter((f) => f.drone_model_id === m.id).length,
    ha: sum(flights.filter((f) => f.drone_model_id === m.id).map((f) => f.area_ha)),
  }))
  const fleetMaxHa = Math.max(1, ...fleet.map((f) => f.ha))
  const totalHa = sum(parcels.map((p) => p.area_ha))

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Panel de operaciones"
        description={`Portafolio de ${parcels.length} parcelas de caña (${fmtDec(totalHa)} ha) con ${fmtInt(fumigations.length)} aplicaciones y ${fmtInt(flights.length)} vuelos históricos consolidados desde DJI AG.`}
        actions={
          <Button render={<Link href="/geovisor" />} size="sm">
            <MapIcon className="size-3.5" />
            Abrir geovisor
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Hectáreas tratadas (30 d)"
            value={`${fmtDec(ha30)} ha`}
            hint="vs 30 días anteriores"
            icon={Sprout}
            delta={delta(ha30, haPrev)}
          />
          <KpiCard
            label="Aplicaciones (30 d)"
            value={fmtInt(last30.length)}
            hint="eventos en dji_fumigations"
            icon={MapIcon}
            delta={delta(last30.length, prev30.length)}
          />
          <KpiCard
            label="Vuelos (30 d)"
            value={fmtInt(flights30.length)}
            hint="sorties en dji_flights"
            icon={Plane}
            delta={delta(flights30.length, flightsPrev30.length)}
          />
          <KpiCard
            label="Volumen aplicado (30 d)"
            value={fmtLiters(vol30)}
            hint="mezcla total asperjada"
            icon={Droplets}
            delta={delta(vol30, volPrev)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <MonthlyChart data={monthly} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Uso de la flota</CardTitle>
              <CardDescription>Vuelos y hectáreas por modelo (dji_drone_models)</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {fleet.map((f) => (
                <div key={f.model.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{f.model.name}</span>
                    <span className="tabular font-mono text-xs text-muted-foreground">
                      {`${fmtInt(f.flights)} vuelos · ${fmtDec(f.ha)} ha`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(f.ha / fleetMaxHa) * 100}%`, backgroundColor: f.model.color }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{`Tanque ${f.model.tank_l} L · id ${f.model.id}`}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <CompliancePanel summaries={summaries} />
          </div>
          <HealthPanel health={health} batches={batches} />
        </div>

        <RecentActivity fumigations={fumigations.slice(0, 12)} parcelById={parcelById} />
      </div>
    </div>
  )
}
