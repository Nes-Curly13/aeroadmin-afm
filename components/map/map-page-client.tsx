"use client";

import { useCallback, useEffect, useState } from "react";

import { KpiPill } from "@/components/ui/kpi-pill";
import { MapFilterSidebar } from "@/components/map/map-filter-sidebar";
import { MapView } from "@/components/map-view";
import { ParcelsList } from "@/components/map/parcels-list";
import { TimeRange, type MonthBucket } from "@/components/map/time-range";
import { getFumigationsSummary, type FumigationsSummary } from "@/api/repositories";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

/**
 * components/map/map-page-client.tsx
 *
 * v1.8 — wrapper cliente del body completo de `/map`.
 *
 * Por qué existe (separado de app/map/page.tsx):
 *   - La page es server-side y hace queries paralelas a la DB. Pero
 *     el estado del drawer de filtros (collapsed / open) y el header
 *     con chip "X Parcelas" + botón "Filtros" son UI client-only.
 *   - Server Component → Client Component: la page pasa los datos
 *     ya hidratados al client; este componente los monta en el layout
 *     y maneja la interactividad.
 *
 * Layout (mockup usuario 2026-07-27):
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  Page header: logo + "Mapa de Parcelas" + subtítulo corto   │
 *   │                                            [chip] [Filtros] │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │                                                              │
 *   │                              │   ┌──────────────────────┐  │
 *   │                              │   │ Filtros del mapa  <  │  │
 *   │            MAPA              │   │ 200 Parcelas          │  │
 *   │         (full bleed)         │   │  Drones [...]         │  │
 *   │                              │   │  Cultivo [...]        │  │
 *   │                              │   │  Fumigadas (6m) [...] │  │
 *   │                              │   │  [Limpiar filtros]    │  │
 *   │                              │   └──────────────────────┘  │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Decisiones:
 *   - **El page header vive acá** (no en AppShell). El chip "X Parcelas"
 *     se re-renderea con cada cambio de filtro (URL navigation), y eso
 *     requiere client-side. AppShell recibe `hidePageHeader={true}` para
 *     no pintar el bloque default.
 *   - **Drawer default cerrado** (`filterCollapsed = true`). El mapa
 *     ocupa todo el viewport en la carga inicial. El operador abre el
 *     drawer con el botón "Filtros" del header.
 *   - **El drawer es overlay absolute** (no flex column). Así el mapa
 *     mantiene el 100% del ancho cuando el drawer está cerrado.
 */

type ParcelsSummaryRow = {
  total_parcels: string;
  total_orchards: string;
  total_farmlands: string;
  total_spray_area_m2: string | null;
  avg_spray_area_m2: string | null;
  drone_model_code: number | null;
  drone_model_name: string | null;
  count_by_drone: string;
};

export interface MapPageClientProps {
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  flightPoints?: FlightPointRecord[];
  fumigatedParcelIds: Set<number>;
  summary: ParcelsSummaryRow[];
  resultCount: number;
  /**
   * v2.0 — agregados de fumigaciones sobre el set visible de parcelas.
   * Se renderizan como overlay pill (KpiPill) en la esquina superior
   * izquierda del mapa, junto al botón "Filtros".
   */
  fumigationsSummary?: FumigationsSummary;
  /**
   * v2.0 — histograma mensual de fumigaciones para alimentar el
   * `<TimeRange>` slider (abajo del mapa). Si se omite, no se
   * renderiza el slider.
   */
  fumigationsByMonth?: MonthBucket[];
}

