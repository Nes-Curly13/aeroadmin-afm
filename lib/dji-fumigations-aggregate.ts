// Helpers puros para agregar dji_fumigations por (parcel_id, fecha local).
//
// v1.6 (sprint de auditoria #2 — doble modelo fumigaciones):
//   El sistema actual calcula alertas desde dji_flights agregado por DIA
//   total de la cuenta. Eso tiene 2 problemas:
//     1. La UI muestra el id sintetico del dia y la fecha como "parcel_name",
//        lo que confunde al operador.
//     2. Si una fumigacion cubre varias parcelas en un dia, las alertas
//        mezclan todas las fincas sin poder identificar cual es la
//        "problemática".
//
//   Este agregador reemplaza la fuente de las alertas: en vez de derivar
//   desde dji_flights, deriva desde dji_fumigations (la verdad per-parcela).
//   El shape de salida es el mismo DjiAlertRecord, asi la UI no se toca.
//
//   Diferencia con lib/dji-flights-aggregate.ts:
//     - flights: agrupa por DIA (todos los vuelos del dia en un solo row).
//     - fumigations: agrupa por (parcela, dia) — 1 row por combinacion
//       parcela+fecha con al menos 1 evento.
//
//   Requisitos:
//     - Pure JS — testeable sin BD.
//     - Solo considera fumigaciones con parcel_id NOT NULL (las aggregate
//       imports con parcel_id NULL se ignoran — son "se fumigo en algun
//       lado, no sabemos donde").
//     - Threshold del nivel de alerta (HIGH/MEDIUM/LOW) son los MISMOS que
//       el agregador viejo (60 mu / 30 mu / 80 sorties / 40 sorties). La
//       calibracion del threshold es otro problema (audit #2.2) y queda
//       para un sprint posterior.

import {
  MU_PER_HA_M2,
  m2ToMu
} from "@/lib/dji-flights-aggregate";
import type { DjiAlertRecord } from "@/lib/types";

/**
 * Shape mínimo de fila de dji_fumigations que necesita el agregador.
 * Definido acá (no importado de @/lib/types) para que el módulo sea
 * puro testeable sin BD.
 *
 * Por qué un shape propio en vez de importar DjiFumigationEvent:
 *   - El agregador no usa `notes`, `human_notes`, `product_used`, etc.
 *   - El repository pasa filas crudas con snake_case; este shape
 *     normaliza a camelCase para el aggregator.
 *   - Mantiene la simetría con lib/dji-flights-aggregate.ts (que define
 *     su propio FlightRow por la misma razón).
 */
export interface FumigationRow {
  id: number;
  parcel_id: number;
  fumigation_date: string; // YYYY-MM-DD (DATE column -> string en boundary)
  area_fumigated_m2: number | null;
  duration_minutes: number | null;
  dose_l_per_ha: number | null;
  /** land_name del JOIN con dji_parcels (opcional, para evitar JOIN doble). */
  parcel_name?: string | null;
}

/**
 * Row intermedio del agregador. 1 fila por (parcel_id, fumigation_date).
 * Contiene los totales del día para esa parcela.
 */
export interface FumigationDailySummary {
  parcel_id: number;
  parcel_name: string;
  fumigation_date: string;
  area_mu: number;
  duration_minutes: number;
  times_count: number;
}

/**
 * Misma función de threshold que lib/alerts.ts:getAlertLevel.
 * Re-implementada acá para que el agregador no dependa de un módulo
 * que importa componentes de UI (ciclo). Si se cambian los thresholds,
 * cambiar en ambos lugares.
 *
 * v1.6: los thresholds vienen del agregador viejo (60 mu / 80 sorties).
 * NO se re-calibran en este commit — eso es scope separado.
 */
export function getAlertLevelFromFumigations(
  areaMu: number,
  timesCount: number
): "HIGH" | "MEDIUM" | "LOW" {
  if (areaMu >= 60 || timesCount >= 80) return "HIGH";
  if (areaMu >= 30 || timesCount >= 40) return "MEDIUM";
  return "LOW";
}

/**
 * Construye un DjiAlertRecord desde un FumigationDailySummary.
 * Mantiene el shape del record intacto — la UI (AlertsPanel) no se toca.
 *
 * Diferencia con buildAlert (lib/alerts.ts):
 *   - buildAlert toma un DjiDailySummaryRecord (1 row = 1 dia TOTAL).
 *   - buildAlertFromFumigation toma un FumigationDailySummary (1 row = 1
 *     parcela en 1 dia). parcel_id y parcel_name son reales.
 */
