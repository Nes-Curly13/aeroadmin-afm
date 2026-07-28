import { AppShell } from "@/components/app-shell";
import { DashboardV0Client } from "@/components/dashboard/dashboard-v0-client";
import { SyncBanner, loadSyncHealth } from "@/components/dashboard/sync-banner";
import {
  getFumigationsForMap,
  getFumigationsByMonth,
  getParcelsNormalized,
  getRecentFumigations,
  getOverdueParcels
} from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { toDateString } from "@/lib/format";
import { COLORS } from "@/lib/ui-tokens";
import type { MonthlyBar } from "@/components/dashboard/monthly-chart";
import type { DjiFumigationEvent, DjiParcelRecord, DjiDailySummaryRecord } from "@/lib/types";

/**
 * Dashboard principal (`/`).
 *
 * v2.1 (sprint S7) — port del V0 mockup. Reemplaza el `DashboardClient`
 * bento con el `DashboardV0Client` que replica el dashboard del V0:
 *   - 4 KPI cards grandes con delta % (ha30 / aplicaciones30 / vuelos30 / volumen30).
 *   - MonthlyChart 12 meses + Card "Uso de la flota" con progress bars.
 *   - CompliancePanel + HealthPanel.
 *   - RecentActivity (12 fumigaciones recientes).
 *
 * Decisiones:
 *   - El banner `SyncBanner` se mantiene arriba del dashboard (urgencia
 *     operacional: si el sync DJI está caído hace 24h, los datos pueden
 *     estar stale).
 *   - El `DashboardClient` viejo queda como archivo legacy (no usado
 *     por este page). Se puede eliminar en un cleanup futuro.
 */
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export default async function DashboardPage() {
  const now = new Date();
  const today = toDateString(now) ?? "1970-01-01";
  const thirtyDaysAgo = toDateString(new Date(now.getTime() - 30 * DAY_MS)) ?? "1970-01-01";
  const sixtyDaysAgo = toDateString(new Date(now.getTime() - 60 * DAY_MS)) ?? "1970-01-01";
  const twelveMonthsAgo = toDateString(new Date(now.getTime() - 365 * DAY_MS)) ?? "1970-01-01";

  // 7 queries en paralelo.
  const [
    parcelsResult,
    allFumigations,
    last30,
    prev30,
    monthsBuckets,
    recentFumigations,
    overdue,
    healthRaw
  ] = await Promise.all([
    getParcelsNormalized(1, 200),
    // v2.1: total histórico (no por rango) — derivado de un fetch sin
    // filtros. La página actual NO necesita el total absoluto, pero
    // el DashboardV0Client sí (description: "N aplicaciones historicas").
    // Usamos `getFumigationsForMap({})` que trae todas las fumigaciones
    // ordenadas desc (limit interno del repo). Suficiente para el total.
    getFumigationsForMap({ parcelIds: [], from: undefined, to: undefined }),
    getFumigationsForMap({ from: thirtyDaysAgo, to: today }),
    getFumigationsForMap({ from: sixtyDaysAgo, to: thirtyDaysAgo }),
    getFumigationsByMonth({ from: twelveMonthsAgo, to: today }),
    getRecentFumigations(12),
    getOverdueParcels({ maxDaysAhead: 14 }),
    loadSyncHealth()
  ]);

  const totalParcels = parcelsResult.data.length;
  const totalHa = parcelsResult.data.reduce(
    (s, p) => s + (p.declared_area_ha ?? 0),
    0
  );

  // KPIs de los últimos 30 días + delta % vs 30 días anteriores.
  const sumHa = (events: DjiFumigationEvent[]) =>
    events.reduce((s, e) => s + (e.area_fumigated_m2 ?? 0) / 10000, 0);
  const sumVol = (events: DjiFumigationEvent[]) =>
    events.reduce(
      (s, e) =>
        s +
        ((e.dose_l_per_ha ?? 0) * (e.area_fumigated_m2 ?? 0)) / 10000,
      0
    );
  // Flights count: no tenemos el campo directo. Usamos `flight_ids.length`
  // (sumamos todos los flight_ids únicos). Aproximación — para el V0 era
  // `flights_count` por evento.
  const sumFlights = (events: DjiFumigationEvent[]) =>
    events.reduce((s, e) => s + (e.flight_ids?.length ?? 0), 0);

  // Monthly series (12 meses) — `monthsBuckets` ya viene en el shape
  // `{ key, label, start, end, count }`. Necesitamos derivar `ha` por
  // mes cruzando con `allFumigations`.
  const monthly: MonthlyBar[] = monthsBuckets.map((m) => {
    const evsInMonth = allFumigations.filter((e) => {
      const t = new Date(e.fumigation_date).getTime();
      return t >= m.start && t <= m.end;
    });
    return {
      label: m.label,
      ha: Math.round(sumHa(evsInMonth) * 10) / 10,
      flights: sumFlights(evsInMonth)
    };
  });

  // Fleet usage — agregamos por modelo de dron. El proyecto tiene 4
  // modelos de DJI hardcoded en `dji_drone_models` (no hay query — los
  // modelos se mantienen en el schema, no cambian). Usamos nombres y
  // tank_l hardcoded.
  const DRONE_MODELS: Record<number, { name: string; tank_l: number }> = {
    0: { name: "Sin asignar", tank_l: 0 },
    72: { name: "Agras T16 / T20", tank_l: 16 },
    201: { name: "Agras T40 / T50", tank_l: 40 },
    210: { name: "Agras T70 / similar", tank_l: 70 }
  };
  const fleetAgg = new Map<number, { flights: number; ha: number }>();
  for (const e of allFumigations) {
    if (e.drone_code_used == null) continue;
    const cur = fleetAgg.get(e.drone_code_used) ?? { flights: 0, ha: 0 };
    cur.flights += e.flight_ids?.length ?? 0;
    cur.ha += (e.area_fumigated_m2 ?? 0) / 10000;
    fleetAgg.set(e.drone_code_used, cur);
  }
  const fleet = Array.from(fleetAgg.entries())
    .map(([modelId, agg]) => {
      const model = DRONE_MODELS[modelId] ?? { name: `Drone ${modelId}`, tank_l: 0 };
      return {
        modelId,
        modelName: model.name,
        tankL: model.tank_l,
        // v2.1: el `color` del V0 no existe en `dji_drone_models`. Usamos
        // tokens de `ui-tokens.ts` rotando por modelId (4 colors del
        // brand palette). Aceptable mientras el schema no agregue el campo.
        color:
          [COLORS.primary, COLORS.success, COLORS.warning, COLORS.info, COLORS.completed][
            modelId % 5
          ] ?? COLORS.primary,
        flights: agg.flights,
        ha: Math.round(agg.ha * 10) / 10
      };
    })
    .filter((f) => f.flights > 0)
    .sort((a, b) => b.flights - a.flights);

  // Health — `loadSyncHealth` ya devuelve un `HealthResponse` listo
  // para pasar al `HealthPanel`.
  const health = healthRaw;

  // Map<id, parcel> para RecentActivity (links).
  const parcelById = new Map<number, DjiParcelRecord>();
  for (const p of parcelsResult.data) parcelById.set(p.id, p);

  // v1.5: sidebar gate.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="Panel de Control"
      highAlertsCount={0}
      overdueCount={0}
      parcelsCount={totalParcels}
      subtitle="Resumen operativo de la fumigación con drones DJI Agras. Trazabilidad por día, alertas y cobertura por dron."
      title="AeroAdmin AFM"
      viewerRole={viewerRole}
    >
      <div className="space-y-5">
        <SyncBanner response={health} />
        <DashboardV0Client
          fleet={fleet}
          health={health}
          healthSteps={health.steps}
          kpi30={{
            ha: Math.round(sumHa(last30) * 10) / 10,
            haPrev: Math.round(sumHa(prev30) * 10) / 10,
            count: last30.length,
            countPrev: prev30.length,
            flights: sumFlights(last30),
            flightsPrev: sumFlights(prev30),
            volume: Math.round(sumVol(last30) * 10) / 10,
            volumePrev: Math.round(sumVol(prev30) * 10) / 10
          }}
          monthly={monthly}
          overdue={overdue}
          parcelById={parcelById}
          recentFumigations={recentFumigations}
          totalFumigations={allFumigations.length}
          totalHa={totalHa}
          totalParcels={totalParcels}
          totalFlights={allFumigations.reduce((s, e) => s + (e.flight_ids?.length ?? 0), 0)}
        />
      </div>
    </AppShell>
  );
}
