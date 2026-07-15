// tests/lib/fumigation-timeline.test.ts
//
// Tests para `buildFumigationTimeline` (lib/fumigation-timeline.ts).
// Función pura: arma FumigationTimelineResult a partir de eventos crudos
// del repositorio + contexto (parcelId, from, to, expectedCadenceDays).
//
// Cubre (checklist §4.3 de docs/guia/02_TDD_AeroAdmin_AFM.md):
//   - Caso feliz
//   - Caso borde específico del dominio:
//     * Parcela sin fumigaciones
//     * 1 sola fumigación (cadencia observada no computable)
//     * Volumen alto (50 eventos跨越 3 años) — byMonth agrupado OK
//     * NULLs en duration/area — no rompe
//     * expectedCadenceDays null (sin schedule)
//   - Si toca fechas: día 23:59 Bogota — month bucket correcto

import { describe, expect, it } from "vitest";

import { buildFumigationTimeline } from "@/lib/fumigation-timeline";
import type { FumigationTimelineInput } from "@/lib/types";

/** Factory mínima de un input — Bogota-local YYYY-MM-DD, todo en lo "normal". */
function ev(over: Partial<FumigationTimelineInput> & { fumigation_date: string }): FumigationTimelineInput {
  return {
    id: 1,
    product_used: null,
    dose_l_per_ha: null,
    area_fumigated_m2: 10_000,            // 1 ha default
    duration_seconds: 3600,                // 1h default
    drone_code_used: 1,
    drone_nickname: "T40-01",
    pilot_name: "Juan Pérez",
    recorded_by: "operator",
    notes: null,
    source: "manual",
    ...over
  };
}

interface CtxOverrides {
  from?: string;
  to?: string;
  expectedCadenceDays?: number | null;  // explícito null = "sin cadencia"
}

const ctx = (over: CtxOverrides = {}) => {
  const { expectedCadenceDays, from, to } = over;
  return {
    parcelId: 42,
    from: from ?? "2026-01-01",
    to: to ?? "2026-12-31",
    // Si `expectedCadenceDays` no se pasa, default 14. Si se pasa null
    // explícito, queda null. Si se pasa un número, queda ese número.
    expectedCadenceDays:
      expectedCadenceDays === undefined ? 14 : expectedCadenceDays
  };
};

