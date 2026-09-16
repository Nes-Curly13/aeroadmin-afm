// tests/api-admin-parcels-geojson.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.fn().mockResolvedValue(undefined);
const getFeats = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a)
}));
vi.mock("@/api/repositories", () => ({
  getParcelGeometriesInBbox: (...a: unknown[]) => getFeats(...a)
}));

import { GET } from "@/app/api/admin/parcels/geojson/route";

const req = (qs: string) =>
  new Request(`http://localhost/api/admin/parcels/geojson${qs}`);

describe("/api/admin/parcels/geojson", () => {
  beforeEach(() => {
    requireRoleMock.mockReset().mockResolvedValue(undefined);
    getFeats.mockReset();
  });

  it("200 con FeatureCollection", async () => {
    getFeats.mockResolvedValueOnce([
      {
        id: 5,
        land_name: "Lote 24",
        client_name: "Agro XYZ",
        farm_name: null,
        geometry: { type: "Polygon", coordinates: [] }
      }
    ]);
    const res = await GET(req("?bbox=-76.4,3.4,-76.3,3.5"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      features: Array<{ id: number; properties: { land_name: string } }>;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features[0].properties.land_name).toBe("Lote 24");
  });

  it("pasa excludeId y limit", async () => {
    getFeats.mockResolvedValueOnce([]);
    await GET(req("?bbox=-76.4,3.4,-76.3,3.5&excludeId=9&limit=50"));
    expect(getFeats).toHaveBeenCalledWith(
      expect.objectContaining({
        minLng: -76.4,
        minLat: 3.4,
        maxLng: -76.3,
        maxLat: 3.5,
        excludeId: 9,
        limit: 50
      })
    );
  });

  it("400 sin bbox", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(getFeats).not.toHaveBeenCalled();
  });

  it("400 con bbox mal formado", async () => {
    const res = await GET(req("?bbox=1,2,3"));
    expect(res.status).toBe(400);
  });

  it("403 si el rol no alcanza", async () => {
    requireRoleMock.mockRejectedValueOnce(
      Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" })
    );
    const res = await GET(req("?bbox=-76.4,3.4,-76.3,3.5"));
    expect(res.status).toBe(403);
  });
});
