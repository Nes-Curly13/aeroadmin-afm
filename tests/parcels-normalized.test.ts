import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

/**
 * Tests del normalizador de parámetros DJI.
 *
 * Estos tests no tocan la BD — validan la lógica de transformación
 * del parameter.json a columnas planas que el importer usa.
 *
 * La función normalizeParameter está en import_djiag_data.js (CommonJS),
 * por lo que usamos createRequire para cargarla.
 */

type Normalized = {
  drone_model_code: number | null;
  spray_width_m: number | null;
  work_speed_mps: number | null;
  optimal_heading_deg: number | null;
  is_orchard: "Orchards" | "Farmland";
  uses_side_spray: boolean;
  inner_area_m2: number | null;
};

type ImporterModule = {
  normalizeParameter: (param: unknown) => Normalized | null;
  parseAreaHa: (text: string | null) => number | null;
  parseEmbeddedJson: (value: unknown) => unknown;
  homePointToPointSql: (value: unknown) => string | null;
  waypointsToMultiPointSql: (value: unknown) => string | null;
  buildAssetIndexFromFilesystem: (filesDir: string) => Array<{
    kind: string;
    landName: string;
    uuid: string;
    externalId: string;
    url: string;
  }>;
  extractLandNameFromKml: (kmlPath: string) => string | null;
  geoJsonToGeometrySql: (g: unknown) => string | null;
};

const require = createRequire(import.meta.url);
const importer = require("../import_djiag_data.js") as ImporterModule;

describe("parameter normalization", () => {
  it("clasifica Orchard cuando tree_spray_selector=1", () => {
    const result = importer.normalizeParameter({
      spray_width: 5.5,
      work_speed: 5.3,
      spray_dir: 115,
      land_connect_drone_type: 201,
      tree_spray_selector: 1,
      is_use_side_spray: true,
      inner_area: 407.5
    });
    expect(result).not.toBeNull();
    expect(result!.is_orchard).toBe("Orchards");
    expect(result!.spray_width_m).toBe(5.5);
    expect(result!.work_speed_mps).toBe(5.3);
    expect(result!.optimal_heading_deg).toBe(115);
    expect(result!.drone_model_code).toBe(201);
    expect(result!.uses_side_spray).toBe(true);
    expect(result!.inner_area_m2).toBe(407.5);
  });

  it("clasifica Farmland cuando tree_spray_selector=0", () => {
    const result = importer.normalizeParameter({
      spray_width: 8,
      work_speed: 6.5,
      spray_dir: 200,
      land_connect_drone_type: 72,
      tree_spray_selector: 0,
      is_use_side_spray: false,
      inner_area: 8520.78
    });
    expect(result).not.toBeNull();
    expect(result!.is_orchard).toBe("Farmland");
    expect(result!.drone_model_code).toBe(72);
  });

  it("devuelve null si el param no es objeto", () => {
    expect(importer.normalizeParameter(null)).toBeNull();
    expect(importer.normalizeParameter(undefined)).toBeNull();
    expect(importer.normalizeParameter("string")).toBeNull();
    expect(importer.normalizeParameter(42)).toBeNull();
  });

  it("devuelve null para campos numéricos cuando el valor es no-numérico", () => {
    const result = importer.normalizeParameter({
      spray_width: "not a number",
      work_speed: null,
      inner_area: NaN
    });
    expect(result).not.toBeNull();
    expect(result!.spray_width_m).toBeNull();
    expect(result!.work_speed_mps).toBeNull();
    expect(result!.inner_area_m2).toBeNull();
    // los defaults siguen aplicando
    expect(result!.is_orchard).toBe("Farmland");
    expect(result!.drone_model_code).toBe(0);
  });

  it("mapea drone_model_code=0 a 'Sin asignar' por convención del lookup", () => {
    const result = importer.normalizeParameter({
      land_connect_drone_type: 0,
      tree_spray_selector: 0
    });
    expect(result!.drone_model_code).toBe(0);
  });
});

describe("area parsing", () => {
  it("parsea '5.78 ha' a 5.78", () => {
    expect(importer.parseAreaHa("5.78 ha")).toBe(5.78);
  });
  it("parsea '10.7 ha' a 10.7", () => {
    expect(importer.parseAreaHa("10.7 ha")).toBe(10.7);
  });
  it("devuelve null para null o vacío", () => {
    expect(importer.parseAreaHa(null)).toBeNull();
    expect(importer.parseAreaHa("")).toBeNull();
  });
  it("maneja '22.55 ha' correctamente", () => {
    expect(importer.parseAreaHa("22.55 ha")).toBe(22.55);
  });
});

