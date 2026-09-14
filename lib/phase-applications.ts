// lib/phase-applications.ts
//
// Lógica pura de la planificación fitosanitaria por fase del ciclo
// (MVP 2026-09-13, ver docs/DEEPSEEK-PROPOSAL-CICLOS-FENOLOGIA.md).
//
// Dado el ciclo activo de una parcela (start_date) y las reglas
// data-driven (`phase_application_rules`), computa:
//   - la fase actual (días desde start_date),
//   - las aplicaciones que esa fase requiere,
//   - el estado de cada una (al día / pendiente / vencida / programada).
//
// Puro y framework-agnostic: recibe `today` y las fechas ya consultadas.
// El caller (repo/UI) filtra las fumigaciones que matchean cada regla.

/** Fases canónicas (mismas que `phase_rules.phase_name` y `CyclePhase`). */
export type CyclePhaseSlug = "establecimiento" | "vegetativa" | "madurante" | "cosecha";

/** Una regla de `phase_application_rules`. */
export interface PhaseApplicationRule {
  id: number;
  crop_type: string;
  phase: string;
  /** Categoría (qué): slug de `fumigation_categories`. */
  category_slug: string;
  /** Tipo de uso (para qué): slug de `application_types`, o null. */
  application_type_slug: string | null;
  /** Si se repite (ej. cada 10 d). null = una vez en la ventana. */
  cadence_days: number | null;
  /** Ventana en días desde `cycles.start_date`. */
  window_from_day: number;
  window_to_day: number;
  /** true = obligatoria; false = "según monitoreo" (no alerta dura). */
  is_required: boolean;
  notes: string | null;
}

export type ApplicationStatus =
  | "al_dia"          // se registró una aplicación dentro de la ventana
  | "pendiente"       // en ventana, requerida, sin registrar
  | "vencida"         // pasó la ventana sin registrar
  | "segun_monitoreo" // en/pasada la ventana, no requerida (sin alerta dura)
  | "programada"      // todavía no entró a la ventana
  | "sin_ciclo";      // no hay ciclo activo (no se puede computar)

export interface ApplicationRequirement {
  rule: PhaseApplicationRule;
  status: ApplicationStatus;
  /** Fechas ISO (YYYY-MM-DD) de la ventana, si hay ciclo. */
  windowStart: string | null;
  windowEnd: string | null;
  /** Última aplicación que matchea la regla dentro de la ventana. */
  lastAppliedAt: string | null;
}

/** Item del overview de planificación (parcela con pendientes/vencidas). */
export interface PhasePlanningItem {
  parcel_id: number;
  land_name: string | null;
  crop_type: string | null;
  start_date: string;
  age_days: number;
  phase: string;
  pending: number;
  overdue: number;
  nextApplication: {
    category_slug: string;
    application_type_slug: string | null;
    status: ApplicationStatus;
    window_end: string | null;
  } | null;
}

const MS_PER_DAY = 86_400_000;

/** Normaliza a Date UTC-medianoche desde string YYYY-MM-DD o Date. */
function toDate(v: string | Date): Date {
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Días (enteros) entre dos fechas YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const a = toDate(from).getTime();
  const b = toDate(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / MS_PER_DAY);
}

/** Fase actual según los días desde `startDate` (curva canónica 4 fases). */
export function phaseForDays(daysSinceStart: number): CyclePhaseSlug {
  if (daysSinceStart < 121) return "establecimiento";
  if (daysSinceStart < 271) return "vegetativa";
  if (daysSinceStart < 361) return "madurante";
  return "cosecha";
}

/** Filtra las reglas de una fase. */
export function applicationsForPhase(
  rules: PhaseApplicationRule[],
  phase: string
): PhaseApplicationRule[] {
  return rules.filter((r) => r.phase === phase);
}

