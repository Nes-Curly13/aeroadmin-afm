// tests/djiag-spatial-aggregator.test.ts
//
// Tests para lib/djiag-spatial-aggregator.ts.
//
// Cubre:
//   - onlyFumigated: true  → INNER JOIN, solo parcelas fumigadas en el rango
//   - onlyFumigated: false → TODAS las parcelas con spray_geom (incluso sin vuelo)
//   - filtros parcelId / droneSerial / pilot
//   - formato de fechas YYYY-MM-DD
//   - parseo de geometry (string vs object)

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del pool de Postgres. Aislamos al agregador del pool real para no
// requerir PostGIS corriendo en CI (la suite de vitest puro no garantiza
// la BD arriba; la suite e2e sí).
const dbMock = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  getDb: () => dbMock
}));

import { getPolygonsInRange, type PolygonInfo } from "@/lib/djiag-spatial-aggregator";

interface PolygonRow {
  parcel_id: number;
  land_name: string | null;
  declared_area_ha: number | null;
  geometry: GeoJSON.Geometry | string | null;
  dates_fumigated: string[] | null;
}

function rowFactory(over: Partial<PolygonRow>): PolygonRow {
  return {
    parcel_id: 1,
    land_name: "Test Parcel",
    declared_area_ha: 12.5,
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    dates_fumigated: ["2026-07-08"],
    ...over
  };
}

describe("getPolygonsInRange", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  describe("onlyFumigated: true", () => {
    it("hace INNER JOIN con dji_flights filtrado por rango", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          rowFactory({
            parcel_id: 1,
            land_name: "Parcela A",
            declared_area_ha: 10.5,
            dates_fumigated: ["2026-07-08", "2026-07-09"]
          })
        ]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        parcelId: 1,
        landName: "Parcela A",
        areaHa: 10.5,
        datesFumigated: ["2026-07-08", "2026-07-09"],
        geometry: expect.objectContaining({ type: "Polygon" })
      });

      // Verificar que el SQL incluye INNER JOIN
      const sql = dbMock.query.mock.calls[0][0] as string;
      expect(sql).toContain("INNER JOIN dji_flights f");
      expect(sql).toContain("f.start_at >= $1::date");
      expect(sql).toContain("f.start_at <  ($2::date + INTERVAL '1 day')");
      // Filtros drone/pilot no deben aparecer en el WHERE
      expect(sql).not.toContain("drone_serial = $");
      expect(sql).not.toContain("pilot_name = $");
    });

    it("pasa filtros de droneSerial y pilot al WHERE", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true,
        droneSerial: "R12XYZ",
        pilot: "breiner"
      });

      const sql = dbMock.query.mock.calls[0][0] as string;
      const params = dbMock.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain("f.drone_serial = $3");
      expect(sql).toContain("f.pilot_name = $4");
      expect(params).toEqual(["2026-07-01", "2026-07-31", "R12XYZ", "breiner"]);
    });

    it("pasa filtro parcelId al WHERE", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true,
        parcelId: 42
      });

      const sql = dbMock.query.mock.calls[0][0] as string;
      const params = dbMock.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain("p.id = $3");
      expect(params).toEqual(["2026-07-01", "2026-07-31", 42]);
    });

    it("devuelve [] cuando no hay fumigaciones en el rango", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const result = await getPolygonsInRange({
        from: "2030-01-01",
        to: "2030-12-31",
        onlyFumigated: true
      });

      expect(result).toEqual([]);
    });
  });

  describe("onlyFumigated: false", () => {
    it("trae TODAS las parcelas con spray_geom, incluso sin fumigación", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          rowFactory({ parcel_id: 1, land_name: "Fumigada", dates_fumigated: ["2026-07-08"] }),
          rowFactory({ parcel_id: 2, land_name: "Sin fumigar", dates_fumigated: [] })
        ]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: false
      });

      expect(result).toHaveLength(2);
      const byId = Object.fromEntries(result.map((p) => [p.parcelId, p]));
      expect(byId[1].datesFumigated).toEqual(["2026-07-08"]);
      expect(byId[2].datesFumigated).toEqual([]);

      // Verificar que NO hay INNER JOIN — usa subquery correlacionada
      const sql = dbMock.query.mock.calls[0][0] as string;
      expect(sql).not.toContain("INNER JOIN dji_flights f");
      // El modo "todas" usa un subquery o LEFT JOIN, no INNER
      // (normalizamos whitespace para que el match sea robusto)
      const sqlNormalized = sql.replace(/\s+/g, " ");
      expect(sqlNormalized).toMatch(/FROM dji_flights f WHERE f\.parcel_id = p\.id/);
    });

    it("aplica droneSerial/pilot al subquery de fechas fumigadas", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: false,
        droneSerial: "R1",
        pilot: "juan"
      });

      const sql = dbMock.query.mock.calls[0][0] as string;
      const params = dbMock.query.mock.calls[0][1] as unknown[];
      // El subquery lateral incluye los filtros
      expect(sql).toMatch(/f\.drone_serial = \$3/);
      expect(sql).toMatch(/f\.pilot_name = \$4/);
      expect(params).toEqual(["2026-07-01", "2026-07-31", "R1", "juan"]);
    });

    it("aplica parcelId al WHERE de dji_parcels (no al subquery)", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: false,
        parcelId: 7
      });

      const sql = dbMock.query.mock.calls[0][0] as string;
      expect(sql).toMatch(/p\.id = \$3/);
    });
  });

  describe("parseo de geometry", () => {
    it("acepta geometry como object (driver pg con parser JSON)", async () => {
      const geom = { type: "MultiPolygon" as const, coordinates: [[[[0, 0]]]] };
      dbMock.query.mockResolvedValueOnce({
        rows: [rowFactory({ geometry: geom })]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].geometry).toEqual(geom);
    });

    it("parsea geometry cuando llega como string (driver sin parser JSON)", async () => {
      const geomStr = JSON.stringify({
        type: "Polygon",
        coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]
      });
      dbMock.query.mockResolvedValueOnce({
        rows: [rowFactory({ geometry: geomStr })]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].geometry).toEqual({
        type: "Polygon",
        coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]
      });
    });

    it("devuelve null si spray_geom es NULL", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [rowFactory({ geometry: null })]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].geometry).toBeNull();
    });
  });

  describe("conversión de tipos", () => {
    it("areaHa es number (no string) — pg type parser NUMERIC→number", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [rowFactory({ declared_area_ha: 7.7523 })]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].areaHa).toBe(7.7523);
      expect(typeof result[0].areaHa).toBe("number");
    });

    it("areaHa es null cuando declared_area_ha es null", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [rowFactory({ declared_area_ha: null })]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].areaHa).toBeNull();
    });

    it("datesFumigated preserva orden ASC (PostgreSQL ORDER BY en array_agg)", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          rowFactory({
            dates_fumigated: ["2026-07-01", "2026-07-05", "2026-07-12", "2026-07-20"]
          })
        ]
      });

      const result = await getPolygonsInRange({
        from: "2026-07-01",
        to: "2026-07-31",
        onlyFumigated: true
      });
      expect(result[0].datesFumigated).toEqual([
        "2026-07-01",
        "2026-07-05",
        "2026-07-12",
        "2026-07-20"
      ]);
    });
  });
});
