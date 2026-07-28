"use client";

import { Droplets, Map as MapIcon, Plane, Sprout } from "lucide-react";
import Link from "next/link";

import { CompliancePanel } from "@/components/dashboard/compliance-panel";
import { HealthPanel } from "@/components/dashboard/health-panel";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MonthlyChart, type MonthlyBar } from "@/components/dashboard/monthly-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatArea, formatNumber } from "@/lib/format";
import type { HealthResponse, StepHealth } from "@/lib/djiag-health";
import type { DjiFumigationEvent, DjiParcelRecord, OverdueParcel } from "@/lib/types";

/**
 * DashboardV0Client — v2.1 (sprint S7).
 *
 * Replica del dashboard del V0 mockup
 * (`docs/fumigation-management-dashboard/app/page.tsx`) con adaptaciones
 * a nuestro stack:
 *   - 4 KPI cards grandes con delta % (vs 30 días anteriores).
 *   - MonthlyChart (bar chart 12 meses) + Card "Uso de la flota" con
 *     progress bars por modelo de dron.
 *   - CompliancePanel (parcelas por cadencia) + HealthPanel (pipeline DJI).
 *   - RecentActivity (12 fumigaciones recientes con link al parcel).
 *   - Button "Abrir geovisor" en actions del PageHeader.
 *
 * Decisiones del port:
 *   - Mantenemos 4 KPIs (no 5 como el `DashboardClient` bento) porque el
 *     V0 los tiene así y el quinto ("Activos DJI") no tiene equivalente
 *     directo en el dominio del V0.
 *   - El "Uso de la flota" se renderiza con un `Card` primitive (de los 9
 *     nuevos) y progress bars inline. No hay componente `FleetUsage`
 *     en el V0; lo reusamos aquí.
 *   - Las queries las hace `app/page.tsx` y se pasan serializadas.
 */
export interface DashboardV0ClientProps {
  /** Total de parcelas importadas (no solo las visibles). */
  totalParcels: number;
  /** Total de ha sumadas de todos los parcels. */
  totalHa: number;
  /** Total de fumigaciones históricas. */
  totalFumigations: number;
  /** Total de vuelos históricos. */
  totalFlights: number;
  /** KPIs de los últimos 30 días + delta % vs 30 anteriores. */
  kpi30: {
    ha: number;
    haPrev: number;
    count: number;
    countPrev: number;
    flights: number;
    flightsPrev: number;
    volume: number;
    volumePrev: number;
  };
  /** Serie mensual de 12 meses para `MonthlyChart`. */
  monthly: MonthlyBar[];
  /** Resumen de uso de la flota (1 row por modelo de dron). */
  fleet: Array<{
    modelId: number;
    modelName: string;
    tankL: number;
    color: string;
    flights: number;
    ha: number;
  }>;
  /** Estado del pipeline DJI. */
  health: HealthResponse;
  /** Steps del pipeline DJI (alternativa a `dji_import_batches`). */
  healthSteps: StepHealth[];
  /** Parcelas agrupadas por status de cadencia. */
  overdue: OverdueParcel[];
  /** Últimas N fumigaciones. */
  recentFumigations: DjiFumigationEvent[];
  /** Lookup `id → parcel` para los links de RecentActivity. */
  parcelById: Map<number, DjiParcelRecord>;
}

const DAY_MS = 86_400_000;

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function DashboardV0Client({
  totalParcels,
  totalHa,
  totalFumigations,
  totalFlights,
  kpi30,
  monthly,
  fleet,
  health,
  healthSteps,
  overdue,
  recentFumigations,
  parcelById
}: DashboardV0ClientProps) {
  const fleetMaxHa = Math.max(1, ...fleet.map((f) => f.ha));
  return (
    <div className="flex flex-col">
      <PageHeader
        actions={
          <Button render={<Link className="flex items-center gap-1.5" href="/map" />} size="sm">
            <MapIcon className="size-3.5" aria-hidden />
            Abrir geovisor
          </Button>
        }
        description={`Portafolio de ${totalParcels} parcelas de caña (${formatArea(totalHa)} ha) con ${formatNumber(totalFumigations)} aplicaciones y ${formatNumber(totalFlights)} vuelos históricos consolidados desde DJI AG.`}
        eyebrow="Panel de operaciones"
        title="AeroAdmin AFM"
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {/* Fila 1 — 4 KpiCards con delta % (V0) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            delta={pctDelta(kpi30.ha, kpi30.haPrev)}
            hint="vs 30 días anteriores"
            icon={Sprout}
            label="Hectáreas tratadas (30 d)"
            value={`${formatArea(kpi30.ha)} ha`}
          />
          <KpiCard
            delta={pctDelta(kpi30.count, kpi30.countPrev)}
            hint="eventos en dji_fumigations"
            icon={MapIcon}
            label="Aplicaciones (30 d)"
            value={formatNumber(kpi30.count)}
          />
          <KpiCard
            delta={pctDelta(kpi30.flights, kpi30.flightsPrev)}
            hint="sorties en dji_flights"
            icon={Plane}
            label="Vuelos (30 d)"
            value={formatNumber(kpi30.flights)}
          />
          <KpiCard
            delta={pctDelta(kpi30.volume, kpi30.volumePrev)}
            hint="mezcla total asperjada"
            icon={Droplets}
            label="Volumen aplicado (30 d)"
            value={`${kpi30.volume.toFixed(1)} L`}
          />
        </div>

        {/* Fila 2 — MonthlyChart (8 cols) + Uso de la flota (4 cols) */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <MonthlyChart data={monthly} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Uso de la flota</CardTitle>
              <CardDescription>
                Vuelos y hectáreas por modelo (dji_drone_models)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {fleet.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin drones asignados.</p>
              ) : (
                fleet.map((f) => (
                  <div className="flex flex-col gap-1.5" key={f.modelId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{f.modelName}</span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {`${formatNumber(f.flights)} vuelos · ${formatArea(f.ha)} ha`}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(f.ha / fleetMaxHa) * 100}%`, backgroundColor: f.color }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {`Tanque ${f.tankL} L · id ${f.modelId}`}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Fila 3 — CompliancePanel (8 cols) + HealthPanel (4 cols) */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <CompliancePanel summaries={overdue} />
          </div>
          <HealthPanel batches={healthSteps} health={health} />
        </div>

        {/* Fila 4 — RecentActivity full-width */}
        <RecentActivity fumigations={recentFumigations} parcelById={parcelById} />
      </div>
    </div>
  );
}
