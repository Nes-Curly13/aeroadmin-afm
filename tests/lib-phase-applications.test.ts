import { describe, expect, it } from "vitest";
import {
  applicationsForPhase,
  computeRequirement,
  daysBetween,
  phaseForDays,
  type PhaseApplicationRule
} from "@/lib/phase-applications";

function rule(over: Partial<PhaseApplicationRule> = {}): PhaseApplicationRule {
  return {
    id: 1,
    crop_type: "cana",
    phase: "establecimiento",
    category_slug: "herbicida",
    application_type_slug: "pre_emergente",
    cadence_days: null,
    window_from_day: 0,
    window_to_day: 20,
    is_required: true,
    notes: null,
    ...over
  };
}

describe("phaseForDays", () => {
  it("mapea los límites de la curva canónica", () => {
    expect(phaseForDays(0)).toBe("establecimiento");
    expect(phaseForDays(120)).toBe("establecimiento");
    expect(phaseForDays(121)).toBe("vegetativa");
    expect(phaseForDays(270)).toBe("vegetativa");
    expect(phaseForDays(271)).toBe("madurante");
    expect(phaseForDays(360)).toBe("madurante");
    expect(phaseForDays(361)).toBe("cosecha");
  });
});

describe("daysBetween", () => {
  it("cuenta días enteros entre fechas ISO", () => {
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
    expect(daysBetween("2026-01-11", "2026-01-01")).toBe(-10);
  });
});

describe("applicationsForPhase", () => {
  it("filtra por fase", () => {
    const rules = [rule({ id: 1, phase: "establecimiento" }), rule({ id: 2, phase: "vegetativa" })];
    expect(applicationsForPhase(rules, "vegetativa").map((r) => r.id)).toEqual([2]);
  });
});

describe("computeRequirement", () => {
  it("sin_ciclo si no hay start_date", () => {
    const r = computeRequirement(rule(), null, "2026-03-01", []);
    expect(r.status).toBe("sin_ciclo");
    expect(r.windowStart).toBeNull();
  });

  it("programada antes de la ventana", () => {
    // start 2026-03-01, ventana 0-20 → 2026-03-01..03-21
    const r = computeRequirement(rule(), "2026-03-01", "2026-02-20", []);
    expect(r.status).toBe("programada");
  });

  it("pendiente dentro de la ventana (requerida, sin registrar)", () => {
    const r = computeRequirement(rule(), "2026-03-01", "2026-03-10", []);
    expect(r.status).toBe("pendiente");
    expect(r.windowStart).toBe("2026-03-01");
    expect(r.windowEnd).toBe("2026-03-21");
  });

  it("vencida si pasó la ventana sin registrar", () => {
    const r = computeRequirement(rule(), "2026-03-01", "2026-04-01", []);
    expect(r.status).toBe("vencida");
  });

  it("al_dia si se registró dentro de la ventana", () => {
    const r = computeRequirement(rule(), "2026-03-01", "2026-04-01", ["2026-03-05"]);
    expect(r.status).toBe("al_dia");
    expect(r.lastAppliedAt).toBe("2026-03-05");
  });

  it("ignora aplicaciones fuera de la ventana", () => {
    const r = computeRequirement(rule(), "2026-03-01", "2026-03-10", ["2026-05-01"]);
    expect(r.status).toBe("pendiente");
  });

  it("no requerida vencida → segun_monitoreo (sin alerta dura)", () => {
    const r = computeRequirement(rule({ is_required: false }), "2026-03-01", "2026-06-01", []);
    expect(r.status).toBe("segun_monitoreo");
  });
});
