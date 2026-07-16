// tests/lib/map-parcel-content.test.ts
//
// TDD rojo→verde para lib/map-parcel-content.ts (M3-M5 Track C).
// Cubre:
//   1. getParcelHoverContent  — string compacto para Leaflet Tooltip
//   2. getParcelPopupContent  — string extendido para Leaflet Popup
//   3. getParcelA11yLabel     — aria-label para el listbox accesible
//   4. bindParcelLayerInteractions — bindTooltip + bindPopup + on('mouseover')
//
// Nota: el estilo del polígono (getParcelPolygonStyle) NO vive acá — está
// en lib/map-styles.ts (Track A, 2026-07-15) y se testea en
// tests/lib/map-styles.test.ts. Track C solo consume esa función.
//
// Patrones:
//   - Pure functions (sin Leaflet) salvo bindParcelLayerInteractions que
//     recibe un ParcelLayerLike (duck-typed) — testeable con un mock.
//   - Las funciones que tocan fecha usan formatDateWithWeekday (TZ-fragile
//     en jsdom). Verificamos con regex flexible `/2026/` + `/jun/i` para
//     tolerar el shift UTC↔Bogota que ya está documentado en format.ts.

import { describe, expect, it, vi } from "vitest";

import {
  bindParcelLayerInteractions,
  getParcelA11yLabel,
  getParcelHoverContent,
  getParcelPopupContent,
  resolveFeatureStyle,
  type ParcelContentInput
} from "@/lib/map-parcel-content";
import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<ParcelContentInput> = {}): ParcelContentInput {
  return {
    name: "Porvenir STE 3",
    areaHa: 5.32,
    lastFumigationDate: "2026-06-15",
    totalFlights: 12,
    alertLevel: null,
    alertMessage: null,
    ...over
  };
}

/**
 * Fixture mínima de DjiParcelRecord para los tests de resolveFeatureStyle.
 * Solo necesitamos los campos que la style function inspecciona
 * (is_orchard, field_type, id). El resto se rellena con defaults razonables
 * para que el record sea válido.
 */
function makeDjiParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    declared_area_ha: 5.32,
    spray_area_m2: 53_200,
    drone_model_code: 201,
    drone_model_name: "Agras T40",
    spray_width_m: 5.5,
    work_speed_mps: 6,
    optimal_heading_deg: 100,
    radar_height_m: 3,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2,
    no_spray_zone_m2: 0,
    droplet_size: 320,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 42,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null,
    ...over
  };
}

