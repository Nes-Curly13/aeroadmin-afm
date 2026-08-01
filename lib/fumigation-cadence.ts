// Lógica de cadencia de fumigación.
// Usada por:
//   - lib/dji-types.ts: tipos compartidos
//   - api/repositories.ts: getUpcomingFumigations()
//   - components/dashboard/upcoming-fumigations.tsx
//   - scripts/seed-cadences.js: defaults
//   - lib/crop-cycle.ts + lib/season.ts: phase/season modifiers
//     (sprint "Crop time / fase de cultivo" 2026-08-01)
//
// Mantenerla pura y testeable (sin dependencias de Node/DOM).

import {
  cadenceForPhase,
  type CyclePhase
} from "@/lib/crop-cycle";
import { cadenceMultiplierForSeason, type Season } from "@/lib/season";

export type FumigationStatus = "no_history" | "ok" | "due_soon" | "overdue";

export interface CadenceDefaults {
  /** "Caña de azúcar" / "Frutales" / etc. */
  crop_type: string;
  /** Días entre fumigaciones esperadas. */
  recommended_cadence_days: number;
}

/**
 * Defaults conservadores por tipo de parcela.
 * Justificación: docs/FUMIGATION_CADENCE.md
 *   - Farmland (caña): 14 días (Cenicaña MIPE, conservador)
 *   - Orchard (frutales): 10 días (hongos en temporada de lluvias)
 */
export const CADENCE_DEFAULTS: Record<"Farmland" | "Orchards", CadenceDefaults> = {
  Farmland: { crop_type: "Caña de azúcar", recommended_cadence_days: 14 },
  Orchards: { crop_type: "Frutales", recommended_cadence_days: 10 }
};

/**
 * Defaults de cadencia usados al seedear el schedule desde el importer.
 * Las Orchards reciben 10 días por default (hongos), las Farmland 14 (caña).
 */
export function getDefaultCadence(fieldType: string | null | undefined): CadenceDefaults {
  if (fieldType === "Orchards") return CADENCE_DEFAULTS.Orchards;
  // Default conservador: cualquier "Farmland" u otro se trata como caña
  return CADENCE_DEFAULTS.Farmland;
}

const MS_PER_DAY = 86_400_000;

/**
 * Suma N días a una fecha (input puede ser Date o ISO string).
 * Devuelve null si input es null/undefined.
 */
export function addDays(date: Date | string | null | undefined, days: number): Date | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : new Date(date.getTime());
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Opciones para `computeNextDueDate` y `getFumigationStatus`.
 *
 * Sprint 2026-08-01 — la cadencia puede ajustarse por fase del cultivo
 * (`phase`) y por estación climática (`season`). Si se pasan, se calcula
 * la cadencia efectiva vía `effectiveCadence()` y se usa esa para el
 * threshold. Si ambos son null/undefined, el comportamiento es
 * idéntico al previo (usa `cadenceDays` directamente).
 *
 * Backward compatibility: ambos campos son opcionales. Los callers que
 * ya existían (no pasan opts) siguen funcionando sin cambios.
 */
export interface StatusOptions {
  phase?: CyclePhase | null;
  season?: Season | null;
  /** Crop type ("Caña", "Frutales", etc.). Usado para el ajuste 0.7 de
   *  orchards en lluvias dentro de `effectiveCadence`. */
  cropType?: string | null;
}

/**
 * Calcula la cadencia EFECTIVA combinando base + fase + estación + crop.
 *
 * Composición:
 *   1. `cadenceForPhase(phase, baseCadence)` → cadencia ajustada por fase
 *   2. `cadenceMultiplierForSeason(cadenciaAjustada, season)` →
 *      cadencia ajustada por estación
 *   3. Si `cropType` es orchards en lluvias → × 0.7 (más fumigación)
 *
 * Reglas por fase (lib/crop-cycle.ts):
 *   - vegetativa     → baseCadence
 *   - establecimiento → baseCadence * 1.5
 *   - madurante       → 35 (fixed)
 *   - cosecha         → 999
 *   - null            → baseCadence
 *
 * Reglas por estación (lib/season.ts):
 *   - secas   → × 1.5
 *   - lluvias → × 1.0
 *
 * Reglas por crop (esta función):
 *   - orchards en lluvias → × 0.7 (presión fúngica es mayor)
 *   - caña en cualquier estación → sin ajuste extra
 *   - otros → sin ajuste extra
 *
 * Sanity: el resultado nunca es menor a 1 día.
 */
