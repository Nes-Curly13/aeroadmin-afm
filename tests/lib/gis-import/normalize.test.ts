/**
 * tests/lib/gis-import/normalize.test.ts — tests del helper de normalización.
 *
 * Cubre:
 *   - extractFeatureName: prioriza nombres humanos sobre IDs
 *   - normalizeGeometry: Polygon / MultiPolygon / GeometryCollection
 *   - edge cases: null, empty, ring < 4 puntos
 */

import { describe, it, expect } from "vitest";
import {
  extractFeatureName,
  normalizeGeometry,
  approxAreaM2
} from "@/lib/gis-import/normalize";

describe("extractFeatureName", () => {
  it("devuelve null si properties es null/undefined", () => {
    expect(extractFeatureName(null)).toBeNull();
    expect(extractFeatureName(undefined)).toBeNull();
  });

  it("agarra 'name' en minúscula primero", () => {
    expect(extractFeatureName({ name: "Lote 1", NOMBRE: "Otro" })).toBe("Lote 1");
  });

  it("agarra 'nombre' en español si no hay name", () => {
    expect(extractFeatureName({ nombre: "Lote 1" })).toBe("Lote 1");
  });

  it("ignora strings vacíos y usa el siguiente", () => {
    expect(extractFeatureName({ name: "", NOMBRE: "Lote 2" })).toBe("Lote 2");
  });

  it("convierte numbers a string (OBJECTID)", () => {
    expect(extractFeatureName({ OBJECTID: 42 })).toBe("42");
  });

  it("devuelve null si ninguna key matchea", () => {
    expect(extractFeatureName({ foo: "bar", baz: 1 })).toBeNull();
  });
});

describe("normalizeGeometry", () => {
  it("devuelve null para null/undefined", () => {
    expect(normalizeGeometry(null)).toBeNull();
    expect(normalizeGeometry(undefined)).toBeNull();
  });

  it("acepta Polygon válido", () => {
    const geom = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
    };
    expect(normalizeGeometry(geom)).toEqual(geom);
  });

  it("rechaza Polygon con ring < 4 puntos", () => {
    const geom = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1]]] // 3 puntos, sin cierre
    };
    expect(normalizeGeometry(geom)).toBeNull();
  });

  it("rechaza Point/LineString", () => {
    expect(
      normalizeGeometry({ type: "Point", coordinates: [0, 0] })
    ).toBeNull();
    expect(
      normalizeGeometry({
        type: "LineString",
        coordinates: [[0, 0], [1, 1]]
      })
    ).toBeNull();
  });

  it("consolida GeometryCollection de Polygons en MultiPolygon", () => {
    const gc = {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
        { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] }
      ]
    };
    const norm = normalizeGeometry(gc);
    expect(norm).not.toBeNull();
    expect(norm!.type).toBe("MultiPolygon");
    expect(norm!.coordinates).toHaveLength(2);
  });

  it("devuelve Polygon si GeometryCollection tiene 1 solo Polygon", () => {
    const gc = {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
      ]
    };
    const norm = normalizeGeometry(gc);
    expect(norm!.type).toBe("Polygon");
  });

  it("rechaza GeometryCollection con geometrías no-polígono", () => {
    const gc = {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
        { type: "Point", coordinates: [2, 2] }
      ]
    };
    expect(normalizeGeometry(gc)).toBeNull();
  });

  it("acepta MultiPolygon", () => {
    const mp = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
      ]
    };
    const norm = normalizeGeometry(mp);
    expect(norm!.type).toBe("MultiPolygon");
    expect(norm!.coordinates).toHaveLength(2);
  });

  it("aplana coords 3D (KML) a 2D — la BD rechaza Z dimension", () => {
    const geom3d = {
      type: "Polygon",
      coordinates: [
        [
          [-76.31, 3.45, 0],
          [-76.30, 3.45, 100],
          [-76.30, 3.46, 50],
          [-76.31, 3.46, 0],
          [-76.31, 3.45, 0]
        ]
      ]
    };
    const norm = normalizeGeometry(geom3d);
    expect(norm).not.toBeNull();
    expect(norm!.type).toBe("Polygon");
    // Cada punto debe quedar como [lng, lat] (2D)
    for (const pt of norm!.coordinates[0] as number[][]) {
      expect(pt).toHaveLength(2);
    }
  });

  it("rechaza puntos con valores no-numéricos", () => {
    // Si TODOS los puntos son inválidos, el ring queda vacío → null
    const geom = {
      type: "Polygon",
      coordinates: [
        [
          [NaN, NaN],
          [NaN, NaN],
          [NaN, NaN]
        ]
      ]
    };
    expect(normalizeGeometry(geom)).toBeNull();
  });

  it("filtra puntos inválidos pero conserva los válidos", () => {
    // Ring de 6 puntos, 1 con NaN → queda 5 puntos = válido (4 + cierre)
    const geom = {
      type: "Polygon",
      coordinates: [
        [
          [NaN, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
          [-0.1, -0.1]
        ]
      ]
    };
    const norm = normalizeGeometry(geom);
    expect(norm).not.toBeNull();
    expect(norm!.type).toBe("Polygon");
    // 5 puntos después de filtrar el NaN
    expect((norm!.coordinates[0] as number[][]).length).toBe(5);
  });

  it("ignora rings con todos los puntos inválidos", () => {
    const geom = {
      type: "Polygon",
      coordinates: [
        [
          [NaN, NaN],
          [NaN, NaN],
          [NaN, NaN]
        ]
      ]
    };
    expect(normalizeGeometry(geom)).toBeNull();
  });
});

describe("approxAreaM2", () => {
  it("devuelve > 0 para un cuadrado chico (~1 ha cerca del ecuador)", () => {
    // 0.001° lng × 0.001° lat ≈ 111m × 111m ≈ 12321 m² ≈ 1.23 ha
    const geom = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]
    };
    const area = approxAreaM2(geom);
    expect(area).toBeGreaterThan(10_000);
    expect(area).toBeLessThan(15_000);
  });

  it("suma áreas de MultiPolygon", () => {
    const mp = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
        [[[0.01, 0], [0.011, 0], [0.011, 0.001], [0.01, 0.001], [0.01, 0]]]
      ]
    };
    const area = approxAreaM2(mp);
    // 2x ~12321 m² ≈ 24642 m²
    expect(area).toBeGreaterThan(20_000);
    expect(area).toBeLessThan(30_000);
  });
});
