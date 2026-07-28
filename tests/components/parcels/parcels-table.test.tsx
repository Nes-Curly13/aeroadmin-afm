// tests/components/parcels/parcels-table.test.tsx
//
// Tests del ParcelsTable (Sprint v0.1 — port del V0).
// Cubre:
//   - Empty state cuando summaries.length === 0.
//   - Render de una fila por summary.
//   - Cada columna se muestra con los datos correctos.
//   - Sort por cada columna (toggle asc/desc).
//   - Filter por nombre y por hacienda (case-insensitive).
//   - Empty inline cuando el filter no matchea nada.
//   - Link al detalle con href correcto.
//   - Chip de estado con color por severity.
//   - data-slot presente.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ParcelsTable, type ParcelSummary } from "@/components/parcels/parcels-table";
import type { DjiFumigationSchedule, DjiParcelRecord } from "@/lib/types";

// =====================================================================
// Fixtures
// =====================================================================

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Porvenir STE 3",
    location_label: "Finca La Esperanza · Candelaria, Valle del Cauca",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 40_750,
    drone_model_code: 201,
    drone_model_name: "Agras T40 / T50",
    spray_width_m: 5.5,
    work_speed_mps: 5.3,
    optimal_heading_deg: 115.2,
    radar_height_m: 2.8,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2,
    no_spray_zone_m2: 0,
    droplet_size: 1,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: true,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: "",
    source_url_parameter: "",
    source_url_waypoint: "",
    fetched_at: "2026-06-10T17:35:40.925Z",
    last_fumigation_date: null,
    days_since_last_fumigation: null,
    ...over
  };
}

function makeSchedule(parcelId: number, cadence: number, lastDate: string | null = null): DjiFumigationSchedule {
  return {
    parcel_id: parcelId,
    crop_type: "Caña de azúcar",
    recommended_cadence_days: cadence,
    last_fumigation_date: lastDate,
    next_due_date: null,
    is_active: true,
    notes: null
  };
}

function makeSummary(over: Partial<ParcelSummary> = {}): ParcelSummary {
  const parcel = over.parcel ?? makeParcel();
  return {
    parcel,
    schedule: over.schedule ?? makeSchedule(parcel.id, 14, "2026-07-01"),
    status: over.status ?? "ok",
    daysUntilNextDue: over.daysUntilNextDue ?? 5,
    eventsCount: over.eventsCount ?? 3,
    flightsCount: over.flightsCount ?? 12,
    ...over
  };
}

// =====================================================================
// Tests
// =====================================================================