describe("embedded JSON parsing", () => {
  it("parsea un JSON string válido", () => {
    const result = importer.parseEmbeddedJson('{"type":"Point","coordinates":[1,2]}');
    expect(result).toEqual({ type: "Point", coordinates: [1, 2] });
  });
  it("devuelve el objeto si ya es objeto", () => {
    const obj = { type: "Point", coordinates: [1, 2] };
    expect(importer.parseEmbeddedJson(obj)).toBe(obj);
  });
  it("devuelve null para null o vacío", () => {
    expect(importer.parseEmbeddedJson(null)).toBeNull();
    expect(importer.parseEmbeddedJson("")).toBeNull();
  });
  it("devuelve null para JSON inválido", () => {
    expect(importer.parseEmbeddedJson("not json")).toBeNull();
  });
});

describe("home point SQL generation", () => {
  it("genera SQL para un Point GeoJSON string", () => {
    const sql = importer.homePointToPointSql(
      '{"type":"Point","coordinates":[-76.4,3.5,0]}'
    );
    expect(sql).toContain("ST_GeomFromGeoJSON");
    expect(sql).toContain("ST_Force2D");
  });

  it("genera SQL desde un FeatureCollection con Point", () => {
    const sql = importer.homePointToPointSql(
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[-76.4,3.5,0]}}]}'
    );
    expect(sql).toContain("ST_GeomFromGeoJSON");
  });

  it("genera SQL desde el formato DJI flat {lat, lng}", () => {
    // Este es el formato real de seg_edge_home_point en parameter.json
    const sql = importer.homePointToPointSql(
      '{"accuracy":0.0,"action":0,"lat":3.5649,"lng":-76.4221,"pointType":0,"yaw":-1.0}'
    );
    expect(sql).toContain("ST_GeomFromGeoJSON");
    expect(sql).toContain('"coordinates":[-76.4221,3.5649,0]');
  });

  it("acepta el formato DJI como objeto (no string)", () => {
    const obj = { lat: 3.5, lng: -76.4, accuracy: 0 };
    const sql = importer.homePointToPointSql(obj);
    expect(sql).toContain("ST_GeomFromGeoJSON");
  });

  it("devuelve null para string vacío", () => {
    expect(importer.homePointToPointSql("")).toBeNull();
  });

  it("devuelve null para null", () => {
    expect(importer.homePointToPointSql(null)).toBeNull();
  });

  it("devuelve null para JSON inválido", () => {
    expect(importer.homePointToPointSql("not json")).toBeNull();
  });
});

describe("waypoints SQL generation", () => {
  it("genera SQL para FeatureCollection de Points", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [1, 2, 0] }, properties: {} },
        { type: "Feature", geometry: { type: "Point", coordinates: [3, 4, 0] }, properties: {} }
      ]
    };
    const sql = importer.waypointsToMultiPointSql(fc);
    expect(sql).toContain("MultiPoint");
    expect(sql).toContain("ST_GeomFromGeoJSON");
  });

  it("devuelve null para FeatureCollection vacía", () => {
    expect(importer.waypointsToMultiPointSql({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("devuelve null para null", () => {
    expect(importer.waypointsToMultiPointSql(null)).toBeNull();
  });

  it("filtra features que no son Point", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [1, 2, 0] }, properties: {} },
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] }, properties: {} }
      ]
    };
    const sql = importer.waypointsToMultiPointSql(fc);
    expect(sql).toContain("MultiPoint");
    // Polygon no debe entrar en el MultiPoint
    expect(sql).not.toContain("Polygon");
  });
});

