// Tests de la unificación de cadencia (CAD-001, 2026-09-21).
//
// Antes había 3 definiciones incompatibles de "vencida" (1d / 7d / 10d).
// Ahora `lib/fumigation-cadence.ts` es la fuente única y los consumidores
// proyectan:
//   - complianceStatus (tabla/geovisor)  → critico/vencido/por_vencer/al_dia
//   - toCadenceStatus  (dot del mapa)    → critico/vencido/por_vencer/al_dia
//   - computeSeverity  (lista overdue)   → overdue/due_soon/ok/no_history
//
// Este archivo garantiza que las proyecciones NO divergen.

import { describe, expect, it } from "vitest";

import {
  CADENCE_THRESHOLDS,
  FUMIGATION_STATUS_ORDER,
  getCadenceState,
  getFumigationStatus,
  severityFromDays,
  statusLabel,
  type FumigationStatus
} from "@/lib/fumigation-cadence";
import { complianceStatus } from "@/lib/data-constants";
import { toCadenceStatus } from "@/lib/map-filter-logic";
import { computeSeverity } from "@/lib/overdue-parcels";

describe("severityFromDays — bandas canónicas", () => {
  it("null → no_history", () => {
    expect(severityFromDays(null)).toBe("no_history");
  });

  it("por encima de DUE_SOON → ok", () => {
    expect(severityFromDays(CADENCE_THRESHOLDS.DUE_SOON_DAYS + 1)).toBe("ok");
    expect(severityFromDays(30)).toBe("ok");
  });

  it("0..DUE_SOON (incluye hoy) → due_soon", () => {
    expect(severityFromDays(CADENCE_THRESHOLDS.DUE_SOON_DAYS)).toBe("due_soon");
    expect(severityFromDays(0)).toBe("due_soon");
  });

  it("1..CRITICAL vencida → overdue", () => {
    expect(severityFromDays(-1)).toBe("overdue");
    expect(severityFromDays(-CADENCE_THRESHOLDS.CRITICAL_DAYS)).toBe("overdue");
  });

  it("más de CRITICAL vencida → critical", () => {
    expect(severityFromDays(-(CADENCE_THRESHOLDS.CRITICAL_DAYS + 1))).toBe("critical");
    expect(severityFromDays(-30)).toBe("critical");
  });
});

describe("getCadenceState — estado canónico completo", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("sin última fumigación → no_history, sin fecha, cadencia intacta", () => {
    const s = getCadenceState(null, 14, NOW);
    expect(s.status).toBe("no_history");
    expect(s.daysUntilDue).toBeNull();
    expect(s.nextDue).toBeNull();
    expect(s.cadenceDays).toBe(14);
  });

  it("16 días tarde con cadencia 14 → critical y daysUntilDue -16", () => {
    const last = new Date("2026-05-16T12:00:00Z");
    const s = getCadenceState(last, 14, NOW);
    expect(s.status).toBe("critical");
    expect(s.daysUntilDue).toBe(-16);
  });

  it("aplica cadencia efectiva por fase/estación", () => {
    // base 14, vegetativa + secas → 21. last 30d atrás → 9d vencida → overdue.
    const last = new Date("2026-05-16T12:00:00Z");
    const s = getCadenceState(last, 14, NOW, "vegetativa", "secas", "Caña");
    expect(s.cadenceDays).toBe(21);
    expect(s.status).toBe("overdue");
  });
});

describe("proyecciones — la tabla, el mapa y la lista dicen lo mismo", () => {
  const cases: Array<{ days: number | null; canonica: FumigationStatus; tabla: string; mapa: string; lista: string }> = [
    { days: null, canonica: "no_history", tabla: "critico", mapa: "critico", lista: "no_history" },
    { days: -20, canonica: "critical", tabla: "critico", mapa: "critico", lista: "overdue" },
    { days: -5, canonica: "overdue", tabla: "vencido", mapa: "vencido", lista: "overdue" },
    { days: 0, canonica: "due_soon", tabla: "por_vencer", mapa: "por_vencer", lista: "due_soon" },
    { days: 7, canonica: "due_soon", tabla: "por_vencer", mapa: "por_vencer", lista: "due_soon" },
    { days: 8, canonica: "ok", tabla: "al_dia", mapa: "al_dia", lista: "ok" }
  ];

  for (const c of cases) {
    it(`days=${c.days}: canónica=${c.canonica}`, () => {
      expect(severityFromDays(c.days)).toBe(c.canonica);
      expect(complianceStatus(c.days)).toBe(c.tabla);
      expect(toCadenceStatus(severityFromDays(c.days))).toBe(c.mapa);
      expect(computeSeverity(c.days)).toBe(c.lista);
    });
  }
});

describe("regresión CAD-001 — se fueron las bandas viejas (5d / null)", () => {
  it("la tabla ya no usa el corte de 5 días (6d por vencer, no al día)", () => {
    expect(complianceStatus(6)).toBe("por_vencer");
  });

  it("no_history y critical comparten 'critico' en la tabla/mapa", () => {
    expect(complianceStatus(null)).toBe("critico");
    expect(toCadenceStatus("no_history")).toBe("critico");
    expect(toCadenceStatus("critical")).toBe("critico");
  });

  it("-10 sigue siendo vencido; -11 pasa a crítico", () => {
    expect(complianceStatus(-10)).toBe("vencido");
    expect(complianceStatus(-11)).toBe("critico");
  });
});

describe("getFumigationStatus / statusLabel", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("30d sin fumigar con cadencia 14 → critical", () => {
    const last = new Date("2026-05-16T12:00:00Z");
    expect(getFumigationStatus(last, 14, NOW)).toBe("critical");
  });

  it("statusLabel cubre los 5 estados", () => {
    expect(statusLabel("no_history")).toBe("Sin historial");
    expect(statusLabel("critical")).toBe("Crítica");
    expect(statusLabel("overdue")).toBe("Vencida");
    expect(statusLabel("due_soon")).toBe("Vence pronto");
    expect(statusLabel("ok")).toBe("En fecha");
  });
});

describe("FUMIGATION_STATUS_ORDER", () => {
  it("urgencia: critical < overdue < due_soon < ok < no_history", () => {
    expect(FUMIGATION_STATUS_ORDER.critical).toBeLessThan(FUMIGATION_STATUS_ORDER.overdue);
    expect(FUMIGATION_STATUS_ORDER.overdue).toBeLessThan(FUMIGATION_STATUS_ORDER.due_soon);
    expect(FUMIGATION_STATUS_ORDER.due_soon).toBeLessThan(FUMIGATION_STATUS_ORDER.ok);
    expect(FUMIGATION_STATUS_ORDER.ok).toBeLessThan(FUMIGATION_STATUS_ORDER.no_history);
  });
});
