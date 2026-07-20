import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { MapView } from "@/components/map-view";
import { MapStatsIsland } from "@/components/map/map-stats-island";
import { MapStatsSkeleton } from "@/components/map/map-stats-skeleton";
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
//   - Stats (island): summary + flights + alerts + flightPoints → streamean
//     después, dentro de un <Suspense> con fallback <MapStatsSkeleton />.
// El mapa aparece apenas las 2 críticas resuelven; los stats se hidratan
// después sin bloquear el render principal.

export default async function MapPage() {
  // Opción B: usamos la tabla normalizada dji_parcels (1 fila por campo con
  // columnas planas). Mantenemos getAlerts y getFlights (legacy) por ahora
  // hasta migrar la lógica de alertas a dji_fumigations.
  // M6: getFlightPoints() agrega circulos en el mapa con la posición
  // (lng, lat) de los 300 sorties mas recientes.
  // M3-M5 Track A: getFumigatedParcelIdsSince(6m) alimenta el flag
  // `hasFumigation` por parcela — fumigadas se ven solidas, no fumigadas
  // dashed con fill atenuado.
  const sixMonthsAgo = toDateString(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6)) ?? "1970-01-01";

  // QUERIES CRÍTICAS (mapa) — solo 2. parcels está cacheado con TTL 60s;
  // fumigatedIds es un SELECT chico sobre dji_fumigations. max(críticas)
  // define cuándo aparece el mapa, sin esperar al resto.
  const [parcelsResult, fumigatedIds] = await Promise.all([
    getParcelsNormalized(1, 200),
    getFumigatedParcelIdsSince(sixMonthsAgo)
  ]);

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
      parcelsCount={parcelsResult.data.length}
      subtitle="Mapa operativo de parcelas DJI con geometría, plan de vuelo y configuración. Toggle de capas, selector de parcela activa y detalle al costado."
      title="Mapa de Parcelas"
    >
      {/* QUERIES NO-CRÍTICAS (island) — streamean con Suspense.
          El skeleton aparece mientras las 4 queries resuelven; el mapa
          ya está renderizado abajo. La promesa se completa una vez que
          TODAS las queries del Promise.all estén listas, pero el usuario
          ya ve el mapa interactivo. */}
      <Suspense fallback={<MapStatsSkeleton />}>
        <MapStatsSection
          fumigatedIds={fumigatedIds}
          parcels={parcelsResult.data}
          sectionQueries={Promise.all([
            getParcelsSummary(),
            getFlights(),
            getAlerts(),
            getFlightPoints(300)
          ])}
        />
      </Suspense>

      <MapView
        alerts={[]}
        flightPoints={[]}
        flights={[]}
        fumigatedParcelIds={fumigatedIds}
        parcels={parcelsResult.data}
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
 * queries "lentas" (summary, flights, alerts, flightPoints) se inyectan vía
 * `sectionQueries` para que el HTML del island se streame apenas resuelvan.
 */
async function MapStatsSection({
  parcels,
  fumigatedIds,
  sectionQueries
}: {
  parcels: DjiParcelRecord[];
  fumigatedIds: Set<number>;
  sectionQueries: Promise<
    [
      Awaited<ReturnType<typeof getParcelsSummary>>,
      Awaited<ReturnType<typeof getFlights>>,
      Awaited<ReturnType<typeof getAlerts>>,
      Awaited<ReturnType<typeof getFlightPoints>>
    ]
  >;
}) {
  const [summary, flightsResult, alerts, flightPoints] = await sectionQueries;

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
