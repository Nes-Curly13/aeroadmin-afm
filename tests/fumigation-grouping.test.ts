// Tests para lib/fumigation-grouping.js — agrupacion pura de vuelos en
// fumigaciones (parcela + dia + sesion) + huerfanas.
//
// TZ fija America/Bogota (UTC-5): un vuelo a las 12:00Z es 07:00 Bogota
// del mismo dia; a las 02:00Z es 21:00 Bogota del dia ANTERIOR.

import { describe, expect, it } from "vitest";
import {
  BOGOTA_TZ,
  DEFAULT_SESSION_GAP_MS,
  groupFumigationFlights,
  modeOf,
  sessionKeyFor,
  toBogotaDate,
} from "@/lib/fumigation-grouping";

const S = 1000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// 2026-09-09 12:00:00Z => 2026-09-09 07:00 Bogota
const BASE = Date.UTC(2026, 8, 9, 12, 0, 0);

function flight(overrides: Record<string, unknown>) {
  return {
    flightId: 1,
    parcelId: 100,
    startAtMs: BASE,
    endAtMs: BASE + 10 * MIN,
    durationSeconds: 600,
    areaM2: 1000,
    sprayUsageMl: 5000,
    droneNickname: "AFM T50-1",
    pilotName: "breiner",
    ...overrides,
  };
}

describe("fumigation-grouping — toBogotaDate", () => {
  it("usa America/Bogota (UTC-5) para el limite de dia", () => {
    expect(BOGOTA_TZ).toBe("America/Bogota");
    // 12:00Z => mismo dia 07:00 Bogota
    expect(toBogotaDate(Date.UTC(2026, 8, 9, 12, 0, 0))).toBe("2026-09-09");
    // 02:00Z del 10 => 21:00 Bogota del 9
    expect(toBogotaDate(Date.UTC(2026, 8, 10, 2, 0, 0))).toBe("2026-09-09");
    // 05:00Z del 10 => 00:00 Bogota del 10
    expect(toBogotaDate(Date.UTC(2026, 8, 10, 5, 0, 0))).toBe("2026-09-10");
  });
});

describe("fumigation-grouping — modeOf", () => {
  it("devuelve el valor mas frecuente", () => {
    expect(modeOf(["a", "b", "a", "a"])).toBe("a");
  });

  it("ignora null/undefined/vacio y trimea", () => {
    expect(modeOf([null, undefined, "", "  ", "T50"])).toBe("T50");
  });

  it("empate: gana el lexicograficamente menor (determinista)", () => {
    expect(modeOf(["zeta", "alfa"])).toBe("alfa");
    expect(modeOf(["b", "a", "b", "a"])).toBe("a");
  });

  it("array vacio o todo nulo => null", () => {
    expect(modeOf([])).toBeNull();
    expect(modeOf([null, undefined])).toBeNull();
  });
});

describe("fumigation-grouping — sessionKeyFor", () => {
  it("incluye parcela, fecha y start epoch", () => {
    expect(sessionKeyFor({ parcelId: 42, date: "2026-09-09", startAtMs: 123 })).toBe(
      "42|2026-09-09|123"
    );
  });

  it("huerfana usa el literal 'orphan'", () => {
    expect(sessionKeyFor({ parcelId: null, date: "2026-09-09", startAtMs: 5 })).toBe(
      "orphan|2026-09-09|5"
    );
  });
});

