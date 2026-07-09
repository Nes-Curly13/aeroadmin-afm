// Tests para lib/djiag-lands-to-parcels.js — converter NormalizedLand → SQL params.
//
// Cubrimos:
//   - landToParcelParams: shape, null safety, derivación de is_orchard
//   - positionToWkt: WKT válido, null, fuera de rango
//   - bboxToWkt: WKT rectangular CCW, null, partial
//   - UPSERT_SQL: tiene los placeholders esperados, incluye ON CONFLICT
//   - paramsToPgArray: orden exacto de los 19 valores
//   - Integración: NormalizedLand real (del fetcher) → params correctos

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  landToParcelParams,
  positionToWkt,
  bboxToWkt,
  paramsToPgArray,
  UPSERT_SQL,
  MU_PER_HA,
  HA_PER_MU
} from "@/lib/djiag-lands-to-parcels";
import { parseLandsResponse } from "@/lib/djiag-lands-fetcher";
import type { NormalizedLand } from "@/lib/djiag-graphql-types";

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8"));
}

describe("djiag-lands-to-parcels — positionToWkt", () => {
  it("POINT con lng primero (OGC), espacio-separado", () => {
    // Nota: JS Number.toString() dropea ceros trailing (3.624620 → "3.62462"),
    // eso es esperado — PostGIS parsea ambos correctamente.
    expect(positionToWkt({ lng: -76.328195, lat: 3.624620 })).toBe("POINT(-76.328195 3.62462)");
    expect(positionToWkt({ lng: 0, lat: 0 })).toBe("POINT(0 0)");
  });

  it("null si lng o lat son null", () => {
    expect(positionToWkt({ lng: null, lat: 3.6 })).toBeNull();
    expect(positionToWkt({ lng: -76.3, lat: null })).toBeNull();
    expect(positionToWkt({ lng: null, lat: null })).toBeNull();
  });

  it("null si la posición no es objeto", () => {
    expect(positionToWkt(null)).toBeNull();
    expect(positionToWkt(undefined)).toBeNull();
  });

  it("null si las coords están fuera de rango", () => {
    expect(positionToWkt({ lng: -200, lat: 0 })).toBeNull();
    expect(positionToWkt({ lng: 0, lat: 91 })).toBeNull();
    expect(positionToWkt({ lng: 200, lat: -91 })).toBeNull();
  });
});

describe("djiag-lands-to-parcels — bboxToWkt", () => {
  it("POLYGON rectangular CCW (downLeft → upRight → upLeft → close)", () => {
    // SW corner: (-76.5, 3.5), NE corner: (-76.0, 4.0)
    const wkt = bboxToWkt({
      upperRight: { lat: 4.0, lng: -76.0 },
      downLeft: { lat: 3.5, lng: -76.5 }
    });
    // CCW: dl → ur-lng/dl-lat → ur → ur-lng/ur-lat → dl-lng/ur-lat → close
    expect(wkt).toBe("POLYGON((-76.5 3.5, -76 3.5, -76 4, -76.5 4, -76.5 3.5))");
  });

  it("null si upperRight o downLeft faltan", () => {
    expect(bboxToWkt({ upperRight: { lat: 1, lng: 1 } })).toBeNull();
    expect(bboxToWkt({ downLeft: { lat: 1, lng: 1 } } as unknown as NormalizedLand["bbox"])).toBeNull();
  });

  it("null si algún componente es null", () => {
    expect(bboxToWkt({
      upperRight: { lat: null, lng: -76.0 },
      downLeft: { lat: 3.5, lng: -76.5 }
    })).toBeNull();
  });

  it("null si la bbox no es objeto", () => {
    expect(bboxToWkt(null)).toBeNull();
  });

  it("null si coords fuera de rango", () => {
    expect(bboxToWkt({
      upperRight: { lat: 4.0, lng: -200 },
      downLeft: { lat: 3.5, lng: -76.5 }
    })).toBeNull();
  });
});

