// tests/api-repositories-parcels-geojson.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/lib/db";
import { getParcelGeometriesInBbox } from "@/api/repositories";

const query = vi.fn();

describe("getParcelGeometriesInBbox", () => {
  beforeEach(() => {
    query.mockReset();
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ query });
  });

  it("filtra por bbox + excludeId y simplifica la geometría", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          land_name: "Lote 24",
          client_name: null,
          farm_name: null,
          geometry: { type: "Polygon", coordinates: [] }
        }
      ],
      rowCount: 1
    });
    const rows = await getParcelGeometriesInBbox({
      minLng: -76.4,
      minLat: 3.4,
      maxLng: -76.3,
      maxLat: 3.5,
      excludeId: 9,
      limit: 100
    });
    expect(rows).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ST_Intersects");
    expect(sql).toContain("ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(sql).toContain("ST_SimplifyPreserveTopology");
    expect(params).toEqual([-76.4, 3.4, -76.3, 3.5, 9, 100]);
  });

  it("acota el límite a 2000", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getParcelGeometriesInBbox({
      minLng: 0,
      minLat: 0,
      maxLng: 1,
      maxLat: 1,
      limit: 99_999
    });
    expect(query.mock.calls[0][1][5]).toBe(2000);
  });

  it("sin datos → []", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const rows = await getParcelGeometriesInBbox({
      minLng: 0,
      minLat: 0,
      maxLng: 1,
      maxLat: 1
    });
    expect(rows).toEqual([]);
  });
});
