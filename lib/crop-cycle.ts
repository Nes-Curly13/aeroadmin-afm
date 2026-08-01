// lib/crop-cycle.ts
//
// Lógica pura de fase de cultivo y cadencia efectiva por fase.
//
// Por qué existe:
//   docs/FUMIGATION_CADENCE.md modela la cadencia como un solo número
//   (14d para caña, 10d para orchards) pero en realidad depende de:
//     1. La FASE del cultivo (establecimiento, vegetativa, madurante,
//        cosecha). La cadencia de ripener (madurante) es 35d pre-cosecha
//        una vez por ciclo, no 14d. El establecimiento es menos urgente.
//        El cosecha se omite (no se fumiga durante cosecha).
//     2. La ESTACIÓN (secas jun-sep vs lluvias oct-may). Ver lib/season.ts.
//
//   Este módulo es la parte de FASE. La parte de ESTACIÓN vive en
//   `lib/season.ts`. `lib/fumigation-cadence.ts#effectiveCadence` las
//   combina.
//
// Decisiones de diseño:
//   - Puro, framework-agnostic (sin React, sin Node, sin DB). Testeable
//     con `new Date(...)` literal — no usa NOW ni clock global.
//   - Las fases son las 4 documentadas en Cenicaña / DJI case study:
//       establecimiento (meses 0-3)
//       vegetativa     (meses 3-9)   ← cadencia base
//       madurante      (meses 10-12) ← 35d pre-cosecha (ripener)
//       cosecha        (>12 meses)
//   - Para orchards, simplificamos: si hay planting_date, devolvemos
//     'vegetativa'. Los orchards no siguen el modelo de 4 fases de la caña
//     (cítricos, mango, etc. son perennes). Documentamos la simplificación
//     — un sprint futuro puede modelar fenología por especie.
//   - `expectedDaysUntilHarvest` es helper. Default 13 meses para caña
//     (Cenicaña reporta 12-14 meses típicos para caña de azúcar en Valle
//     del Cauca).
//   - Para la conversión meses↔días usamos `yearDiff * 12 + monthDiff` con
//     ajuste por día del mes (un planting_date 31-mar cuenta como "mes 0"
//     hasta 1-abr). Esto es exacto y determinístico para fechas en formato
//     DATE (sin hora).
//
//   TZ: las funciones reciben `today: Date` que el caller controla. Por
//   default los tests pasan `new Date('YYYY-MM-DDT00:00:00Z')`. La capa
//   de UI (`lib/data.ts`) debería pasar la fecha local de Colombia
//   (`getBogotaDateString()` de `lib/format.ts`) para que las fases
//   coincidan con el calendario operativo del cliente.

/** Fases del cultivo de caña de azúcar. Ver docs/FUMIGATION_CADENCE.md. */
export type CyclePhase = "establecimiento" | "vegetativa" | "madurante" | "cosecha";

/** Default del ciclo del cultivo en meses (caña de azúcar, Valle del Cauca). */
export const DEFAULT_CROP_CYCLE_MONTHS = 13;

/** Promedio de días por mes (365.25 / 12 ≈ 30.4375). Usado solo en helpers. */
const DAYS_PER_MONTH_AVG = 365.25 / 12;

/**
 * Devuelve la cantidad de meses enteros entre `from` y `to`.
 *
 * Reglas:
 *   - Si `to` es anterior a `from`, devuelve 0 (no negativo).
 *   - "Mes entero" = el día de `to` alcanza o supera el día de `from`.
 *     Ej: from=15-mar, to=14-abr → 0 (no llegamos al 15-abr);
 *     to=15-abr → 1 mes completo.
 *
 * Ejemplo:
 *   monthsBetween(new Date('2025-03-15'), new Date('2026-08-01'))  // 16
 *   monthsBetween(new Date('2025-03-15'), new Date('2026-03-15'))  // 12
 *   monthsBetween(new Date('2025-03-15'), new Date('2025-04-15'))  // 1
 *   monthsBetween(new Date('2025-03-15'), new Date('2025-04-14'))  // 0
 *   monthsBetween(new Date('2025-03-15'), new Date('2025-03-20'))  // 0
 */
export function monthsBetween(from: Date, to: Date): number {
  if (to.getTime() < from.getTime()) return 0;
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  // Si el día de `to` es anterior al día de `from`, todavía no
  // completamos el mes aniversario. Restar 1.
  if (to.getDate() < from.getDate()) {
    months--;
  }
  return Math.max(0, months);
}

/**
 * Devuelve la fase actual del cultivo.
 *
 * Reglas:
 *   - `plantingDate` null → null (no sabemos la fase sin fecha de siembra).
 *   - `today` anterior a `plantingDate` → null (la siembra es en el futuro).
 *   - Caña (default): meses 0-3 = establecimiento, 3-9 = vegetativa,
 *     9-12 = madurante, >12 = cosecha.
 *   - Orchards: simplificación. Si `plantingDate` no es null, devuelve
 *     'vegetativa'. Los orchards no siguen el modelo de 4 fases de la
 *     caña (son perennes con fenología distinta). Documentamos en JSDoc.
 *   - Otros `cropType` (futuros): caen al default de caña.
 *
 * Acepta `plantingDate` como Date o como string ISO (YYYY-MM-DD o
 * ISO completo). Esto matchea la columna `dji_parcels.planting_date`
 * que el driver de Postgres devuelve como string o Date según el path.
 */
