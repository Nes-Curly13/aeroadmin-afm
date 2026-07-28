"use client";

import { ArrowUpRight, Layers, MapPin, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Map as MlMap } from "maplibre-gl";

import { KpiPill } from "@/components/ui/kpi-pill";
import { FieldSelect } from "@/components/ui/field-select";
import { Switch } from "@/components/ui/switch";
import { ToggleButton } from "@/components/ui/toggle-button";
import { MapView } from "@/components/map-view";
import { ParcelsList } from "@/components/map/parcels-list";
import { TimeRange, type MonthBucket } from "@/components/map/time-range";
import {
  getFumigationsSummary,
  type FumigationsSummary
} from "@/api/repositories";
import {
  applyEventFilters,
  applyParcelFilters,
  aggregateEventsByParcel,
  computeKpis,
  decorateParcelsWithEvents,
  defaultFilterState,
  getCadenceDays,
  sortParcelsByPriority,
  toMapFumigationEvent,
  toMapParcelView,
  uniqueClients,
  uniqueFarms
} from "@/lib/map-filter-logic";
import type {
  BaseMap,
  CadenceStatus,
  FumigationSource,
  LayerVisibilityState,
  MapFilterState,
  MapFumigationEvent,
  MapParcelView
} from "@/lib/map-filter-types";
import { CADENCE_STATUS_META, CADENCE_STATUS_ORDER } from "@/lib/map-filter-types";
import { formatArea, formatDateWithWeekday } from "@/lib/format";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

/**
 * components/map/map-page-client.tsx
 *
 * v2.1 (sprint S6) — port de la lógica del V0 al wrapper cliente de `/map`.
 *
 * Contexto histórico:
 *   - v1.8: este componente montaba el page header + el drawer de filtros
 *     (con state local `filterCollapsed`). Los filtros se mantenían en URL
 *     searchParams (`drone`, `crop`, `fumigated`).
 *   - v2.0 (S5): agregamos el `KpiPill` overlay sobre el mapa y el
 *     `TimeRange` slider; los KPIs venían del endpoint server-side
 *     `/api/map/summary`.
 *   - v2.1 (S6 — ESTE COMMIT): se portan los features del V0
 *     (`docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx`):
 *       1. Filtros client-side por cliente, hacienda, modelo, cadencia,
 *          origen, búsqueda libre.
 *       2. KPIs DERIVADOS de los eventos (client-side) en vez del endpoint
 *          server-side (con fallback si no hay eventos localmente).
 *       3. TimeRange filtra los eventos.
 *       4. Toggle de capas (polígonos / eventos / labels) en el rail de filtros.
 *       5. Selector de mapa base (satelite / calles).
 *       6. Buscador fuzzy.
 *       7. FitBounds programático cuando cambia el set de parcels filtrados.
 *       8. Detalle de parcela seleccionada con cadencia y agregados del rango.
 *
 * Decisiones arquitectónicas:
 *   - **URL para `drone`, `crop`, `fumigated`** (compat con el server-rendering
 *     y los deep links); state local para el resto (cliente, hacienda, modelo,
 *     cadencia, source, búsqueda, capa toggles, baseMap, selección, time range).
 *   - **Lógica pura en `lib/map-filter-logic.ts`** — testable sin DOM y
 *     reusables desde otros contexts (e.g. un futuro `ParcelDetailPanel`).
 *   - **Sin Input primitive** — usamos `<input>` nativo con clases Tailwind
 *     (mismo patrón que `parcel-search.tsx`). Si en el futuro se necesita
 *     consistencia, agregar `components/ui/input.tsx` y migrar.
 *   - **TODO: DjiParcelRecord NO tiene `client_name`/`farm_name`/
 *     `municipality`/`variety`** — los filtros asociados se vuelven no-ops
 *     hasta que se agreguen esos campos a la query SQL (ver sprint
 *     "cadencia v2 — metadata de parcela"). Marcado en los lugares afectados.
 *   - **TODO: el render de eventos como markers en el mapa** queda para un
 *     commit posterior. En este commit el `MapLibreView` recibe la prop
 *     `fumigationEvents` (data plumbing) pero la fuente de markers no se
 *     agrega (sprint S6.1).
 *
 * Layout (V0 port):
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Page header: 🗺️ + "Mapa de Parcelas" + subtítulo            │
 *   │                                     [chip] [Mostrar/Ocultar] │
 *   ├──────────┬──────────────────────────────────────┬──────────────┤
 *   │ Filtros  │                                      │  Detalle +   │
 *   │ ──────── │                                      │  Lista de    │
 *   │ Search   │              MAPA                    │  parcelas    │
 *   │ Cliente  │  (full bleed)                       │  (derecho)   │
 *   │ Hacienda │                                      │              │
 *   │ Modelo   │  [KPI overlay: 4 pills]              │              │
 *   │ Cadencia │  [Leyenda] [Basemap badge]          │              │
 *   │ Origen   │  [TimeRange slider]                 │              │
 *   │ Capas    │                                      │              │
 *   │ Basemap  │                                      │              │
 *   └──────────┴──────────────────────────────────────┴──────────────┘
 */

