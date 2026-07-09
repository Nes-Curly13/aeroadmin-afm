// tests/djiag-from-make/task-history.test.ts
//
// Tests para el wrapper del blueprint Make.com /records.
// Validan:
//   - formatDuration produce el formato DJI "1Hour44min53s"
//   - muFromM2 convierte m² → mu
//   - dayToCard mapea NormalizedFumigationDay → DayCard
//   - computeTotals suma correctamente

import { describe, expect, it } from "vitest";

import {
  buildTaskHistorySnapshot,
  computeTotals,
  dayToCard,
  formatDuration,
  muFromM2
} from "@/lib/djiag-from-make/task-history";
import type { NormalizedFumigationDay } from "@/lib/djiag-fumigations-fetcher";

describe("formatDuration", () => {
  it("formatea 0 segundos", () => {
    expect(formatDuration(0)).toEqual({
      hours: 0,
      minutes: 0,
      seconds: 0,
      djiFormat: "0Hour0min0s"
    });
  });

  it("formatea 6293 segundos (1h 44min 53s)", () => {
    const r = formatDuration(6293);
    expect(r.hours).toBe(1);
    expect(r.minutes).toBe(44);
    expect(r.seconds).toBe(53);
    expect(r.djiFormat).toBe("1Hour44min53s");
  });

  it("formatea 2272283 segundos (631h 11min 23s) — el del header UI", () => {
    // 631*3600 + 11*60 + 23 = 2271600 + 660 + 23 = 2272283
    const r = formatDuration(2272283);
    expect(r.hours).toBe(631);
    expect(r.minutes).toBe(11);
    expect(r.seconds).toBe(23);
    expect(r.djiFormat).toBe("631Hour11min23s");
  });

  it("negative input → 0", () => {
    const r = formatDuration(-100);
    expect(r.hours).toBe(0);
    expect(r.djiFormat).toBe("0Hour0min0s");
  });
});

describe("muFromM2", () => {
  it("1 mu = 666.67 m² → round-trip", () => {
    expect(muFromM2(666.67)).toBeCloseTo(1.0, 2);
  });

  it("12000 m² → 18 mu (rounded)", () => {
    // 12000 / 666.67 = 18.00018 → 18
    expect(muFromM2(12000)).toBe(18);
  });

  it("0 m² → 0 mu", () => {
    expect(muFromM2(0)).toBe(0);
  });
});

describe("dayToCard", () => {
  const sample: NormalizedFumigationDay = {
    createTimestamp: 1751980800,
    date: "2026-07-08",
    workAreaM2: 12193,
    workTimeSec: 6293,
    workTimeMin: 105,
    sortieCount: 22,
    sprayUsageMl: 365200,
    sprayUsageL: 365.2,
    doseLPerHa: 0.4,
    hasAgriculture: true
  };

  it("date formateado YYYY/MM/DD", () => {
    const card = dayToCard(sample);
    expect(card.date).toBe("2026/07/08");
  });

  it("weekday: Wednesday para 2026-07-08", () => {
    const card = dayToCard(sample);
    expect(card.weekday).toBe("Wednesday");
  });

  it("areaMu redondeado", () => {
    const card = dayToCard(sample);
    // 12193 / 666.67 ≈ 18.29
    expect(card.areaMu).toBeCloseTo(18.29, 1);
  });

  it("times = sortieCount", () => {
    const card = dayToCard(sample);
    expect(card.times).toBe(22);
  });

  it("liters = sprayUsageL", () => {
    const card = dayToCard(sample);
    expect(card.liters).toBe(365.2);
  });

  it("duration formateada DJI", () => {
    const card = dayToCard(sample);
    expect(card.duration.djiFormat).toBe("1Hour44min53s");
  });
});

describe("computeTotals", () => {
  it("suma totales correctamente", () => {
    const totals = computeTotals([
      {
        date: "2026/07/08",
        weekday: "Wednesday",
        areaMu: 18.29,
        times: 22,
        liters: 365.2,
        duration: formatDuration(6293)
      },
      {
        date: "2026/07/07",
        weekday: "Tuesday",
        areaMu: 20.91,
        times: 27,
        liters: 416.9,
        duration: formatDuration(6213)
      }
    ]);
    expect(totals.areaMu).toBeCloseTo(39.2, 1);
    expect(totals.times).toBe(49);
    expect(totals.liters).toBeCloseTo(782.1, 1);
  });
});

describe("buildTaskHistorySnapshot", () => {
  it("integra days + dateRange + totales", () => {
    const days: NormalizedFumigationDay[] = [
      {
        createTimestamp: 1751980800,
        date: "2026-07-08",
        workAreaM2: 12193,
        workTimeSec: 6293,
        workTimeMin: 105,
        sortieCount: 22,
        sprayUsageMl: 365200,
        sprayUsageL: 365.2,
        doseLPerHa: 0.4,
        hasAgriculture: true
      }
    ];
    const snap = buildTaskHistorySnapshot(days, {
      from: "2026-01-01",
      to: "2026-07-08"
    });
    expect(snap.dateRange.from).toBe("2026-01-01");
    expect(snap.dateRange.to).toBe("2026-07-08");
    expect(snap.days).toHaveLength(1);
    expect(snap.totals.times).toBe(22);
  });
});
