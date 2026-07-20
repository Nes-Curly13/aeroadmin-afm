import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { MapFiltersPanel } from "@/components/map/map-filters-panel";
import { MapStatsIsland } from "@/components/map/map-stats-island";
import { MapStatsSkeleton } from "@/components/map/map-stats-skeleton";
import { MapView } from "@/components/map-view";
import { getAlerts, getFlightPoints, getFlights, getFumigatedParcelIdsSince, getParcelsNormalized, getParcelsSummary } from "@/api/repositories";
import { toDateString } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";

// (Sprint 7) Antes `force-dynamic` — ahora `auto`: el cache de
// `unstable_cache` con TTL 60s se aplica al listado de parcelas + summary.
// El mapa siempre lee data fresca al primer click del usuario (CSR).
//
// v1.2 Track A perf (2026-07-20): las queries se dividen en 2 grupos
// para habilitar <Suspense> streaming. Antes, las 6 queries iban en un
// solo `Promise.all` y TTI era `max(las 6)`. Ahora:
//   - Críticas (mapa): parcels + fumigatedIds → bloquean el render del mapa
//   - Stats (island): flights + alerts + flightPoints → streamean
//     después, dentro de un <Suspense> con fallback <MapStatsSkeleton />.
// El mapa aparece apenas las 2 críticas resuelven; los stats se hidratan
// después sin bloquear el render principal.
//
// v1.3 Track A (2026-07-21): panel de filtros server-side via searchParams.
// El panel se renderiza junto al mapa (critical path) y necesita la lista
// de drones = `getParcelsSummary()`. Esa query se mueve del island al
// critical path. El fumigated filter se aplica in-memory sobre el
// resultado de `getParcelsNormalized` (el Set<number> ya está en memoria
// del critical path desde M3-M5 Track A).
interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * v1.3 — Tipos de los searchParams que el panel entiende. Inline porque
 * son privados a esta página (el panel re-define los suyos en el client).
 */
type FumigatedFilter = "" | "yes" | "no";
type CropFilter = "" | "Farmland" | "Orchards";

function parseDroneParam(raw: string | string[] | undefined): number | null {
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCropParam(raw: string | string[] | undefined): CropFilter {
  if (!raw) return "";
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "Farmland" || value === "Orchards") return value;
  return "";
}

function parseFumigatedParam(raw: string | string[] | undefined): FumigatedFilter {
  if (!raw) return "";
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "yes" || value === "no") return value;
  return "";
}

/**
 * Aplica el filtro de fumigación reciente in-memory. Mantenido acá
 * (no en `api/repositories.ts`) porque es lógica de UI: el Set
 * `fumigatedParcelIds` ya está en memoria desde el critical path,
 * serializar al repo function rompería la paralelización de
 * `Promise.all` (parcels ∥ fumigatedIds).
 */
function applyFumigatedFilter(
  parcels: DjiParcelRecord[],
  fumigatedIds: Set<number>,
  mode: FumigatedFilter
): DjiParcelRecord[] {
  if (mode === "") return parcels;
  if (mode === "yes") return parcels.filter((p) => fumigatedIds.has(p.id));
  // mode === "no"
  return parcels.filter((p) => !fumigatedIds.has(p.id));
}