describe("filesystem fallback (cuando land_file_urls.json viene vacío)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");

  function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "dji-test-"));
  }

  it("devuelve [] si el directorio no existe", () => {
    const idx = importer.buildAssetIndexFromFilesystem("/no/existe/dir");
    expect(idx).toEqual([]);
  });

  it("devuelve [] si el directorio está vacío", () => {
    const tmp = makeTempDir();
    try {
      expect(importer.buildAssetIndexFromFilesystem(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reconstruye el index desde archivos válidos", () => {
    const tmp = makeTempDir();
    try {
      const name = "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db_geometry.json";
      fs.writeFileSync(path.join(tmp, name), "{}");
      const idx = importer.buildAssetIndexFromFilesystem(tmp);
      expect(idx).toHaveLength(1);
      expect(idx[0]).toMatchObject({
        kind: "geometry",
        externalId: "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db",
        uuid: "0047243d-610e-4d2e-84a4-198ac9ac31db",
        url: ""
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignora archivos que no son JSON", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db_geometry.kml"), "<?xml...?>");
      fs.writeFileSync(path.join(tmp, "readme.txt"), "nope");
      expect(importer.buildAssetIndexFromFilesystem(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignora archivos que no matchean el patrón DJI", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "weird_name.json"), "{}");
      fs.writeFileSync(path.join(tmp, "1268692918907510784-flyer-bad-uuid_geometry.json"), "{}");
      expect(importer.buildAssetIndexFromFilesystem(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("agrupa 3 archivos del mismo externalId en 3 entradas separadas por kind", () => {
    const tmp = makeTempDir();
    try {
      const base = "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db";
      fs.writeFileSync(path.join(tmp, `${base}_geometry.json`), "{}");
      fs.writeFileSync(path.join(tmp, `${base}_parameter.json`), "{}");
      fs.writeFileSync(path.join(tmp, `${base}_waypoint.json`), "{}");
      const idx = importer.buildAssetIndexFromFilesystem(tmp);
      expect(idx).toHaveLength(3);
      const kinds = idx.map(a => a.kind).sort();
      expect(kinds).toEqual(["geometry", "parameter", "waypoint"]);
      // todos comparten externalId
      expect(new Set(idx.map(a => a.externalId)).size).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("extrae el land_name del KML hermano", () => {
    const tmp = makeTempDir();
    try {
      const base = "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db";
      fs.writeFileSync(
        path.join(tmp, `${base}_geometry.json`),
        '{"type":"FeatureCollection","features":[]}'
      );
      fs.writeFileSync(
        path.join(tmp, `${base}_geometry.kml`),
        '<?xml version="1.0"?><kml><Document><name>porvenir STE 3</name><Placemark/></Document></kml>'
      );
      const idx = importer.buildAssetIndexFromFilesystem(tmp);
      expect(idx).toHaveLength(1);
      expect(idx[0].landName).toBe("porvenir STE 3");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("deja landName vacío si no hay KML hermano", () => {
    const tmp = makeTempDir();
    try {
      const base = "1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db";
      fs.writeFileSync(path.join(tmp, `${base}_geometry.json`), "{}");
      // No escribimos KML
      const idx = importer.buildAssetIndexFromFilesystem(tmp);
      expect(idx[0].landName).toBe("");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("extractLandNameFromKml", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");

  it("extrae el name del Document", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dji-kml-"));
    try {
      const p = path.join(tmp, "x.kml");
      fs.writeFileSync(p, '<kml><Document><name>Mi Campo</name></Document></kml>');
      expect(importer.extractLandNameFromKml(p)).toBe("Mi Campo");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("devuelve null si no hay Document/name", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dji-kml-"));
    try {
      const p = path.join(tmp, "x.kml");
      fs.writeFileSync(p, '<kml><Document></Document></kml>');
      expect(importer.extractLandNameFromKml(p)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("devuelve null si el archivo no existe", () => {
    expect(importer.extractLandNameFromKml("/no/existe.kml")).toBeNull();
  });
});

describe("geoJsonToGeometrySql — ST_Buffer,0 (truco para reparar)", () => {
  it("envuelve la geometría en ST_Buffer,0 para self-intersections", () => {
    const sql = importer.geoJsonToGeometrySql({
      type: "Polygon",
      coordinates: [[[0,0],[1,1],[1,0],[0,1],[0,0]]]  // bow-tie, self-intersects
    });
    expect(sql).toContain("ST_Buffer");
    expect(sql).toContain("ST_Multi");
    expect(sql).toContain("ST_Force2D");
  });

  it("envuelve FeatureCollection con PlantZone en ST_Buffer,0", () => {
    const sql = importer.geoJsonToGeometrySql({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { funcType: "PlantZone" }, geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
        { type: "Feature", properties: { funcType: "ObstacleZone" }, geometry: { type: "Polygon", coordinates: [[[0.3,0.3],[0.7,0.3],[0.7,0.7],[0.3,0.3]]] } }
      ]
    });
    expect(sql).toContain("ST_Buffer");
    // Solo el PlantZone (no el ObstacleZone) se usa para spray_geom
    expect(sql).toContain("[0,0]");
    expect(sql).toContain("1,1");
    expect(sql).not.toContain("0.3");
  });

  it("ignora features que no son Polygon", () => {
    const sql = importer.geoJsonToGeometrySql({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { funcType: "ReferencePoint" }, geometry: { type: "MultiPoint", coordinates: [] } }
      ]
    });
    expect(sql).toBeNull();
  });
});
