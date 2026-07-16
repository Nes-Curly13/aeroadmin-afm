import { describe, expect, it } from "vitest";
import type { PathOptions } from "leaflet";

import { COLORS } from "@/lib/ui-tokens";
import { getAlertPolygonStyle, getParcelPolygonStyle } from "@/lib/map-styles";
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
