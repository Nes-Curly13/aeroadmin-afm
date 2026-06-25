// Tests para scripts/upsert-lands-from-djiag.js
//
// Cubre:
//   - upsertLands llama a UPSERT_SQL con params por cada land
//   - Lands sin externalId se skipean (no query)
//   - Errores de DB no abortan el batch; se cuentan en stats.errors
//   - stats.inserted refleja rowCount del UPSERT

import { describe, expect, it, vi } from "vitest";

import { upsertLands } from "@/scripts/upsert-lands-from-djiag";
import { UPSERT_SQL } from "@/lib/djiag-lands-to-parcels";

function makeMockClient(opts: {
  failOnExternalId?: Set<string>;
  rowCount?: number;
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rc = opts.rowCount ?? 1;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql === UPSERT_SQL && opts.failOnExternalId) {
        // paramsToPgArray: $1=batchId, $2=externalId, $3=landName, ...
        if (opts.failOnExternalId.has(params[1] as string)) {
          throw new Error(`mock failure for ${params[1]}`);
        }
      }
      return { rowCount: rc };
    })
  };
  return { client: client as unknown as import("pg").PoolClient, calls };
}

const sampleLands = [
  {
    uuid: "uuid-1",
    externalId: "ext-100",
    name: "Finca La Esperanza",
    address: "Valle del Cauca",
    landType: "Farmland",
    sourceType: "api",
    totalAreaMu: 15,
    workAreaMu: 12.5,
    totalObstacleAreaMu: 0.5,
    precisionM: 1.5,
    precisionType: "RTK",
    maxGeometryParameterOffset: 0.1,
    position: { lng: -76.302, lat: 3.668 },
    bbox: {
      upperRight: { lat: 3.670, lng: -76.300 },
      downLeft: { lat: 3.666, lng: -76.304 },
    },
    geometry: null,
    tags: ["caña", "vereda-capri"],
  },
  {
    uuid: "uuid-2",
    externalId: "ext-200",
    name: "Lote B",
    address: null,
    landType: "Orchards",
    sourceType: "api",
    totalAreaMu: 8,
    workAreaMu: null,
    totalObstacleAreaMu: null,
    precisionM: null,
    precisionType: null,
    maxGeometryParameterOffset: null,
    position: null,
    bbox: null,
    geometry: null,
    tags: [],
  },
];

describe("upsert-lands-from-djiag — upsertLands", () => {
  it("upserts todos los lands con UPSERT_SQL y params correctos", async () => {
    const { client, calls } = makeMockClient();
    const stats = await upsertLands(client, 42, sampleLands);

    expect(stats.inserted).toBe(2);
    expect(stats.errors).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toBe(UPSERT_SQL);
    // $1 = batch_id
    expect(calls[0].params[0]).toBe(42);
    // $2 = external_id
    expect(calls[0].params[1]).toBe("ext-100");
    expect(calls[1].params[1]).toBe("ext-200");
  });

  it("skipea lands sin externalId (no query)", async () => {
    const { client, calls } = makeMockClient();
    const noExt = [{ ...sampleLands[0], externalId: null }];
    const stats = await upsertLands(client, 1, noExt as never);

    expect(stats.inserted).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("continúa tras errores de DB y los cuenta en errors", async () => {
    const failOnExternalId = new Set(["ext-100"]);
    const { client, calls } = makeMockClient({ failOnExternalId });
    const stats = await upsertLands(client, 1, sampleLands);

    expect(stats.inserted).toBe(1); // ext-200 pasó
    expect(stats.errors).toBe(1);   // ext-100 falló
    expect(calls).toHaveLength(2);
  });

  it("rowCount = 0 → inserted = 0 (no se cuenta como upsert)", async () => {
    const { client } = makeMockClient({ rowCount: 0 });
    const stats = await upsertLands(client, 1, [sampleLands[0]]);
    // La implementación actual cuenta como "touched" cualquier rowCount > 0
    expect(stats.inserted).toBe(0);
  });

  it("preserva el orden de lands", async () => {
    const { client, calls } = makeMockClient();
    await upsertLands(client, 1, sampleLands);
    expect(calls.map((c) => c.params[1])).toEqual(["ext-100", "ext-200"]);
  });
});