// tests/djiag-from-make/task-history.test.ts
//
// Tests para el wrapper del blueprint Make.com /records.
// Validan:
//   - formatDuration produce el formato DJI "1Hour44min53s"
//   - muFromM2 convierte m² → mu
//   - dayToCard mapea NormalizedFumigationDay → DayCard
//   - computeTotals suma correctamente
//   - v1.7 Track C: aggregateNormalizedDaysWithFlights agrupa por día
//     Y devuelve los flights individuales por día (no solo el rollup).

import { describe, expect, it } from "vitest";

import {
  aggregateNormalizedDaysWithFlights,
  buildTaskHistorySnapshot,
  computeTotals,
  dayToCard,
  formatDuration,
  muFromM2,
  type FlightLikeRow
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

// ============================================================
// v1.7 Track C — aggregateNormalizedDaysWithFlights
// ============================================================

/**
 * Helper para construir filas de dji_flights de prueba. Usa fechas
 * UTC arbitrarias; el agregador las convierte a local Bogota (UTC-5).
 */
function makeFlight(overrides: Partial<FlightLikeRow> = {}): FlightLikeRow {
  return {
    id: 1,
    flight_id: 1,
    // 2026-07-08 14:00 UTC = 2026-07-08 09:00 Bogota local
    start_at: new Date("2026-07-08T14:00:00Z"),
    duration_seconds: 1800, // 30 min
    area_m2: 8000, // ~12 mu
    spray_usage_ml: 100000, // 100L
    drone_serial: "1581F5BKD23100045",
    pilot_name: "Breiner",
    parcel_id: 42,
    ...overrides
  };
}

describe("aggregateNormalizedDaysWithFlights — v1.7 Track C", () => {
  it("devuelve [] para rows vacíos", () => {
    expect(aggregateNormalizedDaysWithFlights([])).toEqual([]);
  });

  it("1 vuelo → 1 día con 1 flight en la lista", () => {
    const result = aggregateNormalizedDaysWithFlights([makeFlight({ id: 1 })]);
    expect(result).toHaveLength(1);
    expect(result[0].flights).toHaveLength(1);
    expect(result[0].flights[0].id).toBe(1);
    // Día en local Bogota del 2026-07-08 14:00 UTC → 2026-07-08 09:00 local
    expect(result[0].flights[0].localDate).toBe("2026-07-08");
    expect(result[0].flights[0].localTime).toBe("09:00");
  });

  it("2 vuelos del mismo día → 1 día con 2 flights", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({ id: 1, start_at: new Date("2026-07-08T14:00:00Z") }),
      makeFlight({ id: 2, start_at: new Date("2026-07-08T18:00:00Z") })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].flights).toHaveLength(2);
  });

  it("vuelos en 2 días distintos → 2 entradas en el array", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({ id: 1, start_at: new Date("2026-07-08T14:00:00Z") }),
      makeFlight({ id: 2, start_at: new Date("2026-07-09T14:00:00Z") })
    ]);
    expect(result).toHaveLength(2);
    // Orden DESC por fecha
    expect(result[0].day.date).toBe("2026-07-09");
    expect(result[1].day.date).toBe("2026-07-08");
    expect(result[0].flights).toHaveLength(1);
    expect(result[1].flights).toHaveLength(1);
  });

  it("flights dentro del mismo día vienen ordenados por start_at ASC", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({ id: 1, start_at: new Date("2026-07-08T18:00:00Z") }),
      makeFlight({ id: 2, start_at: new Date("2026-07-08T14:00:00Z") }),
      makeFlight({ id: 3, start_at: new Date("2026-07-08T16:00:00Z") })
    ]);
    expect(result[0].flights.map((f) => f.id)).toEqual([2, 3, 1]);
  });

  it("FlightListItem incluye drone_serial, pilot_name y parcel_id", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({
        drone_serial: "DRONE-X",
        pilot_name: "Carlos",
        parcel_id: 99
      })
    ]);
    const flight = result[0].flights[0];
    expect(flight.droneSerial).toBe("DRONE-X");
    expect(flight.pilotName).toBe("Carlos");
    expect(flight.parcelId).toBe(99);
  });

  it("FlightListItem maneja nulls (drone, pilot, parcel) sin romper", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({
        drone_serial: null,
        pilot_name: null,
        parcel_id: null
      })
    ]);
    const flight = result[0].flights[0];
    expect(flight.droneSerial).toBeNull();
    expect(flight.pilotName).toBeNull();
    expect(flight.parcelId).toBeNull();
  });

  it("FlightListItem convierte area_m2 → areaMu y spray_usage_ml → liters", () => {
    const result = aggregateNormalizedDaysWithFlights([
      makeFlight({ area_m2: 6666.7, spray_usage_ml: 5000 })
    ]);
    const flight = result[0].flights[0];
    // 6666.7 / 666.67 ≈ 10 mu
    expect(flight.areaMu).toBeCloseTo(10, 1);
    // 5000 / 1000 = 5 L
    expect(flight.liters).toBe(5);
  });

  it("el rollup `day` tiene el mismo shape que aggregateNormalizedDays", () => {
    const result = aggregateNormalizedDaysWithFlights([makeFlight()]);
    const day = result[0].day;
    expect(day).toMatchObject({
      date: "2026-07-08",
      sortieCount: 1,
      hasAgriculture: true
    });
    expect(typeof day.workAreaM2).toBe("number");
    expect(typeof day.workTimeSec).toBe("number");
    expect(typeof day.sprayUsageMl).toBe("number");
  });

  it("acepta filas con campos opcionales faltantes (back-compat con callers viejos)", () => {
    // Sin drone_serial / pilot_name / parcel_id (los originales)
    const result = aggregateNormalizedDaysWithFlights([
      {
        id: 1,
        flight_id: 1,
        start_at: new Date("2026-07-08T14:00:00Z"),
        duration_seconds: 100,
        area_m2: 1000,
        spray_usage_ml: 1000
      }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].flights[0].droneSerial).toBeNull();
    expect(result[0].flights[0].pilotName).toBeNull();
    expect(result[0].flights[0].parcelId).toBeNull();
  });
});
