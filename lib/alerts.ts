import type { AlertLevel, DjiAlertRecord, DjiDailySummaryRecord } from "@/lib/types";

export function getAlertLevel(areaMu: number, timesCount: number): AlertLevel {
  if (areaMu >= 60 || timesCount >= 80) return "HIGH";
  if (areaMu >= 30 || timesCount >= 40) return "MEDIUM";
  return "LOW";
}

export function buildAlert(summary: DjiDailySummaryRecord): DjiAlertRecord {
  const level = getAlertLevel(summary.area_mu, summary.times_count);
  const areaMu = Number(summary.area_mu);
  const usageLiters = Number(summary.usage_liters);
  return {
    parcel_id: summary.id,
    parcel_name: `${summary.record_date} ${summary.category}`,
    level,
    age_days: Math.max(0, Math.round(areaMu / 2)),
    message: `${summary.category} en ${summary.record_date}: ${summary.times_count} salidas, ${areaMu.toFixed(2)} mu, ${usageLiters.toFixed(1)} L.`,
    geometry: null
  };
}

/**
 * Cuenta cuántas alertas tienen level === 'HIGH' en una lista de DjiAlertRecord.
 *
 * Q1 (2026-07-19): el KPI "Alertas altas" del header del dashboard y el
 * panel "Alertas DJI" deben mostrar el MISMO número. Antes el header
 * derivaba de `metrics.highAlertParcels` (count distinct days con
 * area_m2 >= 40000 OR duration_seconds >= 28800) y el panel derivaba
 * de `getAlerts()` (per-day aggregated con `getAlertLevel` y
 * threshold areaMu >= 60 || timesCount >= 80). Dos queries distintas
 * → números distintos → operador pierde confianza.
 *
 * Solución: derivar el KPI del MISMO set de alertas que ve el panel.
 * Esto es lo que alimenta `app-shell` con `highAlertsCount` y al
 * `AlertsPanel` con la prop `alerts`. Single source of truth.
 */
export function countHighAlerts(alerts: DjiAlertRecord[]): number {
  return alerts.filter((alert) => alert.level === "HIGH").length;
}