describe("buildFumigationTimeline", () => {
  it("parcela sin fumigaciones: count=0, gaps=[], observedCadenceDays=null, expectedCadenceDays=ctx value", () => {
    const r = buildFumigationTimeline({ ...ctx(), events: [] });

    expect(r.events).toEqual([]);
    expect(r.summary.count).toBe(0);
    expect(r.summary.totalAreaHa).toBe(0);
    expect(r.summary.totalDurationSeconds).toBe(0);
    expect(r.summary.byMonth).toEqual([]);
    expect(r.summary.observedCadenceDays).toBeNull();
    expect(r.summary.expectedCadenceDays).toBe(14);
    expect(r.summary.gaps).toEqual([]);
  });

  it("parcela con 1 fumigación: count=1, observedCadenceDays=null (cadencia no es computable con < 2 puntos)", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [ev({ id: 1, fumigation_date: "2026-03-15" })]
    });

    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.date).toBe("2026-03-15");
    expect(r.events[0]?.month).toBe("2026-03");
    expect(r.summary.count).toBe(1);
    expect(r.summary.observedCadenceDays).toBeNull();
    expect(r.summary.gaps).toEqual([]);
    // byMonth: una entrada en marzo
    expect(r.summary.byMonth).toEqual([
      { yyyymm: "2026-03", count: 1, areaHa: 1, durationSeconds: 3600 }
    ]);
  });

  it("50 fumigaciones跨越 3 años: byMonth agrupado correcto, totalAreaHa y totalDurationSeconds suman OK", () => {
    // Genera 50 fumigaciones distribuidas entre 2024, 2025 y 2026.
    // Esquema: 1 fumigación cada 22 días empezando 2024-01-15.
    // 50 eventos * 22 días = 1100 días ≈ 3.01 años → cubre 3 calendarios.
    const start = new Date("2024-01-15T00:00:00Z");
    const events: FumigationTimelineInput[] = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i * 22);
      const dateStr = d.toISOString().slice(0, 10);
      events.push(
        ev({
          id: i + 1,
          fumigation_date: dateStr,
          area_fumigated_m2: 8_000,   // 0.8 ha cada uno
          duration_seconds: 2400      // 40 min cada uno
        })
      );
    }
    const r = buildFumigationTimeline({
      ...ctx({ from: "2024-01-01", to: "2026-12-31" }),
      events
    });

    expect(r.events).toHaveLength(50);
    // Orden ascendente
    expect(r.events[0]?.date).toBe("2024-01-15");
    expect(r.events[49]?.date >= r.events[0]?.date).toBe(true);

    // byMonth agrupado: la suma de counts debe dar 50
    const totalCount = r.summary.byMonth.reduce((acc, m) => acc + m.count, 0);
    expect(totalCount).toBe(50);
    // Suma de areas = 50 * 0.8 = 40 ha
    const totalArea = r.summary.byMonth.reduce((acc, m) => acc + m.areaHa, 0);
    expect(totalArea).toBeCloseTo(40, 5);
    // Suma de durations = 50 * 2400 = 120_000 s
    const totalDur = r.summary.byMonth.reduce((acc, m) => acc + m.durationSeconds, 0);
    expect(totalDur).toBe(120_000);

    // Cadencia observada: como están exactamente cada 22 días, debe ser 22
    expect(r.summary.observedCadenceDays).toBe(22);

    // byMonth está ordenado por yyyymm asc
    const months = r.summary.byMonth.map((m) => m.yyyymm);
    const sorted = [...months].sort();
    expect(months).toEqual(sorted);

    // Hay 3 años distintos en el dataset (2024, 2025, 2026)
    const years = new Set(months.map((m) => m.slice(0, 4)));
    expect(years.size).toBe(3);
    expect(years.has("2024")).toBe(true);
    expect(years.has("2025")).toBe(true);
    expect(years.has("2026")).toBe(true);
  });

  it("nulls en duration_seconds y area_fumigated_m2 no rompen el cálculo", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        ev({ id: 1, fumigation_date: "2026-01-10", area_fumigated_m2: 5_000, duration_seconds: 1800 }),
        ev({ id: 2, fumigation_date: "2026-01-20", area_fumigated_m2: null, duration_seconds: null }),
        ev({ id: 3, fumigation_date: "2026-02-05", area_fumigated_m2: 0, duration_seconds: 0 })
      ]
    });

    expect(r.events).toHaveLength(3);
    // El evento con nulls tiene areaHa=null y durationDjiFormat="—"
    const nullish = r.events.find((e) => e.id === 2)!;
    expect(nullish.areaHa).toBeNull();
    expect(nullish.durationDjiFormat).toBe("—");

    // El total suma lo que puede (null → 0, no rompe)
    // areaHa: 5000/10000 + null + 0/10000 = 0.5 ha
    // durationSeconds: 1800 + null + 0 = 1800
    expect(r.summary.totalAreaHa).toBeCloseTo(0.5, 5);
    expect(r.summary.totalDurationSeconds).toBe(1800);
  });

  it("parcela sin cadencia definida: expectedCadenceDays=null, gaps siguen computándose", () => {
    const r = buildFumigationTimeline({
      ...ctx({ expectedCadenceDays: null }),
      events: [
        ev({ id: 1, fumigation_date: "2026-01-10" }),
        ev({ id: 2, fumigation_date: "2026-01-24" }),  // 14 días
        ev({ id: 3, fumigation_date: "2026-06-15" })   // gap grande (> 60d) desde 2026-01-24
      ]
    });

    expect(r.summary.expectedCadenceDays).toBeNull();
    // observedCadenceDays sigue siendo computable (es entre fumigaciones, no contra el schedule)
    expect(r.summary.observedCadenceDays).not.toBeNull();
    // 1 gap > 60d: 2026-01-24 → 2026-06-15 = 142 días
    expect(r.summary.gaps).toEqual([
      { from: "2026-01-24", to: "2026-06-15", days: 142 }
    ]);
  });

  it("fecha 23:59 Bogota cae en el mes correcto del bucket byMonth (TZ-aware)", () => {
    // Caso de borde: si un día 31 a las 23:59 Bogota se interpreta como día 1
    // del mes siguiente en UTC, el bucket byMonth sería incorrecto.
    // Como `fumigation_date` es una columna DATE (no timestamptz), la BD ya
    // almacena la fecha operatoria — el repository la entrega como YYYY-MM-DD
    // Bogota-local. La función NO debe re-interpretar el día a UTC; usa
    // `date.slice(0, 7)` para mantener el bucket Bogota-local.
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        // Fumigación tardía en el último día del mes
        ev({ id: 1, fumigation_date: "2026-01-31" }),
        // Y una el 1ro del siguiente
        ev({ id: 2, fumigation_date: "2026-02-01" })
      ]
    });

    expect(r.events[0]?.month).toBe("2026-01");
    expect(r.events[1]?.month).toBe("2026-02");
    expect(r.summary.byMonth).toEqual([
      { yyyymm: "2026-01", count: 1, areaHa: 1, durationSeconds: 3600 },
      { yyyymm: "2026-02", count: 1, areaHa: 1, durationSeconds: 3600 }
    ]);
  });

  it("gaps: solo incluye gaps estrictamente mayores a 60 días (no <= 60)", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        ev({ id: 1, fumigation_date: "2026-01-01" }),
        ev({ id: 2, fumigation_date: "2026-02-15" }),  // 45 días — no gap
        ev({ id: 3, fumigation_date: "2026-03-02" }),  // 15 días — no gap
        ev({ id: 4, fumigation_date: "2026-05-02" })   // 61 días — gap
      ]
    });

    expect(r.summary.gaps).toEqual([
      { from: "2026-03-02", to: "2026-05-02", days: 61 }
    ]);
  });

  it("cadencia observada con 2 fumigaciones: promedio de daysBetween entre fechas consecutivas", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        ev({ id: 1, fumigation_date: "2026-01-01" }),
        ev({ id: 2, fumigation_date: "2026-01-21" })   // 20 días
      ]
    });

    expect(r.summary.observedCadenceDays).toBe(20);
    // Sin gaps (20d < 60d)
    expect(r.summary.gaps).toEqual([]);
  });

  it("cadencia observada con 3 fumigaciones: promedio de (a→b) y (b→c)", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        ev({ id: 1, fumigation_date: "2026-01-01" }),
        ev({ id: 2, fumigation_date: "2026-01-15" }),  // 14
        ev({ id: 3, fumigation_date: "2026-02-12" })   // 28
      ]
    });

    // Promedio: (14 + 28) / 2 = 21
    expect(r.summary.observedCadenceDays).toBe(21);
  });

  it("eventos fuera del rango [from, to] se excluyen (input no saneado por el caller)", () => {
    const r = buildFumigationTimeline({
      ...ctx({ from: "2026-01-01", to: "2026-06-30" }),
      events: [
        ev({ id: 1, fumigation_date: "2025-12-25" }),  // fuera
        ev({ id: 2, fumigation_date: "2026-03-15" }),  // dentro
        ev({ id: 3, fumigation_date: "2026-07-01" })   // fuera (to es inclusivo pero strict >)
      ]
    });

    expect(r.events.map((e) => e.id)).toEqual([2]);
    expect(r.summary.count).toBe(1);
  });

  it("enriquecimiento: drone_nickname y pilot_name del input se preservan en el evento", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [
        ev({
          id: 1,
          fumigation_date: "2026-03-15",
          drone_nickname: "T40-007",
          pilot_name: "María López"
        })
      ]
    });

    expect(r.events[0]?.droneNickname).toBe("T40-007");
    expect(r.events[0]?.pilotName).toBe("María López");
  });

  it("duración con segundos = 0 produce durationDjiFormat '0Hour00min00s' (no '—')", () => {
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [ev({ id: 1, fumigation_date: "2026-03-15", duration_seconds: 0 })]
    });

    expect(r.events[0]?.durationSeconds).toBe(0);
    expect(r.events[0]?.durationDjiFormat).toBe("0Hour00min00s");
  });

  it("areaHa es null si area_fumigated_m2 es 0 (UI muestra '—', no '0.00 ha')", () => {
    // 0 m² no es "0 ha" significativo — devolvemos null para que la UI decida.
    const r = buildFumigationTimeline({
      ...ctx(),
      events: [ev({ id: 1, fumigation_date: "2026-03-15", area_fumigated_m2: 0 })]
    });

    expect(r.events[0]?.areaHa).toBeNull();
  });
});
