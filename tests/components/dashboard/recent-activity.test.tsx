// tests/components/dashboard/recent-activity.test.tsx
//
// Cobertura del V0 port de RecentActivity:
//   - data-slot="recent-activity" presente.
//   - Renderiza una fila por fumigación.
//   - Empty state cuando no hay fumigaciones.
//   - Link apunta a /parcels/[id] (ruta del proyecto).
//   - Usa land_name del parcel si está en el map; fallback a external_id
//     o "#id" si no.
//   - Muestra ha (area_fumigated_m2/10000), volume_l (ha*dose), flights_count.
//   - Source label (manual/djiscraper/import) se renderiza con texto legible.
//   - formatRelative: helper puro, exportable, determinístico con `now`.
//
// Helper enrichFumigation:
//   - areaHa = m2 / 10000
//   - volumeL = ha * dose (redondeado a 0.1)
//   - flightsCount = flight_ids.length ?? 0
//   - product = product_used ?? "—"
//   - parcelLabel = land_name ?? external_id ?? `#${parcel_id}`

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  RecentActivity,
  enrichFumigation,
  formatRelative
} from "@/components/dashboard/recent-activity";
import type { DjiFumigationEvent, DjiParcelRecord } from "@/lib/types";

const FIXED_NOW = new Date("2026-07-23T12:00:00Z");

function makeEvent(over: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 1,
    parcel_id: 100,
    fumigation_date: "2026-07-20",
    product_used: "Glifosato",
    dose_l_per_ha: 2,
    area_fumigated_m2: 12_500, // 1.25 ha
    drone_code_used: 201,
    duration_minutes: 60,
    notes: null,
    human_notes: null,
    recorded_by: "operator@afm",
    product_registered_ica: "ICA-1234-PN",
    pilot_license: "PCA-12345",
    recorded_at: "2026-07-20T15:00:00Z",
    source: "manual",
    flight_ids: [1, 2, 3],
    ...over
  };
}

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 100,
    external_id: "ext-100",
    land_name: "Parcela Norte",
    field_type: "Farmland",
    declared_area_ha: 1.5,
    spray_area_m2: 12_500,
    drone_model_code: 201,
    drone_model_name: "T40",
    spray_width_m: 5.5,
    work_speed_mps: 6.0,
    optimal_heading_deg: 115,
    radar_height_m: 3.0,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2.0,
    no_spray_zone_m2: 0,
    droplet_size: 320,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 24,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null,
    ...over
  };
}

describe("formatRelative", () => {
  it("devuelve '—' si el input es null/undefined/empty", () => {
    expect(formatRelative(null, FIXED_NOW)).toBe("—");
    expect(formatRelative(undefined, FIXED_NOW)).toBe("—");
    expect(formatRelative("", FIXED_NOW)).toBe("—");
  });

  it("devuelve '—' si el input no es una fecha válida", () => {
    expect(formatRelative("not-a-date", FIXED_NOW)).toBe("—");
  });

  it("< 1 min → 'justo ahora'", () => {
    expect(formatRelative("2026-07-23T11:59:30Z", FIXED_NOW)).toBe("justo ahora");
  });

  it("< 60 min → 'hace N min'", () => {
    expect(formatRelative("2026-07-23T11:30:00Z", FIXED_NOW)).toBe("hace 30 min");
  });

  it("< 24 h → 'hace N h' (sin minutos)", () => {
    expect(formatRelative("2026-07-23T09:00:00Z", FIXED_NOW)).toBe("hace 3 h");
  });

  it("1 día → 'hace 1 día' (singular)", () => {
    expect(formatRelative("2026-07-22T12:00:00Z", FIXED_NOW)).toBe("hace 1 día");
  });

  it("N días → 'hace N días' (plural)", () => {
    expect(formatRelative("2026-07-18T12:00:00Z", FIXED_NOW)).toBe("hace 5 días");
  });

  it("N meses → 'hace N meses'", () => {
    expect(formatRelative("2026-04-23T12:00:00Z", FIXED_NOW)).toBe("hace 3 meses");
  });

  it("1 mes → 'hace 1 mes' (singular)", () => {
    expect(formatRelative("2026-06-23T12:00:00Z", FIXED_NOW)).toBe("hace 1 mes");
  });

  it("N años → 'hace N años'", () => {
    expect(formatRelative("2024-07-23T12:00:00Z", FIXED_NOW)).toBe("hace 2 años");
  });

  it("fecha futura → 'en N ...'", () => {
    // Edge case de TZ
    expect(formatRelative("2026-07-24T12:00:00Z", FIXED_NOW)).toBe("en 1 día");
  });
});

