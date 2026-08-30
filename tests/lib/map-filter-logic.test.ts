// Unit tests de lib/map-filter-logic.ts — funciones puras del filtrado
// client-side del mapa. Aisladas del DOM para que sean rápidas y
// deterministas. Mismo patrón que alerts.test.ts / fumigation-cadence.test.ts.

import { describe, expect, it } from "vitest";

import {
  applyEventFilters,
  applyParcelFilters,
  aggregateEventsByParcel,
  computeKpis,
  computeParcelCentroid,
  decorateParcelsWithEvents,
  defaultFilterState,
  getCadenceDays,
  sortParcelsByPriority,
  toCadenceStatus,
  toMapFumigationEvent,
  toMapParcelView,
  uniqueClients,
  uniqueFarms
} from "@/lib/map-filter-logic";
import { CADENCE_STATUS_META, CADENCE_STATUS_ORDER } from "@/lib/map-filter-types";
import type { DjiFumigationEvent, DjiParcelRecord } from "@/lib/types";

const FIXED_NOW_ISO = "2026-07-28T12:00:00Z";

function makeParcel(overrides: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    is_orchard: false,
    spray_geometry: null,
    spray_area_m2: 50000,
    declared_area_ha: 5,
    drone_model_code: 201,
    drone_model_name: "Agras T40 / T50",
    spray_width_m: null,
    work_speed_mps: null,
    optimal_heading_deg: null,
    radar_height_m: null,
    edge_offset_m: null,
    obstacle_offset_m: null,
    climb_height_m: null,
    no_spray_zone_m2: null,
    droplet_size: null,
    sweep_direction: null,
    uses_side_spray: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null,
    reference_point: null,
    last_fumigation_date: null,
    ...overrides
  };
}

function makeEvent(overrides: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 100,
    parcel_id: 1,
    fumigation_date: "2026-07-15",
    product_used: "Madurante",
    // Sprint S9 — FK opcional al catálogo products.
    product_id: null,
    dose_l_per_ha: 2.0,
    area_fumigated_m2: 30000, // 3 ha
    drone_code_used: 201,
    duration_minutes: 25,
    notes: null,
    human_notes: null,
    recorded_by: "J. Ramírez",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-07-15T18:00:00Z",
    source: "manual",
    flight_ids: null,
    ...overrides
  };
}

describe("toCadenceStatus", () => {
  it("mapea cada FumigationStatus a su CadenceStatus equivalente", () => {
    expect(toCadenceStatus("no_history")).toBe("critico");
    expect(toCadenceStatus("overdue")).toBe("vencido");
    expect(toCadenceStatus("due_soon")).toBe("por_vencer");
    expect(toCadenceStatus("ok")).toBe("al_dia");
  });

  it("el mapeo cubre los 4 valores y solo 4", () => {
    const internalTypes = Object.values(CADENCE_STATUS_META).map((m) => m.internal);
    expect(new Set(internalTypes).size).toBe(4);
  });
});

describe("getCadenceDays", () => {
  it("devuelve 14 días para Farmland", () => {
    expect(getCadenceDays(makeParcel({ field_type: "Farmland" }))).toBe(14);
  });

  it("devuelve 10 días para Orchards", () => {
    expect(getCadenceDays(makeParcel({ field_type: "Orchards" }))).toBe(10);
  });

  it("devuelve el fallback (14) para field_type desconocido", () => {
    expect(getCadenceDays(makeParcel({ field_type: "Otro" }))).toBe(14);
    expect(getCadenceDays(makeParcel({ field_type: null as unknown as string }))).toBe(14);
  });
});