// v2.1 (S6) — la shape `ParcelsSummaryRow` venía del legacy
// `MapFilterSidebar` (que se renderizaba oculto en v2.0). Ahora ese
// sidebar ya no se monta desde acá (los filtros URL siguen activos
// server-side via searchParams pero su UI vive en otra parte del
// producto, ver sprint S6.2). El type quedó en
// `components/map/map-filter-sidebar.tsx` por compat con tests
// existentes.

export interface MapPageClientProps {
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  flightPoints?: FlightPointRecord[];
  fumigatedParcelIds: Set<number>;
  /**
   * v2.0 (S5) — agregados de fumigaciones sobre el set visible de parcelas.
   * Se usan como FALLBACK cuando no hay eventos en el cliente (server-side
   * ya los computa con el `parcelIds` del set visible).
   */
  fumigationsSummary?: FumigationsSummary;
  /**
   * v2.0 (S5) — histograma mensual de fumigaciones para alimentar el
   * `<TimeRange>` slider. Si se omite, no se renderiza el slider.
   */
  fumigationsByMonth?: MonthBucket[];
  /**
   * v2.1 (S6) — eventos de fumigación aplanados (uno por fila) para el
   * filtrado client-side. Si se omite, el componente cae al modo
   * server-side: los KPIs se leen de `fumigationsSummary` y la lista
   * no muestra `events_in_range` por parcela.
   */
  fumigationEvents?: MapFumigationEvent[];
}

const DEFAULT_LAYER_VISIBILITY: LayerVisibilityState = {
  showParcels: true,
  showEvents: true,
  showLabels: false
};

