"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { formatArea, formatNumber } from "@/lib/format";
import { getAlertLevel } from "@/lib/alerts";
import { OperationsSummary } from "@/components/dashboard/operations-summary";
import { RecentFlightsList } from "@/components/dashboard/recent-flights-list";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type {
  AlertLevel,
  DashboardMetrics,
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord
} from "@/lib/types";

export interface OperationsPanelProps {
  metrics: DashboardMetrics;
  alerts: DjiAlertRecord[];
  flights: DjiDailySummaryRecord[];
  // (S1.7 / 2026-07-01) Migrado de DjiAssetRecord[] a DjiParcelRecord[].
  // El dashboard ahora lee del modelo normalizado (dji_parcels) con columnas
  // planas: is_orchard, spray_area_m2, field_type, waypoint_count, etc.
  // El legacy DjiAssetRecord tenía 3 filas por campo + JSONB opaco.
  parcels: DjiParcelRecord[];
}

/**
 * Panel principal del dashboard.
 * Compone: reporte 2026, registro reciente (con filtro), alertas DJI, acceso rapido, sincronización DJI.
 *
 * Las 4 KPIs principales (Registros Totales, Área Cubierta, etc.) NO se renderizan aquí;
 * las pone el `app/page.tsx` arriba para evitar duplicación.
 */
export function OperationsPanel({ metrics, alerts, flights, parcels }: OperationsPanelProps) {
  const [alertFilter, setAlertFilter] = useState<AlertLevel | "ALL">("ALL");

  const yearTotalArea = useMemo(
    () => flights.reduce((sum, flight) => sum + Number(flight.area_mu), 0),
    [flights]
  );
  const yearTotalUsage = useMemo(
    () => flights.reduce((sum, flight) => sum + Number(flight.usage_liters), 0),
    [flights]
  );
  const avgArea = flights.length ? yearTotalArea / flights.length : 0;
  const avgUsage = flights.length ? yearTotalUsage / flights.length : 0;
  const highDays = flights.filter(
    (flight) => getAlertLevel(Number(flight.area_mu), Number(flight.times_count)) === "HIGH"
  ).length;

  const topMonth = useMemo(() => {
    const monthMap = new Map<string, number>();
    for (const flight of flights) {
      const month = new Date(flight.record_date).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit"
      });
      monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
    }
    const sorted = [...monthMap.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0] ? { month: sorted[0][0], count: sorted[0][1] } : null;
  }, [flights]);

  const lastSyncFlight = flights[0];
  const maxAlertDays = alerts.length > 0 ? Math.max(...alerts.map((alert) => alert.age_days)) : 0;
  const renderableParcels = parcels.filter((parcel) => parcel.spray_geometry).length;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
      <section className="space-y-6">
        <OperationsSummary
          avgArea={avgArea}
          avgUsage={avgUsage}
          highDays={highDays}
          topMonth={topMonth?.month}
          topMonthCount={topMonth?.count ?? 0}
          yearTotalArea={yearTotalArea}
          yearTotalUsage={yearTotalUsage}
        />

        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Acceso rapido</p>
              <h3 className="mt-1 text-xl font-semibold text-[#121815]">Explorar capas y reportes</h3>
            </div>
            <Link className="rounded-full border border-[#cfd8d3] px-4 py-2 text-sm font-semibold text-[#0b5f2d]" href="/map">
              Ver mapa
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-[#f4f7f4] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Alerta dominante</p>
              <p className="mt-1 text-sm text-[#121815]">{alerts[0]?.level ?? "LOW"}</p>
            </div>
            <div className="rounded-xl bg-[#f4f7f4] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Activos renderizables</p>
              <p className="mt-1 text-sm text-[#121815]">{renderableParcels} con geometria</p>
            </div>
          </div>
        </div>

        <RecentFlightsList alertFilter={alertFilter} flights={flights} onAlertFilterChange={setAlertFilter} />
      </section>

      <aside className="space-y-6">
        <AlertsPanel alertFilter={alertFilter} alerts={alerts} onAlertFilterChange={setAlertFilter} />

        <div className="rounded-2xl border border-[#0f1713] bg-[#0f1713] p-6 text-white shadow-[0px_18px_40px_rgba(15,23,42,0.18)]">
          <h3 className="mb-4 text-xl font-semibold">Sincronización DJI</h3>
          <div className="space-y-4">
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">Assets importados</p>
              <p className="mt-1 text-lg font-semibold">{formatNumber(metrics.totalAssets)}</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ffd38a]">Máxima alerta</p>
              <p className="mt-1 text-lg font-semibold">{maxAlertDays} días</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">Última operación</p>
              <p className="mt-1 text-lg font-semibold">{lastSyncFlight?.work_time_text ?? "Sin datos"}</p>
            </div>
            <p className="text-xs text-[#c8dcd0]">Datos importados desde DJI SmartFarm y persistidos en PostGIS.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <h3 className="mb-4 text-lg font-semibold text-[#121815]">Resumen del periodo</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#4a5b50]">Area acumulada</span>
              <span className="font-semibold text-[#121815]">{formatArea(yearTotalArea)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#4a5b50]">Litros acumulados</span>
              <span className="font-semibold text-[#121815]">{yearTotalUsage.toFixed(1)} L</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#4a5b50]">Dias de riesgo</span>
              <span className="font-semibold text-[#7a1d1d]">{highDays}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
