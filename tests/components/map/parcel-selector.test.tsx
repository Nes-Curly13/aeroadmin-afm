import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ParcelSelector } from "@/components/map/parcel-selector";
import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord>): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela A",
    field_type: "Farmland",
    declared_area_ha: 5.5,
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

const PARCELS: DjiParcelRecord[] = [
  makeParcel({ id: 1, land_name: "Porvenir STE 3", field_type: "Farmland", declared_area_ha: 5.78 }),
  makeParcel({ id: 2, land_name: "Llano Gómez STE 5", field_type: "Orchards", declared_area_ha: 3.2 }),
  makeParcel({ id: 3, land_name: null, field_type: "Farmland", declared_area_ha: null })
];

describe("ParcelSelector", () => {
  it("renderiza las options con formato land_name - field_type - X ha", () => {
    render(<ParcelSelector onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    expect(screen.getByText(/Porvenir STE 3/)).toBeInTheDocument();
    expect(screen.getByText(/5\.78/)).toBeInTheDocument();
  });

  it("marca como selected el id actual", () => {
    render(<ParcelSelector onSelect={() => {}} parcels={PARCELS} selectedId={2} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("2");
  });

  it("invoca onSelect con el id correcto al cambiar", () => {
    const onSelect = vi.fn();
    render(<ParcelSelector onSelect={onSelect} parcels={PARCELS} selectedId={1} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("muestra estado vacío cuando no hay parcelas", () => {
    render(<ParcelSelector onSelect={() => {}} parcels={[]} selectedId={null} />);
    expect(screen.getByText(/no hay parcelas importadas/i)).toBeInTheDocument();
  });

  it("muestra '(sin nombre)' cuando land_name es null", () => {
    render(<ParcelSelector onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    expect(screen.getByText(/\(sin nombre\)/)).toBeInTheDocument();
  });

  it("no muestra sufijo 'ha' cuando declared_area_ha es null", () => {
    const parcelsNoArea = [makeParcel({ id: 1, land_name: "X", declared_area_ha: null })];
    render(<ParcelSelector onSelect={() => {}} parcels={parcelsNoArea} selectedId={1} />);
    const options = screen.getAllByRole("option");
    const text = options[0].textContent ?? "";
    expect(text).not.toMatch(/\d+(\.\d+)?\s*ha/);
  });
});