export function MapPageClient({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  fumigationsSummary,
  fumigationsByMonth = [],
  fumigationEvents = []
}: MapPageClientProps) {
  // v1.8 — drawer de filtros. Mantenemos el default CERRADO del v1.8
  // (el mapa ocupa todo el viewport en la carga inicial).
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const toggleFilters = useCallback(() => {
    setFilterCollapsed((c) => !c);
  }, []);

  // v2.1 (S6) — state local del V0 port. No va a URL: son filtros de
  // sesión, no queremos que se compartan por link (la URL mantiene los
  // filtros server-side `drone`/`crop`/`fumigated`).
  const [filters, setFilters] = useState<MapFilterState>(defaultFilterState);
  const [layers, setLayers] = useState<LayerVisibilityState>(DEFAULT_LAYER_VISIBILITY);
  const [baseMap, setBaseMap] = useState<BaseMap>("satelite");
  const [selectedParcelId, setSelectedParcelId] = useState<number | null>(null);

  // v2.0 (S5) — TimeRange state. Default = todo el rango.
  const [timeRange, setTimeRange] = useState<[number, number]>(() => [
    0,
    Math.max(0, fumigationsByMonth.length - 1)
  ]);
  const [playing, setPlaying] = useState(false);

  // v2.0 (S5) — KPIs con fallback. Si tenemos eventos localmente, los
  // derivamos client-side desde `filteredEvents`. Si no, usamos el
  // summary server-side (v2.0 behavior).
  const [liveSummary, setLiveSummary] = useState<FumigationsSummary | null>(
    fumigationsSummary ?? null
  );
  const [summaryLoading, setSummaryLoading] = useState(false);

  // v2.1 (S6) — map ref (la setea `onMapReady` del MapLibreView). La
  // usamos para hacer `fitBounds` programático cuando cambian los
  // parcels filtrados.
  const mapRef = useRef<MlMap | null>(null);
  const handleMapReady = useCallback((map: MlMap) => {
    mapRef.current = map;
  }, []);

  // Cuando cambia el time range, fetch del summary server-side filtrado.
  // Debounce 200ms para no martillar el endpoint durante el autoplay.
  // v2.1 (S6): solo se ejecuta si NO tenemos eventos localmente. Si los
  // tenemos, los KPIs se derivan del state y no hace falta este round-trip.
  useEffect(() => {
    if (fumigationEvents.length > 0) {
      // Tenemos eventos locales: el useMemo computeKpis() se encarga.
      return;
    }
    if (fumigationsByMonth.length === 0) {
      setLiveSummary(fumigationsSummary ?? null);
      return;
    }
    if (timeRange[0] === 0 && timeRange[1] >= fumigationsByMonth.length - 1) {
      setLiveSummary(fumigationsSummary ?? null);
      return;
    }
    const fromBucket = fumigationsByMonth[timeRange[0]];
    const toBucket = fumigationsByMonth[timeRange[1]];
    if (!fromBucket || !toBucket) return;
    const fromIso = fromBucket.key + "-01";
    const [yStr, mStr] = toBucket.key.split("-");
    const toIso = `${yStr}-${mStr}-${new Date(Number(yStr), Number(mStr), 0).getUTCDate()}`;

    setSummaryLoading(true);
    const ctrl = new AbortController();
    const handle = setTimeout(() => {
      const parcelIds = parcels.map((p) => p.id).join(",");
      const url = `/api/map/summary?parcelIds=${parcelIds}&from=${fromIso}&to=${toIso}`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: FumigationsSummary) => {
          setLiveSummary(data);
          setSummaryLoading(false);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setSummaryLoading(false);
          }
        });
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, fumigationsByMonth, parcels, fumigationEvents.length]);

  // ====================================================================
  // v2.1 (S6) — derivaciones del V0 port. Toda la lógica de filtrado
  // vive en `lib/map-filter-logic.ts`; acá solo encadenamos useMemo.
  // ====================================================================

  // Enriquecer parcels con status de cadencia y centroid. Se hace una
  // sola vez por cambio en `parcels`.
  const parcelViews: MapParcelView[] = useMemo(
    () => parcels.map(toMapParcelView),
    [parcels]
  );

  // Lista única de clientes (sobre las parcels ya enriquecidas). El
  // V0 lo hace sobre `payload.parcels` — acá lo hacemos sobre
  // `parcelViews` (mismo resultado, pero mantenemos la inmutabilidad).
  const clients = useMemo(() => uniqueClients(parcelViews), [parcelViews]);

  // Farms: filtradas por client (si client !== "todos"). El V0
  // resetea farm a "todas" cuando cambia client; acá manejamos eso
  // en el `onChange` del FieldSelect.
  const farms = useMemo(
    () => uniqueFarms(parcelViews, filters.client),
    [parcelViews, filters.client]
  );

  // Lista única de modelos de dron (derivada de los datos, no hardcoded).
  const droneModels = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{ code: number; name: string }> = [];
    for (const p of parcelViews) {
      if (p.drone_model_code === null) continue;
      if (seen.has(p.drone_model_code)) continue;
      seen.add(p.drone_model_code);
      out.push({
        code: p.drone_model_code,
        name: p.drone_model_name ?? `Drone ${p.drone_model_code}`
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return out;
  }, [parcelViews]);

  // Filtro de parcels: client + farm + model + statuses + query.
  const filteredParcels = useMemo(
    () => applyParcelFilters(parcelViews, filters),
    [parcelViews, filters]
  );

  // Set de parcel_ids visibles (para filtrar eventos en O(1)).
  const filteredParcelIds = useMemo(
    () => new Set(filteredParcels.map((p) => p.id)),
    [filteredParcels]
  );

  // Rango temporal activo en epoch ms.
  const fromMs = fumigationsByMonth[timeRange[0]]?.start ?? 0;
  const toMs = fumigationsByMonth[timeRange[1]]?.end ?? Date.now();

  // Eventos filtrados: pertenencia a filteredParcelIds + sources + rango.
  // Importante: si no hay eventos locales, queda `[]` y los KPIs caen
  // al `liveSummary` server-side.
  const filteredEvents: MapFumigationEvent[] = useMemo(
    () =>
      applyEventFilters(
        fumigationEvents,
        filteredParcelIds,
        filters.sources,
        fromMs,
        toMs
      ),
    [fumigationEvents, filteredParcelIds, filters.sources, fromMs, toMs]
  );

  // Agregados por parcela (count/ha/volume/flights/last).
  const eventsByParcel = useMemo(
    () => aggregateEventsByParcel(filteredEvents),
    [filteredEvents]
  );

  // Parcels decoradas con `events_in_range` y `ha_in_range`.
  const decoratedParcels = useMemo(
    () => decorateParcelsWithEvents(filteredParcels, eventsByParcel),
    [filteredParcels, eventsByParcel]
  );

  // KPIs derivados del set de eventos filtrados. Si no hay eventos
  // locales, el `<KpiPill>` consume `liveSummary` (server-side).
  const derivedKpis = useMemo(
    () => computeKpis(filteredEvents, eventsByParcel),
    [filteredEvents, eventsByParcel]
  );

  // Orden del listado: cadencia (urgente primero), después count desc.
  const sortedList = useMemo(
    () => sortParcelsByPriority(decoratedParcels, CADENCE_STATUS_ORDER),
    [decoratedParcels]
  );

  // Decidir qué KPIs pintar: client-side si hay eventos locales,
  // server-side (con `summaryLoading`) si no.
  const useClientKpis = fumigationEvents.length > 0;
  const kpiItems: Array<{ kind: "aplicaciones" | "hectareas" | "volumen" | "vuelos"; value: string | number }> =
    useMemo(() => {
      if (useClientKpis) {
        return [
          { kind: "aplicaciones", value: derivedKpis.events },
          { kind: "hectareas", value: `${derivedKpis.ha.toFixed(1)} ha` },
          { kind: "volumen", value: `${derivedKpis.volume.toFixed(1)} L` },
          { kind: "vuelos", value: derivedKpis.flights }
        ];
      }
      if (liveSummary) {
        return [
          { kind: "aplicaciones", value: liveSummary.count },
          { kind: "hectareas", value: `${liveSummary.areaHa.toFixed(1)} ha` },
          { kind: "volumen", value: `${liveSummary.volumeL.toFixed(1)} L` },
          { kind: "vuelos", value: liveSummary.flights }
        ];
      }
      return [];
    }, [useClientKpis, derivedKpis, liveSummary]);

  // v2.1 (S6) — FitBounds programático cuando cambia el set de parcels
  // filtrados. Se dispara SOLO si:
  //   1. El map está listo (`mapRef.current` no es null).
  //   2. El set de parcels cambió (deps: `decoratedParcels`).
  //   3. NO en el primer render (sería redundante con el `autoFit` del
  //      MapLibreView). Para eso usamos el `prevRef`.
  const prevFilteredIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentIds = new Set(decoratedParcels.map((p) => p.id));
    // Skip si no cambió (primer render o cambio de filtros no relacionados).
    if (
      currentIds.size === prevFilteredIdsRef.current.size &&
      Array.from(currentIds).every((id) => prevFilteredIdsRef.current.has(id))
    ) {
      return;
    }
    prevFilteredIdsRef.current = currentIds;
    if (currentIds.size === 0) return; // no hay nada que encuadrar
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let found = false;
    for (const p of decoratedParcels) {
      if (p.centroid_lng === null || p.centroid_lat === null) continue;
      found = true;
      if (p.centroid_lng < minLng) minLng = p.centroid_lng;
      if (p.centroid_lat < minLat) minLat = p.centroid_lat;
      if (p.centroid_lng > maxLng) maxLng = p.centroid_lng;
      if (p.centroid_lat > maxLat) maxLat = p.centroid_lat;
    }
    if (!found) return;
    try {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat]
        ],
        { padding: 60, duration: 600, maxZoom: 15 }
      );
    } catch {
      /* ignore — bounds inválidos (1 sola parcela) */
    }
  }, [decoratedParcels]);

  // Helpers de UI: toggle arrays.
  const toggleStatus = useCallback((s: CadenceStatus) => {
    setFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(s)
        ? prev.statuses.filter((x) => x !== s)
        : [...prev.statuses, s]
    }));
  }, []);

  const toggleSource = useCallback((s: FumigationSource) => {
    setFilters((prev) => ({
      ...prev,
      sources: prev.sources.includes(s)
        ? prev.sources.filter((x) => x !== s)
        : [...prev.sources, s]
    }));
  }, []);

  // Cambio de client: resetea farm a "todas" (mismo patrón que V0).
  const onChangeClient = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, client: e.target.value, farm: "todas" }));
  }, []);

  const onChangeFarm = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, farm: e.target.value }));
  }, []);

  const onChangeModel = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, model: e.target.value }));
  }, []);

  const onChangeQuery = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters((prev) => ({ ...prev, query: e.target.value }));
  }, []);

  // Counts y Maps para el listado.
  const countsByParcel = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of filteredEvents) {
      m.set(e.parcel_id, (m.get(e.parcel_id) ?? 0) + 1);
    }
    return m;
  }, [filteredEvents]);

  const haInRangeByParcel = useMemo(() => {
    const m = new Map<number, number>();
    for (const [parcelId, agg] of eventsByParcel) {
      m.set(parcelId, Math.round(agg.ha * 10) / 10);
    }
    return m;
  }, [eventsByParcel]);

  // Selected parcel (la fuente de verdad es el `decoratedParcels`).
  const selectedItem = useMemo(
    () => sortedList.find((p) => p.id === selectedParcelId) ?? null,
    [sortedList, selectedParcelId]
  );
  const selectedParcel = selectedItem;
  const selectedCadence = selectedItem?.cadence_days ?? 14;
  // selectedParcel.area_ha es number | null — el formato formatArea lo soporta.
  const selectedArea = selectedParcel ? selectedParcel.area_ha : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Page header compacto: logo + título + subtítulo + (der) chip + Mostrar/Ocultar filtros */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="map-page-header"
      >
        {/* Left: logo + título + subtítulo */}
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b5f2d]/10 text-[#0b5f2d]"
          >
            <span className="text-2xl" role="img" aria-label="Mapa">🗺️</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#121815] sm:text-3xl">
              Mapa de Parcelas
            </h1>
            <p className="mt-0.5 text-sm text-[#4a5b50]">
              Mapa operativo de parcelas DJI con geometría y configuración de vuelo
            </p>
          </div>
        </div>

        {/* Right: chip "X Parcelas" + botón "Mostrar/Ocultar filtros" */}
        <div className="flex items-center gap-2">
          <span
            aria-label={`${sortedList.length} parcelas en el filtro`}
            className="inline-flex items-center gap-2 rounded-full border border-[#0b5f2d]/25 bg-[#dbe7df] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#0b5f2d]"
            data-testid="map-page-header-parcel-count"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#0b5f2d]" />
            {sortedList.length} Parcelas
          </span>
          <button
            aria-expanded={!filterCollapsed}
            aria-label={filterCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
            className="inline-flex items-center gap-2 rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#121815] shadow-sm transition hover:border-[#0b5f2d]/40 hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
            data-testid="map-page-header-filters-button"
            onClick={toggleFilters}
            type="button"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {filterCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          </button>
        </div>
      </div>

      {/*
        Body: layout flex-row. El mapa ocupa flex-1 (se ajusta al espacio
        restante), el rail derecho (ParcelsList) tiene ancho fijo w-84.
        En mobile el rail pasa abajo del mapa (flex-col).
      */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:h-[calc(100vh-220px)]">
        <div className="relative min-h-[60vh] flex-1 lg:min-h-0">
          {/* Mapa — ocupa todo el ancho disponible del container izquierdo */}
          <MapView
            alerts={alerts}
            flightPoints={flightPoints}
            flights={flights}
            fumigatedParcelIds={fumigatedParcelIds}
            fumigationEvents={fumigationEvents}
            onMapReady={handleMapReady}
            onSelect={setSelectedParcelId}
            parcels={parcels}
            selectedParcelId={selectedParcelId}
            showEvents={layers.showEvents}
          />

          {/*
            v2.0 (sprint S5) — KPIs overlay pill. Se monta en la esquina
            superior izquierda del mapa (no choca con el basemap badge que
            está bottom-right). Es `pointer-events-auto` para que el cursor
            no atraviese la pill; `flex-wrap` para que en mobile los items
            salten de línea.

            v2.1 (S6): los KPIs son client-side (de `filteredEvents`) si
            hay eventos locales; si no, server-side (`liveSummary`).
            La opacidad baja mientras `summaryLoading` para feedback visual.
          */}
          {kpiItems.length > 0 ? (
            <div
              className="pointer-events-none absolute left-3 top-3 z-[500] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2"
              data-testid="map-kpi-overlay"
            >
              <div className={summaryLoading ? "opacity-60" : ""}>
                <KpiPill items={kpiItems} />
              </div>
            </div>
          ) : null}

          {/*
            v2.0 (sprint S5) — TimeRange slider. Se monta en la parte
            inferior del mapa, encima del basemap badge. Es el equivalente
            del slider del V0.
          */}
          {fumigationsByMonth.length > 0 ? (
            <div
              className="absolute inset-x-3 bottom-3 z-[500] rounded-md border border-border bg-card/95 p-3 shadow-sm backdrop-blur"
              data-testid="map-time-range-container"
            >
              <TimeRange
                months={fumigationsByMonth}
                playing={playing}
                range={timeRange}
                onPlayingChange={setPlaying}
                onRangeChange={setTimeRange}
              />
            </div>
          ) : null}

          {/*
            Drawer de filtros (overlay absoluto a la derecha).
            Cuando `filterCollapsed` = true, no se renderiza.
            v2.1 (S6): el contenido del drawer es el rail completo del
            V0 (búsqueda + 3 selects + 4 status + 3 sources + 3 toggles
            de capa + 2 botones de basemap). Los filtros URL
            server-side (`?drone=...`, `?crop=...`, `?fumigated=...`)
            siguen activos en app/map/page.tsx y se aplican al set
            inicial de parcels — su UI para modificarlos vive en otra
            parte del producto (sprint S6.2 — ver TODO).
          */}
          {!filterCollapsed ? (
            <div
              className="absolute right-4 top-4 z-[1100] w-[320px] max-w-[calc(100vw-2rem)]"
              data-testid="map-filter-drawer"
            >
              <div className="relative">
                <V0FilterRail
                  baseMap={baseMap}
                  baseMaps={
                    [
                      { value: "satelite", label: "Satélite" },
                      { value: "calles", label: "Callejero" }
                    ] as { value: BaseMap; label: string }[]
                  }
                  clients={clients}
                  droneModels={droneModels}
                  farms={farms}
                  filters={filters}
                  layers={layers}
                  onBaseMapChange={setBaseMap}
                  onChangeClient={onChangeClient}
                  onChangeFarm={onChangeFarm}
                  onChangeModel={onChangeModel}
                  onChangeQuery={onChangeQuery}
                  onLayerToggle={(k) =>
                    setLayers((prev) => ({ ...prev, [k]: !prev[k] }))
                  }
                  onToggleSource={toggleSource}
                  onToggleStatus={toggleStatus}
                  resultCount={sortedList.length}
                />
                {/* Botón cerrar superpuesto (chevron `<`) en la esquina
                    superior izquierda del drawer. */}
                <button
                  aria-label="Cerrar filtros"
                  className="absolute -left-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#cfd8d3] bg-white text-[#121815] shadow-md transition hover:border-[#0b5f2d]/40 hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
                  data-testid="map-filter-drawer-close"
                  onClick={toggleFilters}
                  type="button"
                >
                  <span aria-hidden="true" className="text-base leading-none">‹</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/*
          v2.0 (sprint S5) — Rail derecho con lista de parcelas.
          v2.1 (S6): ahora muestra los counts y ha_in_range de la parcela
          seleccionada. La lista sigue ordenada por cadencia.
        */}
        <div className="lg:w-84 lg:shrink-0 lg:overflow-hidden">
          {selectedParcel ? (
            <div
              className="flex flex-col gap-3 border-b border-[#d2ddd6] bg-white p-4"
              data-testid="selected-parcel-detail"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                    {selectedParcel.farm_name ?? "Parcela"}
                  </p>
                  <h3 className="truncate text-base font-bold tracking-tight">
                    {selectedParcel.name}
                  </h3>
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                  data-testid="selected-parcel-status"
                  style={{ backgroundColor: CADENCE_STATUS_META[selectedParcel.status].color }}
                >
                  {CADENCE_STATUS_META[selectedParcel.status].label}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Área</dt>
                  <dd className="font-mono font-medium">
                    {selectedArea !== null ? formatArea(selectedArea) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Variedad</dt>
                  <dd className="font-mono font-medium">
                    {selectedParcel.variety ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Cadencia</dt>
                  <dd className="font-mono font-medium">{selectedCadence} días</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Última aplic.</dt>
                  <dd className="font-mono font-medium">
                    {selectedParcel.last_fumigation_date
                      ? formatDateWithWeekday(selectedParcel.last_fumigation_date)
                      : "sin historial"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">En el rango</dt>
                  <dd className="font-mono font-medium">
                    {countsByParcel.get(selectedParcel.id) !== undefined
                      ? `${countsByParcel.get(selectedParcel.id)} aplic.`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Ha en el rango</dt>
                  <dd className="font-mono font-medium">
                    {haInRangeByParcel.get(selectedParcel.id) !== undefined
                      ? `${(haInRangeByParcel.get(selectedParcel.id) ?? 0).toFixed(1)} ha`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <Link
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none transition hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                data-testid="selected-parcel-view-detail"
                href={`/parcels/${selectedParcel.id}`}
              >
                Ver hoja de vida
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}

          <ParcelsList
            countsByParcel={countsByParcel}
            haInRangeByParcel={haInRangeByParcel}
            parcels={parcels}
            selectedId={selectedParcelId}
            onSelect={setSelectedParcelId}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// V0FilterRail — rail de filtros del V0 port, aislado del MapPageClient
// para que sea fácil de testear y mantener. Mismo layout del V0 (buscador
// + selects + status pills + source pills + layer switches + basemap).
// ============================================================

const SOURCES_LIST: FumigationSource[] = ["djiscraper", "import", "manual"];

interface V0FilterRailProps {
  filters: MapFilterState;
  layers: LayerVisibilityState;
  baseMap: BaseMap;
  baseMaps: Array<{ value: BaseMap; label: string }>;
  clients: string[];
  farms: string[];
  droneModels: Array<{ code: number; name: string }>;
  resultCount: number;
  onChangeClient: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onChangeFarm: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onChangeModel: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onChangeQuery: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleStatus: (s: CadenceStatus) => void;
  onToggleSource: (s: FumigationSource) => void;
  onLayerToggle: (k: keyof LayerVisibilityState) => void;
  onBaseMapChange: (b: BaseMap) => void;
}

function V0FilterRail({
  filters,
  layers,
  baseMap,
  baseMaps,
  clients,
  farms,
  droneModels,
  resultCount,
  onChangeClient,
  onChangeFarm,
  onChangeModel,
  onChangeQuery,
  onToggleStatus,
  onToggleSource,
  onLayerToggle,
  onBaseMapChange
}: V0FilterRailProps) {
  return (
    <aside
      aria-label="Filtros del mapa"
      className="flex max-h-[calc(100vh-120px)] flex-col gap-5 overflow-y-auto rounded-2xl border border-[#d2ddd6] bg-white p-4 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="map-v0-filter-rail"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-bold tracking-tight">Filtros</h2>
        <span
          className="ml-auto rounded-full bg-[#dbe7df] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[#0b5f2d]"
          data-testid="map-v0-filter-rail-count"
        >
          {resultCount} parcelas
        </span>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          aria-label="Buscar parcela"
          className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          data-testid="map-v0-search-input"
          onChange={onChangeQuery}
          placeholder="Buscar suerte, hacienda, variedad…"
          type="search"
          value={filters.query}
        />
      </div>

      {/*
        Cliente / Ingenio. TODO: DjiParcelRecord no tiene `client_name`,
        así que la lista de clientes queda vacía salvo que la query SQL
        se extienda. El filtro se vuelve no-op en ese caso.
      */}
      <FieldSelect
        data-testid="map-v0-client-select"
        id="map-v0-client-select"
        label="Cliente / Ingenio"
        onChange={onChangeClient}
        value={filters.client}
      >
        <option value="todos">Todos los clientes</option>
        {clients.length === 0 ? (
          <option value="__none" disabled>
            (sin datos — ver TODO)
          </option>
        ) : (
          clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))
        )}
      </FieldSelect>

      <FieldSelect
        data-testid="map-v0-farm-select"
        id="map-v0-farm-select"
        label="Hacienda"
        onChange={onChangeFarm}
        value={filters.farm}
      >
        <option value="todas">Todas las haciendas</option>
        {farms.length === 0 ? (
          <option value="__none" disabled>
            (sin datos — ver TODO)
          </option>
        ) : (
          farms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))
        )}
      </FieldSelect>

      <FieldSelect
        data-testid="map-v0-model-select"
        id="map-v0-model-select"
        label="Modelo de dron asignado"
        onChange={onChangeModel}
        value={filters.model}
      >
        <option value="todos">Todos los modelos</option>
        {droneModels.map((m) => (
          <option key={m.code} value={String(m.code)}>
            {m.name}
          </option>
        ))}
      </FieldSelect>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Estado de cadencia
        </legend>
        <div className="flex flex-wrap gap-1.5" data-testid="map-v0-status-pills">
          {CADENCE_STATUS_ORDER.map((s) => {
            const active = filters.statuses.includes(s);
            return (
              <ToggleButton
                key={s}
                aria-label={`Filtrar por estado ${CADENCE_STATUS_META[s].label}`}
                data-testid={`map-v0-status-pill-${s}`}
                dotColor={CADENCE_STATUS_META[s].color}
                onPressedChange={() => onToggleStatus(s)}
                pressed={active}
                variant="pill"
              >
                {CADENCE_STATUS_META[s].label}
              </ToggleButton>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Origen del registro
        </legend>
        <div className="flex flex-wrap gap-1.5" data-testid="map-v0-source-pills">
          {SOURCES_LIST.map((s) => {
            const active = filters.sources.includes(s);
            const label = SOURCE_LABEL[s];
            return (
              <ToggleButton
                key={s}
                aria-label={`Filtrar por origen ${label}`}
                data-testid={`map-v0-source-pill-${s}`}
                onPressedChange={() => onToggleSource(s)}
                pressed={active}
                variant="pill"
              >
                {label}
              </ToggleButton>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Layers className="size-3.5" aria-hidden /> Capas
        </legend>
        <div className="flex flex-col gap-1.5" data-testid="map-v0-layer-toggles">
          <Switch
            aria-label="Toggle capa de polígonos de parcelas"
            checked={layers.showParcels}
            data-testid="map-v0-layer-toggle-parcels"
            label="Polígonos de parcelas"
            onCheckedChange={() => onLayerToggle("showParcels")}
          />
          <Switch
            aria-label="Toggle capa de aplicaciones en el rango"
            checked={layers.showEvents}
            data-testid="map-v0-layer-toggle-events"
            label="Aplicaciones en el rango"
            onCheckedChange={() => onLayerToggle("showEvents")}
          />
          <Switch
            aria-label="Toggle capa de etiquetas de suerte"
            checked={layers.showLabels}
            data-testid="map-v0-layer-toggle-labels"
            label="Etiquetas de suerte"
            onCheckedChange={() => onLayerToggle("showLabels")}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Mapa base
        </legend>
        <div className="flex gap-1.5" data-testid="map-v0-basemap-buttons">
          {baseMaps.map((b) => {
            const active = b.value === baseMap;
            return (
              <button
                key={b.value}
                aria-pressed={active}
                className={
                  "h-8 flex-1 rounded-md border text-xs font-semibold outline-none transition-colors " +
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted")
                }
                data-testid={`map-v0-basemap-${b.value}`}
                onClick={() => onBaseMapChange(b.value)}
                type="button"
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    </aside>
  );
}

// Mapa de FumigationSource → label humano. Espejo de docs/.../lib/format.ts.
// Lo movemos acá para no acoplar al V0. El orden de las keys es estable.
const SOURCE_LABEL: Record<FumigationSource, string> = {
  manual: "Manual",
  import: "Import",
  djiscraper: "DJI Scraper"
};

// Helper: convierte un `DjiParcelRecord` a un `MapFumigationEvent` (no se
// usa directamente, pero queda exportado para que los tests puedan
// construir fixtures sin importar lib/map-filter-logic).
export { toMapFumigationEvent };

// Suppress unused warning for getCadenceDays — used via toMapParcelView
// (import kept for the future "per-parcel cadence from schedule" case).
void getCadenceDays;
void MapPin;