describe("computeParcelCentroid", () => {
  it("usa reference_point cuando es un Point", () => {
    const p = makeParcel({
      reference_point: { type: "Point", coordinates: [-76.5, 3.4] }
    });
    expect(computeParcelCentroid(p)).toEqual({ lng: -76.5, lat: 3.4 });
  });

  it("cae al primer vértice de spray_geometry si no hay reference_point", () => {
    const p = makeParcel({
      reference_point: null,
      spray_geometry: {
        type: "Polygon",
        coordinates: [[[-76.1, 3.1], [-76.2, 3.2], [-76.3, 3.3]]]
      }
    });
    expect(computeParcelCentroid(p)).toEqual({ lng: -76.1, lat: 3.1 });
  });

  it("soporta MultiPolygon", () => {
    const p = makeParcel({
      spray_geometry: {
        type: "MultiPolygon",
        coordinates: [[[[-76.7, 3.7], [-76.8, 3.8]]]]
      }
    });
    expect(computeParcelCentroid(p)).toEqual({ lng: -76.7, lat: 3.7 });
  });

  it("devuelve nulls si no hay geometría", () => {
    expect(computeParcelCentroid(makeParcel())).toEqual({ lng: null, lat: null });
  });
});

describe("toMapParcelView", () => {
  it("computa el status desde last_fumigation_date", () => {
    // Sin última fumigación → critico (no_history)
    const view1 = toMapParcelView(makeParcel({ id: 1, last_fumigation_date: null }));
    expect(view1.status).toBe("critico");
  });

  it("marca null los campos que DjiParcelRecord no tiene (TODOs documentados)", () => {
    const view = toMapParcelView(makeParcel());
    expect(view.farm_name).toBeNull();
    expect(view.client_name).toBeNull();
    expect(view.municipality).toBeNull();
    // variety se mapea desde crop_type (puede ser null si no está)
    expect(view.variety).toBeNull();
  });

  it("mapea crop_type a variety cuando existe", () => {
    const view = toMapParcelView(makeParcel({ crop_type: "CC 85-92" }));
    expect(view.variety).toBe("CC 85-92");
  });

  it("inicializa events_in_range y ha_in_range en 0", () => {
    const view = toMapParcelView(makeParcel());
    expect(view.events_in_range).toBe(0);
    expect(view.ha_in_range).toBe(0);
  });

  // v2.1 (sprint S6.1 — V0 events map) — los 4 campos del V0 ahora se
  // propagan desde `DjiParcelRecord` si están presentes. Si no, null
  // (no rompe). Estos tests cubren el contrato del sprint.
  it("propaga client_name/farm_name/municipality/variety si vienen en el parcel", () => {
    const view = toMapParcelView(
      makeParcel({
        client_name: "Manuelita",
        farm_name: "Esperanza",
        municipality: "Palmira",
        variety: "CC 01-1940",
        crop_type: "CC 85-92" // se ignora porque variety tiene precedencia
      })
    );
    expect(view.client_name).toBe("Manuelita");
    expect(view.farm_name).toBe("Esperanza");
    expect(view.municipality).toBe("Palmira");
    expect(view.variety).toBe("CC 01-1940");
  });

  it("degrada a null cuando los campos V0 no están seteados (no rompe)", () => {
    const view = toMapParcelView(makeParcel({ crop_type: null }));
    expect(view.client_name).toBeNull();
    expect(view.farm_name).toBeNull();
    expect(view.municipality).toBeNull();
    expect(view.variety).toBeNull();
  });

  it("usa recommended_cadence_days del schedule si está set y > 0", () => {
    // Schedule dice 7 días, pero el field_type es Farmland (default 14).
    // El del schedule gana porque es la cadencia OPERATIVA que el
    // supervisor ajustó manualmente.
    const view = toMapParcelView(
      makeParcel({ field_type: "Farmland", recommended_cadence_days: 7 })
    );
    expect(view.cadence_days).toBe(7);
  });

  it("cae al default por field_type cuando recommended_cadence_days es null/0", () => {
    expect(
      toMapParcelView(makeParcel({ field_type: "Farmland", recommended_cadence_days: null })).cadence_days
    ).toBe(14);
    expect(
      toMapParcelView(makeParcel({ field_type: "Orchards", recommended_cadence_days: 0 })).cadence_days
    ).toBe(10);
  });
});

