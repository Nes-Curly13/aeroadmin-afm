import { AppShell } from "@/components/app-shell";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import {
  getActivityComparison,
  getAlerts,
  getDashboardMetrics,
  getFlights,
  getOverdueParcels,
  getParcelsNormalized,
  getUpcomingFumigations
} from "@/api/repositories";
import { countHighAlerts } from "@/lib/alerts";
import { getViewerRole } from "@/lib/auth/role";

// (Sprint 7) Antes `force-dynamic` — eso deshabilitaba el data cache de Next
// y nuestras `unstable_cache` no se podían usar. Ahora la página usa `auto`:
// si los tags de `afm:metrics`, `afm:alerts`, `afm:upcoming` están frescos,
// Next sirve la versión cacheada y gana ~3 queries pesadas por render.

/**
 * Dashboard principal (`/`).
 *
 * Sprint v1.7 — Track A (UI overhaul, layout bento):
 *   - El layout vive en `<DashboardClient>` (client component) que
 *     mantiene el state compartido del `alertFilter` (HIGH / MEDIUM /
 *     LOW / ALL) entre `<AlertsPanel>` y `<RecentFlightsList>`.
 *   - Antes (pre-v1.7) esta página renderizaba KPIs en grid 5-col +
 *     2 paneles apilados en `<div className="mt-5">`. Ahora es un
 *     `<BentoGrid>` con: 5 KPIs (mix colSpan=2+3), 2 cards 6×2
 *     (Upcoming + Alerts), 1 card full-width (OperationsPanel).
 *   - El badge "Vista operativa en vivo" que estaba en el slot
 *     `actions` del AppShell se quitó (sprint v1.7 — Track A): ocupaba
 *     un lugar privilegiado en el header pero no aportaba info accionable
 *     para el operador. El slot queda undefined; AppShell ya lo trata
 *     como opcional.
 *
 * Server Component (sin "use client") — fetcha en paralelo y delega.
 */
export default async function DashboardPage() {
  const [
    metrics,
    parcelsResult,
    flightsResult,
    alerts,
    upcoming,
    overdue,
    // Sprint A — F4.0: comparativa ayer/hoy. Cacheada 5min con tag
    // `afm:activity-comparison`. La incluimos en el Promise.all para
    // que corra en paralelo con las otras 6 queries del dashboard.
    activityComparison
  ] = await Promise.all([
    getDashboardMetrics(),
    // (S1.7 / 2026-07-01) Migrado de getParcels() (legacy, lee dji_land_assets shape)
    // a getParcelsNormalized() — tabla dji_parcels, 1 fila por campo, columnas planas.
    // Mismo origen de datos que /map, garantiza coherencia entre dashboard y mapa.
    getParcelsNormalized(1, 200),
    getFlights(),
    getAlerts(),
    getUpcomingFumigations(8),
    // M3-M5 Q2: cuenta de parcelas overdue para KPI "Vencidas".
    // Cacheada con TTL 60s (tag `afm:overdue`) — se invalida junto con
    // `upcoming` al registrar una fumigación.
    getOverdueParcels({ maxDaysAhead: 14 }),
    getActivityComparison()
  ]);

  const overdueCount = overdue.filter((p) => p.severity === "overdue").length;

  // v1.5: sidebar gate. Lee el role del JWT (sin DB hit) y filtra
  // /devices si el viewer es supervisor. Si no hay sesion, devuelve
  // null y el sidebar muestra todo (acceptable, middleware ya redirige).
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="Panel de Control"
      highAlertsCount={countHighAlerts(alerts)}
      parcelsCount={parcelsResult.data.length}
      subtitle="Resumen operativo de la fumigación con drones DJI Agras. Trazabilidad por día, alertas y cobertura por dron."
      title="AeroAdmin AFM"
      viewerRole={viewerRole}
    >
      <DashboardClient
        activityComparison={activityComparison}
        alerts={alerts}
        flights={flightsResult.data}
        metrics={metrics}
        overdueCount={overdueCount}
        parcels={parcelsResult.data}
        upcoming={upcoming}
      />
    </AppShell>
  );
}