export function effectiveCadence(
  baseCadence: number,
  phase: CyclePhase | null | undefined,
  season: Season | null | undefined,
  cropType?: string | null
): number {
  const phaseAdjusted = cadenceForPhase(phase ?? null, baseCadence);
  // Si no hay season, salta el ajuste estacional (devuelve phaseAdjusted).
  const seasonAdjusted =
    season != null
      ? cadenceMultiplierForSeason(phaseAdjusted, season)
      : phaseAdjusted;
  // Ajuste por crop: orchards en lluvias → más fumigación.
  const isOrchard =
    cropType != null &&
    (cropType.toLowerCase().includes("orchard") ||
      cropType.toLowerCase().includes("frutal") ||
      cropType.toLowerCase().includes("frutales"));
  if (isOrchard && season === "lluvias") {
    return Math.max(1, Math.round(seasonAdjusted * 0.7));
  }
  return seasonAdjusted;
}

/**
 * Calcula la próxima fecha de fumigación basándose en la última fumigación
 * y la cadencia esperada. Devuelve null si no hay última fumigación.
 *
 * Si `opts.cadenceForLastFumigation` se pasa (no null/undefined), se usa
 * ESA cadencia en lugar de la calculada. Útil cuando el caller ya computó
 * `effectiveCadence` y quiere evitar re-calcular. Hoy no se usa — es
 * hook para futuro, no se testea.
 */
export function computeNextDueDate(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  opts?: { cadenceForLastFumigation?: number | null }
): Date | null {
  const days = opts?.cadenceForLastFumigation ?? cadenceDays;
  return addDays(lastFumigation, days);
}

/**
 * Compara la fecha objetivo contra `now` y devuelve el estado.
 *
 * Estados:
 *   - "no_history"  → no hay última fumigación registrada
 *   - "ok"          → todavía falta para la próxima fumigación
 *   - "due_soon"    → vence hoy o en los próximos 7 días
 *   - "overdue"     → pasó la fecha objetivo (>= 1 día de atraso)
 *
 * Si se pasa `opts.phase` o `opts.season`, la cadencia efectiva se calcula
 * vía `effectiveCadence()` y se usa ESA en lugar de `cadenceDays`. Si ambos
 * son null/undefined, el comportamiento es idéntico al previo (backward
 * compat con los tests existentes que no pasan opts).
 */
export function getFumigationStatus(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  now: Date = new Date(),
  phase?: CyclePhase | null,
  season?: Season | null
): FumigationStatus {
  const effective =
    phase != null || season != null
      ? effectiveCadence(cadenceDays, phase, season)
      : cadenceDays;
  const next = computeNextDueDate(lastFumigation, effective);
  if (!next) return "no_history";
  const diffMs = now.getTime() - next.getTime();
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  if (diffDays >= 1) return "overdue";
  if (diffDays >= -7) return "due_soon";
  return "ok";
}

/**
 * Calcula los días hasta la próxima fumigación (positivo = futuro, negativo = vencido).
 * Devuelve null si no hay última fumigación.
 */
export function daysUntilNextDue(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  now: Date = new Date()
): number | null {
  const next = computeNextDueDate(lastFumigation, cadenceDays);
  if (!next) return null;
  return Math.ceil((next.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Etiqueta humana para el estado.
 */
export function statusLabel(status: FumigationStatus): string {
  switch (status) {
    case "no_history": return "Sin historial";
    case "ok": return "En fecha";
    case "due_soon": return "Vence pronto";
    case "overdue": return "Vencida";
  }
}
