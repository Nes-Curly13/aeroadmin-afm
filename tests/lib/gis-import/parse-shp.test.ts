/**
 * tests/lib/gis-import/parse-shp.test.ts — unit tests del parser SHP.
 *
 * Mockeamos shpjs porque construir un .shp.zip real es complejo
 * (header binario de 100 bytes + records). Lo que probamos es la
 * lógica de nuestro wrapper: cómo se filtra/normaliza lo que devuelve
 * shpjs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("shpjs", () => ({
  parseZip: vi.fn()
}));

import { parseShpZip } from "@/lib/gis-import/parse-shp";
import * as shpjs from "shpjs";

const parseZipMock = shpjs.parseZip as unknown as ReturnType<typeof vi.fn>;

describe("parseShpZip", () => {
  beforeEach(() => {
    parseZipMock.mockReset();
  });

  it("happy path: 2 Polygon features en un FC", async () => {
    parseZipMock.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
          },
          properties: { LOTE: "Lote 1" }
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
          },
          properties: { LOTE: "Lote 2" }
        }
      ]
    });
    const result = await parseShpZip(Buffer.from("fake-zip"), "lotes.zip");
    expect(result.format).toBe("shp");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].name).toBe("Lote 1");
    expect(result.features[1].name).toBe("Lote 2");
  });

  it("maneja array de FCs (zip con varios shapefiles)", async () => {
    parseZipMock.mockResolvedValue([
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            },
            properties: { LOTE: "A" }
          }
        ]
      },
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
            },
            properties: { LOTE: "B" }
          }
        ]
      }
    ]);
    const result = await parseShpZip(Buffer.from("fake-zip"), "lotes.zip");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].name).toBe("A");
    expect(result.features[1].name).toBe("B");
  });

  it("ignora features no-polígono", async () => {
    parseZipMock.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { name: "skip me" }
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
          },
          properties: { LOTE: "keep me" }
        }
      ]
    });
    const result = await parseShpZip(Buffer.from("fake-zip"), "lotes.zip");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].name).toBe("keep me");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("tira error si shpjs falla al parsear", async () => {
    parseZipMock.mockRejectedValue(new Error("Invalid zip signature"));
    await expect(parseShpZip(Buffer.from("bad"), "bad.zip")).rejects.toThrow(
      /Shapefile zip inválido/
    );
  });

  it("maneja GeometryCollection consolidando a MultiPolygon", async () => {
    parseZipMock.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
              { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] }
            ]
          },
          properties: { name: "multi" }
        }
      ]
    });
    const result = await parseShpZip(Buffer.from("fake-zip"), "lotes.zip");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("MultiPolygon");
  });
});
