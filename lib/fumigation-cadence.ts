// Lógica de cadencia de fumigación.
// Usada por:
//   - lib/dji-types.ts: tipos compartidos
//   - api/repositories.ts: getUpcomingFumigations()
//   - components/dashboard/upcoming-fumigations.tsx
//   - scripts/seed-cadences.js: defaults
//
// Mantenerla pura y testeable (sin dependencias de Node/DOM).

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
 * Calcula la próxima fecha de fumigación basándose en la última fumigación
 * y la cadencia esperada. Devuelve null si no hay última fumigación.
 */
export function computeNextDueDate(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number
): Date | null {
  return addDays(lastFumigation, cadenceDays);
}

/**
 * Compara la fecha objetivo contra `now` y devuelve el estado.
 *
 * Estados:
 *   - "no_history"  → no hay última fumigación registrada
 *   - "ok"          → todavía falta para la próxima fumigación
 *   - "due_soon"    → vence hoy o en los próximos 7 días
 *   - "overdue"     → pasó la fecha objetivo (>= 1 día de atraso)
 */
export function getFumigationStatus(
  lastFumigation: Date | string | null | undefined,
  cadenceDays: number,
  now: Date = new Date()
): FumigationStatus {
  const next = computeNextDueDate(lastFumigation, cadenceDays);
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