describe("toMapFumigationEvent", () => {
  it("convierte m² a ha y calcula volume a partir de area * dose", () => {
    const ev = toMapFumigationEvent(
      makeEvent({ area_fumigated_m2: 30000, dose_l_per_ha: 2.0 }),
      { lng: -76.5, lat: 3.5 }
    );
    expect(ev.area_treated_ha).toBe(3);
    expect(ev.volume_l).toBe(6); // 3 ha * 2 L/ha
  });

  it("cuenta flights desde flight_ids", () => {
    const ev = toMapFumigationEvent(
      makeEvent({ flight_ids: [1, 2, 3] }),
      { lng: null, lat: null }
    );
    expect(ev.flights_count).toBe(3);
  });

  it("usa el centroid pasado como lng/lat del evento", () => {
    const ev = toMapFumigationEvent(
      makeEvent(),
      { lng: -76.5, lat: 3.5 }
    );
    expect(ev.lng).toBe(-76.5);
    expect(ev.lat).toBe(3.5);
  });
});

describe("uniqueClients / uniqueFarms", () => {
  it("devuelve clientes únicos ordenados", () => {
    const parcels = [
      { ...makeParcel({ id: 1 }), client_name: "Manuelita" },
      { ...makeParcel({ id: 2 }), client_name: "Providencia" },
      { ...makeParcel({ id: 3 }), client_name: "Manuelita" },
      { ...makeParcel({ id: 4 }), client_name: null }
    ] as never[];
    const result = uniqueClients(parcels);
    expect(result).toEqual(["Manuelita", "Providencia"]);
  });

  it("filtra farms por client cuando el client no es 'todos'", () => {
    const parcels = [
      { ...makeParcel({ id: 1 }), client_name: "Manuelita", farm_name: "Esperanza" },
      { ...makeParcel({ id: 2 }), client_name: "Manuelita", farm_name: "Trapiche" },
      { ...makeParcel({ id: 3 }), client_name: "Providencia", farm_name: "San Isidro" }
    ] as never[];
    expect(uniqueFarms(parcels, "Manuelita")).toEqual(["Esperanza", "Trapiche"]);
    expect(uniqueFarms(parcels, "todos")).toEqual(["Esperanza", "San Isidro", "Trapiche"]);
  });
});

describe("applyParcelFilters", () => {
  const baseView = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    name: "Porvenir",
    farm_name: "Esperanza",
    client_name: "Manuelita",
    municipality: "Palmira",
    variety: "CC 85-92",
    area_ha: 5,
    drone_model_code: 201,
    drone_model_name: "T40",
    centroid_lng: -76.5,
    centroid_lat: 3.5,
    status: "vencido" as const,
    last_fumigation_date: "2026-05-01",
    cadence_days: 14,
    events_in_range: 0,
    ha_in_range: 0,
    ...overrides
  });

  it("devuelve todas las parcelas con filtros vacíos", () => {
    const parcels = [baseView({ id: 1 }), baseView({ id: 2, name: "La Esperanza" })];
    const filtered = applyParcelFilters(parcels, defaultFilterState());
    expect(filtered).toHaveLength(2);
  });

  it("filtra por client cuando client_name coincide", () => {
    const parcels = [
      baseView({ id: 1, client_name: "Manuelita" }),
      baseView({ id: 2, client_name: "Providencia" })
    ];
    const filtered = applyParcelFilters(parcels, {
      ...defaultFilterState(),
      client: "Manuelita"
    });
    expect(filtered.map((p) => p.id)).toEqual([1]);
  });

  it("filtra por status (OR dentro de statuses[])", () => {
    const parcels = [
      baseView({ id: 1, status: "vencido" }),
      baseView({ id: 2, status: "al_dia" }),
      baseView({ id: 3, status: "critico" })
    ];
    const filtered = applyParcelFilters(parcels, {
      ...defaultFilterState(),
      statuses: ["vencido", "critico"]
    });
    expect(filtered.map((p) => p.id).sort()).toEqual([1, 3]);
  });

  it("filtra por query fuzzy sobre name/farm/client/municipality/variety/id", () => {
    const parcels = [
      baseView({ id: 100, name: "Porvenir" }),
      baseView({ id: 200, name: "La Esperanza", farm_name: "Trapiche" }),
      baseView({ id: 300, name: "Otro Lote", variety: "CC 01-1940" })
    ];
    expect(applyParcelFilters(parcels, { ...defaultFilterState(), query: "porve" })).toHaveLength(1);
    expect(applyParcelFilters(parcels, { ...defaultFilterState(), query: "trapiche" })).toHaveLength(1);
    expect(applyParcelFilters(parcels, { ...defaultFilterState(), query: "1940" })).toHaveLength(1);
    expect(applyParcelFilters(parcels, { ...defaultFilterState(), query: "300" })).toHaveLength(1);
  });

  it("no rompe si farm/client son null en todos los parcels", () => {
    const parcels = [
      baseView({ id: 1, farm_name: null, client_name: null }),
      baseView({ id: 2, farm_name: null, client_name: null })
    ];
    const filtered = applyParcelFilters(parcels, {
      ...defaultFilterState(),
      client: "Manuelita"
    });
    // client_name null no coincide con "Manuelita" → quedan vacías
    expect(filtered).toEqual([]);
  });
});

