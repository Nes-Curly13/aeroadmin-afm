"use client";

/**
 * components/map/map-stats-island.tsx
 *
 * v1.2 Track A perf (2026-07-20): island que encapsula las 5 KPI cards y los
 * 2 paneles "distribución por drone" + "resúmenes operativos" del /map.
 *
 * Por qué client component:
 *   - Los KPIs y los paneles se renderizan dentro de un <Suspense> del
 *     server component. Una vez que resuelven las queries "lentas"
 *     (getParcelsSummary, getFlights, getAlerts, getFlightPoints), el
 *     servidor streamea el HTML de este island al cliente.
 *   - Marcado como "use client" para que cualquier interacción futura
 *     (hover, expand, etc.) no necesite un refactor; hoy es 100% presentacional
 *     pero la decisión arquitectónica es coherente con el resto del mapa
 *     (MapView es client por Leaflet).
 *
 * Por qué NO toca el mapa:
 *   - El mapa (MapView) se streamea primero — solo necesita parcels +
 *     fumigatedParcelIds. Si este island estuviera acoplado al mapa, una
 *     query lenta (ej. getAlerts) bloquearía la aparición del mapa.
 *
 * Datos consumidos:
 *   - parcels: DjiParcelRecord[] — base para los conteos (KPIs 1, 2, 3, 5)
 *   - summary: agregación por drone (panel distribución + KPI 4)
 *   - flights: { data, total } — KPI "días registrados"
 *   - alerts: DjiAlertRecord[] — KPI "alertas altas"
 *   - flightPoints: FlightPointRecord[] — recibido por consistencia con el
 *     contrato del page.tsx (lo usa MapView para overlay, no este island)
 *   - fumigatedIds: Set<number> — KPI "fumigadas (6m)"
 */

import type { getParcelsSummary } from "@/api/repositories";
import type {
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord,
  FlightPointRecord
} from "@/lib/types";

type ParcelsSummaryRow = Awaited<ReturnType<typeof getParcelsSummary>>[number];

export interface MapStatsIslandProps {
  parcels: DjiParcelRecord[];
  summary: ParcelsSummaryRow[];
  flights: { data: DjiDailySummaryRecord[]; total: number; page?: number; limit?: number; totalPages?: number };
  alerts: DjiAlertRecord[];
  flightPoints: FlightPointRecord[];
  fumigatedIds: Set<number>;
}

function formatM2(m2: number): string {
  return m2.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatHa(m2: number): string {
  return `${(m2 / 10_000).toFixed(2)} ha`;
}

/**
 * Helper para agregar summary por drone y mostrarlo como barras.
 * Robusto ante drone_model_name NULL (los agrupa como "Sin asignar").
 */
function aggregateDrones(summary: ParcelsSummaryRow[]) {
  const counts = new Map<string, number>();
  for (const row of summary) {
    const name = row.drone_model_name || "Sin asignar";
    counts.set(name, (counts.get(name) ?? 0) + Number(row.count_by_drone));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function MapStatsIsland({
  parcels,
  summary,
  flights,
  alerts,
  fumigatedIds
}: MapStatsIslandProps) {
  // Cálculos derivados — puros, sin side effects.
  const droneRows = aggregateDrones(summary);
  const totalDroneParcels = droneRows.reduce((acc, [, count]) => acc + count, 0);
  const orchards = parcels.filter((p) => p.is_orchard).length;
  const totalParcels = parcels.length;
  const withWaypoints = parcels.filter((p) => (p.waypoint_count ?? 0) > 0).length;
  const totalSprayM2 = parcels.reduce((s, p) => s + (p.spray_area_m2 ?? 0), 0);
  const fumigatedCount = parcels.filter((p) => fumigatedIds.has(p.id)).length;
  const highAlerts = alerts.filter((a) => a.level === "HIGH").length;

  return (
    <>
      {/* 5 KPI cards */}
      <div className="mb-4 grid gap-4 md:grid-cols-5" data-testid="map-stats-kpis">
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Parcelas</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{totalParcels}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">
            {orchards} orchards · {totalParcels - orchards} farmland
          </p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Área fumigable</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{formatHa(totalSprayM2)}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{formatM2(totalSprayM2)} m² agregados</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Con plan de vuelo</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{withWaypoints}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">de {totalParcels} parcelas</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Drones en flota</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{droneRows.length}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">
            {droneRows.map(([k, v]) => `${v} ${k.split(" ")[0]}`).join(" · ")}
          </p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Fumigadas (6m)</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{fumigatedCount}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{totalParcels - fumigatedCount} sin fumigación reciente</p>
        </div>
      </div>

      {/* 2 paneles */}
      <div className="mb-6 grid gap-4 md:grid-cols-2" data-testid="map-stats-panels">
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Distribución por drone</p>
          <div className="mt-3 space-y-2">
            {droneRows.length === 0 ? (
              <p className="text-sm text-[#4a5b50]">Sin drones asignados todavía.</p>
            ) : (
              droneRows.map(([name, count]) => {
                const pct = totalDroneParcels > 0 ? (count / totalDroneParcels) * 100 : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-[#121815]">{name}</span>
                      <span className="text-[#4a5b50]">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#f0f4f1]">
                      <div
                        className="h-full bg-[#0b5f2d]"
                        data-drone-bar="true"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Resúmenes operativos</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[#4a5b50]">Días registrados</p>
              <p className="text-2xl font-black text-[#121815]">{flights.total}</p>
            </div>
            <div>
              <p className="text-[#4a5b50]">Alertas altas</p>
              <p className="text-2xl font-black text-[#a93232]">{highAlerts}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
