import { describe, expect, it } from "vitest";
import type { PathOptions } from "leaflet";

import { COLORS } from "@/lib/ui-tokens";
import {
  buildFumigatedParcelSet,
  getAlertPolygonStyle,
  getParcelPolygonStyle
} from "@/lib/map-styles";
import type { DjiAlertRecord, DjiParcelRecord } from "@/lib/types";

/**
 * Fixture mínima de DjiParcelRecord. Solo necesitamos los campos que el
 * style function inspecciona (is_orchard, field_type). El resto se rellena
 * con null/0 — `getParcelPolygonStyle` no los toca.
 */
function makeParcel(overrides: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "EXT-1",
    land_name: "Parcela 1",
    field_type: "Farmland",
    declared_area_ha: 1,
    spray_area_m2: 10_000,
    drone_model_code: 1,
    drone_model_name: "T40",
    spray_width_m: 5,
    work_speed_mps: 5,
    optimal_heading_deg: 0,
    radar_height_m: 3,
    edge_offset_m: 0,
    obstacle_offset_m: 0,
    climb_height_m: 0,
    no_spray_zone_m2: 0,
    droplet_size: 100,
    sweep_direction: 0,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null,
    ...overrides
  };
}

describe("getParcelPolygonStyle", () => {
  it("devuelve un PathOptions con todas las keys requeridas", () => {
    const style: PathOptions = getParcelPolygonStyle(makeParcel());
    expect(style).toMatchObject({
      color: expect.any(String),
      weight: expect.any(Number),
      fillColor: expect.any(String),
      fillOpacity: expect.any(Number)
    });
  });

  it("NO contiene hexes hardcodeados — todos los colores vienen de ui-tokens", () => {
    const style = getParcelPolygonStyle(makeParcel());
    const styleOrchard = getParcelPolygonStyle(makeParcel({ is_orchard: true, field_type: "Orchards" }));
    // Las unicas fuentes permitidas de color son los tokens semanticos.
    const allowed = new Set<string>(Object.values(COLORS));
    expect(allowed.has(style.color!)).toBe(true);
    expect(allowed.has(style.fillColor!)).toBe(true);
    expect(allowed.has(styleOrchard.color!)).toBe(true);
    expect(allowed.has(styleOrchard.fillColor!)).toBe(true);
  });

  it("farmland: border primary + fill success (verde)", () => {
    const style = getParcelPolygonStyle(makeParcel({ is_orchard: false, field_type: "Farmland" }));
    expect(style.color).toBe(COLORS.primary);
    expect(style.fillColor).toBe(COLORS.success);
    expect(style.fillOpacity).toBeGreaterThan(0);
  });

  it("orchard: border warning + fill warning con fillOpacity menor", () => {
    const baseline = getParcelPolygonStyle(makeParcel({ is_orchard: false, field_type: "Farmland" }));
    const orchard = getParcelPolygonStyle(makeParcel({ is_orchard: true, field_type: "Orchards" }));
    expect(orchard.color).toBe(COLORS.warning);
    expect(orchard.fillColor).toBe(COLORS.warning);
    // Orchard debe distinguirse visualmente con menos fill (mas tenue).
    expect(orchard.fillOpacity).toBeLessThan(baseline.fillOpacity!);
  });

  it("parcela seleccionada: weight sube a 4 (vs default 2)", () => {
    const baseline = getParcelPolygonStyle(makeParcel());
    const selected = getParcelPolygonStyle(makeParcel(), { isSelected: true });
    expect(baseline.weight).toBe(2);
    expect(selected.weight).toBe(4);
  });

  it("parcela no seleccionada: weight es 2 (default)", () => {
    const style = getParcelPolygonStyle(makeParcel(), { isSelected: false });
    expect(style.weight).toBe(2);
  });

  it("incluye stroke y fill habilitados (no invisibles)", () => {
    const style = getParcelPolygonStyle(makeParcel());
    // stroke puede ser undefined (Leaflet default true) pero al menos uno de color/weight
    // debe estar presente para que la parcela se vea.
    expect(style.color).toBeTruthy();
    expect(style.fillColor).toBeTruthy();
    expect(style.fillOpacity).toBeGreaterThan(0);
  });
});

describe("getAlertPolygonStyle", () => {
  it("HIGH: border danger + fill danger", () => {
    const style = getAlertPolygonStyle("HIGH");
    expect(style.color).toBe(COLORS.danger);
    expect(style.fillColor).toBe(COLORS.danger);
  });

  it("MEDIUM: border warning + fill warning", () => {
    const style = getAlertPolygonStyle("MEDIUM");
    expect(style.color).toBe(COLORS.warning);
    expect(style.fillColor).toBe(COLORS.warning);
  });

  it("LOW: border success + fill success", () => {
    const style = getAlertPolygonStyle("LOW");
    expect(style.color).toBe(COLORS.success);
    expect(style.fillColor).toBe(COLORS.success);
  });

  it("devuelve un PathOptions con weight y fillOpacity", () => {
    const style: PathOptions = getAlertPolygonStyle("HIGH" satisfies DjiAlertRecord["level"]);
    expect(style.weight).toBeGreaterThan(0);
    expect(style.fillOpacity).toBeGreaterThan(0);
  });
});

