import { AppShell } from "@/components/app-shell";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { SyncBanner, loadSyncHealth } from "@/components/dashboard/sync-banner";
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
    // M4/F1.16: count exclusivo de parcelas YA vencidas para el chip
    // "Vencidas: N" del sidebar. Lo separamos del `overdue` de arriba
    // (maxDaysAhead=14, que también trae las "vence pronto") porque el
    // chip del sidebar debe mostrar el número URGENTE, no el agregado.
    // Cacheada con tag `afm:overdue` (mismo TTL 60s) — se invalida en
    // `invalidateAfterFumigationMutation()`.
    overdueNow,
    // Sprint A — F4.0: comparativa ayer/hoy. Cacheada 5min con tag
    // `afm:activity-comparison`. La incluimos en el Promise.all para
    // que corra en paralelo con las otras 6 queries del dashboard.
    activityComparison,
    // M12 — health del sync DJI para el banner superior. No cacheado
    // (loadSyncHealth lee el file system directo, ~1ms). Si el archivo
    // no existe, devuelve status='unknown' sin romper.
    syncHealth
  ] = await Promise.all([
    getDashboardMetrics(),
    // (S1.7 / 2026-07-01) Migrado de getParcels() (legacy, lee dji_land_assets shape)
    // a getParcelsNormalized() — tabla dji_parcels, 1 fila por campo, columnas planas.
    // Mismo origen de datos que /map, garantiza coherencia entre dashboard y mapa.
    getParcelsNormalized(1, 200),
    getFlights(),
    getAlerts(),
    getUpcomingFumigations(8),
    // M3-M5 Q2: lista completa de parcelas overdue + due_soon para el
    // KPI "Atrasadas" del dashboard (UpcomingFumigations + overdueKPI).
    // Cacheada con TTL 60s (tag `afm:overdue`).
    getOverdueParcels({ maxDaysAhead: 14 }),
    // M4/F1.16: SOLO las ya vencidas (maxDaysAhead=0). El chip del
    // sidebar muestra el número que requiere acción inmediata, no
    // "vencen esta semana". Si la lista está vacía, el chip se oculta.
    getOverdueParcels({ maxDaysAhead: 0, limit: 200 }),
    getActivityComparison(),
    loadSyncHealth()
  ]);

  const overdueCount = overdue.filter((p) => p.severity === "overdue").length;
  // M4/F1.16: overdueNow YA está filtrado a severity='overdue' (por
  // la condición de fecha maxDaysAhead=0). El .length es el chip count.
  const overdueSidebarCount = overdueNow.length;

  // v1.5: sidebar gate. Lee el role del JWT (sin DB hit) y filtra
  // /devices si el viewer es supervisor. Si no hay sesion, devuelve
  // null y el sidebar muestra todo (acceptable, middleware ya redirige).
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="Panel de Control"
      highAlertsCount={countHighAlerts(alerts)}
      overdueCount={overdueSidebarCount}
      parcelsCount={parcelsResult.data.length}
      subtitle="Resumen operativo de la fumigación con drones DJI Agras. Trazabilidad por día, alertas y cobertura por dron."
      title="AeroAdmin AFM"
      viewerRole={viewerRole}
    >
      <div className="space-y-5">
        {/* M12 — banner de salud del sync DJI. Server-rendered para
            evitar parpadeo cliente-servidor. Va arriba del dashboard
            porque es info operacional URGENTE (si el sync está caído
            hace 24h, los datos del panel pueden estar stale). */}
        <SyncBanner response={syncHealth} />
        <DashboardClient
          activityComparison={activityComparison}
          alerts={alerts}
          flights={flightsResult.data}
          metrics={metrics}
          overdueCount={overdueCount}
          parcels={parcelsResult.data}
          upcoming={upcoming}
        />
      </div>
    </AppShell>
  );
}
