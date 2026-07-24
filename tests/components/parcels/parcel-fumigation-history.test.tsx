// tests/components/parcels/parcel-fumigation-history.test.tsx
//
// Sprint G2 — tests del componente ParcelFumigationHistory.
// Cubre:
//   - Render del resumen anual (12 cards)
//   - Selector de año dispara fetch
//   - Sección de trazabilidad: renderiza fumigaciones con flight_ids
//   - Click expande los flights asociados
//   - Sección de cambios de cadencia: renderiza el history

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockState = vi.hoisted(() => ({
  refreshMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: mockState.refreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/parcels/42",
  useSearchParams: () => new URLSearchParams()
}));

import { ParcelFumigationHistory } from "@/components/parcels/parcel-fumigation-history";
import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 904,
    external_id: "ext-904",
    land_name: "Porvenir",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 4000,
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
    waypoint_count: 10,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-06-17T00:00:00Z",
    ...over
  };
}

const ZERO_SUMMARY = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  count: 0,
  area_total_m2: 0,
  litros_total: 0
}));

const SAMPLE_SUMMARY = [
  { month: 1, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 2, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 3, count: 5, area_total_m2: 50000, litros_total: 12.5 },
  { month: 4, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 5, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 6, count: 3, area_total_m2: 30000, litros_total: 7.5 },
  { month: 7, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 8, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 9, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 10, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 11, count: 0, area_total_m2: 0, litros_total: 0 },
  { month: 12, count: 0, area_total_m2: 0, litros_total: 0 }
];

const SAMPLE_TOTALS = {
  year: 2026,
  count: 8,
  area_total_m2: 80000,
  litros_total: 20,
  productos_unicos: 2
};

const SAMPLE_EVENTS = [
  {
    id: 100,
    parcel_id: 904,
    fumigation_date: "2026-03-15",
    product_used: "Glifosato",
    dose_l_per_ha: 1.0,
    area_fumigated_m2: 10000,
    drone_code_used: 201,
    duration_minutes: 25,
    notes: null,
    human_notes: null,
    recorded_by: "djiag-import",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-03-15T10:00:00Z",
    source: "import" as const,
    flight_ids: [12345, 12346, 12347]
  },
  {
    id: 101,
    parcel_id: 904,
    fumigation_date: "2026-06-10",
    product_used: "Roundup",
    dose_l_per_ha: 1.0,
    area_fumigated_m2: 10000,
    drone_code_used: 201,
    duration_minutes: 25,
    notes: null,
    human_notes: null,
    recorded_by: "Juan",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-06-10T10:00:00Z",
    source: "manual" as const,
    flight_ids: null
  }
];

const SAMPLE_FLIGHT_TRACES: Record<number, Array<{
  id: number;
  start_at: string | null;
  end_at: string | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  area_m2: number | null;
  duration_seconds: number | null;
}>> = {
  100: [
    {
      id: 12345,
      start_at: "2026-03-15T10:00:00Z",
      end_at: "2026-03-15T10:25:00Z",
      drone_nickname: "Agras T40 #1",
      pilot_name: "Juan",
      area_m2: 5000,
      duration_seconds: 1500
    },
    {
      id: 12346,
      start_at: "2026-03-15T10:30:00Z",
      end_at: "2026-03-15T10:55:00Z",
      drone_nickname: "Agras T40 #1",
      pilot_name: "Juan",
      area_m2: 5000,
      duration_seconds: 1500
    }
  ]
};

const SAMPLE_HISTORY = [
  {
    id: 1,
    parcel_id: 904,
    old_cadence_days: 10,
    new_cadence_days: 14,
    old_crop_type: "Frutales",
    new_crop_type: "Caña de azúcar",
    changed_by: "admin@aeroadmin.local",
    reason: null,
    commit_sha: null,
    changed_at: "2026-07-01T12:00:00.000Z"
  },
  {
    id: 2,
    parcel_id: 904,
    old_cadence_days: null,
    new_cadence_days: 10,
    old_crop_type: null,
    new_crop_type: "Frutales",
    changed_by: "backfill",
    reason: "backfill retrospectivo Sprint G2",
    commit_sha: "03461ea",
    changed_at: "2026-06-18T15:50:09.000Z"
  }
];

