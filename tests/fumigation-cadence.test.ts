import { describe, expect, it } from "vitest";

import {
  CADENCE_DEFAULTS,
  addDays,
  computeNextDueDate,
  daysUntilNextDue,
  getDefaultCadence,
  getFumigationStatus,
  statusLabel
} from "@/lib/fumigation-cadence";

describe("fumigation-cadence — defaults", () => {
  it("Orchards → 10 días, Frutales", () => {
    expect(CADENCE_DEFAULTS.Orchards.crop_type).toBe("Frutales");
    expect(CADENCE_DEFAULTS.Orchards.recommended_cadence_days).toBe(10);
  });

  it("Farmland → 14 días, Caña de azúcar", () => {
    expect(CADENCE_DEFAULTS.Farmland.crop_type).toBe("Caña de azúcar");
    expect(CADENCE_DEFAULTS.Farmland.recommended_cadence_days).toBe(14);
  });

  it("getDefaultCadence retorna Orchards cuando fieldType es 'Orchards'", () => {
    const d = getDefaultCadence("Orchards");
    expect(d.recommended_cadence_days).toBe(10);
  });

  it("getDefaultCadence retorna Farmland para cualquier otro (o null)", () => {
    expect(getDefaultCadence("Farmland").recommended_cadence_days).toBe(14);
    expect(getDefaultCadence(null).recommended_cadence_days).toBe(14);
    expect(getDefaultCadence(undefined).recommended_cadence_days).toBe(14);
    expect(getDefaultCadence("Desconocido").recommended_cadence_days).toBe(14);
  });
});

describe("fumigation-cadence — addDays", () => {
  it("suma N días a una fecha ISO", () => {
    const d = addDays("2026-06-10", 14);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-06-24");
  });

  it("acepta Date", () => {
    const d = addDays(new Date("2026-06-10T00:00:00Z"), 7);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-06-17");
  });

  it("devuelve null para null/undefined", () => {
    expect(addDays(null, 5)).toBeNull();
    expect(addDays(undefined, 5)).toBeNull();
  });
});

describe("fumigation-cadence — computeNextDueDate", () => {
  it("suma la cadencia a la última fumigación", () => {
    const next = computeNextDueDate("2026-06-01", 14);
    expect(next?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("devuelve null sin última fumigación", () => {
    expect(computeNextDueDate(null, 14)).toBeNull();
    expect(computeNextDueDate(undefined, 14)).toBeNull();
  });
});

describe("fumigation-cadence — getFumigationStatus", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("no_history cuando no hay última fumigación", () => {
    expect(getFumigationStatus(null, 14, NOW)).toBe("no_history");
  });

  it("ok cuando la próxima está a más de 7 días", () => {
    // Última hace 5 días, cadencia 14d → próxima en 9 días
    const last = new Date("2026-06-10T00:00:00Z");
    expect(getFumigationStatus(last, 14, NOW)).toBe("ok");
  });

  it("due_soon cuando la próxima está en 0-7 días", () => {
    // Última hace 12 días, cadencia 14d → próxima en 2 días
    const last = new Date("2026-06-03T00:00:00Z");
    expect(getFumigationStatus(last, 14, NOW)).toBe("due_soon");
  });

  it("due_soon cuando la próxima es hoy", () => {
    // Última hace 14 días, cadencia 14d → hoy
    const last = new Date("2026-06-01T00:00:00Z");
    expect(getFumigationStatus(last, 14, NOW)).toBe("due_soon");
  });

  it("overdue cuando la próxima pasó hace 1+ días", () => {
    // Última hace 20 días, cadencia 14d → próxima fue hace 6 días
    const last = new Date("2026-05-26T00:00:00Z");
    expect(getFumigationStatus(last, 14, NOW)).toBe("overdue");
  });
});

describe("fumigation-cadence — daysUntilNextDue", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("devuelve null sin última fumigación", () => {
    expect(daysUntilNextDue(null, 14, NOW)).toBeNull();
  });

  it("devuelve días futuros positivos", () => {
    // Última hace 5 días, cadencia 14d → faltan 9 días
    const last = new Date("2026-06-10T00:00:00Z");
    const days = daysUntilNextDue(last, 14, NOW);
    expect(days).toBe(9);
  });

  it("devuelve días vencidos negativos", () => {
    // Última hace 30 días, cadencia 14d → vencida hace 16 días
    const last = new Date("2026-05-16T00:00:00Z");
    const days = daysUntilNextDue(last, 14, NOW);
    expect(days).toBe(-16);
  });
});

describe("fumigation-cadence — statusLabel", () => {
  it("etiquetas legibles para humanos", () => {
    expect(statusLabel("no_history")).toBe("Sin historial");
    expect(statusLabel("ok")).toBe("En fecha");
    expect(statusLabel("due_soon")).toBe("Vence pronto");
    expect(statusLabel("overdue")).toBe("Vencida");
  });
});
