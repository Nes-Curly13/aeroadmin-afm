import { AppShell } from "@/components/app-shell";
import { MapFilterSidebar } from "@/components/map/map-filter-sidebar";
import { MapView } from "@/components/map-view";
import { getFumigatedParcelIdsSince, getParcelsNormalized, getParcelsSummary } from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { toDateString } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";

// (Sprint 7) Antes `force-dynamic` — ahora `auto`: el cache de
// `unstable_cache` con TTL 60s se aplica al listado de parcelas + summary.
// El mapa siempre lee data fresca al primer click del usuario (CSR).
//
// v1.3 Track A (2026-07-21): panel de filtros server-side via searchParams.
// La sidebar de filtros se renderiza junto al mapa (critical path) y
// necesita la lista de drones = `getParcelsSummary()`. Esa query se
// mueve del island al critical path. El fumigated filter se aplica
// in-memory sobre el resultado de `getParcelsNormalized` (el Set<number>
// ya está en memoria del critical path desde M3-M5 Track A).
//
// v1.7 Track B (2026-07-22): refactor de layout. El mapa pasa a ser
// el elemento principal del body (flex fill-height, ~70%) con la
// sidebar de filtros a la derecha (~30%, 320px). Se elimina el panel
// de filtros horizontal (v1.3) y el `<Suspense>` con `MapStatsIsland`
// que vivía debajo (v1.2 Track A perf) — los stats eran visual clutter,
// el mapa ya muestra polígonos fumigados/no fumigados con el flag
// `hasFumigation`. Sin `<Suspense>`, las 3 queries del critical path
// (parcels + fumigatedIds + summary) van en un solo `Promise.all` y
// el mapa aparece cuando `max` resuelve. Se mantiene `auto` (no se
// cambia a `force-dynamic`) — el comportamiento de cache es el mismo,
// solo cambia la composición del body.
interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * v1.3 — Tipos de los searchParams que la sidebar entiende. Reusamos
 * los mismos tipos que `MapFilterSidebar` exporta (single source of
 * truth — no redefinir acá).
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
  // columnas planas). getAlerts/getFlights ya no se usan acá desde v1.7 —
  // el `<Suspense>` con MapStatsIsland se eliminó.
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

  // v1.5: sidebar gate. Lee del JWT, sin DB hit. Se pasa al AppShell
  // para que el sidebar desktop oculte /devices a supervisores.
  // Si la query falla, viewerRole=null y el sidebar muestra todo
  // (acceptable: defense in depth).
  const viewerRole = await getViewerRole();

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
      viewerRole={viewerRole}
    >
      {/*
        v1.7 Track B — layout horizontal: mapa (main) a la izquierda,
        sidebar de filtros a la derecha.

        Altura del contenedor: `h-[calc(100vh-220px)]` (mismo cálculo
        que el `min-h` interno de `<MapView>`). 220px = header (64)
        + padding del main (32 en lg) + bloque eyebrow/título/subtítulo
        (~120). En mobile (flex-col) el mapa tiene `min-h-[60vh]` para
        que ocupe un viewport razonable antes de empujar la sidebar
        hacia abajo.

        En desktop (lg:flex-row) el mapa es `flex-1` (~70% del ancho
        útil, descontando la sidebar de 320px + gap de 16px) y la
        sidebar es `w-80` (~30%, ~320px) con `overflow-y-auto` por
        si los filtros crecen.

        El 220px difiere del 128px que mencionaba el spec original
        (header 64 + padding del main 32 = 96). El bloque de título
        de la page (eyebrow + h1 + subtítulo) consume ~120px más
        y sin descontarlo la sidebar queda recortada por debajo del
        viewport en viewports típicos (1080p con sidebar del sistema
        abierta, etc.).
      */}
      <div className="flex flex-col gap-4 lg:h-[calc(100vh-220px)] lg:flex-row">
        {/* Mapa (main) — flex-1, ocupa el alto del flex container */}
        <div className="min-h-[60vh] flex-1 lg:min-h-0">
          <MapView
            alerts={[]}
            flightPoints={[]}
            flights={[]}
            fumigatedParcelIds={fumigatedIds}
            parcels={visibleParcels}
          />
        </div>

        {/* Sidebar de filtros (right) — w-80 fijo en desktop, scroll si crece */}
        <div className="lg:w-80 lg:overflow-y-auto">
          <MapFilterSidebar
            resultCount={visibleParcels.length}
            summary={summary}
          />
        </div>
      </div>
    </AppShell>
  );
}