describe("ParcelFumigationHistory — Sprint G2", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("render: muestra las 3 secciones (resumen, trazabilidad, cambios)", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={SAMPLE_FLIGHT_TRACES}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    expect(screen.getByText("Resumen anual")).toBeInTheDocument();
    expect(screen.getByText("Trazabilidad de fumigaciones del import")).toBeInTheDocument();
    expect(screen.getByText("Cambios de cadencia")).toBeInTheDocument();
  });

  it("resumen anual: renderiza 12 cards (uno por mes)", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const grid = screen.getByTestId("history-month-grid");
    expect(grid.querySelectorAll("li")).toHaveLength(12);
  });

  it("resumen anual: marzo (count=5) y junio (count=3) se ven activos", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const march = screen.getByTestId("history-month-3");
    expect(march.textContent).toMatch(/5/);
    const june = screen.getByTestId("history-month-6");
    expect(june.textContent).toMatch(/3/);
  });

  it("selector de año: muestra el initialYear en el select", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2025}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const select = screen.getByTestId("history-year-select") as HTMLSelectElement;
    expect(select.value).toBe("2025");
  });

  it("selector de año: cambiar el año dispara un fetch al endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        summary: ZERO_SUMMARY,
        totals: { year: 2025, count: 0, area_total_m2: 0, litros_total: 0, productos_unicos: 0 }
      })
    });

    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const select = screen.getByTestId("history-year-select");
    fireEvent.change(select, { target: { value: "2025" } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/parcels/904/fumigation-history?year=2025");
    });
  });

  it("trazabilidad: solo lista fumigaciones con flight_ids", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={SAMPLE_FLIGHT_TRACES}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    // SAMPLE_EVENTS tiene 2 fumigaciones pero solo la #100 (import) tiene
    // flight_ids. La #101 (manual) NO debe aparecer.
    const list = screen.getByTestId("history-traceable-list");
    expect(list.querySelectorAll("li")).toHaveLength(1);
    // El id 100 debe estar, el 101 no
    expect(screen.getByTestId("history-traceable-toggle-100")).toBeInTheDocument();
    expect(screen.queryByTestId("history-traceable-toggle-101")).toBeNull();
  });

  it("trazabilidad: si no hay fumigaciones con flight_ids, muestra empty state", () => {
    const eventsNoTrace = SAMPLE_EVENTS.map((e) => ({ ...e, flight_ids: null }));
    render(
      <ParcelFumigationHistory
        events={eventsNoTrace}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    expect(screen.getByTestId("history-no-traceable")).toBeInTheDocument();
  });

  it("trazabilidad: click en fumigación expande los flights", async () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={SAMPLE_FLIGHT_TRACES}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const toggle = screen.getByTestId("history-traceable-toggle-100");
    fireEvent.click(toggle);
    // Después del click, los flights deben aparecer (vienen pre-cargados
    // en initialFlightTraces, así que no hay fetch).
    await waitFor(() => {
      expect(screen.getByTestId("history-flight-12345")).toBeInTheDocument();
    });
    expect(screen.getByTestId("history-flight-12346")).toBeInTheDocument();
  });

  it("trazabilidad: click en fumigación sin flight cacheados hace fetch", async () => {
    // Sin flight trace pre-cargado para 100
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        flights: [
          {
            id: 99999,
            start_at: "2026-03-15T10:00:00Z",
            end_at: "2026-03-15T10:25:00Z",
            drone_nickname: "Agras T40 #2",
            pilot_name: "Pedro",
            area_m2: 5000,
            duration_seconds: 1500
          }
        ]
      })
    });

    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const toggle = screen.getByTestId("history-traceable-toggle-100");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/fumigations/100/flights");
    });
  });

  it("cambios de cadencia: renderiza los history rows", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    const list = screen.getByTestId("history-changes-list");
    expect(list.querySelectorAll("li")).toHaveLength(2);
  });

  it("cambios de cadencia: muestra diff antes/después", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={SAMPLE_HISTORY}
      />
    );
    // El primer row (más reciente) tiene diff 10d → 14d + Frutales → Caña
    const row = screen.getByTestId("history-change-1");
    expect(row.textContent).toMatch(/10d/);
    expect(row.textContent).toMatch(/14d/);
    expect(row.textContent).toMatch(/Frutales/);
    expect(row.textContent).toMatch(/Caña de azúcar/);
  });

  it("cambios de cadencia: history vacío muestra empty state", () => {
    render(
      <ParcelFumigationHistory
        events={SAMPLE_EVENTS}
        initialFlightTraces={{}}
        initialSummary={SAMPLE_SUMMARY}
        initialTotals={SAMPLE_TOTALS}
        initialYear={2026}
        parcel={makeParcel()}
        scheduleHistory={[]}
      />
    );
    expect(screen.getByTestId("history-no-changes")).toBeInTheDocument();
  });
});
