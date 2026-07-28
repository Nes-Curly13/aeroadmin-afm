import { ArrowLeft, CalendarClock, Droplets, History, Plane, Sprout } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FumigationTimeline } from "@/components/parcels/fumigation-timeline"
import { IntervalChart } from "@/components/parcels/interval-chart"
import { ParcelMap } from "@/components/parcels/parcel-map"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  NOW,
  STATUS_META,
  droneModel,
  getFlightsByParcel,
  getFumigationsByParcel,
  getParcelSummary,
  getScheduleHistory,
} from "@/lib/data"
import { fmtDate, fmtDateTime, fmtDec, fmtHa, fmtInt, fmtLiters, fmtRelative } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function ParcelaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const summary = await getParcelSummary(id)
  if (!summary) notFound()

  const { parcel, schedule } = summary
  const fumigations = await getFumigationsByParcel(id)
  const flights = await getFlightsByParcel(id)
  const history = await getScheduleHistory(id)
  const meta = STATUS_META[summary.status]
  const model = droneModel(parcel.drone_model_id)

  const intervals = fumigations
    .slice(0, 13)
    .map((f, i) => {
      const prev = fumigations[i + 1]
      if (!prev) return null
      return {
        date: f.executed_at,
        gap: Math.round((new Date(f.executed_at).getTime() - new Date(prev.executed_at).getTime()) / 86_400_000),
      }
    })
    .filter((x): x is { date: string; gap: number } => x !== null)
    .reverse()

  const totalMinutes = flights.reduce((s, f) => s + f.duration_min, 0)
  const onTime = intervals.filter((p) => p.gap <= schedule.cadence_days + 2).length
  const compliance = intervals.length ? Math.round((onTime / intervals.length) * 100) : null
  const firstEvent = fumigations[fumigations.length - 1]
  const pilots = Array.from(new Set(flights.map((f) => f.pilot)))

  const stats = [
    { label: "Aplicaciones", value: fmtInt(summary.fumigations_count), icon: Droplets },
    { label: "Vuelos", value: fmtInt(summary.flights_count), icon: Plane },
    { label: "Ha tratadas (acum.)", value: fmtHa(summary.total_area_treated_ha), icon: Sprout },
    { label: "Volumen acumulado", value: fmtLiters(summary.total_volume_l), icon: Droplets },
  ]

  const ficha: { label: string; value: string }[] = [
    { label: "Cliente", value: parcel.client_name },
    { label: "Hacienda", value: parcel.farm_name },
    { label: "Municipio", value: parcel.municipality },
    { label: "Variedad", value: parcel.variety },
    { label: "Área catastral", value: fmtHa(parcel.area_ha) },
    { label: "Equipo asignado", value: `${model.name} · ${model.tank_l} L` },
    { label: "Producto", value: schedule.product },
    { label: "Dosis", value: `${fmtDec(schedule.dose_l_ha)} L/ha` },
    { label: "Ventana horaria", value: `${schedule.window_start_hour}:00 – ${schedule.window_end_hour}:00` },
    { label: "Centroide", value: `${parcel.centroid_lat.toFixed(5)}, ${parcel.centroid_lng.toFixed(5)}` },
    { label: "dji_land_id", value: parcel.dji_land_id },
    { label: "Alta en sistema", value: fmtDate(parcel.created_at) },
  ]

  return (
    <>
      <header className="border-b border-border bg-card px-4 py-5 sm:px-6">
        <Link
          href="/parcelas"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Volver al inventario
        </Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{parcel.name}</h1>
              <Badge variant="outline" className="gap-1.5 border-border">
                <span className="size-2 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                {meta.label}
              </Badge>
              {!parcel.is_active && <Badge variant="secondary">Inactiva</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {`${parcel.client_name} · ${parcel.farm_name} · ${parcel.municipality}`}
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Última aplicación</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums">
                {fmtDate(summary.last_fumigation_at)}
                <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                  {fmtRelative(summary.last_fumigation_at)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Próxima programada</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums">
                {fmtDate(summary.next_due_at)}
                {summary.days_to_due !== null && (
                  <span
                    className="ml-1.5 font-sans text-xs font-normal"
                    style={{ color: summary.days_to_due < 0 ? meta.color : undefined }}
                  >
                    {summary.days_to_due >= 0 ? `en ${summary.days_to_due} d` : `${Math.abs(summary.days_to_due)} d de atraso`}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-start justify-between gap-2 p-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
                </div>
                <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              </CardContent>
            </Card>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Geometría y vuelos</CardTitle>
                <CardDescription>
                  {`Polígono PostGIS (EPSG:4326) con ${fmtInt(flights.length)} sorties georreferenciados.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ParcelMap
                  geom={parcel.geom}
                  color={meta.color}
                  flights={flights.map((f) => ({ id: f.id, lng: f.lng, lat: f.lat, pilot: f.pilot }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Ficha técnica</CardTitle>
                <CardDescription>Atributos planos de dji_parcels y su cadencia esperada.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {ficha.map((f) => (
                    <div key={f.label} className="border-b border-border/60 pb-2">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                      <dd className="mt-0.5 font-medium text-foreground">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Ritmo de aplicación</CardTitle>
                    <CardDescription>
                      {`Intervalo real entre aplicaciones frente a la cadencia de ${schedule.cadence_days} días.`}
                    </CardDescription>
                  </div>
                  {compliance !== null && (
                    <div className="text-right">
                      <p className="font-mono text-2xl font-bold tabular-nums text-primary">{`${compliance}%`}</p>
                      <p className="text-[11px] text-muted-foreground">en ventana</p>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <IntervalChart points={intervals} cadenceDays={schedule.cadence_days} />
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Intervalo medio</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums">
                      {summary.avg_interval_days !== null ? `${fmtDec(summary.avg_interval_days)} d` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Horas de vuelo</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums">{`${fmtDec(totalMinutes / 60)} h`}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Pilotos</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums">{fmtInt(pilots.length)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4 text-primary" aria-hidden />
                  Historial de trabajos
                </CardTitle>
                <CardDescription>
                  {firstEvent
                    ? `${fmtInt(fumigations.length)} aplicaciones registradas desde ${fmtDate(firstEvent.executed_at)}.`
                    : "Sin registros."}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[32rem] overflow-y-auto">
                <FumigationTimeline
                  fumigations={fumigations}
                  flights={flights}
                  cadenceDays={schedule.cadence_days}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="size-4 text-primary" aria-hidden />
                  Cambios de cadencia
                </CardTitle>
                <CardDescription>dji_fumigation_schedule_history — auditoría por triggers.</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    La cadencia no ha cambiado desde el alta.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {history.map((h) => (
                      <li key={h.id} className="flex flex-col gap-1 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {fmtDate(h.changed_at)}
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">
                            {`${h.old_cadence_days ?? "—"} d → ${h.new_cadence_days} d`}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {h.changed_by}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">{h.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                  {`Cadencia vigente actualizada el ${fmtDateTime(schedule.updated_at)} · consulta al ${fmtDateTime(
                    NOW.toISOString(),
                  )}`}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
