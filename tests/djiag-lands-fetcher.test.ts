// Tests para lib/djiag-lands-fetcher.js — parser puro de responses de DJI AG.
//
// Estos tests NO requieren credenciales ni Playwright — usan fixtures
// sintéticos. La separación parser/transporte es deliberada: si DJI
// cambia el shape de la response, solo el parser cambia (no el client).
//
// Casos cubiertos:
//   - normalizeLand: shape completo, nulls, missing fields
//   - normalizePosition: con coords, sin lng, sin lat, todo null
//   - normalizeBbox: completo, parcial, null
//   - parseLandsResponse: response válida, edges vacío, totalCount, pageInfo
//   - parseLandsResponse: errores (no objeto, sin data, sin lands)
//   - muToHa / haToMu / muToM2: conversiones de unidades
//   - aggregate: simulación de paginación multi-página
//
// Para tests de regresión con responses reales (no sintéticos), ver
// tests/fixtures/djiag-live/ — se generan con `fetch-lands-from-djiag --save-fixtures`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseLandsResponse,
  normalizeLand,
  normalizePosition,
  normalizeBbox,
  muToHa,
  haToMu,
  muToM2,
  MU_PER_HA,
  HA_PER_MU,
  M2_PER_MU
} from "@/lib/djiag-lands-fetcher";
import type { DjiLandsResponse, NormalizedLand } from "@/lib/djiag-graphql-types";

