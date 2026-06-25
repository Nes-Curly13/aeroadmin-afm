// Tests para scripts/upsert-flights-from-djiag.js
//
// Cubre:
//   - upsertFlights llama a UPSERT_SQL con los params correctos para cada flight
//   - Flights sin flightId o sin start/end timestamp se skipean (no query)
//   - Errores de DB no abortan el batch entero; se cuentan en stats.errors
//   - Stats.upserted y stats.errors suman correctamente

import { describe, expect, it, vi } from "vitest";

import { upsertFlights } from "@/scripts/upsert-flights-from-djiag";
import { UPSERT_SQL } from "@/lib/djiag-flights-fetcher";

// Mock client con query() que retorna ok o falla según una lista configurable.
// Captura todas las llamadas para aserciones.
function makeMockClient(opts: {
  failOnFlightId?: Set<number>;
  failOnAnyQuery?: Error;
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (opts.failOnAnyQuery) throw opts.failOnAnyQuery;
      if (opts.failOnFlightId && sql === UPSERT_SQL) {
        const fid = params[0] as number;
        if (opts.failOnFlightId.has(fid)) {
          throw new Error(`mock failure for flight ${fid}`);
        }
      }
      return { rowCount: 1 };
    })
  };
  return { client: client as unknown as import("pg").PoolClient, calls };
}

const sampleFlights = [
  {
    flightId: 638640703,
    droneSerial: "R1272065674",
    droneNickname: "AFM T40 1",
    pilotName: "breiner pelaez",
    flyerName: "Afm Drone",
    district: "El Cerrito",
    location: "Capri. Selva La, Valle del Cauca, Colombia",
    startAt: new Date("2026-06-22T13:30:00Z"),
    endAt: new Date("2026-06-22T13:36:21Z"),
    durationSeconds: 381,
    areaM2: 6233.33,
    sprayVolumeMl: 12669,
    lng: -76.30263127,
    lat: 3.66871315,
    modeName: 4,
    workSpeedMS: 5.0,
    sprayWidthM: 5.08,
    radarHeightM: 2.9,
    createDate: 20260622,
    source: "dji_ag",
  },
  {
    flightId: 638640704,
    droneSerial: "R1272065675",
    droneNickname: "AFM T50-1",
    pilotName: null,
    flyerName: "Afm Drone",
    district: null,
    location: null,
    startAt: new Date("2026-06-22T14:00:00Z"),
    endAt: new Date("2026-06-22T14:05:00Z"),
    durationSeconds: 300,
    areaM2: 5000,
    sprayVolumeMl: 10000,
    lng: -76.30,
    lat: 3.67,
    modeName: 4,
    workSpeedMS: 5.0,
    sprayWidthM: 5.0,
    radarHeightM: 2.5,
    createDate: 20260622,
    source: "dji_ag",
  },
];

describe("upsert-flights-from-djiag — upsertFlights", () => {
  it("upserts todos los flights con UPSERT_SQL y params correctos", async () => {
    const { client, calls } = makeMockClient();
    const stats = await upsertFlights(client, sampleFlights);

    expect(stats.upserted).toBe(2);
    expect(stats.errors).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toBe(UPSERT_SQL);
    // Primer param = flight_id
    expect(calls[0].params[0]).toBe(638640703);
    expect(calls[1].params[0]).toBe(638640704);
  });

  it("incluye todos los campos parseados como params del UPSERT", async () => {
    const { client, calls } = makeMockClient();
    await upsertFlights(client, sampleFlights);

    // paramsToPgArray del fetcher define 24 placeholders ($1..$24) — sanity check.
    // Si DJI agrega una columna al UPSERT y no actualizamos el test, este assert rompe.
    expect(calls[0].params).toHaveLength(24);
    // Pilot name en posición $5 (flight_id, parcel_id, drone_serial, drone_nickname, pilot_name)
    expect(calls[0].params[4]).toBe("breiner pelaez");
    // area_m2 ($12) debe venir como number, no string (post-patchPgTypes)
    expect(typeof calls[0].params[11]).toBe("number");
  });

  it("skipea flights sin flightId (no query, cuenta en errors)", async () => {
    const { client, calls } = makeMockClient();
    const bad = [{ ...sampleFlights[0], flightId: undefined }];
    const stats = await upsertFlights(client, bad as never);

    expect(stats.upserted).toBe(0);
    expect(stats.errors).toBe(1);
    expect(calls).toHaveLength(0); // ningún query emitido
  });

  it("skipea flights sin startAt o endAt", async () => {
    const { client, calls } = makeMockClient();
    const noStart = [{ ...sampleFlights[0], startAt: null }];
    const noEnd = [{ ...sampleFlights[0], endAt: null }];
    const s1 = await upsertFlights(client, noStart as never);
    const s2 = await upsertFlights(client, noEnd as never);

    expect(s1.errors).toBe(1);
    expect(s2.errors).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("continúa tras errores de DB y los cuenta en stats.errors", async () => {
    const failOnFlightId = new Set([638640703]);
    const { client, calls } = makeMockClient({ failOnFlightId });
    const stats = await upsertFlights(client, sampleFlights);

    expect(stats.upserted).toBe(1); // el segundo pasó
    expect(stats.errors).toBe(1);   // el primero falló
    expect(calls).toHaveLength(2);  // ambos intentaron query
  });

  it("ignora flights vacíos (no queries)", async () => {
    const { client, calls } = makeMockClient();
    const stats = await upsertFlights(client, []);
    expect(stats.upserted).toBe(0);
    expect(stats.errors).toBe(0);
    expect(calls).toHaveLength(0);
  });
});