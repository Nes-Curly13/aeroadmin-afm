import { describe, expect, it } from "vitest";

import {
  MU_PER_HA_M2,
  aggregateFlightsByDay,
  formatDurationDjI,
  m2ToMu,
  mlToLiters,
  toLocalDateString,
  toLocalWeekdayName,
  type FlightRow
} from "../lib/dji-flights-aggregate";

/**
 * Tests del agregador de dji_flights → DjiDailySummaryRecord (Sprint 2).
 * Helpers puros — sin BD ni browser.
 *
 * Datos de referencia: scrape del 2026-06-10 (UTC-5), Valle del Cauca.
 * 7050 vuelos reales, 30 días, 4 drones (AFM T50-1, AFM T40 1, etc.).
 */

function makeFlight(over: Partial<FlightRow>): FlightRow {
  return {
    id: 1,
    flight_id: 638640703,
    start_at: new Date("2026-06-10T13:30:00Z"),
    duration_seconds: 600,
    area_m2: 5000,
    spray_usage_ml: 2000,
    ...over
  };
}

describe("m2ToMu", () => {
  it("10000 m² = 15 mu (1 ha)", () => {
    expect(m2ToMu(10_000)).toBeCloseTo(15, 5);
  });

  it("666.67 m² ≈ 1 mu", () => {
    expect(m2ToMu(MU_PER_HA_M2)).toBeCloseTo(1, 5);
  });

  it("0 m² → 0 mu", () => {
    expect(m2ToMu(0)).toBe(0);
  });

  it("negativo o NaN → 0", () => {
    expect(m2ToMu(-100)).toBe(0);
    expect(m2ToMu(NaN)).toBe(0);
  });
});

describe("mlToLiters", () => {
  it("1000 mL = 1 L", () => {
    expect(mlToLiters(1000)).toBe(1);
  });

  it("0 mL → 0 L", () => {
    expect(mlToLiters(0)).toBe(0);
  });

  it("negativo o NaN → 0", () => {
    expect(mlToLiters(-100)).toBe(0);
    expect(mlToLiters(NaN)).toBe(0);
  });
});

describe("formatDurationDjI", () => {
  it("0 segundos → '0s'", () => {
    expect(formatDurationDjI(0)).toBe("0s");
  });

  it("solo segundos", () => {
    expect(formatDurationDjI(28)).toBe("28s");
  });

  it("solo minutos (sin segundos)", () => {
    expect(formatDurationDjI(60)).toBe("1min");
    expect(formatDurationDjI(120)).toBe("2min");
  });

  it("minutos + segundos", () => {
    expect(formatDurationDjI(88)).toBe("1min28s");
  });

  it("solo horas (sin min ni s)", () => {
    expect(formatDurationDjI(3600)).toBe("1Hour");
  });

  it("horas + minutos", () => {
    expect(formatDurationDjI(3600 + 60)).toBe("1Hour1min");
  });

  it("completo (H+M+S)", () => {
    expect(formatDurationDjI(5 * 3600 + 24 * 60 + 40)).toBe("5Hour24min40s");
  });

  it("negativo o NaN → '0s'", () => {
    expect(formatDurationDjI(-100)).toBe("0s");
    expect(formatDurationDjI(NaN)).toBe("0s");
  });
});

describe("toLocalDateString", () => {
  it("formato YYYY-MM-DD en America/Bogota", () => {
    // 2026-06-10 23:30 UTC = 2026-06-10 18:30 Bogotá (UTC-5)
    const date = new Date("2026-06-10T23:30:00Z");
    expect(toLocalDateString(date)).toBe("2026-06-10");
  });

  it("cruza medianoche hacia atrás en UTC", () => {
    // 2026-06-11 02:00 UTC = 2026-06-10 21:00 Bogotá
    const date = new Date("2026-06-11T02:00:00Z");
    expect(toLocalDateString(date)).toBe("2026-06-10");
  });

  it("cruza medianoche hacia adelante en UTC", () => {
    // 2026-06-10 04:00 UTC = 2026-06-09 23:00 Bogotá
    const date = new Date("2026-06-10T04:00:00Z");
    expect(toLocalDateString(date)).toBe("2026-06-09");
  });
});

