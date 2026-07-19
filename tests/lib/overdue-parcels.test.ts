// tests/lib/overdue-parcels.test.ts
//
// TDD rojo→verde para lib/overdue-parcels.ts (M3-M5 Q2 sprint).
// Cubre:
//   1. computeSeverity — bordes de la clasificación.
//   2. SEVERITY_ORDER — ordenamiento estable.
//   3. sortOverdueByPriority — combinación severity + days + parcel_id.
//   4. severityLabel / severityChipClass — copy UI.

import { describe, expect, it } from "vitest";

import {
  computeSeverity,
  SEVERITY_ORDER,
  severityChipClass,
  severityLabel,
  sortOverdueByPriority
} from "@/lib/overdue-parcels";

describe("computeSeverity", () => {
  it("daysUntilNextDue < 0 → overdue", () => {
    expect(computeSeverity(-1)).toBe("overdue");
    expect(computeSeverity(-30)).toBe("overdue");
    expect(computeSeverity(-365)).toBe("overdue");
  });

  it("daysUntilNextDue = 0 → due_soon (vence hoy)", () => {
    expect(computeSeverity(0)).toBe("due_soon");
  });

  it("daysUntilNextDue entre 1 y 7 → due_soon", () => {
    expect(computeSeverity(1)).toBe("due_soon");
    expect(computeSeverity(7)).toBe("due_soon");
  });

  it("daysUntilNextDue = 8 → ok (fuera de la ventana de urgencia)", () => {
    expect(computeSeverity(8)).toBe("ok");
  });

  it("daysUntilNextDue grande → ok", () => {
    expect(computeSeverity(30)).toBe("ok");
    expect(computeSeverity(365)).toBe("ok");
  });

  it("daysUntilNextDue = null → no_history", () => {
    expect(computeSeverity(null)).toBe("no_history");
  });
});

describe("SEVERITY_ORDER", () => {
  it("overdue < due_soon < ok < no_history (orden de prioridad)", () => {
    expect(SEVERITY_ORDER.overdue).toBeLessThan(SEVERITY_ORDER.due_soon);
    expect(SEVERITY_ORDER.due_soon).toBeLessThan(SEVERITY_ORDER.ok);
    expect(SEVERITY_ORDER.ok).toBeLessThan(SEVERITY_ORDER.no_history);
  });
});

describe("sortOverdueByPriority", () => {
  // Helper para construir fixtures tipadas.
  // Importante: usa un objeto de overrides explícito en lugar de
  // defaults con `??`, para preservar `null` cuando se quiere testear
  // ese caso (recordatorio: `null ?? 30` se evalúa a 30, NO a null).
  const p = (overrides: {
    parcel_id?: number;
    severity?: "overdue" | "due_soon" | "ok" | "no_history";
    days_until_next_due?: number | null;
  }) => {
    const out: {
      parcel_id: number;
      severity: "overdue" | "due_soon" | "ok" | "no_history";
      days_until_next_due: number | null;
    } = {
      parcel_id: 1,
      severity: "ok",
      days_until_next_due: 30
    };
    if (overrides.parcel_id !== undefined) out.parcel_id = overrides.parcel_id;
    if (overrides.severity !== undefined) out.severity = overrides.severity;
    // Solo sobreescribimos si la key está presente Y no es null
    if (Object.prototype.hasOwnProperty.call(overrides, "days_until_next_due")) {
      out.days_until_next_due = overrides.days_until_next_due ?? null;
    }
    return out;
  };

  it("ordena overdue antes de due_soon antes de ok antes de no_history", () => {
    const arr = [p({ parcel_id: 1, severity: "ok" }), p({ parcel_id: 2, severity: "no_history" }), p({ parcel_id: 3, severity: "overdue" }), p({ parcel_id: 4, severity: "due_soon" })];
    const sorted = arr.slice().sort(sortOverdueByPriority);
    expect(sorted.map((x) => x.parcel_id)).toEqual([3, 4, 1, 2]);
  });

  it("dentro de overdue, las más atrasadas primero (días más negativos)", () => {
    const arr = [p({ parcel_id: 1, severity: "overdue", days_until_next_due: -5 }), p({ parcel_id: 2, severity: "overdue", days_until_next_due: -30 }), p({ parcel_id: 3, severity: "overdue", days_until_next_due: -1 })];
    const sorted = arr.slice().sort(sortOverdueByPriority);
    expect(sorted.map((x) => x.parcel_id)).toEqual([2, 1, 3]);
  });

  it("dentro de due_soon, las que vencen antes primero", () => {
    const arr = [p({ parcel_id: 1, severity: "due_soon", days_until_next_due: 7 }), p({ parcel_id: 2, severity: "due_soon", days_until_next_due: 0 }), p({ parcel_id: 3, severity: "due_soon", days_until_next_due: 3 })];
    const sorted = arr.slice().sort(sortOverdueByPriority);
    expect(sorted.map((x) => x.parcel_id)).toEqual([2, 3, 1]);
  });

  it("empate en severity y days: desempate por parcel_id ASC (orden estable)", () => {
    const arr = [p({ parcel_id: 3, severity: "overdue", days_until_next_due: -10 }), p({ parcel_id: 1, severity: "overdue", days_until_next_due: -10 }), p({ parcel_id: 2, severity: "overdue", days_until_next_due: -10 })];
    const sorted = arr.slice().sort(sortOverdueByPriority);
    expect(sorted.map((x) => x.parcel_id)).toEqual([1, 2, 3]);
  });

  it("days_until_next_due null se trata como 0 para el desempate", () => {
    // Si dos parcelas tienen severity 'due_soon' pero una tiene null
    // days y la otra 0, el helper `?? 0` las pone a la par. El
    // desempate por parcel_id debe ganar.
    // Test con 3 elementos para que V8 TimSort haga al menos
    // una comparación cruzada (no solo entre el primer par).
    const arr = [
      p({ parcel_id: 2, severity: "due_soon", days_until_next_due: 0 }),
      p({ parcel_id: 1, severity: "due_soon", days_until_next_due: null }),
      p({ parcel_id: 3, severity: "due_soon", days_until_next_due: 0 })
    ];
    const sorted = arr.slice().sort(sortOverdueByPriority);
    // 1 (null→0) y 2 y 3 (0) todos en 0 días, desempate por parcel_id.
    expect(sorted.map((x) => x.parcel_id)).toEqual([1, 2, 3]);
  });
});

describe("severityLabel (UI copy)", () => {
  it("traduce cada severity al español", () => {
    expect(severityLabel("overdue")).toBe("Vencida");
    expect(severityLabel("due_soon")).toBe("Vence pronto");
    expect(severityLabel("ok")).toBe("En fecha");
    expect(severityLabel("no_history")).toBe("Sin historial");
  });
});

describe("severityChipClass (estilos inline consistentes con parcel-fumigations)", () => {
  it("overdue usa rojo danger", () => {
    expect(severityChipClass("overdue")).toContain("a93232");
  });
  it("due_soon usa amarillo warning", () => {
    expect(severityChipClass("due_soon")).toContain("d4b23c");
  });
  it("ok usa verde primary", () => {
    expect(severityChipClass("ok")).toContain("0b5f2d");
  });
  it("no_history usa gris neutral", () => {
    expect(severityChipClass("no_history")).toContain("cfd8d3");
  });
});