export function MapPageClient({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  summary,
  resultCount,
  fumigationsSummary,
  fumigationsByMonth = []
}: MapPageClientProps) {
  // v1.8 — estado del drawer de filtros. Default CERRADO para que el
  // mapa ocupe todo el viewport en la carga inicial.
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const toggleFilters = useCallback(() => {
    setFilterCollapsed((c) => !c);
  }, []);

  // v2.0 — estado del TimeRange slider. Default = todo el rango.
  // El KPI overlay se recalcula contra el endpoint /api/map/summary
  // cuando cambia el rango (ver useEffect abajo).
  const [timeRange, setTimeRange] = useState<[number, number]>(() => [
    0,
    Math.max(0, fumigationsByMonth.length - 1)
  ]);
  const [playing, setPlaying] = useState(false);
  // Summary reactivo al time range. Inicia con el del server (full history).
  const [liveSummary, setLiveSummary] = useState<FumigationsSummary | null>(
    fumigationsSummary ?? null
  );
  const [summaryLoading, setSummaryLoading] = useState(false);

  // v2.0 — estado de la parcela seleccionada. Se pasa al MapView
  // (que hace flyTo + highlight) y al ParcelsList (que muestra el detalle).
  const [selectedParcelId, setSelectedParcelId] = useState<number | null>(null);

  // Cuando cambia el time range, fetch del summary filtrado.
  // Debounce 200ms para no martillar el endpoint durante el autoplay.
  useEffect(() => {
    if (fumigationsByMonth.length === 0) {
      setLiveSummary(fumigationsSummary ?? null);
      return;
    }
    if (timeRange[0] === 0 && timeRange[1] >= fumigationsByMonth.length - 1) {
      // Rango completo → usar el summary del server (sin round-trip).
      setLiveSummary(fumigationsSummary ?? null);
      return;
    }
    const fromBucket = fumigationsByMonth[timeRange[0]];
    const toBucket = fumigationsByMonth[timeRange[1]];
    if (!fromBucket || !toBucket) return;
    const fromIso = fromBucket.key + "-01";
    // end of month: primer día del mes siguiente - 1 día
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
  }, [timeRange, fumigationsByMonth, parcels]);

  return (
    <div className="flex flex-col gap-4">
      {/* Page header compacto: logo + título + subtítulo + (der) chip + botón Filtros */}
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

        {/* Right: chip "X Parcelas" + botón "Filtros" */}
        <div className="flex items-center gap-2">
          <span
            aria-label={`${resultCount} parcelas`}
            className="inline-flex items-center gap-2 rounded-full border border-[#0b5f2d]/25 bg-[#dbe7df] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#0b5f2d]"
            data-testid="map-page-header-parcel-count"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#0b5f2d]" />
            {resultCount} Parcelas
          </span>
          <button
            aria-expanded={!filterCollapsed}
            aria-label={filterCollapsed ? "Abrir filtros" : "Cerrar filtros"}
            className="inline-flex items-center gap-2 rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#121815] shadow-sm transition hover:border-[#0b5f2d]/40 hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
            data-testid="map-page-header-filters-button"
            onClick={toggleFilters}
            type="button"
          >
            <span aria-hidden="true" className="text-sm leading-none">⚲</span>
            Filtros
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
            onSelect={setSelectedParcelId}
            parcels={parcels}
            selectedParcelId={selectedParcelId}
          />

        {/*
          v2.0 (sprint S5) — KPIs overlay pill. Se monta en la esquina
          superior izquierda del mapa (no choca con el basemap badge que
          está bottom-right). Es `pointer-events-auto` para que el cursor
          no atraviese la pill; `flex-wrap` para que en mobile los items
          salten de línea.

          Usa `liveSummary` (state) en vez de `fumigationsSummary` (prop
          inicial) para que se actualice cuando el TimeRange cambia.
          Si está cargando, baja opacidad para feedback visual.
        */}
        {liveSummary ? (
          <div
            className="pointer-events-none absolute left-3 top-3 z-[500] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2"
            data-testid="map-kpi-overlay"
          >
            <div className={summaryLoading ? "opacity-60" : ""}>
              <KpiPill
                items={[
                  { kind: "aplicaciones", value: liveSummary.count },
                  { kind: "hectareas", value: `${liveSummary.areaHa.toFixed(1)} ha` },
                  { kind: "volumen", value: `${liveSummary.volumeL.toFixed(1)} L` },
                  { kind: "vuelos", value: liveSummary.flights }
                ]}
              />
            </div>
          </div>
        ) : null}

        {/*
          v2.0 (sprint S5) — TimeRange slider. Se monta en la parte
          inferior del mapa, encima del basemap badge. Es el equivalente
          del slider del V0 (docs/fumigation-management-dashboard/components/geovisor/time-range.tsx).
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
        */}
        {!filterCollapsed ? (
          <div
            className="absolute right-4 top-4 z-[1100] w-[320px] max-w-[calc(100vw-2rem)]"
            data-testid="map-filter-drawer"
          >
            <div className="relative">
              <MapFilterSidebar
                collapsed={false}
                onToggle={toggleFilters}
                resultCount={resultCount}
                summary={summary}
              />
              {/* Botón cerrar superpuesto (chevron `<`) en la esquina
                  superior izquierda del drawer, igual que en el mockup. */}
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
          Patrón del V0 (docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx):
          el operador ve cada parcela con su status de cadencia, nombre,
          área y count de aplicaciones. Click selecciona → MapView
          hace flyTo + highlight.

          En mobile (lg-) el rail se apila debajo del mapa; en desktop
          (lg+) es una columna fija a la derecha.
        */}
        <div className="lg:w-84 lg:shrink-0 lg:overflow-hidden">
          <ParcelsList
            parcels={parcels}
            selectedId={selectedParcelId}
            onSelect={setSelectedParcelId}
          />
        </div>
      </div>
    </div>
  );
}