describe("djiag-lands-to-parcels — landToParcelParams", () => {
  it("deriva isOrchard=true de landType='Orchards'", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: "Orchards",
      position: null, bbox: null, tags: [], precision: null, precisionType: null,
      serialNumber: null, totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.isOrchard).toBe(true);
    expect(p.fieldType).toBe("Orchards");
    expect(p.landTypeRaw).toBe("Orchards");
  });

  it("deriva isOrchard=false de landType='Farmland' (default)", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: "Farmland",
      position: null, bbox: null, tags: [], precision: null, precisionType: null,
      serialNumber: null, totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.isOrchard).toBe(false);
    expect(p.fieldType).toBe("Farmland");
  });

  it("landType null → isOrchard=false, fieldType='Farmland' (default seguro)", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: null,
      position: null, bbox: null, tags: [], precision: null, precisionType: null,
      serialNumber: null, totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.isOrchard).toBe(false);
    expect(p.fieldType).toBe("Farmland");
  });

  it("tags vacío → null (no '{}'::text[])", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: "Farmland",
      position: null, bbox: null, tags: [], precision: null, precisionType: null,
      serialNumber: null, totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.tags).toBeNull();
  });

  it("tags con elementos → array preservado", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: "Farmland",
      position: null, bbox: null, tags: ["caña", "q1-2026"], precision: null, precisionType: null,
      serialNumber: null, totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.tags).toEqual(["caña", "q1-2026"]);
  });

  it("strings en blanco → null (no '')", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "  ", name: "", landType: "  ",
      position: null, bbox: null, tags: [], precision: null, precisionType: "  ",
      serialNumber: "", totalAreaMu: null, workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: "", waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.djiLandUuid).toBeNull();
    expect(p.landName).toBeNull();
    expect(p.precisionType).toBeNull();
    expect(p.serialNumber).toBeNull();
    expect(p.sourceUrlGeometry).toBeNull();
  });

  it("numeric NaN/Infinity → null", () => {
    const p = landToParcelParams({
      externalId: "x", uuid: "u", name: "n", landType: "Farmland",
      position: null, bbox: null, tags: [], precision: "NaN", precisionType: null,
      serialNumber: null, totalAreaMu: "abc", workAreaMu: null, obstacleAreaMu: null,
      geometryUrl: null, waypointUrl: null, parameterUrl: null
    } as unknown as NormalizedLand);
    expect(p.precisionM).toBeNull();
    expect(p.totalAreaMu).toBeNull();
  });
});

