"use client";

/**
 * GeovisorClient — vista principal del geovisor (QA-02, 2026-09-06).
 *
 * Historia del archivo:
 *   - S8.8 (2026-07-31): primera versión completa con cadencia,
 *     status, cliente, hacienda, modelo, source, ventana temporal
 *     derivada del rango natural de los datos.
 *   - QA-02 (2026-09-06, fix/qa-02-geovisor-simplify): rediseño
 *     alineado con la decisión del operador fumigador. La utilidad
 *     principal del geovisor es "consultar el histórico de
 *     fumigaciones realizadas sobre las parcelas". Se eliminan los
 *     filtros que el operador no considera útiles (cadencia, crítico,
 *     vencido, cliente, hacienda, drone, source) y se mantiene solo
 *     lo que aporta valor de consulta:
 *       1. Rango temporal manual (Desde / Hasta)
 *       2. Búsqueda por texto (suerte, hacienda, municipio, etc.)
 *       3. Capas (polígonos, eventos, labels)
 *       4. Basemap (satélite / híbrido / calles)
 *     Se reemplaza la lista de parcelas del sidebar derecho por una
 *     lista de FUMIGACIONES ordenada por fecha DESC, con click para
 *     centrar el mapa y abrir el popup de la aplicación.
 *
 * Decisiones de diseño UX:
 *   - **Rango temporal con defaults sensatos**: arranca en los
 *     últimos 90 días (vs los 700+ días del dataset completo). El
 *     operador fumigador trabaja en ventanas cortas; ver 2 años de
 *     eventos satura el mapa sin aportar.
 *   - **Lista de eventos, no de parcelas**: la consulta es
 *     "qué se fumigó", no "qué parcelas hay". Cada item muestra
 *     parcela, fecha, área aplicada, producto, fuente (DJI / manual /
 *     import).
 *   - **Click en evento → flyTo + popup**: la acción esperada al
 *     ver una fumigación en la lista es "mostrame dónde fue". El
 *     flyTo centra el mapa en el centroide de la parcela y abre
 *     el popup MapLibre con el detalle.
 *   - **KPIs resumidos arriba**: Fumigaciones / Parcelas tratadas /
 *     Área aplicada / Última fumigación. Mismo set que la lista
 *     que el operador quiere consultar.
 *
 * Compatibilidad:
 *   - El contrato del componente (`payload: GeovisorPayload`) NO
 *     cambia. La página server (`app/(auth)/geovisor/page.tsx`)
 *     sigue funcionando.
 *   - El `GeoMap` que recibe el componente no cambia. Solo se filtra
 *     `payload.events` por rango temporal y se filtra
 *     `payload.parcels` a las que tienen eventos en el rango.
 *   - Los fields `status`, `cadence_days`, `next_due_at` del payload
 *     SIGUEN EXISTIENDO en el type (porque `getGeovisorPayload` los
 *     trae de `dji_parcels`), pero ya no se renderizan en la UI.
 *     Limpiar el payload es una tarea separada.
 */

