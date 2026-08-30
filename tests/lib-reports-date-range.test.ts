// Tests para los helpers de date range del feature/s9-2-reports-date-range.
// Cubre `quickRange` y `defaultWindow` (ambos extraídos a
// `lib/reports/date-range.ts` para testabilidad).

import { describe, expect, it } from "vitest";

import { defaultWindow, quickRange } from "@/lib/reports/date-range";

describe("quickRange — presets de rango rápido", () => {
  // todayParts = [2026, 8, 29] (29 de agosto de 2026)
  const today: [number, number, number] = [2026, 8, 29];

  describe("preset '7d' (últimos 7 días)", () => {
    it("to es hoy", () => {
      const r = quickRange(today, "7d");
      expect(r.to).toBe("2026-08-29");
    });

    it("from es 7 días antes (mes anterior)", () => {
      const r = quickRange(today, "7d");
      expect(r.from).toBe("2026-08-22");
    });
  });

  describe("preset '30d' (últimos 30 días)", () => {
    it("from es 30 días antes (cruza de julio a agosto)", () => {
      const r = quickRange(today, "30d");
      expect(r.to).toBe("2026-08-29");
      expect(r.from).toBe("2026-07-30");
    });
  });

  describe("preset '90d' (últimos 90 días)", () => {
    it("from es 90 días antes (cruza mayo/junio)", () => {
      const r = quickRange(today, "90d");
      expect(r.to).toBe("2026-08-29");
      expect(r.from).toBe("2026-05-31");
    });
  });

  describe("preset 'month' (mes actual)", () => {
    it("from es el día 1 del mes actual, to es hoy", () => {
      const r = quickRange(today, "month");
      expect(r.from).toBe("2026-08-01");
      expect(r.to).toBe("2026-08-29");
    });

    it("con primer día del mes, from === to", () => {
      const r = quickRange([2026, 9, 1], "month");
      expect(r.from).toBe("2026-09-01");
      expect(r.to).toBe("2026-09-01");
    });
  });

  describe("preset 'year' (año actual)", () => {
    it("from es 1-ene del año actual, to es hoy", () => {
      const r = quickRange(today, "year");
      expect(r.from).toBe("2026-01-01");
      expect(r.to).toBe("2026-08-29");
    });

    it("con primer día del año, from === to", () => {
      const r = quickRange([2026, 1, 1], "year");
      expect(r.from).toBe("2026-01-01");
      expect(r.to).toBe("2026-01-01");
    });
  });

  describe("edge cases de mes corto / cambio de año", () => {
    it("'7d' antes del 1 del mes: cruza al mes anterior", () => {
      const r = quickRange([2026, 9, 3], "7d");
      expect(r.from).toBe("2026-08-27");
    });

    it("'30d' antes del 1 de enero: cruza al año anterior", () => {
      const r = quickRange([2026, 1, 15], "30d");
      expect(r.from).toBe("2025-12-16");
    });

    it("'7d' a inicio de año funciona", () => {
      const r = quickRange([2026, 1, 5], "7d");
      expect(r.from).toBe("2025-12-29");
    });
  });
});

describe("defaultWindow — últimos 30 días", () => {
  it("equivale a quickRange(30d) — son la misma función", () => {
    const today: [number, number, number] = [2026, 8, 29];
    expect(defaultWindow(today)).toEqual(quickRange(today, "30d"));
  });
});