// Helper para cargar fixtures del directorio tests/fixtures/
function loadFixture(name: string): DjiLandsResponse {
  const p = join(process.cwd(), "tests", "fixtures", name);
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("djiag-lands-fetcher — normalizePosition", () => {
  it("extrae lng/lat cuando están presentes", () => {
    expect(normalizePosition({ lng: -76.3, lat: 3.6 })).toEqual({ lng: -76.3, lat: 3.6 });
  });

  it("acepta strings numéricos y los convierte", () => {
    expect(normalizePosition({ lng: "-76.3", lat: "3.6" })).toEqual({ lng: -76.3, lat: 3.6 });
  });

  it("preserva null en cada componente individualmente", () => {
    expect(normalizePosition({ lng: null, lat: 3.6 })).toEqual({ lng: null, lat: 3.6 });
    expect(normalizePosition({ lng: -76.3, lat: null })).toEqual({ lng: -76.3, lat: null });
  });

  it("devuelve null si no hay nada usable", () => {
    expect(normalizePosition({ lng: null, lat: null })).toBeNull();
    expect(normalizePosition(null)).toBeNull();
    expect(normalizePosition({})).toBeNull();
  });

  it("rechaza strings no numéricos (no numberifica NaN)", () => {
    expect(normalizePosition({ lng: "abc", lat: 3.6 })).toEqual({ lng: null, lat: 3.6 });
  });
});

describe("djiag-lands-fetcher — normalizeBbox", () => {
  it("extrae upperRight y downLeft", () => {
    const ur = { lat: 3.62, lng: -76.32 };
    const dl = { lat: 3.61, lng: -76.33 };
    expect(normalizeBbox({ upperRight: ur, downLeft: dl })).toEqual({
      upperRight: { lat: 3.62, lng: -76.32 },
      downLeft: { lat: 3.61, lng: -76.33 }
    });
  });

  it("devuelve null si falta upperRight o downLeft", () => {
    expect(normalizeBbox({ upperRight: { lat: 1, lng: 1 } })).toBeNull();
    expect(normalizeBbox({ downLeft: { lat: 1, lng: 1 } })).toBeNull();
    expect(normalizeBbox(null)).toBeNull();
  });
});

describe("djiag-lands-fetcher — normalizeLand", () => {
  it("normaliza un land completo del fixture", () => {
    const fixture = loadFixture("lands-response-page1.json");
    const node = fixture.data.lands.edges[0].node;
    const normalized = normalizeLand(node);

    expect(normalized.uuid).toBe("7c1a4b8e-3f29-4d10-b6c1-a1b2c3d4e5f6");
    expect(normalized.externalId).toContain("flyer-");
    expect(normalized.name).toBe("linares 2 ste4A");
    expect(normalized.landType).toBe("Farmland");
    expect(normalized.totalAreaMu).toBe(91.95);
    expect(normalized.workAreaMu).toBe(85.5);
    expect(normalized.obstacleAreaMu).toBe(6.45);
    expect(normalized.position).toEqual({ lng: -76.328195, lat: 3.624620 });
    expect(normalized.bbox).toEqual({
      upperRight: { lat: 3.6247, lng: -76.32813 },
      downLeft: { lat: 3.62455, lng: -76.32826 }
    });
    expect(normalized.geometryUrl).toMatch(/^https:\/\//);
    expect(normalized.waypointUrl).toMatch(/^https:\/\//);
    expect(normalized.parameterUrl).toMatch(/^https:\/\//);
    expect(normalized.tags).toEqual(["caña", "q1-2026"]);
    expect(normalized.precision).toBe(0.5);
    expect(normalized.serialNumber).toBe("T40-001");
  });

  it("tolerancia a missing fields (devuelve null/[] en vez de tirar)", () => {
    const partial = {
      uuid: "abc",
      name: "test"
    };
    const normalized = normalizeLand(partial);
    expect(normalized.uuid).toBe("abc");
    expect(normalized.name).toBe("test");
    expect(normalized.totalAreaMu).toBeNull();
    expect(normalized.position).toBeNull();
    expect(normalized.bbox).toBeNull();
    expect(normalized.geometryUrl).toBeNull();
    expect(normalized.tags).toEqual([]);
  });

  it("lanza si node no es objeto", () => {
    expect(() => normalizeLand(null as unknown as object)).toThrow();
    expect(() => normalizeLand("string" as unknown as object)).toThrow();
  });
});

describe("djiag-lands-fetcher — parseLandsResponse", () => {
  it("parsea una página completa con edges", () => {
    const fixture = loadFixture("lands-response-page1.json");
    const parsed = parseLandsResponse(fixture);

    expect(parsed.lands).toHaveLength(3);
    expect(parsed.totalCount).toBe(1063);
    expect(parsed.hasNextPage).toBe(true);
    expect(parsed.endCursor).toBe("200");

    // Verificamos que cada land está normalizado (no el edge wrapper)
    expect(parsed.lands[0].name).toBe("linares 2 ste4A");
    expect(parsed.lands[2].landType).toBe("Orchards");
  });

  it("parsea la última página (hasNextPage=false)", () => {
    const fixture = loadFixture("lands-response-page2.json");
    const parsed = parseLandsResponse(fixture);

    expect(parsed.lands).toHaveLength(2);
    expect(parsed.hasNextPage).toBe(false);
    expect(parsed.endCursor).toBeNull();
  });

  it("tolerancia a edges vacío (página con 0 lands, no es error)", () => {
    const empty = { data: { lands: { totalCount: 1063, pageInfo: { hasNextPage: true, endCursor: "0" }, edges: [] } } };
    const parsed = parseLandsResponse(empty);
    expect(parsed.lands).toEqual([]);
    expect(parsed.totalCount).toBe(1063);
  });

  it("errores: response no es objeto", () => {
    expect(() => parseLandsResponse(null as unknown as DjiLandsResponse)).toThrow(/not an object/);
  });

  it("errores: falta data.lands", () => {
    expect(() => parseLandsResponse({ data: {} } as unknown as DjiLandsResponse)).toThrow(/lands/);
  });

  it("errores: falta data entero", () => {
    expect(() => parseLandsResponse({} as unknown as DjiLandsResponse)).toThrow(/data/);
  });
});

describe("djiag-lands-fetcher — conversión de unidades (MU ↔ ha ↔ m²)", () => {
  it("constantes de conversión", () => {
    expect(MU_PER_HA).toBe(15);
    expect(HA_PER_MU).toBeCloseTo(0.0667, 3);
    expect(M2_PER_MU).toBeCloseTo(666.667, 2);
  });

  it("MU → ha: 91.95 MU ≈ 6.13 ha (caso linares 2 ste4A)", () => {
    // 91.95 / 15 = 6.13
    expect(muToHa(91.95)).toBeCloseTo(6.13, 2);
  });

  it("ha → MU: 6.13 ha → 91.95 MU", () => {
    expect(haToMu(6.13)).toBeCloseTo(91.95, 2);
  });

  it("round-trip: muToHa(haToMu(x)) ≈ x", () => {
    const original = 6.13;
    expect(muToHa(haToMu(original))).toBeCloseTo(original, 10);
  });

  it("MU → m²: 1 MU = 666.67 m²", () => {
    expect(muToM2(1)).toBeCloseTo(666.667, 2);
    expect(muToM2(15)).toBeCloseTo(10000, 0); // 1 ha
  });

  it("null safety: null input → null output (no NaN)", () => {
    expect(muToHa(null)).toBeNull();
    expect(muToHa(undefined)).toBeNull();
    expect(haToMu(null)).toBeNull();
    expect(muToM2(null)).toBeNull();
  });
});

describe("djiag-lands-fetcher — paginación multi-página (integración)", () => {
  it("consolida lands de page1 + page2 con sus cursor states", () => {
    const page1 = parseLandsResponse(loadFixture("lands-response-page1.json"));
    const page2 = parseLandsResponse(loadFixture("lands-response-page2.json"));

    expect(page1.hasNextPage).toBe(true);
    expect(page1.endCursor).toBe("200");
    expect(page1.lands).toHaveLength(3);

    expect(page2.hasNextPage).toBe(false);
    expect(page2.endCursor).toBeNull();
    expect(page2.lands).toHaveLength(2);

    // Consolidación típica que haría el CLI
    const allLands = [...page1.lands, ...page2.lands];
    expect(allLands).toHaveLength(5);
    expect(allLands.map((l) => l.name)).toEqual([
      "linares 2 ste4A",
      "porvenir MB ste10",
      "malibu ste 65",
      "Santa Mónica STE 1",
      "prueba 1"
    ]);
  });

  it("lands con campos opcionales null no rompen la pipeline", () => {
    // page2 tiene un land (Santa Mónica) con precision/position/bbox null
    // y otro (prueba 1) con casi todo null
    const page2 = parseLandsResponse(loadFixture("lands-response-page2.json"));
    const santaM = page2.lands.find((l: NormalizedLand) => l.name === "Santa Mónica STE 1")!;
    expect(santaM.precision).toBeNull();
    // position: ambos componentes son null → colapsa a null (semántica:
    // "no tengo position", no "{lng: null, lat: null}"). El caller puede
    // distinguir via `land.position === null` sin chequear cada componente.
    expect(santaM.position).toBeNull();
    expect(santaM.bbox).toBeNull();
    expect(santaM.geometryUrl).toBeNull();

    const prueba1 = page2.lands.find((l: NormalizedLand) => l.name === "prueba 1")!;
    expect(prueba1.position).toBeNull();
    expect(prueba1.bbox).toBeNull();
    expect(prueba1.geometryUrl).toBeNull();
    expect(prueba1.workAreaMu).toBe(0); // string "0" → 0
  });
});
