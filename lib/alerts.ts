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