describe("enrichFumigation", () => {
  it("calcula areaHa, volumeL y flightsCount", () => {
    const parcelMap = new Map<number, DjiParcelRecord>([[100, makeParcel()]]);
    const enriched = enrichFumigation(makeEvent(), parcelMap);
    expect(enriched.areaHa).toBe(1.25);
    // volumeL = 1.25 * 2 = 2.5 L
    expect(enriched.volumeL).toBe(2.5);
    expect(enriched.flightsCount).toBe(3);
  });

  it("areaHa es null si area_fumigated_m2 es null", () => {
    const enriched = enrichFumigation(
      makeEvent({ area_fumigated_m2: null }),
      new Map()
    );
    expect(enriched.areaHa).toBeNull();
    expect(enriched.volumeL).toBeNull();
  });

  it("volumeL es null si dose_l_per_ha es null", () => {
    const enriched = enrichFumigation(
      makeEvent({ dose_l_per_ha: null }),
      new Map()
    );
    expect(enriched.volumeL).toBeNull();
  });

  it("flightsCount = 0 si flight_ids es null/undefined", () => {
    const enriched1 = enrichFumigation(makeEvent({ flight_ids: null }), new Map());
    const enriched2 = enrichFumigation(makeEvent({ flight_ids: undefined }), new Map());
    expect(enriched1.flightsCount).toBe(0);
    expect(enriched2.flightsCount).toBe(0);
  });

  it("product = '—' si product_used es null", () => {
    const enriched = enrichFumigation(makeEvent({ product_used: null }), new Map());
    expect(enriched.product).toBe("—");
  });

  it("parcelLabel = land_name del map", () => {
    const parcelMap = new Map<number, DjiParcelRecord>([[100, makeParcel()]]);
    const enriched = enrichFumigation(makeEvent(), parcelMap);
    expect(enriched.parcelLabel).toBe("Parcela Norte");
  });

  it("parcelLabel = external_id si land_name es null", () => {
    const parcelMap = new Map<number, DjiParcelRecord>([
      [100, makeParcel({ land_name: null, external_id: "ext-ABC" })]
    ]);
    const enriched = enrichFumigation(makeEvent(), parcelMap);
    expect(enriched.parcelLabel).toBe("ext-ABC");
  });

  it("parcelLabel = '#id' si la parcela no está en el map", () => {
    const enriched = enrichFumigation(makeEvent({ parcel_id: 999 }), new Map());
    expect(enriched.parcelLabel).toBe("#999");
  });
});