describe("applyEventFilters", () => {
  const make = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    parcel_id: 1,
    executed_at: "2026-07-15",
    source: "manual" as const,
    area_treated_ha: 3,
    volume_l: 6,
    flights_count: 1,
    lng: -76.5,
    lat: 3.5,
    ...overrides
  });

  it("filtra por parcelIds", () => {
    const events = [make({ parcel_id: 1 }), make({ parcel_id: 2 })];
    const filtered = applyEventFilters(events, new Set([1]), [], 0, Infinity);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].parcel_id).toBe(1);
  });

  it("filtra por source (OR dentro de sources[])", () => {
    const events = [make({ source: "manual" }), make({ source: "import" })];
    const filtered = applyEventFilters(
      events,
      new Set([1, 2]),
      ["manual"],
      0,
      Infinity
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe("manual");
  });

  it("filtra por rango temporal [from, to] en ms epoch", () => {
    const events = [
      make({ id: 1, executed_at: "2026-01-15" }),
      make({ id: 2, executed_at: "2026-06-15" }),
      make({ id: 3, executed_at: "2026-12-15" })
    ];
    const from = Date.UTC(2026, 4, 1); // 1 may 2026
    const to = Date.UTC(2026, 8, 30); // 30 sep 2026
    const filtered = applyEventFilters(events, new Set([1]), [], from, to);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(2);
  });
});

describe("aggregateEventsByParcel", () => {
  it("suma count/ha/volume/flights y queda con last=YYYY-MM-DD más reciente", () => {
    const events = [
      {
        id: 1,
        parcel_id: 1,
        executed_at: "2026-06-01",
        source: "manual" as const,
        area_treated_ha: 2,
        volume_l: 4,
        flights_count: 1,
        lng: null,
        lat: null
      },
      {
        id: 2,
        parcel_id: 1,
        executed_at: "2026-07-01",
        source: "manual" as const,
        area_treated_ha: 3,
        volume_l: 6,
        flights_count: 2,
        lng: null,
        lat: null
      },
      {
        id: 3,
        parcel_id: 2,
        executed_at: "2026-05-01",
        source: "import" as const,
        area_treated_ha: 1,
        volume_l: 2,
        flights_count: 1,
        lng: null,
        lat: null
      }
    ];
    const agg = aggregateEventsByParcel(events);
    const p1 = agg.get(1);
    expect(p1).toEqual({
      count: 2,
      ha: 5,
      volume: 10,
      flights: 3,
      last: "2026-07-01"
    });
    expect(agg.get(2)?.count).toBe(1);
  });
});

