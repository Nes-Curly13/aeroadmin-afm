import { AppShell } from "@/components/app-shell";
import { OperationsPanel } from "@/components/dashboard/operations-panel";
import { UpcomingFumigations } from "@/components/dashboard/upcoming-fumigations";
import { MetricCard } from "@/components/ui/metric-card";
import { getAlerts, getDashboardMetrics, getFlights, getParcelsNormalized, getUpcomingFumigations } from "@/api/repositories";
import { countHighAlerts } from "@/lib/alerts";
import { formatArea, formatNumber } from "@/lib/format";
import { getDashboardKpiTone } from "@/lib/ui-tokens";

// (Sprint 7) Antes `force-dynamic` — eso deshabilitaba el data cache de Next
// y nuestras `unstable_cache` no se podían usar. Ahora la página usa `auto`:
// si los tags de `afm:metrics`, `afm:alerts`, `afm:upcoming` están frescos,
// Next sirve la versión cacheada y gana ~3 queries pesadas por render.

function CompassIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M14.85 9.15L9 15l6.45-2.15L17.6 6.4 14.85 9.15Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function AreaIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M12 8v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92A2 2 0 0 0 22.18 18L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function DroneIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M3 8h4M17 8h4M3 16h4M17 16h4M7 12h10M12 5v3M12 16v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default async function DashboardPage() {
  const [metrics, parcelsResult, flightsResult, alerts, upcoming] = await Promise.all([
    getDashboardMetrics(),
    // (S1.7 / 2026-07-01) Migrado de getParcels() (legacy, lee dji_land_assets shape)
    // a getParcelsNormalized() — tabla dji_parcels, 1 fila por campo, columnas planas.
    // Mismo origen de datos que /map, garantiza coherencia entre dashboard y mapa.
    getParcelsNormalized(1, 200),
    getFlights(),
    getAlerts(),
    getUpcomingFumigations(8)
  ]);

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#e2bfb0] bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          Vista operativa en vivo
        </div>
      }
      activeSection="dashboard"
      eyebrow="Panel de Control"
      highAlertsCount={countHighAlerts(alerts)}
      parcelsCount={parcelsResult.data.length}
      subtitle="Resumen operativo de la fumigación con drones DJI Agras. Trazabilidad por día, alertas y cobertura por dron."
      title="AeroAdmin AFM"
    >
      <div className="grid gap-5 xl:grid-cols-4">
        <MetricCard
          accent={<CompassIcon />}
          hint="Misiones registradas en todas las parcelas"
          label="Registros Totales"
          tone={getDashboardKpiTone("totalFlights")}
          value={formatNumber(metrics.totalFlights)}
        />
        <MetricCard
          accent={<AreaIcon />}
          hint="Cobertura combinada de huella de dron"
          label="Área Cubierta"
          tone={getDashboardKpiTone("totalAreaCovered")}
          value={formatArea(metrics.totalAreaCovered)}
        />
        <MetricCard
          accent={<DroneIcon />}
          hint="Activos DJI importados y disponibles"
          label="Activos DJI"
          tone={getDashboardKpiTone("totalAssets")}
          value={formatNumber(metrics.totalAssets)}
        />
        <MetricCard
          accent={<AlertIcon />}
          hint="Días con volumen o frecuencia de riesgo"
          label="Alertas Altas"
          tone={getDashboardKpiTone("highAlertParcels")}
          value={formatNumber(metrics.highAlertParcels)}
        />
      </div>
      <div className="mt-5">
        <UpcomingFumigations items={upcoming} />
      </div>
      <div className="mt-5">
        <OperationsPanel alerts={alerts} flights={flightsResult.data} metrics={metrics} parcels={parcelsResult.data} />
      </div>
    </AppShell>
  );
}
