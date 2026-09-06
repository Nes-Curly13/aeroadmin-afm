import { AlertTriangle, ArrowLeft, CalendarClock, Droplets, FileSpreadsheet, FileText, History, Pencil, Plane, Plus, Sprout } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RedrawGeometryButton } from "@/components/admin/parcels/redraw-geometry-button"
import { FumigationTimeline } from "@/components/parcels/fumigation-timeline"
import { IntervalChart } from "@/components/parcels/interval-chart"
import { ParcelMap } from "@/components/parcels/parcel-map"
import { RegisterFumigationForm } from "@/components/parcels/register-fumigation-form"
import { AutoFocusFumigation } from "@/components/parcels/auto-focus-fumigation"
import { DataQualityBanner } from "@/components/data-quality/data-quality-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  NOW,
  STATUS_META,
  droneModel,
  getCycleForParcel,
  getFlightsByParcel,
  getFumigationsByParcel,
  getParcelSummary,
  getScheduleHistory,
} from "@/lib/data"
import { getActiveCycleForParcel, listEventsForCycle, listCyclesForParcel } from "@/api/repositories"
import { phaseChipClass, phaseLabel } from "@/lib/crop-cycle"
import { fmtDate, fmtDateTime, fmtDec, fmtHa, fmtInt, fmtLiters, fmtRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function ParcelaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const summary = await getParcelSummary(id)
  if (!summary) notFound()

  const { parcel, schedule } = summary
  // El id del parcel puede llegar como string ("abc") desde la URL;
  // los repos esperan number. Validamos acá para no tirar 500 si
  // el operador escribe un id mal en la barra.
  const parcelIdNum = Number(parcel.id)
  if (!Number.isFinite(parcelIdNum) || parcelIdNum <= 0) notFound()
  // Sprint 2026-08-01 — fetch de cycle data en paralelo con flights/fumigations.
  // `getCycleForParcel` degrada a {null, null} si la migration no se aplicó.
  // S11+ / Fase 4.5 — tambien fetch el ciclo activo desde la nueva tabla
  // `cycles` y su lista de eventos. Si la migration no se aplicó, los
  // helpers devuelven null/[] vacíos y la UI muestra estado "Sin ciclo".
  const [fumigations, flights, history, cycle, activeCycle, allCycles] = await Promise.all([
    getFumigationsByParcel(id),
    getFlightsByParcel(id),
    getScheduleHistory(id),
    getCycleForParcel(id),
    getActiveCycleForParcel(parcelIdNum).catch(() => null),
    listCyclesForParcel(parcelIdNum).catch(() => [])
  ])
  // Eventos del ciclo activo (si existe).
  const cycleEvents = activeCycle
    ? await listEventsForCycle(activeCycle.id).catch(() => [])
    : []
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
    {
      // F1 fix (2026-08-11): `dose_l_ha` ahora es `number | null`
      // (ver `lib/data.ts:adaptSchedule`). Antes hardcodeábamos
      // 2.0 y mostrábamos "2,0 L/ha" — el operador lo veía como
      // dato real y era un default ficticio. 95% del dataset DJI
      // histórico no tiene la dosis expuesta. Mostramos "—" con
      // un callout hasta que el backfill / captura se arregle.
      // Contexto completo: `docs/audit/DOSE_FIELDS_BACKFILL.md`.
      label: "Dosis",
      value: schedule.dose_l_ha != null
        ? `${fmtDec(schedule.dose_l_ha)} L/ha`
        : "— (DJI no expone este dato en este lote)"
    },
    { label: "Ventana horaria", value: `${schedule.window_start_hour}:00 – ${schedule.window_end_hour}:00` },
    { label: "Centroide", value: `${parcel.centroid_lat.toFixed(5)}, ${parcel.centroid_lng.toFixed(5)}` },
    { label: "dji_land_id", value: parcel.dji_land_id },
    { label: "Alta en sistema", value: fmtDate(parcel.created_at) },
  ]
  // Sprint 2026-08-04 — fix UX: para parcelas con source='manual' el
  // external_id es 'manual-{uuid}' y mostrar "dji_land_id" confunde al
  // operador (ese ID no existe en DJI). Ocultamos la fila entera en ese
  // caso. Misma condicion se podria haber implementado con un
  // `{parcel.source !== "manual" && (...)}` envolviendo el JSX, pero
  // como la fila viene del array `ficha`, filtrar aca es mas limpio
  // (no toca el JSX del map). El campo `parcel.source` se cablea
  // via DjiParcel (lib/types.ts) — el adapter V0 (lib/data.ts
  // adaptParcel) lo popula desde p.source, que viene de
  // djiParcelsQuery. Ver migration
  // 20260804081000_add_manual_parcels_support.sql para el schema.
  .filter((f) => !(f.label === "dji_land_id" && parcel.source === "manual"))

  return (
    <>
      {/* S11+ / Fase 3.C — breadcrumb Cliente → Finca → Parcela. */}
      <nav
        aria-label="Jerarquía de la parcela"
        className="border-b border-border bg-muted/30 px-4 py-2 text-xs sm:px-6"
      >
        <ol className="flex flex-wrap items-center gap-1.5 font-medium">
          <li>
            <Link
              href="/parcelas"
              className="text-muted-foreground hover:text-primary"
            >
              Parcelas
            </Link>
          </li>
          {parcel.client_name && (
            <>
              <li aria-hidden className="text-muted-foreground/50">/</li>
              <li>
                <span className="text-muted-foreground" title="Cliente (Fase 3.A)">
                  {parcel.client_name}
                </span>
              </li>
            </>
          )}
          {parcel.farm_name && (
            <>
              <li aria-hidden className="text-muted-foreground/50">/</li>
              <li>
                <span className="text-muted-foreground" title="Hacienda (Fase 3.A)">
                  {parcel.farm_name}
                </span>
              </li>
            </>
          )}
          <li aria-hidden className="text-muted-foreground/50">/</li>
          <li>
            <span className="font-semibold text-foreground" aria-current="page">
              {parcel.name}
            </span>
          </li>
        </ol>
      </nav>
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
              {/* Sprint 2026-08-01 — chip de fase de cultivo. Mismo patrón
                  visual que en parcels-table. Si no hay planting_date,
                  muestra "Fase: Desconocida" en gris. */}
              <Badge
                variant="outline"
                className={cn("gap-1.5 border text-[10px] font-medium", phaseChipClass(cycle.cycle_phase))}
                title={
                  cycle.cycle_phase
                    ? `Fase del cultivo: ${phaseLabel(cycle.cycle_phase)}`
                    : "Fase desconocida (faltan planting_date / cycle_phase en dji_parcels)"
                }
              >
                <Sprout className="size-3" aria-hidden />
                {`Fase: ${phaseLabel(cycle.cycle_phase)}`}
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
          {/* Sprint 2026-08-04 — entry-point al panel admin. La
              edición inline de client_name / farm_name / municipality /
              variety está en /admin/parcels (tabla con 4 inputs por
              row + Guardar). Desde acá el operador llega a la lista y
              puede usar el filtro "missing_X" para encontrar las
              parcelas con metadata incompleta. */}
          <div className="flex items-center gap-2">
            {/* feature/reports-level-1 (2026-08-08) — descarga de reportes.
                PDFs y CSVs usan `<a download>` (no Next Link) para que el
                browser gatille la descarga sin navegación. El server
                pone `Content-Disposition: attachment` con filename
                `reporte-{nombre}-parcela-{id}-{fecha}.{pdf|csv}`. */}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={`/api/admin/parcels/${parcelIdNum}/report.pdf`}
                  download
                  aria-label="Descargar reporte PDF de esta parcela"
                >
                  <FileText className="size-3.5" aria-hidden />
                  PDF
                </a>
              }
            />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={`/api/admin/parcels/${parcelIdNum}/report.csv`}
                  download
                  aria-label="Descargar reporte CSV de esta parcela"
                >
                  <FileSpreadsheet className="size-3.5" aria-hidden />
                  CSV
                </a>
              }
            />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link href="/admin/parcels" aria-label="Ir al panel admin para editar metadata">
                  <Pencil className="size-3.5" aria-hidden />
                  Editar metadata
                </Link>
              }
            />
          </div>
          {/* feature/reports-level-1 — callout que avisa al operador que
              puede exportar la data. Sin esto el feature existe pero es
              invisible para el que no sepa que el botón descarga un reporte. */}
          <p className="mt-1 text-right text-[11px] text-muted-foreground">
            {`Reportes disponibles — PDF y CSV con cadencia, fumigaciones, totales y mapa del lote.`}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        {/* S11+ / Fase 4.4.1 — banner de calidad de datos (admin-only,
            silencioso para supervisor que no tiene acceso al endpoint). */}
        <DataQualityBanner parcelaId={parcelIdNum} />
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

            {/* S11+ / Fase 4.5 — Ciclo Productivo actual + timeline. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sprout className="size-4 text-primary" aria-hidden />
                  Ciclo productivo
                </CardTitle>
                <CardDescription>
                  Ciclos de siembra → cosecha. Las fumigaciones se asocian al
                  ciclo activo.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeCycle ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono">
                        Ciclo #{activeCycle.id}
                      </Badge>
                      <span className="font-semibold">{fmtDate(activeCycle.start_date)}</span>
                      {activeCycle.end_date && (
                        <>
                          <span aria-hidden>→</span>
                          <span className="font-semibold">{fmtDate(activeCycle.end_date)}</span>
                          <Badge variant="secondary">cerrado</Badge>
                        </>
                      )}
                      {activeCycle.crop_type && (
                        <Badge variant="outline" className="text-[10px]">
                          {activeCycle.crop_type}
                          {activeCycle.variety ? ` · ${activeCycle.variety}` : ""}
                        </Badge>
                      )}
                      {activeCycle.data_validity === "needs_review" && (
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="mr-1 size-2.5" aria-hidden />
                          needs_review
                        </Badge>
                      )}
                    </div>
                    {activeCycle.notes && (
                      <p className="rounded-md border border-border bg-muted/40 p-2 text-xs italic text-muted-foreground">
                        {activeCycle.notes}
                      </p>
                    )}
                    {cycleEvents.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Eventos del ciclo
                        </p>
                        <ul className="space-y-1.5 border-l-2 border-border pl-3">
                          {cycleEvents.slice(0, 8).map((ev) => (
                            <li key={ev.id} className="flex items-center gap-2 text-xs">
                              <span className="font-mono tabular-nums text-muted-foreground">
                                {fmtDate(ev.event_date)}
                              </span>
                              <Badge variant="secondary" className="text-[10px]">
                                {ev.event_type}
                              </Badge>
                              {ev.fumigation_id && (
                                <span className="text-[10px] text-muted-foreground">
                                  → fumigación #{ev.fumigation_id}
                                </span>
                              )}
                            </li>
                          ))}
                          {cycleEvents.length > 8 && (
                            <li className="text-[10px] italic text-muted-foreground">
                              +{cycleEvents.length - 8} eventos más
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                    {allCycles.length > 1 && (
                      <p className="mt-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                        Esta parcela tiene {allCycles.length} ciclos en total. El actual
                        es el de más arriba. Ver histórico en /admin/parcels (próximo sprint).
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-2 py-2">
                    <p className="text-sm text-muted-foreground">
                      Esta parcela no tiene un ciclo activo. Las fumigaciones se
                      asocian al ciclo via dji_fumigations.cycle_id.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {fumigations.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={
                            <a
                              href="/admin/parcels"
                              aria-label="Asignar cliente y crear ciclo"
                            >
                              <Plus className="size-3.5" aria-hidden />
                              Asignar cliente + crear ciclo
                            </a>
                          }
                        />
                      )}
                    </div>
                    {fumigations.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Tip: correr el backfill híbrido desde la API
                        (<code className="rounded bg-muted px-1">POST /api/admin/cycles/backfill</code>)
                        para inferir ciclos desde el histórico de fumigaciones.
                      </p>
                    )}
                  </div>
                )}
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

            {/* Sprint 2026-08-02 — feature/manual-fumigation-ui.
                Cierra el gap #1 del QA review: antes el operador
                no podía registrar fumigaciones manuales. El form
                hace POST a /api/admin/fumigations. El client
                component hace router.refresh() al success para
                que el timeline de abajo se re-fetche. */}
            {/* Sub-sprint 3 (2026-08-04): si el URL tiene ?action=fumigar,
                scrollea al form y enfoca el primer input. Usado cuando
                el operador crea la parcela con "Fumigar inmediatamente". */}
            <AutoFocusFumigation />
            <Card id="fumigacion-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="size-4 text-primary" aria-hidden />
                  Registrar fumigación manual
                </CardTitle>
                <CardDescription>
                  Usa esto si DJI no reportó una fumigación que el
                  operador ya hizo (e.g. re-tratamiento, aplicación
                  manual de herbicida, fumigación fuera del rango de
                  fechas que DJI sincroniza). El ICA requiere los
                  campos de compliance abajo para auditoría.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RegisterFumigationForm parcelId={parcelIdNum} />
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

            {/* Sprint 2026-08-04 (sub-sprint 2) — entry-point para
                re-dibujar el polígono desde el detail page. Cierra el
                último gap del sub-sprint 1: el endpoint PATCH
                /api/admin/parcels/[id]/geometry ya existía pero solo
                se podía invocar via curl. Este Card vive al final del
                grid de Cards (right column) y abre un Dialog con el
                ParcelDrawer pre-cargado + textarea para change_reason.
                NO toqué los Cards existentes ni el <dl> del header. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pencil className="size-4 text-primary" aria-hidden />
                  Geometría — re-dibujo manual
                </CardTitle>
                <CardDescription>
                  Corregí el polígono si la forma de DJI no coincide con
                  el lote real. El cambio queda auditado en
                  djiag_audit_log.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RedrawGeometryButton
                  parcelId={Number(id)}
                  currentGeometry={parcel.geom}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
