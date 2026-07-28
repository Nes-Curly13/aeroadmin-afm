// Tests del ParcelsList (rail derecho del /map).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ParcelsList } from "@/components/map/parcels-list";
import type { DjiParcelRecord } from "@/lib/types";

const baseParcel: DjiParcelRecord = {
  id: 1,
  external_id: "ext-1",
  land_name: "Porvenir STE 3",
  field_type: "Farmland",
  is_orchard: false,
  spray_geometry: null,
  spray_area_m2: 50000,
  declared_area_ha: 5,
  drone_model_code: null,
  drone_model_name: null,
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
  last_fumigation_date: null
};

const parcelOverdue: DjiParcelRecord = { ...baseParcel, id: 1, land_name: "Porvenir STE 3", last_fumigation_date: "2026-05-01" };
const parcelOk: DjiParcelRecord = { ...baseParcel, id: 2, land_name: "La Esperanza 1", last_fumigation_date: "2026-07-20" };
const parcelNoHistory: DjiParcelRecord = { ...baseParcel, id: 3, land_name: "Sin historial SA", last_fumigation_date: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ParcelsList", () => {
  it("renderiza el aside con aria-label y conteo de parcelas", () => {
    render(<ParcelsList parcels={[]} onSelect={() => {}} selectedId={null} />);
    const aside = screen.getByRole("complementary", { name: "Lista de parcelas en el filtro" });
    expect(aside).toBeInTheDocument();
  });

  it("muestra empty state si no hay parcelas", () => {
    render(<ParcelsList parcels={[]} onSelect={() => {}} selectedId={null} />);
    expect(screen.getByText("No hay parcelas que cumplan los filtros.")).toBeInTheDocument();
  });

  it("renderiza un item por parcela con su nombre", () => {
    render(
      <ParcelsList
        parcels={[parcelOverdue, parcelOk, parcelNoHistory]}
        onSelect={() => {}}
        selectedId={null}
      />
    );
    expect(screen.getByText("Porvenir STE 3")).toBeInTheDocument();
    expect(screen.getByText("La Esperanza 1")).toBeInTheDocument();
    expect(screen.getByText("Sin historial SA")).toBeInTheDocument();
  });

  it("ordena por urgencia (overdue primero)", () => {
    render(
      <ParcelsList
        parcels={[parcelOk, parcelNoHistory, parcelOverdue]}
        onSelect={() => {}}
        selectedId={null}
      />
    );
    const items = screen.getAllByTestId(/^parcels-list-item-/);
    expect(items[0].getAttribute("data-testid")).toBe("parcels-list-item-1"); // overdue
  });

  it("llama onSelect con el id al hacer click en un item", () => {
    const onSelect = vi.fn();
    render(
      <ParcelsList
        parcels={[parcelOverdue, parcelOk]}
        onSelect={onSelect}
        selectedId={null}
      />
    );
    fireEvent.click(screen.getByTestId("parcels-list-item-1"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("llama onSelect con null al click en el item ya seleccionado (toggle)", () => {
    const onSelect = vi.fn();
    render(
      <ParcelsList
        parcels={[parcelOverdue]}
        onSelect={onSelect}
        selectedId={1}
      />
    );
    fireEvent.click(screen.getByTestId("parcels-list-item-1"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("muestra aria-pressed=true en el item seleccionado", () => {
    render(
      <ParcelsList
        parcels={[parcelOverdue, parcelOk]}
        onSelect={() => {}}
        selectedId={2}
      />
    );
    expect(screen.getByTestId("parcels-list-item-2").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("parcels-list-item-1").getAttribute("aria-pressed")).toBe("false");
  });

  it("muestra el header expandido con 'Ver hoja de vida' cuando hay seleccion", () => {
    render(
      <ParcelsList
        parcels={[parcelOverdue]}
        onSelect={() => {}}
        selectedId={1}
      />
    );
    const link = screen.getByTestId("parcels-list-view-detail");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/parcels/1");
  });

  it("muestra el count de fumigaciones cuando se pasa countsByParcel", () => {
    const counts = new Map<number, number>([[1, 12], [2, 3]]);
    render(
      <ParcelsList
        countsByParcel={counts}
        parcels={[parcelOverdue, parcelOk]}
        onSelect={() => {}}
        selectedId={null}
      />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