describe("ParcelsTable", () => {
  it("empty state cuando summaries.length === 0", () => {
    render(<ParcelsTable summaries={[]} />);
    const empty = screen.getByTestId("parcels-table-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/aún no hay parcelas/i);
  });

  it("data-slot='parcels-table' presente cuando hay data", () => {
    render(<ParcelsTable summaries={[makeSummary()]} />);
    expect(screen.getByTestId("parcels-table").getAttribute("data-slot")).toBe("parcels-table");
  });

  it("renderiza una fila por summary con las 7 columnas", () => {
    const summaries = [
      makeSummary({ parcel: makeParcel({ id: 1, land_name: "Porvenir" }) }),
      makeSummary({
        parcel: makeParcel({ id: 2, land_name: "El Carmen", location_label: "Finca Sur" }),
        schedule: makeSchedule(2, 10, "2026-06-20")
      })
    ];
    render(<ParcelsTable summaries={summaries} />);
    expect(screen.getByTestId("parcels-table-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("parcels-table-row-2")).toBeInTheDocument();
    // Nombres visibles.
    expect(screen.getByText("Porvenir")).toBeInTheDocument();
    expect(screen.getByText("El Carmen")).toBeInTheDocument();
  });

  it("muestra hacienda desde location_label", () => {
    const summary = makeSummary({
      parcel: makeParcel({ location_label: "Finca La Esperanza · Candelaria" })
    });
    render(<ParcelsTable summaries={[summary]} />);
    expect(screen.getByText(/Finca La Esperanza/)).toBeInTheDocument();
  });

  it("muestra '—' cuando location_label es null", () => {
    const summary = makeSummary({ parcel: makeParcel({ location_label: null }) });
    const { container } = render(<ParcelsTable summaries={[summary]} />);
    const row = screen.getByTestId("parcels-table-row-1");
    // El segundo td (hacienda) debe tener "—".
    const cells = row.querySelectorAll("td");
    expect(cells[1]?.textContent).toBe("—");
    void container;
  });

  it("muestra el área en ha formateada", () => {
    const summary = makeSummary({ parcel: makeParcel({ declared_area_ha: 5.78 }) });
    render(<ParcelsTable summaries={[summary]} />);
    expect(screen.getByText("5.78 ha")).toBeInTheDocument();
  });

  it("muestra la cadencia en días", () => {
    const summary = makeSummary({ schedule: makeSchedule(1, 14) });
    render(<ParcelsTable summaries={[summary]} />);
    expect(screen.getByText("14 d")).toBeInTheDocument();
  });

  it("muestra '—' en cadencia cuando schedule es null", () => {
    const summary = makeSummary({ schedule: null });
    render(<ParcelsTable summaries={[summary]} />);
    const row = screen.getByTestId("parcels-table-row-1");
    const cells = row.querySelectorAll("td");
    expect(cells[3]?.textContent).toBe("—");
  });

  it("muestra la última fumigación formateada", () => {
    const summary = makeSummary({
      parcel: makeParcel({ last_fumigation_date: "2026-07-15" }),
      daysUntilNextDue: 5
    });
    const { container } = render(<ParcelsTable summaries={[summary]} />);
    // La fecha formateada contiene "2026" (formato en-US, no asumimos el día).
    expect(container.textContent).toMatch(/2026/);
  });

  it("muestra 'Sin historial' cuando last_fumigation_date es null", () => {
    const summary = makeSummary({ parcel: makeParcel({ last_fumigation_date: null }) });
    render(<ParcelsTable summaries={[summary]} />);
    expect(screen.getByText("Sin historial")).toBeInTheDocument();
  });

  it("agrega contexto 'vencida hace N d' cuando overdue", () => {
    const summary = makeSummary({
      parcel: makeParcel({ last_fumigation_date: "2026-06-20" }),
      status: "overdue",
      daysUntilNextDue: -7
    });
    const { container } = render(<ParcelsTable summaries={[summary]} />);
    expect(container.textContent).toMatch(/vencida hace 7 d/i);
  });

  it("chip de estado con color por severity (4 estados)", () => {
    const summaries = [
      makeSummary({ parcel: makeParcel({ id: 1 }), status: "overdue" }),
      makeSummary({ parcel: makeParcel({ id: 2 }), status: "due_soon" }),
      makeSummary({ parcel: makeParcel({ id: 3 }), status: "ok" }),
      makeSummary({
        parcel: makeParcel({ id: 4, last_fumigation_date: null }),
        schedule: makeSchedule(4, 14, null),
        status: "no_history"
      })
    ];
    render(<ParcelsTable summaries={summaries} />);
    expect(screen.getByTestId("parcels-table-status-overdue")).toBeInTheDocument();
    expect(screen.getByTestId("parcels-table-status-due-soon")).toBeInTheDocument();
    expect(screen.getByTestId("parcels-table-status-ok")).toBeInTheDocument();
    expect(screen.getByTestId("parcels-table-status-no-history")).toBeInTheDocument();
  });

  it("link a detalle con href /parcels/[id]", () => {
    const summaries = [
      makeSummary({ parcel: makeParcel({ id: 42, land_name: "P42" }) }),
      makeSummary({ parcel: makeParcel({ id: 99, land_name: "P99" }) })
    ];
    render(<ParcelsTable summaries={summaries} />);
    const link42 = screen.getByTestId("parcels-table-detail-link-42");
    expect(link42.getAttribute("href")).toBe("/parcels/42");
    const link99 = screen.getByTestId("parcels-table-detail-link-99");
    expect(link99.getAttribute("href")).toBe("/parcels/99");
  });

  it("contador muestra N de M parcelas", () => {
    const summaries = [
      makeSummary({ parcel: makeParcel({ id: 1 }) }),
      makeSummary({ parcel: makeParcel({ id: 2 }) }),
      makeSummary({ parcel: makeParcel({ id: 3 }) })
    ];
    render(<ParcelsTable summaries={summaries} />);
    const counter = screen.getByTestId("parcels-table-counter");
    expect(counter.textContent).toMatch(/3 de 3 parcelas/);
  });

  describe("Sort", () => {
    it("default: ordena por estado (overdue primero)", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1 }), status: "ok" }),
        makeSummary({ parcel: makeParcel({ id: 2 }), status: "overdue" }),
        makeSummary({ parcel: makeParcel({ id: 3 }), status: "due_soon" })
      ];
      render(<ParcelsTable summaries={summaries} />);
      // Verificamos el orden por position: row-2 (overdue) debe estar antes.
      const rows = screen.getAllByTestId(/^parcels-table-row-/);
      expect(rows[0]?.getAttribute("data-testid")).toBe("parcels-table-row-2");
      expect(rows[1]?.getAttribute("data-testid")).toBe("parcels-table-row-3");
      expect(rows[2]?.getAttribute("data-testid")).toBe("parcels-table-row-1");
    });

    it("click en 'Nombre' ordena alfabéticamente asc", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, land_name: "Zulema" }) }),
        makeSummary({ parcel: makeParcel({ id: 2, land_name: "Alfa" }) }),
        makeSummary({ parcel: makeParcel({ id: 3, land_name: "María" }) })
      ];
      render(<ParcelsTable summaries={summaries} />);
      fireEvent.click(screen.getByTestId("parcels-table-th-name"));
      const rows = screen.getAllByTestId(/^parcels-table-row-/);
      expect(rows[0]?.getAttribute("data-testid")).toBe("parcels-table-row-2"); // Alfa
      expect(rows[1]?.getAttribute("data-testid")).toBe("parcels-table-row-3"); // María
      expect(rows[2]?.getAttribute("data-testid")).toBe("parcels-table-row-1"); // Zulema
    });

    it("click 2 veces en 'Nombre' invierte a desc", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, land_name: "Alfa" }) }),
        makeSummary({ parcel: makeParcel({ id: 2, land_name: "Zulema" }) })
      ];
      render(<ParcelsTable summaries={summaries} />);
      fireEvent.click(screen.getByTestId("parcels-table-th-name"));
      fireEvent.click(screen.getByTestId("parcels-table-th-name"));
      const rows = screen.getAllByTestId(/^parcels-table-row-/);
      expect(rows[0]?.getAttribute("data-testid")).toBe("parcels-table-row-2"); // Zulema
      expect(rows[1]?.getAttribute("data-testid")).toBe("parcels-table-row-1"); // Alfa
    });

    it("click en 'Área' ordena por área desc (default de columnas numéricas)", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, declared_area_ha: 5.78 }) }),
        makeSummary({ parcel: makeParcel({ id: 2, declared_area_ha: 12.5 }) }),
        makeSummary({ parcel: makeParcel({ id: 3, declared_area_ha: 3.2 }) })
      ];
      render(<ParcelsTable summaries={summaries} />);
      fireEvent.click(screen.getByTestId("parcels-table-th-area"));
      const rows = screen.getAllByTestId(/^parcels-table-row-/);
      expect(rows[0]?.getAttribute("data-testid")).toBe("parcels-table-row-2"); // 12.5
      expect(rows[1]?.getAttribute("data-testid")).toBe("parcels-table-row-1"); // 5.78
      expect(rows[2]?.getAttribute("data-testid")).toBe("parcels-table-row-3"); // 3.2
    });

    it("click en 'Última fumigación' ordena por fecha desc (nulls al final)", () => {
      const summaries = [
        makeSummary({
          parcel: makeParcel({ id: 1, last_fumigation_date: "2026-06-15" })
        }),
        makeSummary({
          parcel: makeParcel({ id: 2, last_fumigation_date: "2026-07-15" })
        }),
        makeSummary({
          parcel: makeParcel({ id: 3, last_fumigation_date: null }),
          schedule: makeSchedule(3, 14, null)
        })
      ];
      render(<ParcelsTable summaries={summaries} />);
      fireEvent.click(screen.getByTestId("parcels-table-th-last"));
      const rows = screen.getAllByTestId(/^parcels-table-row-/);
      // 2026-07-15 primero (más reciente), 2026-06-15 segundo, null al final.
      expect(rows[0]?.getAttribute("data-testid")).toBe("parcels-table-row-2");
      expect(rows[1]?.getAttribute("data-testid")).toBe("parcels-table-row-1");
      expect(rows[2]?.getAttribute("data-testid")).toBe("parcels-table-row-3");
    });

    it("atributo aria-sort refleja el estado actual", () => {
      const summaries = [makeSummary({ parcel: makeParcel({ id: 1, land_name: "A" }) })];
      render(<ParcelsTable summaries={summaries} />);
      fireEvent.click(screen.getByTestId("parcels-table-th-name"));
      const th = screen.getByTestId("parcels-table-th-name");
      expect(th.getAttribute("aria-sort")).toBe("ascending");
      fireEvent.click(screen.getByTestId("parcels-table-th-name"));
      expect(th.getAttribute("aria-sort")).toBe("descending");
    });
  });

  describe("Filter", () => {
    it("filtra por nombre (case-insensitive)", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, land_name: "Porvenir" }) }),
        makeSummary({ parcel: makeParcel({ id: 2, land_name: "Lourdes" }) })
      ];
      render(<ParcelsTable summaries={summaries} />);
      const search = screen.getByTestId("parcels-table-search");
      fireEvent.change(search, { target: { value: "PORVENIR" } });
      expect(screen.getByTestId("parcels-table-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("parcels-table-row-2")).toBeNull();
    });

    it("filtra por hacienda (location_label)", () => {
      const summaries = [
        makeSummary({
          parcel: makeParcel({ id: 1, land_name: "X", location_label: "Candelaria" })
        }),
        makeSummary({
          parcel: makeParcel({ id: 2, land_name: "Y", location_label: "Tuluá" })
        })
      ];
      render(<ParcelsTable summaries={summaries} />);
      const search = screen.getByTestId("parcels-table-search");
      fireEvent.change(search, { target: { value: "tuluá" } });
      expect(screen.getByTestId("parcels-table-row-2")).toBeInTheDocument();
      expect(screen.queryByTestId("parcels-table-row-1")).toBeNull();
    });

    it("el filtro es OR: matchea nombre O hacienda", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, land_name: "Porvenir" }) }),
        makeSummary({
          parcel: makeParcel({ id: 2, land_name: "X", location_label: "Porvenir Sur" })
        })
      ];
      render(<ParcelsTable summaries={summaries} />);
      const search = screen.getByTestId("parcels-table-search");
      fireEvent.change(search, { target: { value: "porvenir" } });
      expect(screen.getByTestId("parcels-table-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("parcels-table-row-2")).toBeInTheDocument();
    });

    it("contador refleja el subset filtrado", () => {
      const summaries = [
        makeSummary({ parcel: makeParcel({ id: 1, land_name: "Porvenir" }) }),
        makeSummary({ parcel: makeParcel({ id: 2, land_name: "Lourdes" }) }),
        makeSummary({ parcel: makeParcel({ id: 3, land_name: "Otra" }) })
      ];
      render(<ParcelsTable summaries={summaries} />);
      const search = screen.getByTestId("parcels-table-search");
      fireEvent.change(search, { target: { value: "porvenir" } });
      const counter = screen.getByTestId("parcels-table-counter");
      expect(counter.textContent).toMatch(/1 de 3 parcelas/);
    });

    it("empty state inline cuando el filtro no matchea nada", () => {
      const summaries = [makeSummary({ parcel: makeParcel({ id: 1, land_name: "Porvenir" }) })];
      render(<ParcelsTable summaries={summaries} />);
      const search = screen.getByTestId("parcels-table-search");
      fireEvent.change(search, { target: { value: "zzz_no_existe" } });
      const noMatch = screen.getByTestId("parcels-table-no-matches");
      expect(noMatch).toBeInTheDocument();
      expect(within(noMatch).getByText(/no hay parcelas que coincidan/i)).toBeInTheDocument();
    });
  });
});