describe("djiag-lands-to-parcels — UPSERT_SQL", () => {
  it("tiene 20 placeholders ($1..$20) — incluye location_label (Figma audit 2026-07-09)", () => {
    const matches = UPSERT_SQL.match(/\$\d+/g) ?? [];
    expect(matches.length).toBe(20);
    for (let i = 1; i <= 20; i++) {
      expect(matches).toContain(`$${i}`);
    }
  });

  it("usa ON CONFLICT (batch_id, external_id)", () => {
    expect(UPSERT_SQL).toMatch(/ON CONFLICT \(batch_id, external_id\)/);
  });

  it("el DO UPDATE solo toca columnas API, no las de parameter.json", () => {
    // Estas columnas las maneja el importer legacy, no se deben pisar
    expect(UPSERT_SQL).not.toMatch(/spray_geom\s*=\s*EXCLUDED/);
    expect(UPSERT_SQL).not.toMatch(/drone_model_code\s*=\s*EXCLUDED/);
    expect(UPSERT_SQL).not.toMatch(/spray_width_m\s*=\s*EXCLUDED/);
    expect(UPSERT_SQL).not.toMatch(/is_orchard\s*=\s*EXCLUDED/);
  });

  it("usa COALESCE en source_url_* para preservar valores del scraper", () => {
    expect(UPSERT_SQL).toMatch(/source_url_geometry\s*=\s*COALESCE\(dji_parcels\.source_url_geometry/);
    expect(UPSERT_SQL).toMatch(/source_url_parameter\s*=\s*COALESCE\(dji_parcels\.source_url_parameter/);
    expect(UPSERT_SQL).toMatch(/source_url_waypoint\s*=\s*COALESCE\(dji_parcels\.source_url_waypoint/);
  });

  it("actualiza api_fetched_at a NOW()", () => {
    expect(UPSERT_SQL).toMatch(/api_fetched_at\s*=\s*NOW\(\)/);
  });
});

describe("djiag-lands-to-parcels — paramsToPgArray", () => {
  it("orden exacto de 20 valores: batchId primero, sourceUrlWaypoint último", () => {
    const fakeLand: NormalizedLand = {
      externalId: "ext", uuid: "u", name: "n", address: null, landType: "Farmland",
      sourceType: null, totalAreaMu: 91.95, workAreaMu: 85.5, obstacleAreaMu: 6.45,
      precision: 0.5, precisionType: "RTK", maxGeometryParameterOffset: null,
      position: { lng: -76.3, lat: 3.6 },
      bbox: {
        upperRight: { lat: 3.7, lng: -76.2 },
        downLeft: { lat: 3.5, lng: -76.4 }
      },
      geometryUrl: "https://geom", waypointUrl: "https://wp",
      parameterUrl: "https://param", geometryStorageUuid: null, geometryContentMd5: null,
      serialNumber: "T40-001", tags: ["x"], createdAt: null, updatedAt: null
    };
    const p = landToParcelParams(fakeLand);
    const arr = paramsToPgArray(42, p);

    expect(arr).toHaveLength(20);
    expect(arr[0]).toBe(42);              // $1 batch_id
    expect(arr[1]).toBe("ext");           // $2 external_id
    expect(arr[2]).toBe("n");             // $3 land_name
    expect(arr[3]).toBe("Farmland");      // $4 field_type
    expect(arr[4]).toBe(false);           // $5 is_orchard
    expect(arr[5]).toBe("u");             // $6 dji_land_uuid
    expect(arr[6]).toBe("POINT(-76.3 3.6)"); // $7 position (WKT)
    expect(arr[7]).toMatch(/^POLYGON/);   // $8 bbox (WKT)
    expect(arr[8]).toEqual(["x"]);        // $9 tags
    expect(arr[9]).toBe(0.5);             // $10 precision_m
    expect(arr[10]).toBe("RTK");          // $11 precision_type
    expect(arr[11]).toBe("T40-001");      // $12 serial_number
    expect(arr[12]).toBe(91.95);          // $13 total_area_mu
    expect(arr[13]).toBe(85.5);           // $14 work_area_mu
    expect(arr[14]).toBe(6.45);           // $15 obstacle_area_mu
    expect(arr[15]).toBe("Farmland");     // $16 land_type_raw
    expect(arr[16]).toBeNull();           // $17 location_label (address was null in fixture)
    expect(arr[17]).toBe("https://geom"); // $18 source_url_geometry
    expect(arr[18]).toBe("https://param");// $19 source_url_parameter
    expect(arr[19]).toBe("https://wp");   // $20 source_url_waypoint
  });
});

describe("djiag-lands-to-parcels — integración con fetcher (round-trip)", () => {
  it("convierte lands reales del fixture a params listos para DB", () => {
    const page = parseLandsResponse(loadFixture("lands-response-page1.json"));
    const linares = page.lands[0];
    const p = landToParcelParams(linares);

    expect(p.externalId).toContain("flyer-");
    expect(p.landName).toBe("linares 2 ste4A");
    expect(p.fieldType).toBe("Farmland");
    expect(p.isOrchard).toBe(false);
    expect(p.positionWkt).toBe("POINT(-76.328195 3.62462)");
    expect(p.bboxWkt).toBe("POLYGON((-76.32826 3.62455, -76.32813 3.62455, -76.32813 3.6247, -76.32826 3.6247, -76.32826 3.62455))");
    expect(p.totalAreaMu).toBe(91.95);
    expect(p.tags).toEqual(["caña", "q1-2026"]);
    expect(p.precisionType).toBe("RTK");
    expect(p.serialNumber).toBe("T40-001");
  });

  it("tolera lands con campos opcionales null (segundo fixture)", () => {
    const page = parseLandsResponse(loadFixture("lands-response-page2.json"));
    const prueba1 = page.lands.find((l) => l.name === "prueba 1")!;
    const p = landToParcelParams(prueba1);

    expect(p.externalId).toContain("flyer-");
    expect(p.positionWkt).toBeNull();     // position null en fixture
    expect(p.bboxWkt).toBeNull();         // bbox null en fixture
    // prueba 1 sí tiene tags ["test"] — el converter los preserva
    expect(p.tags).toEqual(["test"]);
    expect(p.workAreaMu).toBe(0);         // "0" → 0
    expect(p.totalAreaMu).toBe(22.05);
    expect(p.sourceUrlGeometry).toBeNull(); // sin geometry URL
  });
});

describe("djiag-lands-to-parcels — constantes de unidades", () => {
  it("1 ha = 15 MU (estándar DJI)", () => {
    expect(MU_PER_HA).toBe(15);
    expect(HA_PER_MU).toBeCloseTo(0.0667, 3);
  });
});
