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

import { Droplets, Layers, MapPin, Plane, Search, SlidersHorizontal, Sprout } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle
} from "react-resizable-panels";
import { InspectorPanel, type InspectorTab } from "@/components/geovisor/inspector-panel";
import { type BaseMap, GeoMap, USE_MAPTILER, type MapParcel } from "@/components/map/geo-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtDec, fmtInt } from "@/lib/format";
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

  // PR-3b (auditoría UI): paneles redimensionables. En desktop el
  // workspace es horizontal (filtros | mapa | eventos); en mobile se
  // apila vertical. `autoSaveId` persiste los tamaños en localStorage.
  const [isDesktop, setIsDesktop] = useState(false);
  const filtersPanelRef = useRef<ImperativePanelHandle>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [showEvents, setShowEvents] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // El toggle "Ocultar filtros" ahora colapsa/expande el panel (PR-3b).
  useEffect(() => {
    const p = filtersPanelRef.current;
    if (!p) return;
    if (showFilters) p.expand();
    else p.collapse();
  }, [showFilters]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Id de la FUMIGACIÓN seleccionada dentro del contexto de la parcela.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // Modo del Inspector (2026-09-21). Al seleccionar en el mapa salta a
  // "contexto"; por defecto muestra la lista general de fumigaciones.
  const [tab, setTab] = useState<InspectorTab>("fumigaciones");

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

  // Selección de parcela (desde el mapa o la lista "Parcelas"): fija la
  // parcela, limpia la fumigación y muestra el contexto. `null` = click en
  // el fondo del mapa → limpia todo.
  function handleSelectParcel(id: string | null) {
    if (id === null) {
      setSelectedId(null);
      setSelectedEventId(null);
      setTab("fumigaciones");
      return;
    }
    setSelectedId(id);
    setSelectedEventId(null);
    setTab("contexto");
  }

  // Selección de fumigación (desde el mapa o la lista "Fumigaciones"):
  // mantiene la jerarquía parcela → fumigación.
  function handleSelectEvent(eventId: string | null) {
    if (eventId === null) {
      setSelectedEventId(null);
      return;
    }
    const ev = sortedEvents.find((e) => e.id === eventId);
    if (ev) setSelectedId(ev.parcel_id);
    setSelectedEventId(eventId);
    setTab("contexto");
  }

  // Si el usuario cambia el rango temporal y el evento seleccionado
  // queda fuera del rango, lo limpiamos.
  useEffect(() => {
    if (!selectedEventId) return;
    if (!sortedEvents.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [selectedEventId, sortedEvents]);

  return (
    // PR-3a: `h-full + min-h-0` ata el geovisor a la altura del Workspace.
    // PR-3b: los 3 paneles (filtros | mapa | eventos) son redimensionables
    // (horizontal en desktop, vertical en mobile) y persisten en
    // localStorage via `autoSaveId`.
    <PanelGroup
      direction={isDesktop ? "horizontal" : "vertical"}
      autoSaveId="afm-geovisor-layout"
      className="h-full min-h-0"
    >
      {/* Rail de filtros */}
      <Panel
        ref={filtersPanelRef}
        collapsible
        collapsedSize={0}
        defaultSize={22}
        minSize={isDesktop ? 14 : 28}
        maxSize={isDesktop ? 28 : 45}
        className="flex flex-col gap-5 overflow-y-auto border-b border-border bg-card p-4 lg:border-b-0 lg:border-r"
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
      </Panel>
      <PanelResizeHandle
        className={cn(
          "shrink-0 bg-border/70 transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary",
          isDesktop ? "w-1" : "h-1 w-full"
        )}
      />

      {/* Mapa */}
      <Panel minSize={isDesktop ? 55 : 40} className="relative min-h-0">
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
          onSelect={handleSelectParcel}
          onSelectEvent={handleSelectEvent}
        />

        {/* QA-02: KPIs simplificados — Fumigaciones / Parcelas / Área / Última */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-2">
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
            // UI-10: quitar el `hidden ... lg:inline-flex`. Antes el
            // boton de mostrar/ocultar filtros solo aparecia en lg+;
            // mobile users no podian colapsar el rail de filtros.
            className="pointer-events-auto bg-card/95 backdrop-blur"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" />
            {showFilters ? "Ocultar filtros" : "Mostrar filtros"}
          </Button>
        </div>
      </Panel>
      <PanelResizeHandle
        className={cn(
          "shrink-0 bg-border/70 transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary",
          isDesktop ? "w-1" : "h-1 w-full"
        )}
      />

      {/* Panel de resultados: lista de fumigaciones */}
      <Panel
        defaultSize={26}
        minSize={16}
        maxSize={isDesktop ? 34 : 50}
        className="relative flex flex-col border-t border-border bg-card lg:border-l lg:border-t-0"
        data-testid="geovisor-events-panel"
      >
        {/* 2026-09-21 — el detalle (parcela/fumigación) y las listas viven
            en el InspectorPanel único (abajo). El mapa ya no abre popups. */}

        <InspectorPanel
          tab={tab}
          onTabChange={setTab}
          parcels={filteredParcels}
          selectedParcelId={selectedId}
          onSelectParcel={handleSelectParcel}
          events={sortedEvents}
          selectedEventId={selectedEventId}
          onSelectEvent={handleSelectEvent}
          onClearEvent={() => setSelectedEventId(null)}
          canAssign={canAssign}
          counts={{ parcels: filteredParcels.length, events: sortedEvents.length }}
        />
      </Panel>
    </PanelGroup>
  );
}