import { ArrowUpRight, Droplets, Layers, List, MapPin, Plane, Search, SlidersHorizontal, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ParcelPanel } from "@/components/geovisor/parcel-panel";
import { AssignParcelDialog } from "@/components/fumigations/assign-parcel-dialog";
import { SidebarBoxes } from "@/components/geovisor/sidebar-boxes";
import { type BaseMap, GeoMap, USE_MAPTILER, type MapParcel } from "@/components/map/geo-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtDec, fmtInt, fmtLiters, SOURCE_LABEL } from "@/lib/format";
import { MAP_COLORS } from "@/lib/map-palette";
import type { GeovisorPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Días por default para el rango temporal inicial. */
const DEFAULT_DAYS_BACK = 90;

function isoDate(d: Date): string {
  // Formato YYYY-MM-DD en timezone local (Bogota). El input type="date"
  // espera este formato.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalISODate(s: string): number | null {
  // Parsea YYYY-MM-DD como medianoche local. Date.parse("2026-09-06")
  // lo trata como UTC midnight, lo cual da medianoche en Bogota del
  // día ANTERIOR. Para evitar ese drift, parseamos a mano.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d).getTime();
}

export function GeovisorClient({
  payload,
  canAssign = false
}: {
  payload: GeovisorPayload;
  canAssign?: boolean;
}) {
  // QA-02 (2026-09-06): rango temporal con defaults sensatos.
  // Última fumigación conocida (si hay) o hoy.
  const lastEventMs = useMemo(() => {
    if (payload.events.length === 0) return Date.now();
    return Math.max(...payload.events.map((e) => new Date(e.executed_at).getTime()));
  }, [payload.events]);
  const [fromDate, setFromDate] = useState<string>(
    isoDate(new Date(lastEventMs - DEFAULT_DAYS_BACK * 86_400_000))
  );
  const [toDate, setToDate] = useState<string>(isoDate(new Date(lastEventMs)));

  // QA-02: solo búsqueda por texto. Sin filtros de cadencia, status,
  // cliente, hacienda, drone, source.
  const [query, setQuery] = useState("");

  const [baseMap, setBaseMap] = useState<BaseMap>("satelite");
  const [showParcels, setShowParcels] = useState(true);

  // UI-M1 (auditoría UI 2026-09-21): el mapa es la **capa base**
  // full-bleed (`absolute inset-0`). Filtros y eventos son overlays
  // flotantes (`absolute`, z-20). En desktop arrancan abiertos; en
  // mobile cerrados (mapa limpio, se abren desde los toggles).
  // Reemplaza al layout de 3 paneles redimensionables de PR-3b, que
  // repartía el ancho 22% / 52% / 26% y dejaba al mapa como una celda más.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(true);
  // Al determinar el breakpoint, abrimos los overlays solo en desktop.
  useEffect(() => {
    setFiltersOpen(isDesktop);
    setEventsOpen(isDesktop);
  }, [isDesktop]);

  const [showEvents, setShowEvents] = useState(true);
  const [showLabels, setShowLabels] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // QA-02: el id del EVENTO (fumigación) seleccionado desde la lista
  // o desde el mapa. Cuando se setea, el mapa centra en la parcela +
  // abre el popup del evento.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Rango temporal como timestamps (ms). Si el usuario tipea algo
  // inválido, parseLocalISODate devuelve null y usamos null en el
  // filtro (= sin restricción de ese lado).
  const fromMs = parseLocalISODate(fromDate);
  const toMs = useMemo(() => {
    const base = parseLocalISODate(toDate);
    if (base == null) return null;
    // Inclusivo: incluimos eventos hasta el final del día "to".
    return base + 86_400_000 - 1;
  }, [toDate]);

  // Filtrar eventos por rango temporal.
  const eventsInRange = useMemo(() => {
    return payload.events.filter((e) => {
      const t = new Date(e.executed_at).getTime();
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t > toMs) return false;
      return true;
    });
  }, [payload.events, fromMs, toMs]);

  // 2026-09-17 — el geovisor antes mostraba solo parcelas CON eventos
  // de fumigación en el rango. Con la base recién cargada (solo shapes,
  // sin fumigaciones) eso dejaba el mapa sin polígonos. Ahora muestra
  // TODAS las parcelas del payload; la búsqueda de texto sigue filtrando.
  const filteredParcels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payload.parcels.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.farm_name} ${p.municipality} ${p.variety} ${p.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [payload.parcels, query]);

  const filteredParcelsById = useMemo(
    () => new Map(filteredParcels.map((p) => [p.id, p])),
    [filteredParcels]
  );

  // QA-02: lista de fumigaciones ordenada por fecha DESC. Cada
  // fumigación muestra: nombre de la parcela, fecha, área aplicada,
  // producto, fuente.
  const sortedEvents = useMemo(
    () =>
      [...eventsInRange]
        .filter(
          (e) =>
            filteredParcelsById.has(e.parcel_id) ||
            e.needs_parcel_assignment === true
        )
        .sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime()),
    [eventsInRange, filteredParcelsById]
  );

  // Resumen por parcela para el mapa.
  const eventsByParcel = useMemo(() => {
    const map = new Map<string, { count: number; ha: number; volume: number; flights: number; last: string | null }>();
    for (const e of eventsInRange) {
      if (!filteredParcelsById.has(e.parcel_id)) continue;
      const cur = map.get(e.parcel_id) ?? { count: 0, ha: 0, volume: 0, flights: 0, last: null };
      cur.count += 1;
      cur.ha += e.area_treated_ha;
      cur.volume += e.volume_l;
      cur.flights += e.flights_count;
      if (!cur.last || e.executed_at > cur.last) cur.last = e.executed_at;
      map.set(e.parcel_id, cur);
    }
    return map;
  }, [eventsInRange, filteredParcelsById]);

  // Parcelas en formato MapParcel para el mapa.
  const mapParcels: MapParcel[] = useMemo(
    () =>
      filteredParcels.map((p) => {
        const agg = eventsByParcel.get(p.id);
        return {
          id: p.id,
          name: p.name,
          farm_name: p.farm_name,
          client_name: p.client_name,
          area_ha: p.area_ha,
          // QA-02: status ya no se muestra en el mapa. Pasamos
          // "al_dia" como neutral para que el color de relleno no
          // confunda al operador. Los polígonos se pintan con el
          // verde de "al dia" por default; el evento amarillo
          // (events-circle) es el indicador visual principal.
          status: "al_dia" as const,
          geom: p.geom,
          centroid_lng: p.centroid_lng,
          centroid_lat: p.centroid_lat,
          events_in_range: agg?.count ?? 0,
          ha_in_range: agg ? Math.round(agg.ha * 10) / 10 : 0
        };
      }),
    [filteredParcels, eventsByParcel]
  );

  // QA-02: KPIs simplificados. Aplicaciones (cantidad), Parcelas
  // tratadas (count único), Área aplicada (suma), Última fumigación
  // (max executed_at).
  const kpis = useMemo(() => {
    const last = sortedEvents[0]?.executed_at ?? null;
    return {
      events: sortedEvents.length,
      parcels: eventsByParcel.size,
      ha: sortedEvents.reduce((s, e) => s + e.area_treated_ha, 0),
      last
    };
  }, [sortedEvents, eventsByParcel]);

  // Evento seleccionado: si hay, derivamos su parcela para el card
  // del sidebar.
  const selectedEvent = useMemo(
    () => sortedEvents.find((e) => e.id === selectedEventId) ?? null,
    [sortedEvents, selectedEventId]
  );
  const selectedEventParcel = selectedEvent
    ? filteredParcelsById.get(selectedEvent.parcel_id) ?? null
    : null;

  // QA-02: cuando el usuario hace click en un item de la lista,
  // centramos el mapa en la parcela y abrimos el popup. El componente
  // `GeoMap` acepta `selectedEventId` y abre el popup en el feature
  // del source "events". Para centrar el mapa, hacemos flyTo al
  // centroide de la parcela.
  function handleEventClick(eventId: string) {
    const ev = sortedEvents.find((e) => e.id === eventId);
    if (!ev) return;
    setSelectedEventId(eventId);
    setSelectedId(ev.parcel_id);
  }

  // Si el usuario cambia el rango temporal y el evento seleccionado
  // queda fuera del rango, lo limpiamos.
  useEffect(() => {
    if (!selectedEventId) return;
    if (!sortedEvents.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [selectedEventId, sortedEvents]);

  // Card-resumen cuando hay evento seleccionado: incluye los datos
  // del V0 que el operador quiere ver.
  // 2026-09-19 — parcela seleccionada en el mapa (panel A del geovisor).
  // Cómputo plano (sin hook) para no alterar el orden de hooks del
  // componente: hay `return` tempranos más arriba.
  const selectedParcel = selectedId
    ? payload.parcels.find((p) => p.id === selectedId) ?? null
    : null;

  const selectedCardData = selectedEvent ? {
    event: selectedEvent,
    parcel: selectedEventParcel
  } : null;

  return (
    // UI-M1: el geovisor es un workbench canvas-first. El mapa llena el
    // contenedor; los paneles flotan encima y no compiten por el layout.
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* Filtros — overlay flotante */}
      <aside
        aria-label="Filtros del geovisor"
        className={cn(
          "absolute bottom-3 left-3 top-20 z-20 w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur",
          filtersOpen ? "flex" : "hidden"
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
            data-testid="geovisor-search"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Desde
            </span>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="Fecha desde"
              data-testid="geovisor-from"
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Hasta
            </span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="Fecha hasta"
              data-testid="geovisor-to"
              className="text-xs"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="size-3.5" aria-hidden /> Capas
          </legend>
          <div className="flex flex-col gap-1.5">
            {(
              [
                {
                  label: "Polígonos de parcelas",
                  value: showParcels,
                  set: setShowParcels,
                  sym: (
                    <span
                      className="size-3.5 rounded-sm border border-foreground/20"
                      style={{ backgroundColor: MAP_COLORS.parcel }}
                      aria-hidden
                    />
                  )
                },
                {
                  label: "Aplicaciones en el rango",
                  value: showEvents,
                  set: setShowEvents,
                  sym: (
                    <span
                      className="size-3.5 rounded-sm border border-foreground/30"
                      style={{ backgroundColor: MAP_COLORS.event }}
                      aria-hidden
                    />
                  )
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
                  )
                }
              ] as const
            ).map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => l.set(!l.value)}
                aria-pressed={l.value}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex items-center gap-2">
                  {l.sym}
                  <span>{l.label}</span>
                </span>
                <span
                  className={cn(
                    "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                    l.value ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full bg-card transition-transform",
                      l.value && "translate-x-3"
                    )}
                  />
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Leyenda
          </legend>
          <ul className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded" style={{ backgroundColor: MAP_COLORS.parcel }} aria-hidden />
              Parcela (borde ámbar)
            </li>
            <li className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: MAP_COLORS.event, opacity: 0.5 }} aria-hidden />
              Fumigación (relleno cian)
            </li>
            <li className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-sm border border-dashed"
                style={{ backgroundColor: MAP_COLORS.orphan, opacity: 0.5, borderColor: MAP_COLORS.orphanLine }}
                aria-hidden
              />
              Sin asignar (magenta, borde punteado)
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded" style={{ backgroundColor: MAP_COLORS.parcelSelected }} aria-hidden />
              Parcela seleccionada (azul)
            </li>
          </ul>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mapa base
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["satelite", "Satélite"],
                ["hibrido", "Híbrido"],
                ["calles", "Calles"],
                ["topo", "Topo"]
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

      {/* Mapa — capa base full-bleed */}
      <div className="absolute inset-0">
        <GeoMap
          parcels={mapParcels}
          events={sortedEvents
            .filter(
              (e) =>
                e.hull != null ||
                (typeof e.lng === "number" && typeof e.lat === "number")
            )
            .map((e) => ({
              id: e.id,
              lng: e.lng ?? null,
              lat: e.lat ?? null,
              // 2026-09-16 — polígono (hull de los vuelos). El mapa lo
              // dibuja como área; si falta, cae al punto lng/lat.
              hull: e.hull ?? null,
              // 2026-09-17 — dron real (nickname del vuelo).
              drone_nickname: e.drone_nickname ?? null,
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
              is_orphan: e.needs_parcel_assignment === true,
              assignment_note: e.assignment_note ?? null
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

        {/* QA-02: KPIs simplificados — Fumigaciones / Parcelas / Área / Última */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-wrap items-start gap-2">
          <div className="pointer-events-auto flex flex-wrap items-stretch divide-x divide-border overflow-hidden rounded-md border border-border bg-card/95 shadow-sm backdrop-blur">
            {[
              { icon: Sprout, label: "Fumigaciones", value: fmtInt(kpis.events) },
              { icon: MapPin, label: "Parcelas tratadas", value: fmtInt(kpis.parcels) },
              { icon: Droplets, label: "Área aplicada", value: `${fmtDec(kpis.ha)} ha` },
              {
                icon: Plane,
                label: "Última aplicación",
                value: kpis.last ? fmtDate(kpis.last) : "—"
              }
            ].map((k) => (
              <div key={k.label} className="flex items-center gap-2.5 px-3 py-2">
                <k.icon className="size-4 text-primary" aria-hidden />
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums">{k.value}</span>
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={filtersOpen}
            className="pointer-events-auto bg-card/95 backdrop-blur"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={eventsOpen}
            className="pointer-events-auto bg-card/95 backdrop-blur"
            onClick={() => setEventsOpen((v) => !v)}
          >
            <List className="size-3.5" aria-hidden />
            {eventsOpen ? "Ocultar eventos" : "Mostrar eventos"}
          </Button>
        </div>
      </div>

      {/* Eventos — overlay derecho */}
      <aside
        aria-label="Resultados del geovisor"
        data-testid="geovisor-events-panel"
        className={cn(
          "absolute bottom-3 right-3 top-20 z-20 w-80 max-w-[85vw] flex-col overflow-hidden rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur",
          eventsOpen ? "flex" : "hidden"
        )}
      >
        {/* 2026-09-19 — panel de la parcela seleccionada (opción A). */}
        {selectedParcel ? (
          <div className="border-b border-border p-3">
            <ParcelPanel
              parcel={selectedParcel}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : null}
        {/* Card del evento seleccionado (opcional) */}
        {selectedCardData ? (
          <div className="flex flex-col gap-2 border-b border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {selectedCardData.parcel?.farm_name ?? "Sin parcela asignada"}
                </p>
                <h3 className="text-base font-bold tracking-tight">
                  {selectedCardData.parcel?.name ?? "Fumigación huérfana"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(selectedCardData.event.executed_at)}
                </p>
              </div>
              {selectedCardData.event.needs_parcel_assignment ? (
                <Badge className="shrink-0 border-transparent bg-orphan text-orphan-foreground">
                  Sin asignar
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  {SOURCE_LABEL[selectedCardData.event.source]}
                </Badge>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Área aplicada</dt>
                <dd className="font-mono font-medium">
                  {fmtDec(selectedCardData.event.area_treated_ha)} ha
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Volumen</dt>
                <dd className="font-mono font-medium">
                  {fmtLiters(selectedCardData.event.volume_l)}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Producto</dt>
                <dd className="font-medium">{selectedCardData.event.product || "—"}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Operador</dt>
                <dd className="font-medium">{selectedCardData.event.operator || "—"}</dd>
              </div>
            </dl>
            {selectedCardData.event.needs_parcel_assignment &&
            selectedCardData.event.assignment_note ? (
              <p className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
                {selectedCardData.event.assignment_note}
              </p>
            ) : null}
            {selectedCardData.parcel ? (
              <Button
                render={
                  <Link
                    href={`/parcelas/${selectedCardData.parcel.id}`}
                    aria-label="Ver hoja de vida de la parcela"
                  />
                }
                nativeButton={false}
                size="sm"
                className="w-full"
              >
                Ver detalle
                <ArrowUpRight className="size-3.5" />
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {canAssign ? (
                  <AssignParcelDialog
                    fumigationId={Number(selectedCardData.event.id)}
                    note={selectedCardData.event.assignment_note}
                  />
                ) : null}
                <Button
                  render={
                    <Link
                      href={`/fumigaciones/${selectedCardData.event.id}`}
                      aria-label="Ver detalle de la fumigación"
                    />
                  }
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                >
                  Ver fumigación
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <SidebarBoxes
          storageKey="afm-geovisor-sidebar-boxes"
          boxes={[
            {
              id: "parcelas",
              title: "Parcelas",
              badge: (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {fmtInt(filteredParcels.length)}
                </Badge>
              ),
              content: (
                <ul className="divide-y divide-border">
                  {filteredParcels.map((p) => {
                    const agg = eventsByParcel.get(p.id);
                    const active = p.id === selectedId;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(p.id)}
                          aria-pressed={active}
                          data-testid={`geovisor-parcel-${p.id}`}
                          className={cn(
                            "flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                            active && "bg-muted"
                          )}
                        >
                          <span
                            className="mt-0.5 size-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: MAP_COLORS.parcel }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {p.name}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {[p.farm_name, p.municipality].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-[10px] text-muted-foreground">
                            <span className="block font-mono">{fmtDec(p.area_ha)} ha</span>
                            {agg ? <span className="block">{fmtInt(agg.count)} fum.</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {filteredParcels.length === 0 && (
                    <li className="p-4 text-xs text-muted-foreground">
                      Sin parcelas para la búsqueda.
                    </li>
                  )}
                </ul>
              ),
            },
            {
              id: "fumigaciones",
              title: "Fumigaciones",
              badge: (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {fmtInt(sortedEvents.length)}
                </Badge>
              ),
              content: (
                <ul className="divide-y divide-border">
                  {sortedEvents.map((e) => {
                    const parcel = filteredParcelsById.get(e.parcel_id);
                    const active = e.id === selectedEventId;
                    const isOrphan = e.needs_parcel_assignment === true;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => handleEventClick(e.id)}
                          aria-pressed={active}
                          data-testid={`geovisor-event-${e.id}`}
                          className={cn(
                            "flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                            active && "bg-muted"
                          )}
                        >
                          <span
                            className="mt-0.5 size-2.5 shrink-0 rounded-full"
                            style={
                              isOrphan
                                ? { backgroundColor: MAP_COLORS.orphan, border: "1px dashed rgba(255,255,255,0.8)" }
                                : { backgroundColor: MAP_COLORS.event, border: "1px solid rgba(31,41,55,0.5)" }
                            }
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {parcel?.name ?? "Fumigación sin parcela"}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {fmtDate(e.executed_at)} · {fmtDec(e.area_treated_ha)} ha
                              {e.product ? ` · ${e.product}` : ""}
                            </span>
                          </span>
                          {isOrphan ? (
                            <Badge className="shrink-0 border-transparent bg-orphan text-[10px] text-orphan-foreground">
                              Sin asignar
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {SOURCE_LABEL[e.source]}
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {sortedEvents.length === 0 && (
                    <li className="p-4 text-sm text-muted-foreground">
                      No hay fumigaciones en el rango seleccionado.
                    </li>
                  )}
                </ul>
              ),
            },
          ]}
        />
      </aside>
    </div>
  );
}
