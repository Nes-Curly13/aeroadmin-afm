// lib/fumigation-timeline.ts
//
// Función pura que arma la "timeline de fumigaciones por parcela" (M7 del
// roadmap). A partir de un array de `FumigationTimelineInput` (lo que el
// repository normaliza desde `dji_fumigations` + join con `dji_flights`)
// y un contexto {parcelId, from, to, expectedCadenceDays}, devuelve:
//
//   - events: FumigationEvent[] en orden ascendente, enriquecidos
//     (areaHa, durationDjiFormat, month bucket).
//   - summary: contadores + byMonth (group by YYYY-MM) + cadencia observada
//     + gaps > 60 días.
//
// La función es PURA: no hace I/O, no depende de pg/Next. La puede testear
// cualquiera sin mockear nada (ver tests/lib/fumigation-timeline.test.ts).
//
// Por qué vive acá y no en api/repositories.ts: para que el componente
// (parcel-timeline.tsx) pueda llamarla con un dataset pre-cargado, y para
// que la ruta `/api/fumigations/[parcelId]/timeline` reutilice exactamente
// la misma lógica que la página server-component `/parcels/[id]/timeline`
// (decisión documentada en el commit — pasamos por el repository siempre,
// no por HTTP entre page y route).
//
// Convención TZ: `fumigation_date` ya viene como YYYY-MM-DD Bogota-local
// (DATE column en la BD, normalizada en el boundary del repository). No
// re-interpretamos a UTC; usamos `date.slice(0, 7)` para el month bucket.

import {
  daysBetween,
  formatDjiDuration,
  m2ToHa
} from "@/lib/format";
import {
  FUMIGATION_GAP_THRESHOLD_DAYS,
  type FumigationEvent,
  type FumigationTimelineInput,
  type FumigationTimelineResult
} from "@/lib/types";

export interface FumigationTimelineContext {
  /** ID de la parcela (referencia, no se usa en el cálculo). */
  parcelId: number;
  /** YYYY-MM-DD inclusivo. Eventos estrictamente fuera se filtran. */
  from: string;
  /** YYYY-MM-DD inclusivo. */
  to: string;
  /** Cadencia esperada del schedule de la parcela, o null si no hay. */
  expectedCadenceDays: number | null;
  /** Eventos crudos del repository. */
  events: FumigationTimelineInput[];
}

export function buildFumigationTimeline(
  context: FumigationTimelineContext
): FumigationTimelineResult {
  // ---- 1) Filter por rango [from, to] ----
  const inRange = context.events.filter((e) =>
    e.fumigation_date >= context.from && e.fumigation_date <= context.to
  );

  // ---- 2) Orden ascendente por fecha ----
  const sorted = [...inRange].sort((a, b) =>
    a.fumigation_date.localeCompare(b.fumigation_date)
  );

  // ---- 3) Enriquecer eventos a FumigationEvent ----
  const events: FumigationEvent[] = sorted.map((e) => {
    const areaHaRaw = m2ToHa(e.area_fumigated_m2);
    // 0 m² no es 0 ha significativo — devolvemos null para que la UI
    // muestre "—" en vez de "0.00 ha" (consistente con la UX del Task History).
    const areaHa = areaHaRaw === 0 ? null : areaHaRaw;
    return {
      id: e.id,
      date: e.fumigation_date,
      month: e.fumigation_date.slice(0, 7),
      productUsed: e.product_used,
      doseLPerHa: e.dose_l_per_ha,
      areaHa,
      durationSeconds: e.duration_seconds,
      durationDjiFormat: formatDjiDuration(e.duration_seconds),
      droneCode: e.drone_code_used,
      droneNickname: e.drone_nickname,
      pilotName: e.pilot_name,
      recordedBy: e.recorded_by,
      notes: e.notes,
      source: e.source
    };
  });

  // ---- 4) Aggregations ----
  const totalAreaHa = events.reduce((acc, e) => acc + (e.areaHa ?? 0), 0);
  const totalDurationSeconds = events.reduce(
    (acc, e) => acc + (e.durationSeconds ?? 0),
    0
  );

  // ---- 5) byMonth agrupado ----
  const monthMap = new Map<
    string,
    { count: number; areaHa: number; durationSeconds: number }
  >();
  for (const e of events) {
    const cur = monthMap.get(e.month) ?? { count: 0, areaHa: 0, durationSeconds: 0 };
    cur.count += 1;
    cur.areaHa += e.areaHa ?? 0;
    cur.durationSeconds += e.durationSeconds ?? 0;
    monthMap.set(e.month, cur);
  }
  const byMonth = Array.from(monthMap.entries())
    .map(([yyyymm, v]) => ({ yyyymm, ...v }))
    .sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));

  // ---- 6) Cadencia observada (promedio de días entre fumigaciones consecutivas) ----
  // No es computable con < 2 puntos.
  let observedCadenceDays: number | null = null;
  if (events.length >= 2) {
    let total = 0;
    let count = 0;
    for (let i = 1; i < events.length; i++) {
      const d = daysBetween(events[i - 1]!.date, events[i]!.date);
      if (d !== null && d >= 0) {
        total += d;
        count += 1;
      }
    }
    observedCadenceDays = count > 0 ? Math.round(total / count) : null;
  }

  // ---- 7) Gaps > 60 días entre fumigaciones consecutivas ----
  const gaps: FumigationTimelineResult["summary"]["gaps"] = [];
  for (let i = 1; i < events.length; i++) {
    const d = daysBetween(events[i - 1]!.date, events[i]!.date);
    if (d !== null && d > FUMIGATION_GAP_THRESHOLD_DAYS) {
      gaps.push({
        from: events[i - 1]!.date,
        to: events[i]!.date,
        days: d
      });
    }
  }

  return {
    events,
    summary: {
      count: events.length,
      totalAreaHa,
      totalDurationSeconds,
      byMonth,
      observedCadenceDays,
      expectedCadenceDays: context.expectedCadenceDays,
      gaps
    }
  };
}