describe("toLocalWeekdayName", () => {
  it("devuelve el nombre en en-US", () => {
    // 2026-06-10 es Wednesday
    expect(toLocalWeekdayName(new Date("2026-06-10T13:30:00Z"))).toBe("Wednesday");
  });

  it("respeta zona horaria para el cálculo del día", () => {
    // 2026-06-11 02:00 UTC = 2026-06-10 en Bogotá (Wednesday)
    expect(toLocalWeekdayName(new Date("2026-06-11T02:00:00Z"))).toBe("Wednesday");
  });
});

describe("aggregateFlightsByDay", () => {
  it("agrupa 2 vuelos del mismo día en una sola entrada", () => {
    const rows = [
      makeFlight({ id: 1, flight_id: 100, start_at: "2026-06-10T13:00:00Z", duration_seconds: 600, area_m2: 3000, spray_usage_ml: 1500 }),
      makeFlight({ id: 2, flight_id: 101, start_at: "2026-06-10T18:00:00Z", duration_seconds: 1200, area_m2: 5000, spray_usage_ml: 2500 })
    ];
    const result = aggregateFlightsByDay(rows);
    expect(result).toHaveLength(1);
    expect(result[0].record_date).toBe("2026-06-10");
    expect(result[0].times_count).toBe(2);
    expect(result[0].area_mu).toBeCloseTo(m2ToMu(8000), 2);
    expect(result[0].usage_liters).toBe(4);
    expect(result[0].work_time_text).toBe("30min"); // 600+1200=1800s = 30min
    expect(result[0].category).toBe("Agriculture");
    expect(result[0].weekday).toBe("Wednesday");
  });

  it("separa vuelos que caen en distintos días locales", () => {
    const rows = [
      makeFlight({ id: 1, flight_id: 100, start_at: "2026-06-10T13:00:00Z" }), // 2026-06-10 Bogotá
      makeFlight({ id: 2, flight_id: 101, start_at: "2026-06-11T05:00:00Z" })  // 2026-06-11 00:00 Bogotá
    ];
    const result = aggregateFlightsByDay(rows);
    expect(result).toHaveLength(2);
    expect(result[0].record_date).toBe("2026-06-11"); // DESC
    expect(result[1].record_date).toBe("2026-06-10");
  });

  it("orden DESC por fecha", () => {
    const rows = [
      makeFlight({ id: 1, flight_id: 100, start_at: "2026-06-05T13:00:00Z" }),
      makeFlight({ id: 2, flight_id: 101, start_at: "2026-06-15T13:00:00Z" }),
      makeFlight({ id: 3, flight_id: 102, start_at: "2026-06-10T13:00:00Z" })
    ];
    const result = aggregateFlightsByDay(rows);
    expect(result.map((r) => r.record_date)).toEqual(["2026-06-15", "2026-06-10", "2026-06-05"]);
  });

  it("id regenerado por día (1, 2, 3...)", () => {
    const rows = [
      makeFlight({ id: 99, flight_id: 100, start_at: "2026-06-10T13:00:00Z" }),
      makeFlight({ id: 100, flight_id: 101, start_at: "2026-06-11T13:00:00Z" })
    ];
    const result = aggregateFlightsByDay(rows);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  it("raw_text en formato legacy DJI", () => {
    const rows = [
      makeFlight({ id: 1, flight_id: 100, start_at: "2026-06-10T13:00:00Z", area_m2: 5000, spray_usage_ml: 2000, duration_seconds: 600 })
    ];
    const result = aggregateFlightsByDay(rows);
    // 5000 m² = 7.5 mu → 7.50; 2000 mL = 2.0 L; 600s = 10min
    expect(result[0].raw_text).toBe("2026/06/10WednesdayAgriculture7.50mu1times2.0L-10min");
  });

  it("array vacío → array vacío", () => {
    expect(aggregateFlightsByDay([])).toEqual([]);
  });

  it("work_time_text suma correctamente horas+minutos+segundos", () => {
    const rows = [
      makeFlight({ id: 1, flight_id: 100, start_at: "2026-06-10T13:00:00Z", duration_seconds: 3600 + 60 + 30 }),
      makeFlight({ id: 2, flight_id: 101, start_at: "2026-06-10T18:00:00Z", duration_seconds: 7200 })
    ];
    const result = aggregateFlightsByDay(rows);
    // 3690 + 7200 = 10890s = 3h 1min 30s
    expect(result[0].work_time_text).toBe("3Hour1min30s");
  });
});