export function phaseFor(
  plantingDate: Date | string | null | undefined,
  today: Date,
  cropType?: string | null
): CyclePhase | null {
  if (!plantingDate) return null;
  const d =
    plantingDate instanceof Date
      ? plantingDate
      : new Date(plantingDate);
  if (Number.isNaN(d.getTime())) return null;
  if (today.getTime() < d.getTime()) return null;

  // Orchards: simplificación perenne. Solo aplicamos si el cropType
  // matchea orchards explícitamente. Si es null o desconocido, cae al
  // default de caña.
  const isOrchard =
    cropType != null &&
    (cropType.toLowerCase().includes("orchard") ||
      cropType.toLowerCase().includes("frutal") ||
      cropType.toLowerCase().includes("frutales"));
  if (isOrchard) return "vegetativa";

  const months = monthsBetween(d, today);
  if (months < 3) return "establecimiento";
  if (months < 9) return "vegetativa";
  if (months < 12) return "madurante";
  return "cosecha";
}

/**
 * Devuelve la cadencia efectiva para una fase, aplicada sobre la cadencia
 * base del cultivo.
 *
 * Reglas (docs/FUMIGATION_CADENCE.md §"Defaults aplicados"):
 *   - vegetativa     → baseCadence (sin cambio, ej. 14d para caña)
 *   - establecimiento → baseCadence * 1.5 (menos urgente, ej. 21d)
 *   - madurante       → 35 (ripener, una vez por ciclo 35d pre-cosecha)
 *   - cosecha         → 999 (effectively no fumigation; no se fumiga
 *                       durante cosecha)
 *   - null            → baseCadence (fallback a comportamiento legacy)
 *
 * Sanity check: nunca devuelve menos de 1 día. Esto protege contra
 * inputs degenerados (baseCadence negativo, multiplicadores rotos en
 * el futuro).
 */
export function cadenceForPhase(
  phase: CyclePhase | null | undefined,
  baseCadence: number
): number {
  if (phase == null) return Math.max(1, baseCadence);
  let cadence: number;
  switch (phase) {
    case "vegetativa":
      cadence = baseCadence;
      break;
    case "establecimiento":
      cadence = baseCadence * 1.5;
      break;
    case "madurante":
      cadence = 35;
      break;
    case "cosecha":
      cadence = 999;
      break;
  }
  return Math.max(1, Math.round(cadence));
}

/**
 * Días estimados hasta la cosecha. Útil para mostrar "Faltan X días
 * para cosecha" en la ficha del parcel.
 *
 * `cropCycleMonths` default = 13 (caña de azúcar, Valle del Cauca).
 * Devuelve null si `plantingDate` es null o si ya pasó el ciclo.
 */
export function expectedDaysUntilHarvest(
  plantingDate: Date | string | null | undefined,
  today: Date,
  cropCycleMonths: number = DEFAULT_CROP_CYCLE_MONTHS
): number | null {
  if (!plantingDate) return null;
  const d =
    plantingDate instanceof Date
      ? plantingDate
      : new Date(plantingDate);
  if (Number.isNaN(d.getTime())) return null;
  const monthsElapsed = monthsBetween(d, today);
  if (monthsElapsed >= cropCycleMonths) return null;
  const monthsRemaining = cropCycleMonths - monthsElapsed;
  return Math.round(monthsRemaining * DAYS_PER_MONTH_AVG);
}

/**
 * Etiqueta humana en español para una fase. Usado por chips de UI
 * (parcels-table, compliance-panel, detail page).
 */
export function phaseLabel(phase: CyclePhase | null | undefined): string {
  switch (phase) {
    case "establecimiento":
      return "Establecimiento";
    case "vegetativa":
      return "Vegetativa";
    case "madurante":
      return "Madurante";
    case "cosecha":
      return "Cosecha";
    default:
      return "Desconocida";
  }
}

/**
 * Clases CSS (Tailwind, paleta AFM) para el chip de fase.
 *
 * Reglas visuales (consistente con `severityChipClass` en
 * `lib/overdue-parcels.ts`):
 *   - vegetativa      → verde  (fase activa, cadencia normal)
 *   - establecimiento → teal   (fase temprana, menos urgente)
 *   - madurante       → amber  (ripener, ventana corta)
 *   - cosecha         → gris   (no se fumiga, sin urgencia)
 *   - null/undefined  → gris   ("Fase: desconocida")
 */
export function phaseChipClass(phase: CyclePhase | null | undefined): string {
  switch (phase) {
    case "vegetativa":
      return "bg-[#0b5f2d]/10 text-[#0b5f2d] border-[#0b5f2d]/30";
    case "establecimiento":
      return "bg-[#16847e]/10 text-[#16847e] border-[#16847e]/30";
    case "madurante":
      return "bg-[#d4b23c]/20 text-[#7a5f0d] border-[#d4b23c]/40";
    case "cosecha":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-[#cfd8d3] text-[#4a5b50] border-border";
  }
}
