// lib/overdue-parcels.ts
//
// M3-M5 Q2 — Sprint "Faltan por fumigar".
// Funciones puras para calcular prioridad de fumigación de parcelas
// basándose en `dji_fumigation_schedule` (last_fumigation_date +
// recommended_cadence_days) y la fecha actual.
//
// Decisiones de diseño (no obvias):
//   - `severity` se calcula desde `days_until_next_due` con estos cortes:
//     negative = overdue (vencida), 0..7 = due_soon, >7 = ok.
//     null last_fumigation_date = "no_history" (no sabemos, peor que ok).
//   - `sortOverdueByPriority` ordena por (severity, days_until_next_due ASC).
//     Severidad es el primer criterio (overdue > due_soon > ok > no_history),
//     días es el desempate (más negativo = más atrasado = más prioritario).
//   - Estas funciones son puras (no I/O, no Date.now()) para ser
//     facilmente testeables. El repo les pasa `now` como argumento.
//
// Por qué NO extender `lib/fumigation-cadence.ts`:
//   - `fumigation-cadence.ts` ya tiene `getFumigationStatus` que usa la
//     misma semántica de severidad. Mantuve las funciones acá para
//     dejar claro el scope (overdue parcels ≠ cadencia per se).
//   - El sort es específico de esta vista; no es reusable en otros
//     contexts (el dashboard usa el orden por status, la página
//     /parcels/overdue usa este sort).
//
// CAD-001 (2026-09-21): los umbrales se unificaron en
// `lib/fumigation-cadence.ts#severityFromDays`. Este módulo dejó de tener
// su propia definición de "vencida/due_soon" y ahora proyecta el estado
// canónico (critical → overdue).

import { severityFromDays } from "@/lib/fumigation-cadence";

export type OverdueSeverity = "overdue" | "due_soon" | "ok" | "no_history";

/**
 * Severidad de prioridad de fumigación para una parcela.
 *
 * CAD-001 (2026-09-21): los umbrales viven en `lib/fumigation-cadence.ts`
 * (`severityFromDays`). Acá solo proyectamos el estado canónico al
 * vocabulario de 4 valores de esta lista: `critical` se pliega a `overdue`
 * (la lista no distingue "muy vencida"; el orden por días ya prioriza).
 *
 * - `overdue`   — `days_until_next_due < 0` (vencida).
 * - `due_soon`  — `0 <= days_until_next_due <= 7` (vence esta semana).
 * - `ok`        — `days_until_next_due > 7` (no urge).
 * - `no_history` — no hay `last_fumigation_date` (no sabemos cadencia).
 */
export function computeSeverity(
  daysUntilNextDue: number | null
): OverdueSeverity {
  const status = severityFromDays(daysUntilNextDue);
  return status === "critical" ? "overdue" : status;
}

/**
 * Severidad ordenada por prioridad de fumigación.
 * Menor número = más prioritario. Usado para ordenar listas.
 */
export const SEVERITY_ORDER: Record<OverdueSeverity, number> = {
  overdue: 0,
  due_soon: 1,
  ok: 2,
  no_history: 3
};

/**
 * Compara dos parcelas por prioridad de fumigación:
 *   1. Severidad (overdue > due_soon > ok > no_history).
 *   2. Días hasta próximo vencimiento (más negativo = más prioritario).
 *   3. Empate estable (parcel_id asc) para orden determinístico.
 *
 * Diseñado para `Array.prototype.sort` (devuelve -1/0/1).
 */
export function sortOverdueByPriority<
  T extends { severity: OverdueSeverity; days_until_next_due: number | null; parcel_id: number }
>(a: T, b: T): number {
  const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sevDiff !== 0) return sevDiff;
  const aDays = a.days_until_next_due ?? 0;
  const bDays = b.days_until_next_due ?? 0;
  if (aDays !== bDays) return aDays - bDays;
  return a.parcel_id - b.parcel_id;
}

/**
 * Etiqueta legible en español para la severidad (UI copy).
 */
export function severityLabel(severity: OverdueSeverity): string {
  switch (severity) {
    case "overdue":
      return "Vencida";
    case "due_soon":
      return "Vence pronto";
    case "ok":
      return "En fecha";
    case "no_history":
      return "Sin historial";
  }
}

/**
 * Clases CSS para el chip de severidad (consistente con
 * `components/parcels/parcel-fumigations.tsx`).
 */
export function severityChipClass(severity: OverdueSeverity): string {
  switch (severity) {
    case "overdue":
      return "bg-destructive/15 text-destructive";
    case "due_soon":
      return "bg-warning/20 text-warning-foreground";
    case "ok":
      return "bg-primary/10 text-primary";
    case "no_history":
      return "bg-muted text-muted-foreground";
  }
}
