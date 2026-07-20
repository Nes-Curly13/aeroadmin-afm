/**
 * components/map/map-stats-skeleton.tsx
 *
 * v1.2 Track A perf (2026-07-20): skeleton del MapStatsIsland.
 *
 * Se muestra mientras el `<Suspense>` boundary del server component está
 * esperando que las queries "lentas" (getParcelsSummary, getFlights,
 * getAlerts, getFlightPoints) resuelvan. El mapa en sí se streamea primero
 * (no necesita esas queries) — esto es el por qué del split.
 *
 * Mismo shape que MapStatsIsland para que la transición a contenido real
 * no produzca layout shift.
 */
export function MapStatsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Cargando estadísticas del mapa"
      className="mb-6 space-y-4"
      data-testid="map-stats-skeleton"
      role="status"
    >
      {/* Skeleton KPIs (5 cards) */}
      <div
        className="grid gap-4 md:grid-cols-5"
        data-kpi-grid="true"
      >
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            className="animate-pulse rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
            data-kpi-skeleton="true"
            key={idx}
          >
            <div className="h-3 w-20 rounded bg-[#e2e8e0]" />
            <div className="mt-3 h-8 w-24 rounded bg-[#e2e8e0]" />
            <div className="mt-2 h-3 w-32 rounded bg-[#e2e8e0]" />
          </div>
        ))}
      </div>

      {/* Skeleton paneles (distribución + resúmenes) */}
      <div
        className="grid gap-4 md:grid-cols-2"
        data-panel-grid="true"
      >
        <div
          className="animate-pulse rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
          data-panel-skeleton="true"
        >
          <div className="h-3 w-32 rounded bg-[#e2e8e0]" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div className="h-4 rounded bg-[#e2e8e0]" key={idx} />
            ))}
          </div>
        </div>
        <div
          className="animate-pulse rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
          data-panel-skeleton="true"
        >
          <div className="h-3 w-32 rounded bg-[#e2e8e0]" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div className="space-y-2" key={idx}>
                <div className="h-3 w-20 rounded bg-[#e2e8e0]" />
                <div className="h-7 w-16 rounded bg-[#e2e8e0]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