export function buildAlertFromFumigation(
  summary: FumigationDailySummary
): DjiAlertRecord {
  const level = getAlertLevelFromFumigations(summary.area_mu, summary.times_count);
  const areaMu = Number(summary.area_mu);
  const minutes = Number(summary.duration_minutes);
  // age_days: heurística legacy (area/2). La idea es "días de riesgo" — no
  // es edad cronológica, es un proxy del tamaño del evento.
  const ageDays = Math.max(0, Math.round(areaMu / 2));
  return {
    parcel_id: summary.parcel_id,
    parcel_name: summary.parcel_name,
    level,
    age_days: ageDays,
    message:
      `Fumigación en ${summary.parcel_name} el ${summary.fumigation_date}: ` +
      `${summary.times_count} evento(s), ${areaMu.toFixed(2)} mu, ${minutes} min.`,
    geometry: null
  };
}

/**
 * Agrupa una lista de fumigaciones per-parcela por (parcel_id, fecha)
 * y devuelve un array de FumigationDailySummary. Ordenado por area_mu DESC
 * (los eventos más grandes primero — los HIGH alerts quedan arriba).
 *
 * Comportamiento:
 *   - Fumigaciones con `parcel_id === null` se IGNORAN (aggregate imports
 *     sin parcela específica). Documentado en la migration
 *     `20260619140000_make_dji_fumigations_parcel_nullable.sql`.
 *   - Fumigaciones con `area_fumigated_m2 === null || 0` se SUMAN igual
 *     (puede haber un evento sin área reportada pero con duración). El
 *     threshold después filtra los LOW.
 *   - Si `parcel_name` viene en la fila (vía JOIN), se usa. Si no, fallback
 *     a `Parcela #<id>`. La query SQL siempre hace JOIN, así que el
 *     fallback solo aplica en tests unitarios con data mock.
 */
export function aggregateFumigationsByParcelAndDay(
  rows: FumigationRow[]
): FumigationDailySummary[] {
  // Agrupar por (parcel_id, fumigation_date)
  type Bucket = {
    parcel_id: number;
    parcel_name: string;
    fumigation_date: string;
    area_m2: number;
    duration_minutes: number;
    times_count: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    // Skip aggregate imports (parcel_id NULL)
    if (row.parcel_id === null || row.parcel_id === undefined) continue;
    const key = `${row.parcel_id}|${row.fumigation_date}`;
    const existing = buckets.get(key);
    const areaM2 = Number(row.area_fumigated_m2 ?? 0);
    const durationMin = Number(row.duration_minutes ?? 0);
    if (existing) {
      existing.area_m2 += areaM2;
      existing.duration_minutes += durationMin;
      existing.times_count += 1;
    } else {
      buckets.set(key, {
        parcel_id: row.parcel_id,
        parcel_name: row.parcel_name?.trim() || `Parcela #${row.parcel_id}`,
        fumigation_date: row.fumigation_date,
        area_m2: areaM2,
        duration_minutes: durationMin,
        times_count: 1
      });
    }
  }

  // Convertir a FumigationDailySummary + ordenar por area_mu DESC
  const summaries: FumigationDailySummary[] = [];
  for (const b of buckets.values()) {
    summaries.push({
      parcel_id: b.parcel_id,
      parcel_name: b.parcel_name,
      fumigation_date: b.fumigation_date,
      area_mu: Math.round(m2ToMu(b.area_m2) * 100) / 100,
      duration_minutes: b.duration_minutes,
      times_count: b.times_count
    });
  }
  summaries.sort((a, b) => b.area_mu - a.area_mu);
  return summaries;
}

/**
 * Helper de un solo paso: rows -> alerts (DjiAlertRecord[]).
 * Usado por la SQL query (`lib/cache.ts:fetchAlertsFromFumigationsRaw`).
 */
export function buildAlertsFromFumigations(rows: FumigationRow[]): DjiAlertRecord[] {
  return aggregateFumigationsByParcelAndDay(rows).map(buildAlertFromFumigation);
}

/**
 * Re-export para que el caller no tenga que importar m2ToMu aparte.
 * Útil para queries SQL que ya devuelven area en m².
 */
export { m2ToMu, MU_PER_HA_M2 };
