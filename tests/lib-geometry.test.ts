// tests/lib-geometry.test.ts
//
// Tests de los helpers de geometría usados para detectar solape entre
// parcelas (alta manual).

import { describe, expect, it } from "vitest";
import {
  bboxesOverlap,
  geojsonOuterRings,
  geometriesOverlap,
  pointInRing,
  ringBbox,
  ringsOverlap,
  segmentsIntersect
} from "@/lib/geometry";

const square = (x: number, y: number, s: number) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y]
] as [number, number][];

describe("lib/geometry", () => {
  it("geojsonOuterRings: Polygon", () => {
    const rings = geojsonOuterRings({
      type: "Polygon",
      coordinates: [square(0, 0, 10)]
    });
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });

  it("geojsonOuterRings: MultiPolygon", () => {
    const rings = geojsonOuterRings({
      type: "MultiPolygon",
      coordinates: [
        [square(0, 0, 1)],
        [square(5, 5, 1)]
      ]
    });
    expect(rings).toHaveLength(2);
  });

  it("geojsonOuterRings: geometry inválida → []", () => {
    expect(geojsonOuterRings(null)).toEqual([]);
    expect(geojsonOuterRings({ type: "Point", coordinates: [0, 0] })).toEqual([]);
  });

  it("ringBbox", () => {
    expect(ringBbox(square(2, 3, 4))).toEqual([2, 3, 6, 7]);
    expect(ringBbox([])).toBeNull();
  });

  it("bboxesOverlap", () => {
    expect(bboxesOverlap([0, 0, 10, 10], [5, 5, 15, 15])).toBe(true);
    expect(bboxesOverlap([0, 0, 1, 1], [5, 5, 6, 6])).toBe(false);
    // tocándose en el borde
    expect(bboxesOverlap([0, 0, 5, 5], [5, 0, 10, 5])).toBe(true);
  });

  it("pointInRing", () => {
    const ring = square(0, 0, 10);
    expect(pointInRing([5, 5], ring)).toBe(true);
    expect(pointInRing([15, 5], ring)).toBe(false);
    expect(pointInRing([5, -1], ring)).toBe(false);
  });

  it("segmentsIntersect", () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [1, 1], [5, 5], [6, 6])).toBe(false);
  });

  it("ringsOverlap: disjuntos → false", () => {
    expect(ringsOverlap(square(0, 0, 10), square(50, 50, 10))).toBe(false);
  });

  it("ringsOverlap: contención total → true", () => {
    expect(ringsOverlap(square(0, 0, 10), square(2, 2, 3))).toBe(true);
    expect(ringsOverlap(square(2, 2, 3), square(0, 0, 10))).toBe(true);
  });

  it("ringsOverlap: solape parcial → true", () => {
    expect(ringsOverlap(square(0, 0, 10), square(5, 5, 10))).toBe(true);
  });

  it("ringsOverlap: borde que cruza (sin vértices dentro) → true", () => {
    // Barra horizontal que atraviesa el cuadrado: los vértices de cada
    // uno están FUERA del otro; solo se cruzan los bordes.
    const bar = [
      [-5, 4],
      [15, 4],
      [15, 6],
      [-5, 6],
      [-5, 4]
    ] as [number, number][];
    expect(ringsOverlap(bar, square(0, 0, 10))).toBe(true);
  });

  it("geometriesOverlap: Polygon vs MultiPolygon", () => {
    const polygon = { type: "Polygon", coordinates: [square(0, 0, 10)] };
    const multi = {
      type: "MultiPolygon",
      coordinates: [[square(0, 0, 1)], [square(4, 4, 4)]]
    };
    const far = {
      type: "MultiPolygon",
      coordinates: [[square(100, 100, 5)]]
    };
    expect(geometriesOverlap(polygon, multi)).toBe(true);
    expect(geometriesOverlap(polygon, far)).toBe(false);
  });

  it("geometriesOverlap: geometría inválida → false", () => {
    expect(geometriesOverlap(null, { type: "Polygon", coordinates: [] })).toBe(
      false
    );
  });
});
