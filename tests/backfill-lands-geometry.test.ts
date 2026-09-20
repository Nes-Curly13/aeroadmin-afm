// Tests para scripts/backfill-lands-geometry.js — extraccion pura del
// PlantZone (geometria de fumigacion) desde el geometry.json de DJI.

import { describe, expect, it } from "vitest";
import { extractSprayGeojson } from "@/scripts/backfill-lands-geometry";

const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-76.35271, 3.60573, 0],
      [-76.3528, 3.60465, 0],
      [-76.35197, 3.60463, 0],
      [-76.35271, 3.60573, 0],
    ],
  ],
};

const OTHER_POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-76.4, 3.1, 0],
      [-76.41, 3.11, 0],
      [-76.4, 3.1, 0],
    ],
  ],
};

describe("extractSprayGeojson", () => {
  it("toma el PlantZone de una FeatureCollection", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "MultiPoint", coordinates: [] }, properties: { funcType: "ReferencePoint" } },
        { type: "Feature", geometry: POLYGON, properties: { funcType: "PlantZone" } },
      ],
    };
    expect(extractSprayGeojson(fc)).toEqual(POLYGON);
  });

  it("usa el primer Polygon si no hay PlantZone (fallback)", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "MultiPoint", coordinates: [] }, properties: {} },
        { type: "Feature", geometry: OTHER_POLYGON, properties: { funcType: "ObstacleZone" } },
      ],
    };
    expect(extractSprayGeojson(fc)).toEqual(OTHER_POLYGON);
  });

  it("devuelve null si no hay ninguna Polygon", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "MultiPoint", coordinates: [] }, properties: { funcType: "ReferencePoint" } },
      ],
    };
    expect(extractSprayGeojson(fc)).toBeNull();
  });

  it("acepta una geometry cruda Polygon", () => {
    expect(extractSprayGeojson(POLYGON)).toEqual(POLYGON);
  });

  it("acepta un Feature que envuelve la geometria", () => {
    expect(extractSprayGeojson({ type: "Feature", geometry: POLYGON, properties: {} })).toEqual(POLYGON);
  });

  it("preserva MultiPolygon", () => {
    const mp = { type: "MultiPolygon", coordinates: [POLYGON.coordinates] };
    expect(extractSprayGeojson({ type: "FeatureCollection", features: [{ geometry: mp, properties: { funcType: "PlantZone" } }] })).toEqual(mp);
  });

  it("devuelve null para entradas invalidas", () => {
    expect(extractSprayGeojson(null)).toBeNull();
    expect(extractSprayGeojson(undefined)).toBeNull();
    expect(extractSprayGeojson({ type: "Point", coordinates: [0, 0] })).toBeNull();
    expect(extractSprayGeojson({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("ignora PlantZone sin geometry", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { funcType: "PlantZone" } },
        { type: "Feature", geometry: OTHER_POLYGON, properties: {} },
      ],
    };
    expect(extractSprayGeojson(fc)).toEqual(OTHER_POLYGON);
  });
});