export default async function MapPage({ searchParams }: PageProps) {
  // v1.3 — parsear searchParams. Si están vacíos, el comportamiento
  // es idéntico al pre-v1.3 (back-compat).
  const droneCode = parseDroneParam(searchParams.drone);
  const crop = parseCropParam(searchParams.crop);
  const fumigated = parseFumigatedParam(searchParams.fumigated);

  // Opción B: usamos la tabla normalizada dji_parcels (1 fila por campo con
  // columnas planas). Mantenemos getAlerts y getFlights (legacy) por ahora
  // hasta migrar la lógica de alertas a dji_fumigations.
  // M6: getFlightPoints() agrega circulos en el mapa con la posición
  // (lng, lat) de los 300 sorties mas recientes.
  // M3-M5 Track A: getFumigatedParcelIdsSince(6m) alimenta el flag
  // `hasFumigation` por parcela — fumigadas se ven solidas, no fumigadas
  // dashed con fill atenuado.
  // v1.3 Track A: getParcelsSummary() se mueve del island al critical
  // path porque el panel de filtros necesita la lista de drones al
  // primer render (no podemos mostrar "Todos" si el usuario ya está
  // filtrando — necesitamos que la lista de opciones esté disponible
  // junto con el mapa).
  const sixMonthsAgo = toDateString(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6)) ?? "1970-01-01";

  // QUERIES CRÍTICAS (mapa) — 3 en paralelo. parcels y summary van a la
  // BD (sin cache) si hay filtros; sin filtros van por el wrapper
  // cacheado (TTL 60s). fumigatedIds es un SELECT chico sobre
  // dji_fumigations, siempre uncached.
  // max(críticas) define cuándo aparece el mapa, sin esperar al resto.
  const [parcelsResult, fumigatedIds, summary] = await Promise.all([
    getParcelsNormalized(1, 200, {
      droneModelCode: droneCode ?? undefined,
      fieldType: crop || undefined
    }),
    getFumigatedParcelIdsSince(sixMonthsAgo),
    getParcelsSummary()
  ]);

  // v1.3 — aplicar el filtro de fumigación in-memory sobre el resultado
  // del SQL. Si no hay filtro, esto es un no-op (retorna el array tal cual).
  const visibleParcels = applyFumigatedFilter(parcelsResult.data, fumigatedIds, fumigated);

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-sm font-semibold text-[#4a5b50]">
          Capas y estado espacial
        </div>
      }
      activeSection="map"
      eyebrow="Vista espacial"
      highAlertsCount={0}
      parcelsCount={visibleParcels.length}
      subtitle="Mapa operativo de parcelas DJI con geometría, plan de vuelo y configuración. Toggle de capas, selector de parcela activa y detalle al costado."
      title="Mapa de Parcelas"
    >
      {/* v1.3 — Panel de filtros. DENTRO del critical path (sin Suspense)
          porque necesita la lista de drones al primer render. El form
          navega a /map con searchParams al cambiar — los polígonos del
          mapa ya vienen filtrados del server (getParcelsNormalized
          + applyFumigatedFilter). */}
      <MapFiltersPanel summary={summary} />

      {/* QUERIES NO-CRÍTICAS (island) — streamean con Suspense.
          El skeleton aparece mientras las 3 queries resuelven; el mapa
          ya está renderizado abajo. La promesa se completa una vez que
          TODAS las queries del Promise.all estén listas, pero el usuario
          ya ve el mapa interactivo. */}
      <Suspense fallback={<MapStatsSkeleton />}>
        <MapStatsSection
          fumigatedIds={fumigatedIds}
          parcels={visibleParcels}
          sectionQueries={Promise.all([
            getFlights(),
            getAlerts(),
            getFlightPoints(300)
          ])}
          summary={summary}
        />
      </Suspense>

      <MapView
        alerts={[]}
        flightPoints={[]}
        flights={[]}
        fumigatedParcelIds={fumigatedIds}
        parcels={visibleParcels}
      />
    </AppShell>
  );
}

/**
 * Sub-componente server (async) que corre las queries "lentas" en paralelo
 * y pasa los resultados al MapStatsIsland (client). Vive aquí (en page.tsx)
 * porque solo se usa en este flujo — no merece su propio archivo.
 *
 * Recibe `parcels` y `fumigatedIds` ya calculados por el page.tsx (critical
 * path) para que el island muestre KPIs reales desde el primer frame; las
 * queries "lentas" (flights, alerts, flightPoints) se inyectan vía
 * `sectionQueries` para que el HTML del island se streame apenas resuelvan.
 *
 * v1.3 — ya no recibe `summary` como prop porque se pasa al panel de
 * filtros directamente (panel vive en el critical path, no en el island).
 */
async function MapStatsSection({
  parcels,
  fumigatedIds,
  sectionQueries,
  summary
}: {
  parcels: DjiParcelRecord[];
  fumigatedIds: Set<number>;
  sectionQueries: Promise<
    [
      Awaited<ReturnType<typeof getFlights>>,
      Awaited<ReturnType<typeof getAlerts>>,
      Awaited<ReturnType<typeof getFlightPoints>>
    ]
  >;
  /**
   * v1.3 — pasamos el summary sin filtrar al island. El panel
   * "Distribución por drone" muestra la composición completa de la
   * flota independientemente del filtro activo — si el usuario
   * filtró a Agras T40, la barra de T40 sigue mostrando el conteo
   * total (no solo el subconjunto filtrado) y el resto de las
   * barras siguen visibles para que pueda ver el contexto.
   */
  summary: Awaited<ReturnType<typeof getParcelsSummary>>;
}) {
  const [flightsResult, alerts, flightPoints] = await sectionQueries;

  return (
    <MapStatsIsland
      alerts={alerts}
      flightPoints={flightPoints}
      flights={flightsResult}
      fumigatedIds={fumigatedIds}
      parcels={parcels}
      summary={summary}
    />
  );
}
