/**
 * tests/lib/gis-import/parse-gpkg.test.ts — unit tests del parser GPKG.
 *
 * Mockeamos @ngageoint/geopackage (es nativo y abre SQLite, complicado
 * de testear sin un .gpkg real). Cubrimos la lógica de nuestro wrapper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ngageoint/geopackage", () => ({
  GeoPackageAPI: {
    open: vi.fn()
  }
}));

import { parseGpkg } from "@/lib/gis-import/parse-gpkg";
import * as gpkg from "@ngageoint/geopackage";

const openMock = (gpkg as unknown as { GeoPackageAPI: { open: ReturnType<typeof vi.fn> } })
  .GeoPackageAPI.open;

describe("parseGpkg", () => {
  beforeEach(() => {
    openMock.mockReset();
  });

  function mockGpkg(
    tables: { name: string; columns: { name: string }[]; rows: unknown[] }[]
  ) {
    openMock.mockResolvedValue({
      getFeatureTables: () => tables.map((t) => t.name),
      getFeatureDao: (tableName: string) => {
        const t = tables.find((x) => x.name === tableName);
        if (!t) throw new Error("table not found");
        return {
          getColumns: () => t.columns,
          iterate: (cb: (row: unknown) => void) => {
            for (const row of t.rows) cb(row);
          }
        };
      },
      close: () => {}
    });
  }

  it("happy path: 1 feature table con 2 Polygon rows", async () => {
    mockGpkg([
      {
        name: "parcels",
        columns: [
          { name: "fid" },
          { name: "geom" },
          { name: "name" }
        ],
        rows: [
          {
            fid: 1,
            name: "Lote GPKG 1",
            getGeometry: () => ({
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            })
          },
          {
            fid: 2,
            name: "Lote GPKG 2",
            getGeometry: () => ({
              type: "Polygon",
              coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
            })
          }
        ]
      }
    ]);
    const result = await parseGpkg(Buffer.from("fake-gpkg"), "test.gpkg");
    expect(result.format).toBe("gpkg");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].name).toBe("Lote GPKG 1");
    expect(result.features[1].name).toBe("Lote GPKG 2");
  });

  it("tira error si no hay feature tables", async () => {
    mockGpkg([]);
    await expect(parseGpkg(Buffer.from("fake"), "empty.gpkg")).rejects.toThrow(
      /no contiene feature tables/
    );
  });

  it("warning si hay varias tablas, importa solo la primera", async () => {
    mockGpkg([
      {
        name: "parcels",
        columns: [{ name: "geom" }, { name: "name" }],
        rows: [
          {
            name: "P1",
            getGeometry: () => ({
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            })
          }
        ]
      },
      {
        name: "roads",
        columns: [{ name: "geom" }],
        rows: []
      }
    ]);
    const result = await parseGpkg(Buffer.from("fake"), "multi.gpkg");
    expect(result.features).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("2 feature tables"))).toBe(true);
  });

  it("ignora rows sin geometría", async () => {
    mockGpkg([
      {
        name: "parcels",
        columns: [{ name: "geom" }, { name: "name" }],
        rows: [
          { name: "no-geom", getGeometry: () => null },
          {
            name: "has-geom",
            getGeometry: () => ({
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            })
          }
        ]
      }
    ]);
    const result = await parseGpkg(Buffer.from("fake"), "test.gpkg");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].name).toBe("has-geom");
    expect(result.warnings.some((w) => w.includes("sin geometría"))).toBe(true);
  });

  it("ignora rows con geometría no-polígono (Point)", async () => {
    mockGpkg([
      {
        name: "parcels",
        columns: [{ name: "geom" }, { name: "name" }],
        rows: [
          {
            name: "point",
            getGeometry: () => ({ type: "Point", coordinates: [0, 0] })
          }
        ]
      }
    ]);
    const result = await parseGpkg(Buffer.from("fake"), "test.gpkg");
    expect(result.features).toHaveLength(0);
  });

  it("propaga error si el GPKG no se puede abrir", async () => {
    openMock.mockRejectedValue(new Error("SQLite_NOTADB"));
    await expect(parseGpkg(Buffer.from("bad"), "bad.gpkg")).rejects.toThrow(
      /GeoPackage inválido/
    );
  });

  it("detecta columna 'name' y la usa como nombre", async () => {
    mockGpkg([
      {
        name: "parcels",
        columns: [{ name: "geom" }, { name: "name" }, { name: "OBJECTID" }],
        rows: [
          {
            OBJECTID: 99,
            name: "Mi Lote",
            getGeometry: () => ({
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            })
          }
        ]
      }
    ]);
    const result = await parseGpkg(Buffer.from("fake"), "test.gpkg");
    expect(result.features[0].name).toBe("Mi Lote");
  });
});