describe("<RecentActivity />", () => {
  it("aplica data-slot='recent-activity' al contenedor", () => {
    const { container } = render(<RecentActivity fumigations={[]} parcelById={new Map()} />);
    expect(container.querySelector('[data-slot="recent-activity"]')).not.toBeNull();
  });

  it("empty state cuando no hay fumigaciones", () => {
    render(<RecentActivity fumigations={[]} parcelById={new Map()} />);
    expect(screen.getByTestId("recent-activity-empty")).toBeInTheDocument();
    expect(screen.getByText(/Sin fumigaciones registradas/i)).toBeInTheDocument();
    expect(screen.queryByTestId("recent-activity-list")).toBeNull();
  });

  it("renderiza una fila por fumigación con data-fumigation-id", () => {
    const events = [
      makeEvent({ id: 1 }),
      makeEvent({ id: 2, parcel_id: 200 })
    ];
    const parcelMap = new Map<number, DjiParcelRecord>([
      [100, makeParcel()],
      [200, makeParcel({ id: 200, land_name: "Otra", external_id: "ext-200" })]
    ]);
    render(<RecentActivity fumigations={events} parcelById={parcelMap} />);
    const items = screen.getAllByTestId(/^recent-activity-item-/);
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("data-fumigation-id")).toBe("1");
    expect(items[1].getAttribute("data-fumigation-id")).toBe("2");
  });

  it("links apuntan a /parcels/[id] (ruta del proyecto, no /parcelas/ del V0)", () => {
    const events = [makeEvent({ id: 7, parcel_id: 42 })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[42, makeParcel({ id: 42 })]])}
      />
    );
    const link = screen.getByTestId("recent-activity-link-7");
    expect(link.getAttribute("href")).toBe("/parcels/42");
  });

  it("renderiza land_name como label del parcel", () => {
    const events = [makeEvent()];
    const parcelMap = new Map([[100, makeParcel({ land_name: "Lote Hermoso" })]]);
    render(<RecentActivity fumigations={events} parcelById={parcelMap} />);
    expect(screen.getByText("Lote Hermoso")).toBeInTheDocument();
  });

  it("renderiza el producto en la línea de metadata", () => {
    const events = [makeEvent({ product_used: "Imidacloprid" })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-product-1").textContent).toBe("Imidacloprid");
  });

  it("renderiza ha con 1 decimal y sufijo 'ha'", () => {
    const events = [makeEvent({ area_fumigated_m2: 8_000 })]; // 0.8 ha
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-ha-1").textContent).toBe("0.8 ha");
  });

  it("renderiza '—' en ha y volume si area_fumigated_m2 es null", () => {
    const events = [makeEvent({ area_fumigated_m2: null, dose_l_per_ha: null })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-ha-1").textContent).toBe("—");
    expect(screen.getByTestId("recent-activity-volume-1").textContent).toBe("—");
  });

  it("renderiza volume_l = ha * dose_l_per_ha con 1 decimal", () => {
    // 1.25 ha * 3 L/ha = 3.75 L
    const events = [makeEvent({ area_fumigated_m2: 12_500, dose_l_per_ha: 3 })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-volume-1").textContent).toBe("3.8 L");
  });

  it("source label: 'manual' → 'Manual'", () => {
    const events = [makeEvent({ source: "manual" })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-source-1").textContent).toBe("Manual");
  });

  it("source label: 'djiscraper' → 'DJI'", () => {
    const events = [makeEvent({ source: "djiscraper" })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map<number, DjiParcelRecord>([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-source-1").textContent).toBe("DJI");
  });

  it("source label: 'import' → 'Import'", () => {
    const events = [makeEvent({ source: "import" })];
    render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map<number, DjiParcelRecord>([[100, makeParcel()]])}
      />
    );
    expect(screen.getByTestId("recent-activity-source-1").textContent).toBe("Import");
  });

  it("renderiza la fecha relativa con el helper formatRelative", () => {
    // 3 días antes del fixed now → "hace 3 días"
    const events = [makeEvent({ fumigation_date: "2026-07-20" })];
    const { container } = render(
      <RecentActivity
        fumigations={events}
        parcelById={new Map([[100, makeParcel()]])}
      />
    );
    const dateEl = screen.getByTestId("recent-activity-date");
    // El helper no usa `now` cuando se llama desde el componente (usa new Date()).
    // No es determinístico — pero podemos al menos verificar que la fecha
    // se renderiza con la forma esperada (hace N ...).
    expect(dateEl.textContent).toMatch(/hace \d+ (min|h|días?)/);
  });

  it("no rompe cuando una fumigación referencia una parcela que no está en el map", () => {
    const events = [makeEvent({ id: 9, parcel_id: 999 })]; // #999
    render(<RecentActivity fumigations={events} parcelById={new Map()} />);
    expect(screen.getByText("#999")).toBeInTheDocument();
    // El link igual debe apuntar al id correcto
    expect(screen.getByTestId("recent-activity-link-9").getAttribute("href")).toBe("/parcels/999");
  });
});
