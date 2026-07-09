// tests/djiag-from-make/field-management.test.ts
//
// Tests para el wrapper del blueprint Make.com /mission.
// Validan:
//   - formatDjiDate produce YYYY/MM/DD
//   - landToFieldCard mapea cada campo del UI a una FieldCard
//   - los campos que el UI muestra (name, areaHa, type, date) están
//     correctamente poblados desde el NormalizedLand de DJI

import { describe, expect, it } from "vitest";

import {
  landToFieldCard,
  type FieldCard,
  type FetchFieldManagementOptions
} from "@/lib/djiag-from-make/field-management";
import type { NormalizedLand } from "@/lib/djiag-graphql-types";

const baseLand: NormalizedLand = {
  uuid: "uuid-abc",
  externalId: "123-flyer-x",
  name: "Gertrudis STE 116C",
  address: "Amaime, Palmira, Sur, Valle del Cauca, Colombia",
  landType: "Farmland",
  sourceType: "Agras",
  totalAreaMu: 7.75 * 15, // 7.75 ha = 116.25 mu
  workAreaMu: 7.5 * 15,
  obstacleAreaMu: 0.25 * 15,
  precision: 0.5,
  precisionType: "RTK",
  maxGeometryParameterOffset: null,
  position: { lng: -76.31, lat: 3.54 },
  bbox: null,
  geometryUrl: null,
  geometryStorageUuid: null,
  geometryContentMd5: null,
  waypointUrl: null,
  parameterUrl: null,
  serialNumber: "1581F5BKD23100045",
  tags: [],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-03T00:00:00Z"
};

describe("field-management wrapper", () => {
  it("formatDjiDate via landToFieldCard: produce YYYY/MM/DD desde updatedAt", () => {
    const card = landToFieldCard(baseLand);
    expect(card.date).toBe("2026/07/03");
  });

  it("landToFieldCard: name + areaHa (mu → ha) + type", () => {
    const card: FieldCard = landToFieldCard(baseLand);
    expect(card.name).toBe("Gertrudis STE 116C");
    // muToHa(116.25) → 116.25 / 15 = 7.75
    expect(card.areaHa).toBeCloseTo(7.75, 2);
    expect(card.type).toBe("Farmland");
  });

  it("landToFieldCard: locationLabel desde address (DjiGap #2)", () => {
    const card = landToFieldCard(baseLand);
    expect(card.locationLabel).toBe(
      "Amaime, Palmira, Sur, Valle del Cauca, Colombia"
    );
  });

  it("landToFieldCard: type = Orchards cuando landType = 'Orchards'", () => {
    const card = landToFieldCard({ ...baseLand, landType: "Orchards" });
    expect(card.type).toBe("Orchards");
  });

  it("landToFieldCard: externalId + uuid propagados", () => {
    const card = landToFieldCard(baseLand);
    expect(card.externalId).toBe("123-flyer-x");
    expect(card.uuid).toBe("uuid-abc");
  });

  it("landToFieldCard: fallback a createdAt si updatedAt es null", () => {
    const card = landToFieldCard({ ...baseLand, updatedAt: null });
    expect(card.date).toBe("2026/07/01");
  });

  it("landToFieldCard: areaHa = null si totalAreaMu es null", () => {
    const card = landToFieldCard({ ...baseLand, totalAreaMu: null });
    expect(card.areaHa).toBeNull();
  });

  it("landToFieldCard: locationLabel = null si address es null", () => {
    const card = landToFieldCard({ ...baseLand, address: null });
    expect(card.locationLabel).toBeNull();
  });
});

describe("FetchFieldManagementOptions", () => {
  it("existe la interface y es asignable", () => {
    const opts: FetchFieldManagementOptions = {
      baseUrl: "https://www.djiag.com",
      first: 200,
      after: "0"
    };
    expect(opts.first).toBe(200);
  });
});
