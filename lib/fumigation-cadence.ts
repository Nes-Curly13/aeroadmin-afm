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

/**
 * Estado de cadencia CANÓNICO (fuente de verdad única).
 *
 * Unificación CAD-001 (2026-09-21): antes existían 3 definiciones
 * incompatibles de "vencida" (1d / 7d / 10d). Ahora todo se computa acá y
 * los consumidores PROYECTAN a su vocabulario de UI:
 *   - Tabla/geovisor (`ComplianceStatus`): no_history|critical → "critico".
 *   - Dot del mapa (`CadenceStatus`):        no_history|critical → "critico".
 *   - Lista "Faltan por fumigar" (`OverdueSeverity`): critical → "overdue".
 *
 * Bands (ver `CADENCE_THRESHOLDS`):
 *   - no_history → sin última fumigación.
 *   - critical   → más de `CRITICAL_DAYS` días vencida.
 *   - overdue    → 1..`CRITICAL_DAYS` días vencida.
 *   - due_soon   → 0..`DUE_SOON_DAYS` días por vencer (incluye hoy).
 *   - ok         → más de `DUE_SOON_DAYS` días por vencer.
 */
export type FumigationStatus = "no_history" | "critical" | "overdue" | "due_soon" | "ok";

/** Umbrales canónicos de cadencia (días). Cambiar acá, no en cada consumidor. */
export const CADENCE_THRESHOLDS = {
  /** Días hacia adelante que cuentan como "por vencer". */
  DUE_SOON_DAYS: 7,
  /** Días de atraso a partir de los cuales una parcela es "crítica". */
  CRITICAL_DAYS: 10
} as const;

/** Orden canónico por urgencia (menor = más prioritario). */
export const FUMIGATION_STATUS_ORDER: Record<FumigationStatus, number> = {
  critical: 0,
  overdue: 1,
  due_soon: 2,
  ok: 3,
  no_history: 4
};

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
 * Clasifica una cantidad de días hasta el próximo vencimiento en el estado
 * canónico. Única implementación de los umbrales (CAD-001).
 *
 *   null            → no_history
 *   >  DUE_SOON     → ok
 *   0..DUE_SOON     → due_soon
 *   -CRITICAL..-1   → overdue
 *   < -CRITICAL     → critical
 */
export function severityFromDays(days: number | null): FumigationStatus {
  if (days === null) return "no_history";
  if (days > CADENCE_THRESHOLDS.DUE_SOON_DAYS) return "ok";
  if (days >= 0) return "due_soon";
  if (days < -CADENCE_THRESHOLDS.CRITICAL_DAYS) return "critical";
  return "overdue";
}

export interface CadenceState {
  /** Estado canónico. */
  status: FumigationStatus;
  /** Días hasta el próximo vencimiento (positivo futuro, negativo vencido). null = sin historial. */
  daysUntilDue: number | null;
  /** Fecha objetivo de la próxima fumigación. null = sin historial. */
  nextDue: Date | null;
  /** Cadencia efectiva usada (base ajustada por fase/estación). */
  cadenceDays: number;
}

/**
 * Calcula el estado de cadencia COMPLETO desde la última fumigación.
 *
 * Es la función canónica: `getFumigationStatus`, `computeSeverity`
 * (`lib/overdue-parcels.ts`) y `complianceStatus` (`lib/data-constants.ts`)
 * son proyecciones de esto.
 *
 * Si se pasa `phase` y/o `season`, la cadencia efectiva se calcula vía
 * `effectiveCadence()` (con `cropType` opcional). Si ambos son null/undefined,
 * se usa `cadenceDays` tal cual (backward compat).
 */
export function getCadenceState(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  now: Date = new Date(),
  phase?: CyclePhase | null,
  season?: Season | null,
  cropType?: string | null
): CadenceState {
  const effective =
    phase != null || season != null
      ? effectiveCadence(cadenceDays, phase, season, cropType)
      : cadenceDays;
  const next = computeNextDueDate(lastFumigation, effective);
  if (!next) {
    return { status: "no_history", daysUntilDue: null, nextDue: null, cadenceDays: effective };
  }
  const daysUntilDue = Math.ceil((next.getTime() - now.getTime()) / MS_PER_DAY);
  return {
    status: severityFromDays(daysUntilDue),
    daysUntilDue,
    nextDue: next,
    cadenceDays: effective
  };
}

/**
 * Estado canónico de cadencia (proyección directa de `getCadenceState`).
 *
 * Estados:
 *   - "no_history"  → no hay última fumigación registrada
 *   - "critical"    → pasó la fecha objetivo por más de `CRITICAL_DAYS`
 *   - "overdue"     → pasó la fecha objetivo (1..`CRITICAL_DAYS` días)
 *   - "due_soon"    → vence hoy o dentro de los próximos `DUE_SOON_DAYS`
 *   - "ok"          → todavía falta más de `DUE_SOON_DAYS`
 */
export function getFumigationStatus(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  now: Date = new Date(),
  phase?: CyclePhase | null,
  season?: Season | null
): FumigationStatus {
  return getCadenceState(lastFumigation, cadenceDays, now, phase, season).status;
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
  return getCadenceState(lastFumigation, cadenceDays, now).daysUntilDue;
}

/**
 * Etiqueta humana para el estado.
 */
export function statusLabel(status: FumigationStatus): string {
  switch (status) {
    case "no_history": return "Sin historial";
    case "critical": return "Crítica";
    case "overdue": return "Vencida";
    case "due_soon": return "Vence pronto";
    case "ok": return "En fecha";
  }
}
