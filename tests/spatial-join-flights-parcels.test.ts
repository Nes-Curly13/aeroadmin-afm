// Tests para scripts/spatial-join-flights-parcels.js
//
// Cubre:
//   - spatialJoinFlights ejecuta el SQL de UPDATE con el tolerance correcto
//   - Devuelve matched (del UPDATE rowCount) y unmatched (del COUNT posterior)
//   - Usa ST_Within OR ST_DWithin con la tolerancia como $1
//
// El SQL real toca dji_flights y dji_parcels con PostGIS — no se testea
// contra una DB real acá. Lo que verificamos es la forma del query que se
// emite y los stats que devuelve.

import { describe, expect, it, vi } from "vitest";

import { spatialJoinFlights } from "@/scripts/spatial-join-flights-parcels";

function makeMockClient(opts: {
  updateRowCount?: number;
  unmatchedCount?: number;
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const updateRowCount = opts.updateRowCount ?? 0;
  const unmatchedCount = opts.unmatchedCount ?? 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      // El UPDATE devuelve rowCount
      if (sql.includes("UPDATE dji_flights")) {
        return { rowCount: updateRowCount, rows: [] };
      }
      // El COUNT posterior
      if (sql.includes("COUNT(*)::int")) {
        return { rowCount: 1, rows: [{ c: unmatchedCount }] };
      }
      return { rowCount: 0, rows: [] };
    })
  };
  return { client: client as unknown as import("pg").PoolClient, calls };
}

describe("spatial-join-flights-parcels — spatialJoinFlights", () => {
  it("ejecuta UPDATE con tolerance como $1 (param)", async () => {
    const { client, calls } = makeMockClient();
    await spatialJoinFlights(client, 500);

    const updateCall = calls.find((c) => c.sql.includes("UPDATE dji_flights"));
    expect(updateCall).toBeDefined();
    expect(updateCall!.params).toEqual([500]);
  });

  it("devuelve matched = rowCount del UPDATE", async () => {
    const { client } = makeMockClient({ updateRowCount: 1681 });
    const stats = await spatialJoinFlights(client, 500);
    expect(stats.matched).toBe(1681);
  });

  it("devuelve unmatched del COUNT posterior", async () => {
    const { client } = makeMockClient({ unmatchedCount: 5369 });
    const stats = await spatialJoinFlights(client, 500);
    expect(stats.unmatched).toBe(5369);
  });

  it("incluye el filtro parcel_id IS NULL en el UPDATE", async () => {
    const { client, calls } = makeMockClient();
    await spatialJoinFlights(client, 500);

    const updateSql = calls.find((c) => c.sql.includes("UPDATE dji_flights"))!.sql;
    expect(updateSql).toMatch(/parcel_id IS NULL/);
  });

  it("incluye filtro lng/lat NOT NULL en el UPDATE (no asignar sin coords)", async () => {
    const { client, calls } = makeMockClient();
    await spatialJoinFlights(client, 500);

    const updateSql = calls.find((c) => c.sql.includes("UPDATE dji_flights"))!.sql;
    expect(updateSql).toMatch(/lng IS NOT NULL/);
    expect(updateSql).toMatch(/lat IS NOT NULL/);
  });

  it("usa ST_Within como match primario + ST_DWithin como fallback", async () => {
    const { client, calls } = makeMockClient();
    await spatialJoinFlights(client, 500);

    const updateSql = calls.find((c) => c.sql.includes("UPDATE dji_flights"))!.sql;
    expect(updateSql).toMatch(/ST_Within/);
    expect(updateSql).toMatch(/ST_DWithin/);
  });

  it("tolerancia 0 → solo ST_Within matchea (no fallback distance)", async () => {
    const { client, calls } = makeMockClient();
    await spatialJoinFlights(client, 0);

    const updateCall = calls.find((c) => c.sql.includes("UPDATE dji_flights"))!;
    expect(updateCall.params).toEqual([0]);
    // ST_DWithin con 0 es siempre false → efectivamente solo ST_Within
    expect(updateCall.sql).toMatch(/ST_DWithin/);
  });
});