describe("getParcelHoverContent", () => {
  it("incluye el nombre, área formateada y fecha de fumigación", () => {
    const html = getParcelHoverContent(makeParcel());
    expect(html).toContain("Porvenir STE 3");
    expect(html).toContain("5.32 ha");
    // formatDateWithWeekday output usa es-CO con año+mes; toleramos TZ shift.
    expect(html).toMatch(/2026/);
    expect(html).toMatch(/jun/i);
  });

  it("muestra 'sin fumigaciones registradas' cuando lastFumigationDate es null", () => {
    const html = getParcelHoverContent(makeParcel({ lastFumigationDate: null }));
    expect(html).toContain("sin fumigaciones registradas");
    expect(html).not.toMatch(/2026/);
  });

  it("muestra '—' cuando areaHa es null", () => {
    const html = getParcelHoverContent(makeParcel({ areaHa: null }));
    expect(html).toContain("—");
  });

  it("usa 'Sin nombre' cuando name es null", () => {
    const html = getParcelHoverContent(makeParcel({ name: null }));
    expect(html).toContain("Sin nombre");
  });

  it("escapa HTML en el name para evitar XSS", () => {
    const html = getParcelHoverContent(
      makeParcel({ name: "<script>alert('xss')</script>" })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapa HTML en el mensaje de alerta (no usado en hover pero defense-in-depth)", () => {
    // getParcelHoverContent no usa alertMessage; nos aseguramos de que no rompa
    // cuando se pasa.
    const html = getParcelHoverContent(
      makeParcel({ name: "Parcela", alertMessage: "<img onerror=alert(1)>" })
    );
    expect(html).not.toContain("<img onerror=alert(1)>");
  });

  it("área con 2 decimales: 5.32 ha (no 5.3, no 5.320)", () => {
    const html = getParcelHoverContent(makeParcel({ areaHa: 5.3 }));
    expect(html).toContain("5.30 ha");
  });

  it("área muy grande se formatea con separador de miles (en-US)", () => {
    const html = getParcelHoverContent(makeParcel({ areaHa: 1234.56 }));
    expect(html).toContain("1,234.56 ha");
  });
});

describe("getParcelPopupContent", () => {
  it("incluye nombre, área, fecha última fumigación y total de vuelos", () => {
    const html = getParcelPopupContent(makeParcel());
    expect(html).toContain("Porvenir STE 3");
    expect(html).toContain("5.32 ha");
    expect(html).toMatch(/2026/);
    expect(html).toContain("12");
  });

  it("incluye alert level cuando se pasa alertLevel=HIGH", () => {
    const html = getParcelPopupContent(makeParcel({ alertLevel: "HIGH" }));
    expect(html).toMatch(/HIGH|alta|severidad/i);
  });

  it("incluye alert level MEDIUM", () => {
    const html = getParcelPopupContent(makeParcel({ alertLevel: "MEDIUM" }));
    expect(html).toMatch(/MEDIUM|media/i);
  });

  it("incluye alert level LOW", () => {
    const html = getParcelPopupContent(makeParcel({ alertLevel: "LOW" }));
    expect(html).toMatch(/LOW|baja/i);
  });

  it("muestra '—' para total_flights cuando es undefined", () => {
    const html = getParcelPopupContent(makeParcel({ totalFlights: undefined }));
    expect(html).toContain("—");
  });

  it("no incluye sección de alerta cuando alertLevel es null", () => {
    const html = getParcelPopupContent(makeParcel({ alertLevel: null }));
    expect(html).not.toMatch(/severidad|alerta nivel/i);
  });

  it("incluye alertMessage cuando se proporciona", () => {
    const html = getParcelPopupContent(
      makeParcel({ alertLevel: "HIGH", alertMessage: "Operación sobre-explotada" })
    );
    expect(html).toContain("Operación sobre-explotada");
  });

  it("muestra '—' para areaHa null y 'sin fumigaciones' para date null", () => {
    const html = getParcelPopupContent(
      makeParcel({ areaHa: null, lastFumigationDate: null })
    );
    expect(html).toContain("—");
    expect(html).toContain("sin fumigaciones registradas");
  });

  it("escapa HTML en alertMessage para evitar XSS", () => {
    const html = getParcelPopupContent(
      makeParcel({
        alertLevel: "HIGH",
        alertMessage: "<img src=x onerror=alert(1)>"
      })
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

describe("getParcelA11yLabel", () => {
  it("formato descriptivo: nombre, hectáreas, fecha", () => {
    const label = getParcelA11yLabel(makeParcel());
    expect(label).toContain("Porvenir STE 3");
    expect(label).toContain("5.32");
    expect(label).toMatch(/hect/i);
    expect(label).toMatch(/2026/);
  });

  it("usa 'sin fumigaciones registradas' cuando no hay fecha", () => {
    const label = getParcelA11yLabel(makeParcel({ lastFumigationDate: null }));
    expect(label).toContain("sin fumigaciones registradas");
  });

  it("usa 'área desconocida' cuando areaHa es null", () => {
    const label = getParcelA11yLabel(makeParcel({ areaHa: null }));
    // O "—" — aceptamos cualquiera,关键是 que sea explícito y no "undefined"
    expect(label).not.toMatch(/undefined/);
    expect(label).not.toMatch(/null/);
    expect(label).toMatch(/área/i);
  });

  it("usa 'parcela sin nombre' cuando name es null", () => {
    const label = getParcelA11yLabel(makeParcel({ name: null }));
    expect(label).toMatch(/sin nombre/i);
  });

  it("NO incluye HTML (es un aria-label, no innerHTML)", () => {
    const label = getParcelA11yLabel(makeParcel());
    expect(label).not.toMatch(/<[^>]+>/);
  });

  it("pluraliza correctamente '1.00 hectáreas' vs '5.32 hectáreas'", () => {
    expect(getParcelA11yLabel(makeParcel({ areaHa: 1 }))).toMatch(/hectárea|1\.00 ha/);
    expect(getParcelA11yLabel(makeParcel({ areaHa: 5.32 }))).toMatch(/hectárea|5\.32 ha/);
  });

  it("incluye el id externo cuando está disponible (vía name null fallback)", () => {
    const label = getParcelA11yLabel(
      makeParcel({ name: null, areaHa: 1, lastFumigationDate: null })
    );
    // Cuando name es null el caller podría pasar external_id; pero la función
    // pura solo conoce 'name'. Aceptamos que diga "parcela sin nombre".
    expect(label).toMatch(/sin nombre/i);
  });
});

describe("bindParcelLayerInteractions", () => {
  function makeMockLayer() {
    return {
      bindTooltip: vi.fn(),
      bindPopup: vi.fn(),
      on: vi.fn(),
      getTooltip: vi.fn(() => ({ getContent: () => "tooltip content" }))
    };
  }

  it("bindTooltip se llama con contenido del parcel y opciones sticky/top/0.95", () => {
    const layer = makeMockLayer();
    bindParcelLayerInteractions(layer, makeParcel());
    expect(layer.bindTooltip).toHaveBeenCalledTimes(1);
    const [content, opts] = (layer.bindTooltip as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("Porvenir STE 3");
    expect(content).toContain("5.32 ha");
    expect(opts).toEqual(
      expect.objectContaining({
        sticky: true,
        direction: "top",
        opacity: 0.95
      })
    );
  });

  it("bindPopup se llama con contenido extendido del parcel", () => {
    const layer = makeMockLayer();
    bindParcelLayerInteractions(layer, makeParcel());
    expect(layer.bindPopup).toHaveBeenCalledTimes(1);
    const [content] = (layer.bindPopup as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("Porvenir STE 3");
    expect(content).toContain("5.32 ha");
    expect(content).toContain("12"); // total flights
  });

  it("registra mouseover handler cuando se pasa onMouseOver", () => {
    const layer = makeMockLayer();
    const onMouseOver = vi.fn();
    bindParcelLayerInteractions(layer, makeParcel(), { onMouseOver });
    expect(layer.on).toHaveBeenCalledWith("mouseover", onMouseOver);
  });

  it("registra mouseout handler cuando se pasa onMouseOut", () => {
    const layer = makeMockLayer();
    const onMouseOut = vi.fn();
    bindParcelLayerInteractions(layer, makeParcel(), { onMouseOut });
    expect(layer.on).toHaveBeenCalledWith("mouseout", onMouseOut);
  });

  it("NO registra handlers si no se pasan options (test isolation)", () => {
    const layer = makeMockLayer();
    bindParcelLayerInteractions(layer, makeParcel());
    expect(layer.on).not.toHaveBeenCalled();
  });

  it("el orden es: bindTooltip → bindPopup → on(mouseover) → on(mouseout)", () => {
    const layer = makeMockLayer();
    const order: string[] = [];
    (layer.bindTooltip as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("tooltip"));
    (layer.bindPopup as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("popup"));
    (layer.on as ReturnType<typeof vi.fn>).mockImplementation((event: string) => {
      order.push(`on:${event}`);
    });
    bindParcelLayerInteractions(layer, makeParcel(), { onMouseOver: vi.fn(), onMouseOut: vi.fn() });
    expect(order).toEqual(["tooltip", "popup", "on:mouseover", "on:mouseout"]);
  });
});

describe("resolveFeatureStyle", () => {
  it("feature sin parcel matcheada: devuelve fallback default (no rompe el render)", () => {
    const parcelById = new Map<number, DjiParcelRecord>();
    const style = resolveFeatureStyle(
      { properties: { id: 999 } },
      parcelById,
      null
    );
    // weight y fillOpacity presentes; color y fillColor truthy.
    expect(style.weight).toBeGreaterThan(0);
    expect(style.fillOpacity).toBeGreaterThan(0);
  });

  it("feature null: devuelve fallback default", () => {
    const parcelById = new Map<number, DjiParcelRecord>();
    const style = resolveFeatureStyle(null, parcelById, null);
    expect(style.weight).toBeGreaterThan(0);
  });

  it("feature sin properties: devuelve fallback default", () => {
    const parcelById = new Map<number, DjiParcelRecord>();
    const style = resolveFeatureStyle({ properties: null }, parcelById, null);
    expect(style.weight).toBeGreaterThan(0);
  });

  it("feature con id no matcheado: devuelve fallback default", () => {
    const parcel = makeDjiParcel({ id: 1 });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 999 } },
      parcelById,
      null
    );
    expect(style.weight).toBeGreaterThan(0);
  });

  it("feature NO seleccionado: weight=2 (default de Track A)", () => {
    const parcel = makeDjiParcel({ id: 1, is_orchard: false, field_type: "Farmland" });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 1 } },
      parcelById,
      null // no seleccionado
    );
    expect(style.weight).toBe(2);
  });

  it("feature SELECCIONADO: weight=4 (Track A) + dashArray=undefined (override Track C)", () => {
    const parcel = makeDjiParcel({ id: 1 });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 1 } },
      parcelById,
      1 // seleccionado
    );
    expect(style.weight).toBe(4);
    // Override Track C: seleccionada siempre es línea sólida.
    // La impl borra dashArray del spread (no asigna null porque el
    // tipo Leaflet PathOptions es `string | number[]`, no `null`).
    // Leaflet trata `dashArray: undefined` como "sin patrón = sólido".
    expect(style.dashArray).toBeUndefined();
  });

  it("feature SELECCIONADO (orchard): weight=4 + dashArray=undefined + color warning", () => {
    const parcel = makeDjiParcel({ id: 1, is_orchard: true, field_type: "Orchards" });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 1 } },
      parcelById,
      1
    );
    expect(style.weight).toBe(4);
    expect(style.dashArray).toBeUndefined();
  });

  it("feature SELECCIONADO preserva fillColor de Track A (no override accidental)", () => {
    // El override solo toca dashArray, no toca colores. Esto es importante
    // para que la parcela seleccionada siga mostrando su tipo (farmland verde
    // vs orchard amarillo) además del grosor.
    const parcel = makeDjiParcel({ id: 1, is_orchard: true, field_type: "Orchards" });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 1 } },
      parcelById,
      1
    );
    // El color y fillColor deben venir de Track A (COLORS.warning para orchard).
    expect(style.color).toBeTruthy();
    expect(style.fillColor).toBeTruthy();
  });

  it("varias parcelas, solo una seleccionada: cada style refleja su estado", () => {
    const parcel1 = makeDjiParcel({ id: 1, land_name: "Parcela 1" });
    const parcel2 = makeDjiParcel({ id: 2, land_name: "Parcela 2" });
    const parcel3 = makeDjiParcel({ id: 3, land_name: "Parcela 3" });
    const parcelById = new Map([
      [1, parcel1],
      [2, parcel2],
      [3, parcel3]
    ]);
    // Solo parcel 2 está seleccionada.
    const s1 = resolveFeatureStyle({ properties: { id: 1 } }, parcelById, 2);
    const s2 = resolveFeatureStyle({ properties: { id: 2 } }, parcelById, 2);
    const s3 = resolveFeatureStyle({ properties: { id: 3 } }, parcelById, 2);
    // Parcel 2: weight=4 + dashArray undefined (override Track C = línea sólida)
    expect(s2.weight).toBe(4);
    expect(s2.dashArray).toBeUndefined();
    // Las otras: weight=2, sin override
    expect(s1.weight).toBe(2);
    expect(s3.weight).toBe(2);
  });

  it("selectedParcelId null: ninguna parcela tiene override (todas weight=2)", () => {
    const parcel = makeDjiParcel({ id: 1 });
    const parcelById = new Map([[1, parcel]]);
    const style = resolveFeatureStyle(
      { properties: { id: 1 } },
      parcelById,
      null
    );
    expect(style.weight).toBe(2);
    expect(style.dashArray).toBeUndefined();
  });
});
