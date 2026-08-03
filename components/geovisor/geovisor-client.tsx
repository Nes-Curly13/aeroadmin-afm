"use client"

import { ArrowUpRight, Droplets, Layers, MapPin, Plane, Search, SlidersHorizontal, Sprout } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { type BaseMap, GeoMap, USE_MAPTILER, type MapParcel } from "@/components/map/geo-map"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { DRONE_MODELS, STATUS_META } from "@/lib/data-constants"
import { fmtDec, fmtInt, fmtLiters, fmtRelative, SOURCE_LABEL } from "@/lib/format"
import type { GeovisorPayload } from "@/lib/types"
import type { ComplianceStatus, FumigationSource } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_ORDER: ComplianceStatus[] = ["critico", "vencido", "por_vencer", "al_dia"]
const SOURCES: FumigationSource[] = ["djiscraper", "import", "manual"]

export function GeovisorClient({ payload }: { payload: GeovisorPayload }) {
  // S8.8 (2026-07-31): sin VENTANA TEMPORAL, from/to es el rango natural
  // de los datos (min/max de executed_at). Filtrar por un rango manual
  // no aportaba a la UX del operador.
  const { from, to } = useMemo(() => {
    if (payload.events.length === 0) return { from: 0, to: Date.now() }
    const times = payload.events.map((e) => new Date(e.executed_at).getTime())
    return { from: Math.min(...times), to: Math.max(...times) }
  }, [payload.events])
  const [client, setClient] = useState("todos")
  const [farm, setFarm] = useState("todas")
  const [model, setModel] = useState("todos")
  const [statuses, setStatuses] = useState<ComplianceStatus[]>([])
  const [sources, setSources] = useState<FumigationSource[]>([])
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // s8.8 (2026-07-31): id del event (fumigacion) seleccionado en el mapa.
  // Cuando se setea, GeoMap muestra un popup MapLibre con el detalle.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [baseMap, setBaseMap] = useState<BaseMap>("satelite")
  const [showParcels, setShowParcels] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const clients = useMemo(() => Array.from(new Set(payload.parcels.map((p) => p.client_name))).sort(), [payload])
  const farms = useMemo(
    () =>
      Array.from(
        new Set(
          payload.parcels.filter((p) => client === "todos" || p.client_name === client).map((p) => p.farm_name),
        ),
      ).sort(),
    [payload, client],
  )

  // S8.8 (2026-07-31): from/to vienen del useMemo arriba (rango natural
  // de los datos). Sin ventana temporal para filtrar, mostramos todos
  // los eventos del periodo disponible.
  const filteredParcels = useMemo(
    () =>
      payload.parcels.filter((p) => {
        if (client !== "todos" && p.client_name !== client) return false
        if (farm !== "todas" && p.farm_name !== farm) return false
        if (model !== "todos" && String(p.drone_model_id) !== model) return false
        if (statuses.length > 0 && !statuses.includes(p.status)) return false
        if (query.trim()) {
          const q = query.trim().toLowerCase()
          const hay = `${p.name} ${p.farm_name} ${p.client_name} ${p.municipality} ${p.variety} ${p.id}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      }),
    [payload.parcels, client, farm, model, statuses, query],
  )

  const parcelIds = useMemo(() => new Set(filteredParcels.map((p) => p.id)), [filteredParcels])

  const filteredEvents = useMemo(
    () =>
      payload.events.filter((e) => {
        if (!parcelIds.has(e.parcel_id)) return false
        if (sources.length > 0 && !sources.includes(e.source)) return false
        const t = new Date(e.executed_at).getTime()
        return t >= from && t <= to
      }),
    [payload.events, parcelIds, sources, from, to],
  )

  const eventsByParcel = useMemo(() => {
    const map = new Map<string, { count: number; ha: number; volume: number; flights: number; last: string | null }>()
    for (const e of filteredEvents) {
      const cur = map.get(e.parcel_id) ?? { count: 0, ha: 0, volume: 0, flights: 0, last: null }
      cur.count += 1
      cur.ha += e.area_treated_ha
      cur.volume += e.volume_l
      cur.flights += e.flights_count
      if (!cur.last || e.executed_at > cur.last) cur.last = e.executed_at
      map.set(e.parcel_id, cur)
    }
    return map
  }, [filteredEvents])

  const mapParcels: MapParcel[] = useMemo(
    () =>
      filteredParcels.map((p) => {
        const agg = eventsByParcel.get(p.id)
        return {
          id: p.id,
          name: p.name,
          farm_name: p.farm_name,
          client_name: p.client_name,
          area_ha: p.area_ha,
          status: p.status,
          geom: p.geom,
          centroid_lng: p.centroid_lng,
          centroid_lat: p.centroid_lat,
          events_in_range: agg?.count ?? 0,
          ha_in_range: agg ? Math.round(agg.ha * 10) / 10 : 0,
        }
      }),
    [filteredParcels, eventsByParcel],
  )

  const kpis = useMemo(() => {
    const ha = filteredEvents.reduce((s, e) => s + e.area_treated_ha, 0)
    const volume = filteredEvents.reduce((s, e) => s + e.volume_l, 0)
    const flights = filteredEvents.reduce((s, e) => s + e.flights_count, 0)
    return { events: filteredEvents.length, ha, volume, flights, parcels: eventsByParcel.size }
  }, [filteredEvents, eventsByParcel])

  const selected = filteredParcels.find((p) => p.id === selectedId) ?? null
  const selectedAgg = selectedId ? eventsByParcel.get(selectedId) : undefined

  const sortedList = useMemo(
    () =>
      [...filteredParcels].sort((a, b) => {
        const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        if (s !== 0) return s
        return (eventsByParcel.get(b.id)?.count ?? 0) - (eventsByParcel.get(a.id)?.count ?? 0)
      }),
    [filteredParcels, eventsByParcel],
  )

  const toggle = <T,>(list: T[], value: T, setter: (v: T[]) => void) =>
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  return (
    <div className="flex h-svh flex-col lg:flex-row">
      {/* Rail de filtros */}
      <aside
        className={cn(
          "flex shrink-0 flex-col gap-5 overflow-y-auto border-b border-border bg-card p-4 lg:border-b-0 lg:border-r",
          showFilters ? "lg:w-76" : "lg:w-0 lg:overflow-hidden lg:border-r-0 lg:p-0",
        )}
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-bold tracking-tight">Filtros</h2>
          <Badge variant="secondary" className="ml-auto font-mono">
            {filteredParcels.length} parcelas
          </Badge>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar suerte, hacienda, variedad…"
            aria-label="Buscar parcela"
            className="pl-8"
          />
        </div>

        <FieldSelect
          label="Cliente / Ingenio"
          value={client}
          onChange={(e) => {
            setClient(e.target.value)
            setFarm("todas")
          }}
        >
          <option value="todos">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FieldSelect>

        <FieldSelect label="Hacienda" value={farm} onChange={(e) => setFarm(e.target.value)}>
          <option value="todas">Todas las haciendas</option>
          {farms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </FieldSelect>

        <FieldSelect label="Modelo de dron asignado" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="todos">Todos los modelos</option>
          {DRONE_MODELS.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}
            </option>
          ))}
        </FieldSelect>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estado de cadencia
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.map((s) => {
              const active = statuses.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(statuses, s, setStatuses)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active ? "border-transparent bg-foreground text-background" : "border-border hover:bg-muted",
                  )}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: STATUS_META[s].color }}
                    aria-hidden
                  />
                  {STATUS_META[s].label}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Origen del registro
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map((s) => {
              const active = sources.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(sources, s, setSources)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active ? "border-transparent bg-foreground text-background" : "border-border hover:bg-muted",
                  )}
                >
                  {SOURCE_LABEL[s]}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="size-3.5" aria-hidden /> Capas
          </legend>
          <div className="flex flex-col gap-1.5">
            {(
              [
                // S8.8 (2026-07-31): cada capa muestra su simbologia real
                // (color de relleno, punto, glyph) para que el operador
                // entienda que es cada toggle sin abrir el mapa. Los
                // colores matchean geo-map.tsx:
                //   - critico: #c0392b (rojo) — representativo del color
                //     de poligono critico (cambia por status real del parcel)
                //   - eventos: #f5e839 (amarillo) — events-circle paint
                //   - labels: text-glyph "Aa"
                {
                  label: "Polígonos de parcelas",
                  value: showParcels,
                  set: setShowParcels,
                  sym: (
                    <span
                      className="size-3.5 rounded-sm border border-foreground/20"
                      style={{ backgroundColor: STATUS_META.critico.color }}
                      aria-hidden
                    />
                  ),
                },
                {
                  label: "Aplicaciones en el rango",
                  value: showEvents,
                  set: setShowEvents,
                  sym: (
                    <span
                      className="size-3.5 rounded-full border border-foreground/30"
                      style={{ backgroundColor: "#f5e839" }}
                      aria-hidden
                    />
                  ),
                },
                {
                  label: "Etiquetas de suerte",
                  value: showLabels,
                  set: setShowLabels,
                  sym: (
                    <span
                      className="grid size-3.5 place-items-center rounded-sm border border-foreground/30 bg-card text-[8px] font-bold leading-none text-foreground/70"
                      aria-hidden
                    >
                      Aa
                    </span>
                  ),
                },
              ] as const
            ).map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => l.set(!l.value)}
                aria-pressed={l.value}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  {l.sym}
                  <span>{l.label}</span>
                </span>
                <span
                  className={cn(
                    "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                    l.value ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full bg-card transition-transform",
                      l.value && "translate-x-3",
                    )}
                  />
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mapa base
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                // S8.7 (v2.6): selector de 4 basemaps. hibrido + topo solo
                // disponibles cuando USE_MAPTILER=true (requieren MapTiler
                // vector styles con labels / curvas de nivel). En fallback
                // (sin key), solo satelite y calles son relevantes.
                ["satelite", "Satélite"],
                ["hibrido", "Híbrido"],
                ["calles", "Calles"],
                ["topo", "Topo"],
              ] as [BaseMap, string][]
            )
              .filter(([value]) => USE_MAPTILER || value === "satelite" || value === "calles")
              .map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={baseMap === value ? "default" : "outline"}
                  onClick={() => setBaseMap(value)}
                >
                  {label}
                </Button>
              ))}
          </div>
        </fieldset>
      </aside>

      {/* Mapa */}
      <section className="relative min-h-[60svh] flex-1">
        <GeoMap
          parcels={mapParcels}
          events={filteredEvents
            .filter((e): e is typeof e & { lng: number; lat: number } =>
              // s8.8 (2026-07-31): solo eventos con coordenadas validas
              // (centroide de flights calculado en getRecentFumigations).
              // Si no hay flights asociados, el evento se oculta.
              typeof e.lng === "number" && typeof e.lat === "number"
            )
            .map((e) => ({
              id: e.id,
              lng: e.lng,
              lat: e.lat,
              parcel_id: e.parcel_id,
              executed_at: e.executed_at,
              area_treated_ha: e.area_treated_ha,
              product: e.product,
              volume_l: e.volume_l,
              operator: e.operator,
              flights_count: e.flights_count,
              notes: e.notes,
              source: e.source,
              n_matched_flights: e.n_matched_flights ?? null,
            }))}
          showParcels={showParcels}
          showEvents={showEvents}
          showLabels={showLabels}
          baseMap={baseMap}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selectedEventId={selectedEventId}
          onSelectEvent={setSelectedEventId}
        />

        {/* KPIs de la ventana temporal */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-2">
          <div className="pointer-events-auto flex flex-wrap items-stretch divide-x divide-border overflow-hidden rounded-md border border-border bg-card/95 shadow-sm backdrop-blur">
            {[
              { icon: Sprout, label: "Aplicaciones", value: fmtInt(kpis.events) },
              { icon: MapPin, label: "Hectáreas tratadas", value: `${fmtDec(kpis.ha)} ha` },
              { icon: Droplets, label: "Volumen", value: fmtLiters(kpis.volume) },
              { icon: Plane, label: "Vuelos", value: fmtInt(kpis.flights) },
            ].map((k) => (
              <div key={k.label} className="flex items-center gap-2.5 px-3 py-2">
                <k.icon className="size-4 text-primary" aria-hidden />
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</span>
                  <span className="tabular font-mono text-sm font-bold">{k.value}</span>
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto hidden bg-card/95 backdrop-blur lg:inline-flex"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" />
            {showFilters ? "Ocultar filtros" : "Mostrar filtros"}
          </Button>
        </div>

        {/* Leyenda */}
        <div className="absolute bottom-28 left-3 rounded-md border border-border bg-card/95 p-2.5 shadow-sm backdrop-blur sm:bottom-32">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cadencia de fumigación
          </p>
          <ul className="flex flex-col gap-1">
            {STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2 text-xs">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: STATUS_META[s].color }} aria-hidden />
                {STATUS_META[s].label}
              </li>
            ))}
          </ul>
        </div>

        {/* S8.8 (2026-07-31): VENTANA TEMPORAL removida. No aportaba
            a la UX del operador; filtramos por el rango natural de los
            datos (ver from/to arriba). Si en el futuro se quiere
            re-introducir, el componente TimeRange sigue en
            components/geovisor/time-range.tsx listo para usar. */}
      </section>

      {/* Panel de resultados */}
      <aside className="flex shrink-0 flex-col border-t border-border bg-card lg:w-84 lg:border-l lg:border-t-0">
        {selected ? (
          <div className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{selected.farm_name}</p>
                <h3 className="text-base font-bold tracking-tight">{selected.name}</h3>
              </div>
              <Badge
                className="shrink-0 text-background"
                style={{ backgroundColor: STATUS_META[selected.status].color }}
              >
                {STATUS_META[selected.status].label}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              {[
                ["Área", `${fmtDec(selected.area_ha)} ha`],
                ["Variedad", selected.variety],
                ["Cadencia", `${selected.cadence_days} días`],
                ["Última aplic.", fmtRelative(selected.last_fumigation_at)],
                ["En el rango", `${selectedAgg?.count ?? 0} aplicaciones`],
                ["Ha en el rango", `${fmtDec(selectedAgg?.ha ?? 0)} ha`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                  <dd className="font-mono font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <Button render={<Link href={`/parcelas/${selected.id}`} />} size="sm" className="w-full">
              Ver hoja de vida
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="border-b border-border p-4">
            <h3 className="text-sm font-bold tracking-tight">Parcelas en el filtro</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Haz clic en un polígono del mapa o en la lista para ver el detalle y la hoja de vida.
            </p>
          </div>
        )}

        <ul className="flex-1 divide-y divide-border overflow-y-auto lg:max-h-none max-h-72">
          {sortedList.map((p) => {
            const agg = eventsByParcel.get(p.id)
            const active = p.id === selectedId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : p.id)}
                  className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted", active && "bg-muted")}
                >
                  <span
                    className="mt-0.5 size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: STATUS_META[p.status].color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.farm_name} · {fmtDec(p.area_ha)} ha
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block font-mono text-sm font-bold">{agg?.count ?? 0}</span>
                    <span className="block text-[10px] uppercase text-muted-foreground">aplic.</span>
                  </span>
                </button>
              </li>
            )
          })}
          {sortedList.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">No hay parcelas que cumplan los filtros.</li>
          )}
        </ul>
      </aside>
    </div>
  )
}
