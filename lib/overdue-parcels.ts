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

export type OverdueSeverity = "overdue" | "due_soon" | "ok" | "no_history";

/**
 * Severidad de prioridad de fumigación para una parcela.
 *
 * - `overdue`   — `days_until_next_due < 0` (vencida).
 * - `due_soon`  — `0 <= days_until_next_due <= 7` (vence esta semana).
 * - `ok`        — `days_until_next_due > 7` (no urge).
 * - `no_history` — no hay `last_fumigation_date` (no sabemos cadencia).
 *
 * El umbral de 7 días para "due_soon" es arbitrario. Si en producción
 * el operador fumigador típico va al campo cada 14 días, podríamos
 * ajustar a 14. Por ahora 7 es un default razonable.
 */
export function computeSeverity(
  daysUntilNextDue: number | null
): OverdueSeverity {
  if (daysUntilNextDue === null) return "no_history";
  if (daysUntilNextDue < 0) return "overdue";
  if (daysUntilNextDue <= 7) return "due_soon";
  return "ok";
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
      return "bg-[#a93232]/15 text-[#a93232]";
    case "due_soon":
      return "bg-[#d4b23c]/20 text-[#7a5f0d]";
    case "ok":
      return "bg-[#0b5f2d]/10 text-[#0b5f2d]";
    case "no_history":
      return "bg-[#cfd8d3] text-[#4a5b50]";
  }
}