describe("fumigation-grouping — groupFumigationFlights", () => {
  it("agrupa vuelos de la misma parcela y dia dentro del gap de 1h", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, startAtMs: BASE, endAtMs: BASE + 10 * MIN }),
      flight({ flightId: 2, startAtMs: BASE + 20 * MIN, endAtMs: BASE + 30 * MIN }),
      flight({ flightId: 3, startAtMs: BASE + 40 * MIN, endAtMs: BASE + 50 * MIN }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.flightsCount).toBe(3);
    expect(g.flightIds).toEqual([1, 2, 3]);
    expect(g.orphan).toBe(false);
    expect(g.date).toBe("2026-09-09");
  });

  it("separa en dos sesiones si el idle gap supera 1h (manana/tarde)", () => {
    const groups = groupFumigationFlights([
      // manana: 12:00Z y 12:20Z
      flight({ flightId: 1, startAtMs: BASE, endAtMs: BASE + 10 * MIN }),
      flight({ flightId: 2, startAtMs: BASE + 20 * MIN, endAtMs: BASE + 30 * MIN }),
      // tarde: 3 horas despues del fin del anterior
      flight({ flightId: 3, startAtMs: BASE + 3 * HOUR, endAtMs: BASE + 3 * HOUR + 10 * MIN }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].flightIds).toEqual([1, 2]);
    expect(groups[1].flightIds).toEqual([3]);
    expect(groups[0].sessionKey).not.toBe(groups[1].sessionKey);
  });

  it("gap exactamente en el umbral NO separa (>, estricto)", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, startAtMs: BASE, endAtMs: BASE + 10 * MIN }),
      flight({ flightId: 2, startAtMs: BASE + 10 * MIN + DEFAULT_SESSION_GAP_MS, endAtMs: BASE + 20 * MIN + DEFAULT_SESSION_GAP_MS }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("respeta gapMs custom", () => {
    const groups = groupFumigationFlights(
      [
        flight({ flightId: 1, startAtMs: BASE, endAtMs: BASE + 10 * MIN }),
        flight({ flightId: 2, startAtMs: BASE + 30 * MIN, endAtMs: BASE + 40 * MIN }),
      ],
      { gapMs: 10 * MIN }
    );
    expect(groups).toHaveLength(2);
  });

  it("separa parcelas distintas aunque sean consecutivas", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, parcelId: 100 }),
      flight({ flightId: 2, parcelId: 200, startAtMs: BASE + MIN }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.parcelId).sort()).toEqual([100, 200]);
  });

  it("marca huerfanas (parcelId null) y no mezcla con parcelas", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, parcelId: null }),
      flight({ flightId: 2, parcelId: null, startAtMs: BASE + MIN }),
      flight({ flightId: 3, parcelId: 7, startAtMs: BASE + 2 * MIN }),
    ]);
    const orphan = groups.find((g) => g.orphan);
    const parcel = groups.find((g) => !g.orphan);
    expect(orphan).toBeDefined();
    expect(orphan!.parcelId).toBeNull();
    expect(orphan!.flightsCount).toBe(2);
    expect(orphan!.sessionKey.startsWith("orphan|")).toBe(true);
    expect(parcel!.parcelId).toBe(7);
    expect(parcel!.flightsCount).toBe(1);
  });

  it("separa huerfanas por salto espacial > maxDistanceM", () => {
    // ~0.02 grados de latitud ~ 2.2 km
    const groups = groupFumigationFlights([
      flight({ flightId: 1, parcelId: null, lng: -76.30, lat: 3.50 }),
      flight({ flightId: 2, parcelId: null, startAtMs: BASE + MIN, lng: -76.30, lat: 3.52 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("no separa huerfanas dentro de maxDistanceM", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, parcelId: null, lng: -76.30, lat: 3.5 }),
      // ~0.001 grados ~ 111 m
      flight({ flightId: 2, parcelId: null, startAtMs: BASE + MIN, lng: -76.301, lat: 3.5 }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("NO separa por distancia los vuelos CON parcela", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, parcelId: 100, lng: -76.30, lat: 3.5 }),
      flight({ flightId: 2, parcelId: 100, startAtMs: BASE + MIN, lng: -76.30, lat: 3.52 }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("calcula el centroide de los vuelos con coords", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, lng: -76.30, lat: 3.50 }),
      flight({ flightId: 2, startAtMs: BASE + MIN, lng: -76.32, lat: 3.52 }),
    ]);
    expect(groups[0].centroidLng).toBeCloseTo(-76.31, 6);
    expect(groups[0].centroidLat).toBeCloseTo(3.51, 6);
  });

  it("suma area/volumen/tiempo y calcula moda de dron y piloto", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, areaM2: 1000, sprayUsageMl: 4000, durationSeconds: 600, droneNickname: "AFM T50-1", pilotName: "breiner" }),
      flight({ flightId: 2, startAtMs: BASE + 5 * MIN, areaM2: 2000.4, sprayUsageMl: 6000, durationSeconds: 900, droneNickname: "AFM T50-1", pilotName: "juan" }),
      flight({ flightId: 3, startAtMs: BASE + 10 * MIN, areaM2: 500.6, sprayUsageMl: 1000, durationSeconds: 300, droneNickname: "AFM T40-1", pilotName: "breiner" }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.areaM2).toBe(3501); // Math.round(3501.0)
    expect(g.sprayUsageMl).toBe(11000);
    expect(g.durationSeconds).toBe(1800);
    expect(g.droneNickname).toBe("AFM T50-1");
    expect(g.pilotName).toBe("breiner");
  });

  it("endAtMs: cae a start + duracion si falta endAtMs", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, startAtMs: BASE, endAtMs: null, durationSeconds: 120 }),
    ]);
    expect(groups[0].endAtMs).toBe(BASE + 120 * S);
  });

  it("ignora candidatos sin startAtMs valido", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1 }),
      { flightId: 2, parcelId: 100, startAtMs: null },
      { flightId: 3, parcelId: 100, startAtMs: Number.NaN },
      undefined,
    ] as any[]);
    expect(groups).toHaveLength(1);
    expect(groups[0].flightIds).toEqual([1]);
  });

  it("vuelos de dias distintos no se agrupan", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 1, startAtMs: BASE }),
      flight({ flightId: 2, startAtMs: BASE + 24 * HOUR }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("ordena por fecha y start", () => {
    const groups = groupFumigationFlights([
      flight({ flightId: 3, parcelId: 100, startAtMs: BASE + 6 * HOUR }),
      flight({ flightId: 1, parcelId: 100, startAtMs: BASE }),
      flight({ flightId: 2, parcelId: 100, startAtMs: BASE + 3 * HOUR }),
    ]);
    expect(groups.map((g) => g.startAtMs)).toEqual([
      BASE,
      BASE + 3 * HOUR,
      BASE + 6 * HOUR,
    ]);
  });

  it("no muta el input", () => {
    const input = [flight({ flightId: 1 })];
    const snapshot = JSON.stringify(input);
    groupFumigationFlights(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