describe("getParcelPolygonStyle — fumigación (commit 2)", () => {
  it("parcela fumigada (hasFumigation=true): estilo solido (sin dashArray)", () => {
    const style = getParcelPolygonStyle(makeParcel(), { hasFumigation: true });
    // Sin dashArray o dashArray vacio => borde solido.
    expect(style.dashArray === undefined || style.dashArray === "" || style.dashArray === "0").toBe(true);
    expect(style.fillOpacity).toBeGreaterThan(0.2);
  });

  it("parcela NO fumigada (hasFumigation=false): borde dashed + fillOpacity bajo", () => {
    const fumigated = getParcelPolygonStyle(makeParcel(), { hasFumigation: true });
    const notFumigated = getParcelPolygonStyle(makeParcel(), { hasFumigation: false });
    // dashArray presente en no fumigado
    expect(notFumigated.dashArray).toBeDefined();
    expect(String(notFumigated.dashArray)).toMatch(/\d+\s+\d+/);
    // fillOpacity menor que el fumigado
    expect(notFumigated.fillOpacity).toBeLessThan(fumigated.fillOpacity!);
  });

  it("parcela NO fumigada: opacity del stroke presente y < 1 (menos visible)", () => {
    const notFumigated = getParcelPolygonStyle(makeParcel(), { hasFumigation: false });
    expect(notFumigated.opacity).toBeDefined();
    expect(notFumigated.opacity!).toBeLessThan(1);
  });

  it("parcela fumigada: NO aplica opacity reducida (se ve al 100%)", () => {
    const fumigated = getParcelPolygonStyle(makeParcel(), { hasFumigation: true });
    // Sin opacity definida, o >= 1: borde solido al 100% de visibilidad.
    expect(fumigated.opacity === undefined || fumigated.opacity! >= 1).toBe(true);
  });

  it("default sin hasFumigation explicito: se asume fumigada (no rompe backwards compat)", () => {
    const style = getParcelPolygonStyle(makeParcel());
    // Sin hasFumigation, no debe aplicar dashed.
    expect(style.dashArray === undefined || style.dashArray === "" || style.dashArray === "0").toBe(true);
  });

  it("isSelected y hasFumigation=false son compatibles (dashed + weight=4)", () => {
    const style = getParcelPolygonStyle(makeParcel(), {
      hasFumigation: false,
      isSelected: true
    });
    expect(style.weight).toBe(4);
    expect(String(style.dashArray)).toMatch(/\d+\s+\d+/);
  });

  it("orchard NO fumigada: tambien dashed (la distincion se aplica a todo tipo)", () => {
    const orchard = getParcelPolygonStyle(
      makeParcel({ is_orchard: true, field_type: "Orchards" }),
      { hasFumigation: false }
    );
    expect(String(orchard.dashArray)).toMatch(/\d+\s+\d+/);
  });
});

describe("buildFumigatedParcelSet", () => {
  it("devuelve un Set con los parcel_ids que tienen fumigacion >= since", () => {
    const events = [
      { id: 1, parcel_id: 10, fumigation_date: "2026-05-15" },
      { id: 2, parcel_id: 20, fumigation_date: "2026-04-01" },
      { id: 3, parcel_id: 10, fumigation_date: "2026-06-01" }, // dup parcel
      { id: 4, parcel_id: 30, fumigation_date: "2025-01-01" }  // antes del since
    ];
    const set = buildFumigatedParcelSet(events, "2026-01-01");
    expect(set.size).toBe(2);
    expect(set.has(10)).toBe(true);
    expect(set.has(20)).toBe(true);
    expect(set.has(30)).toBe(false);
  });

  it("eventos con fumigation_date null se ignoran", () => {
    const events = [
      { id: 1, parcel_id: 10, fumigation_date: null as unknown as string },
      { id: 2, parcel_id: 20, fumigation_date: "2026-05-15" }
    ];
    const set = buildFumigatedParcelSet(events, "2026-01-01");
    expect(set.size).toBe(1);
    expect(set.has(20)).toBe(true);
  });

  it("lista vacia devuelve Set vacio", () => {
    const set = buildFumigatedParcelSet([], "2026-01-01");
    expect(set.size).toBe(0);
  });
});