describe("decorateParcelsWithEvents", () => {
  it("escribe events_in_range y ha_in_range en cada parcela", () => {
    const parcels = [
      { id: 1, name: "P1", events_in_range: 0, ha_in_range: 0 } as never,
      { id: 2, name: "P2", events_in_range: 0, ha_in_range: 0 } as never
    ];
    const agg = new Map([
      [1, { count: 5, ha: 12.34, volume: 0, flights: 0, last: null }],
      [2, { count: 0, ha: 0, volume: 0, flights: 0, last: null }]
    ]);
    const decorated = decorateParcelsWithEvents(parcels, agg);
    expect(decorated[0].events_in_range).toBe(5);
    // ha redondeado a 1 decimal (12.3)
    expect(decorated[0].ha_in_range).toBe(12.3);
    expect(decorated[1].events_in_range).toBe(0);
  });
});

describe("computeKpis", () => {
  it("suma ha/volume/flights y cuenta eventos y parcels distintas", () => {
    const events = [
      {
        id: 1,
        parcel_id: 1,
        executed_at: "2026-07-01",
        source: "manual" as const,
        area_treated_ha: 2.5,
        volume_l: 5,
        flights_count: 1,
        lng: null,
        lat: null
      },
      {
        id: 2,
        parcel_id: 1,
        executed_at: "2026-07-15",
        source: "manual" as const,
        area_treated_ha: 3.2,
        volume_l: 6.4,
        flights_count: 2,
        lng: null,
        lat: null
      },
      {
        id: 3,
        parcel_id: 2,
        executed_at: "2026-07-10",
        source: "import" as const,
        area_treated_ha: 1.1,
        volume_l: 2.2,
        flights_count: 1,
        lng: null,
        lat: null
      }
    ];
    const agg = aggregateEventsByParcel(events);
    const k = computeKpis(events, agg);
    expect(k.events).toBe(3);
    expect(k.ha).toBe(6.8); // 2.5+3.2+1.1
    expect(k.volume).toBe(13.6); // 5+6.4+2.2
    expect(k.flights).toBe(4); // 1+2+1
    expect(k.parcels).toBe(2);
  });
});

describe("sortParcelsByPriority", () => {
  it("ordena por status (más urgente primero) y por count desc", () => {
    const parcels = [
      { id: 1, name: "A", farm_name: null, client_name: null, municipality: null, variety: null, area_ha: null, drone_model_code: null, drone_model_name: null, centroid_lng: null, centroid_lat: null, last_fumigation_date: null, cadence_days: 14, ha_in_range: 0, status: "al_dia" as const, events_in_range: 10 },
      { id: 2, name: "B", farm_name: null, client_name: null, municipality: null, variety: null, area_ha: null, drone_model_code: null, drone_model_name: null, centroid_lng: null, centroid_lat: null, last_fumigation_date: null, cadence_days: 14, ha_in_range: 0, status: "vencido" as const, events_in_range: 1 },
      { id: 3, name: "C", farm_name: null, client_name: null, municipality: null, variety: null, area_ha: null, drone_model_code: null, drone_model_name: null, centroid_lng: null, centroid_lat: null, last_fumigation_date: null, cadence_days: 14, ha_in_range: 0, status: "vencido" as const, events_in_range: 5 },
      { id: 4, name: "D", farm_name: null, client_name: null, municipality: null, variety: null, area_ha: null, drone_model_code: null, drone_model_name: null, centroid_lng: null, centroid_lat: null, last_fumigation_date: null, cadence_days: 14, ha_in_range: 0, status: "critico" as const, events_in_range: 0 }
    ];
    const sorted = sortParcelsByPriority(parcels, CADENCE_STATUS_ORDER);
    expect(sorted.map((p) => p.id)).toEqual([4, 3, 2, 1]);
  });
});

// FIXED_NOW_ISO no se usa directamente (los tests con `last_fumigation_date`
// son deterministas porque `getFumigationStatus` acepta `now` opcional).
void FIXED_NOW_ISO;
