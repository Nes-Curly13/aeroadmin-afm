import { describe, expect, it } from "vitest";

import {
  DEFAULT_CROP_CYCLE_MONTHS,
  cadenceForPhase,
  expectedDaysUntilHarvest,
  monthsBetween,
  phaseChipClass,
  phaseFor,
  phaseLabel
} from "@/lib/crop-cycle";

const TODAY = new Date("2026-08-01T12:00:00Z");

function monthsAgo(n: number, base: Date = TODAY): Date {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

describe("crop-cycle — monthsBetween", () => {
  it("devuelve 0 cuando `to` es anterior a `from`", () => {
    const from = new Date("2025-03-15T00:00:00Z");
    const to = new Date("2025-02-15T00:00:00Z");
    expect(monthsBetween(from, to)).toBe(0);
  });

  it("cuenta meses calendario completos por día del mes", () => {
    const from = new Date("2025-03-15T00:00:00Z");
    expect(monthsBetween(from, new Date("2026-03-15T00:00:00Z"))).toBe(12);
    expect(monthsBetween(from, new Date("2025-04-15T00:00:00Z"))).toBe(1);
  });

  it("no completa el mes si el día de `to` es anterior al de `from`", () => {
    const from = new Date("2025-03-15T00:00:00Z");
    // 1 día antes del mes 1 → 0 meses completos
    expect(monthsBetween(from, new Date("2025-04-14T00:00:00Z"))).toBe(0);
  });

  it("maneja跨越 de año", () => {
    const from = new Date("2025-11-15T00:00:00Z");
    expect(monthsBetween(from, new Date("2026-02-15T00:00:00Z"))).toBe(3);
  });
});

describe("crop-cycle — phaseFor (caña de azúcar)", () => {
  it("devuelve null cuando plantingDate es null", () => {
    expect(phaseFor(null, TODAY)).toBeNull();
    expect(phaseFor(undefined, TODAY)).toBeNull();
  });

  it("devuelve null si today es anterior a plantingDate", () => {
    const future = new Date("2027-01-01T00:00:00Z");
    expect(phaseFor(future, TODAY)).toBeNull();
  });

  it("devuelve 'establecimiento' para plantingDate 0–3 meses atrás", () => {
    expect(phaseFor(monthsAgo(0), TODAY)).toBe("establecimiento");
    expect(phaseFor(monthsAgo(2), TODAY)).toBe("establecimiento");
    // Caso borde: justo 3 meses no es establecimiento
    expect(phaseFor(monthsAgo(3), TODAY)).toBe("vegetativa");
  });

  it("devuelve 'vegetativa' para plantingDate 3–9 meses atrás", () => {
    expect(phaseFor(monthsAgo(3), TODAY)).toBe("vegetativa");
    expect(phaseFor(monthsAgo(8), TODAY)).toBe("vegetativa");
    // Caso borde: justo 9 meses no es vegetativa
    expect(phaseFor(monthsAgo(9), TODAY)).toBe("madurante");
  });

  it("devuelve 'madurante' para plantingDate 9–12 meses atrás", () => {
    expect(phaseFor(monthsAgo(9), TODAY)).toBe("madurante");
    expect(phaseFor(monthsAgo(11), TODAY)).toBe("madurante");
    // Caso borde: justo 12 meses no es madurante
    expect(phaseFor(monthsAgo(12), TODAY)).toBe("cosecha");
  });

  it("devuelve 'cosecha' para plantingDate >12 meses atrás", () => {
    expect(phaseFor(monthsAgo(12), TODAY)).toBe("cosecha");
    expect(phaseFor(monthsAgo(15), TODAY)).toBe("cosecha");
    expect(phaseFor(monthsAgo(24), TODAY)).toBe("cosecha");
  });

  it("acepta plantingDate como string ISO", () => {
    // 2026-05-15 = 2.5 meses atrás de TODAY (2026-08-01) → 'establecimiento'
    expect(phaseFor("2026-05-15", TODAY)).toBe("establecimiento");
    // 2024-04-01 = ~28 meses atrás → 'cosecha'
    expect(phaseFor("2024-04-01", TODAY)).toBe("cosecha");
  });
});

describe("crop-cycle — phaseFor (orchards, simplificación)", () => {
  it("orchards con plantingDate no-null → 'vegetativa'", () => {
    expect(phaseFor(monthsAgo(2), TODAY, "Orchards")).toBe("vegetativa");
    expect(phaseFor(monthsAgo(8), TODAY, "Orchards")).toBe("vegetativa");
    expect(phaseFor(monthsAgo(15), TODAY, "Orchards")).toBe("vegetativa");
  });

  it("matchea nombres de crop type orchards / frutal / frutales (case-insensitive)", () => {
    expect(phaseFor(monthsAgo(8), TODAY, "orchards")).toBe("vegetativa");
    expect(phaseFor(monthsAgo(8), TODAY, "Frutales")).toBe("vegetativa");
    expect(phaseFor(monthsAgo(8), TODAY, "frutal")).toBe("vegetativa");
  });

  it("orchards con plantingDate null → null (sin asumir fase)", () => {
    expect(phaseFor(null, TODAY, "Orchards")).toBeNull();
  });

  it("cultivo desconocido con plantingDate sigue la regla de caña", () => {
    expect(phaseFor(monthsAgo(2), TODAY, "Arroz")).toBe("establecimiento");
    expect(phaseFor(monthsAgo(11), TODAY, "Arroz")).toBe("madurante");
  });
});

describe("crop-cycle — cadenceForPhase", () => {
  it("null → baseCadence (fallback legacy)", () => {
    expect(cadenceForPhase(null, 14)).toBe(14);
    expect(cadenceForPhase(undefined, 10)).toBe(10);
  });

  it("'vegetativa' → baseCadence sin cambio", () => {
    expect(cadenceForPhase("vegetativa", 14)).toBe(14);
    expect(cadenceForPhase("vegetativa", 10)).toBe(10);
  });

  it("'establecimiento' → baseCadence × 1.5", () => {
    expect(cadenceForPhase("establecimiento", 14)).toBe(21);
    expect(cadenceForPhase("establecimiento", 10)).toBe(15);
  });

  it("'madurante' → 35 (fixed, ripener pre-cosecha)", () => {
    expect(cadenceForPhase("madurante", 14)).toBe(35);
    expect(cadenceForPhase("madurante", 10)).toBe(35);
  });

  it("'cosecha' → 999 (effectively sin fumigación)", () => {
    expect(cadenceForPhase("cosecha", 14)).toBe(999);
    expect(cadenceForPhase("cosecha", 10)).toBe(999);
  });

  it("nunca devuelve menos de 1 día (sanity check)", () => {
    expect(cadenceForPhase("establecimiento", 0)).toBeGreaterThanOrEqual(1);
    expect(cadenceForPhase("vegetativa", 0)).toBeGreaterThanOrEqual(1);
    // Aún baseCadence negativo se protege
    expect(cadenceForPhase("vegetativa", -5)).toBeGreaterThanOrEqual(1);
  });
});

describe("crop-cycle — expectedDaysUntilHarvest", () => {
  it("devuelve null si plantingDate es null", () => {
    expect(expectedDaysUntilHarvest(null, TODAY)).toBeNull();
    expect(expectedDaysUntilHarvest(undefined, TODAY)).toBeNull();
  });

  it("8 meses atrás, ciclo 13 → ~150 días restantes", () => {
    const days = expectedDaysUntilHarvest(monthsAgo(8), TODAY, 13);
    expect(days).not.toBeNull();
    // 5 meses restantes * 30.4375 = ~152 días. Tolerancia ±5 días.
    expect(days!).toBeGreaterThan(140);
    expect(days!).toBeLessThan(160);
  });

  it("devuelve null si el ciclo ya pasó", () => {
    const days = expectedDaysUntilHarvest(monthsAgo(15), TODAY, 13);
    expect(days).toBeNull();
  });

  it("acepta plantingDate como string ISO", () => {
    const days = expectedDaysUntilHarvest("2025-12-01", TODAY, 13);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(0);
  });

  it("usa DEFAULT_CROP_CYCLE_MONTHS=13 cuando no se especifica", () => {
    const explicit = expectedDaysUntilHarvest(monthsAgo(8), TODAY, 13);
    const implicit = expectedDaysUntilHarvest(monthsAgo(8), TODAY);
    expect(implicit).toBe(explicit);
    expect(DEFAULT_CROP_CYCLE_MONTHS).toBe(13);
  });
});

describe("crop-cycle — phaseLabel + phaseChipClass", () => {
  it("phaseLabel devuelve etiqueta humana en español", () => {
    expect(phaseLabel("vegetativa")).toBe("Vegetativa");
    expect(phaseLabel("establecimiento")).toBe("Establecimiento");
    expect(phaseLabel("madurante")).toBe("Madurante");
    expect(phaseLabel("cosecha")).toBe("Cosecha");
    expect(phaseLabel(null)).toBe("Desconocida");
    expect(phaseLabel(undefined)).toBe("Desconocida");
  });

  it("phaseChipClass devuelve clase con tokens AFM (no vacía)", () => {
    for (const phase of ["vegetativa", "establecimiento", "madurante", "cosecha", null, undefined] as const) {
      const cls = phaseChipClass(phase);
      expect(cls).toBeTruthy();
      expect(typeof cls).toBe("string");
    }
  });

  it("phaseChipClass distingue fases (clases distintas para colores distintos)", () => {
    const veg = phaseChipClass("vegetativa");
    const cos = phaseChipClass("cosecha");
    const mad = phaseChipClass("madurante");
    expect(veg).not.toBe(cos);
    expect(veg).not.toBe(mad);
    expect(cos).not.toBe(mad);
  });
});