/**
 * Computa el estado de una regla para una parcela.
 *
 * @param rule              la regla
 * @param cycleStartDate    `cycles.start_date` (YYYY-MM-DD) o null
 * @param today             fecha de referencia (YYYY-MM-DD)
 * @param applicationsDates fechas (YYYY-MM-DD) de aplicaciones que matchean
 *                          la regla (misma categoría / tipo)
 */
export function computeRequirement(
  rule: PhaseApplicationRule,
  cycleStartDate: string | null,
  today: string,
  applicationsDates: string[]
): ApplicationRequirement {
  if (!cycleStartDate) {
    return {
      rule,
      status: "sin_ciclo",
      windowStart: null,
      windowEnd: null,
      lastAppliedAt: null
    };
  }

  const start = toDate(cycleStartDate);
  const windowStart = iso(new Date(start.getTime() + rule.window_from_day * MS_PER_DAY));
  const windowEnd = iso(new Date(start.getTime() + rule.window_to_day * MS_PER_DAY));

  // ¿Hay una aplicación registrada dentro de la ventana?
  const applied = applicationsDates
    .filter((d) => d >= windowStart && d <= windowEnd)
    .sort()
    .at(-1) ?? null;
  if (applied) {
    return { rule, status: "al_dia", windowStart, windowEnd, lastAppliedAt: applied };
  }

  let status: ApplicationStatus;
  if (today < windowStart) {
    status = "programada";
  } else if (today <= windowEnd) {
    status = rule.is_required ? "pendiente" : "segun_monitoreo";
  } else {
    status = rule.is_required ? "vencida" : "segun_monitoreo";
  }

  return { rule, status, windowStart, windowEnd, lastAppliedAt: null };
}

/** Etiqueta legible de la categoría (qué se aplica). */
const CATEGORY_LABELS: Record<string, string> = {
  herbicida: "Herbicida",
  insecticida: "Insecticida",
  fungicida: "Fungicida",
  fertilizante: "Fertilizante",
  acaricida: "Acaricida",
  nematicida: "Nematicida",
  otro: "Otro"
};
export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}

/** Etiqueta legible del tipo de uso (para qué). */
const TYPE_LABELS: Record<string, string> = {
  pre_emergente: "Pre-emergente",
  post_emergente: "Post-emergente",
  bioestimulante: "Bioestimulante",
  madurante: "Madurante",
  otro: "Otro"
};
export function applicationTypeLabel(slug: string | null): string | null {
  if (!slug) return null;
  return TYPE_LABELS[slug] ?? slug;
}

/** Etiqueta legible de la fase del ciclo. */
const PHASE_LABELS: Record<string, string> = {
  establecimiento: "Establecimiento",
  vegetativa: "Crecimiento",
  madurante: "Maduración",
  cosecha: "Cosecha"
};
export function phaseDisplayLabel(phase: string | null | undefined): string {
  if (!phase) return "—";
  return PHASE_LABELS[phase] ?? phase;
}

/** Etiqueta humana en español del estado. */
export function applicationStatusLabel(status: ApplicationStatus): string {
  switch (status) {
    case "al_dia":
      return "Aplicada";
    case "pendiente":
      return "Pendiente";
    case "vencida":
      return "Vencida";
    case "segun_monitoreo":
      return "Según monitoreo";
    case "programada":
      return "Programada";
    case "sin_ciclo":
      return "Sin ciclo";
  }
}

/** Clases Tailwind del chip de estado (consistente con el resto de la UI). */
export function applicationStatusChipClass(status: ApplicationStatus): string {
  switch (status) {
    case "al_dia":
      return "border-chart-1/40 bg-chart-1/5 text-chart-1";
    case "pendiente":
      return "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300";
    case "vencida":
      return "border-destructive/40 bg-destructive/5 text-destructive";
    case "programada":
      return "border-input bg-background text-muted-foreground";
    case "segun_monitoreo":
    case "sin_ciclo":
    default:
      return "border-input bg-background text-muted-foreground";
  }
}
