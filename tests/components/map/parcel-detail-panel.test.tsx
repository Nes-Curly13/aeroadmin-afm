import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ParcelDetailPanel } from "@/components/map/parcel-detail-panel";
import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord>): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 2502.96,
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
    fetched_at: "2026-06-17T00:00:00Z",
    ...over
  };
}

describe("ParcelDetailPanel", () => {
  it("muestra mensaje de selección cuando parcel es null", () => {
    render(<ParcelDetailPanel flightsCount={0} highAlertsCount={0} parcel={null} />);
    expect(screen.getByText(/seleccione una parcela/i)).toBeInTheDocument();
  });

  it("renderiza el land_name como badge", () => {
    render(
      <ParcelDetailPanel flightsCount={0} highAlertsCount={0} parcel={makeParcel({})} />
    );
    expect(screen.getByText("Porvenir STE 3")).toBeInTheDocument();
  });

  it("renderiza el field_type como heading", () => {
    render(<ParcelDetailPanel flightsCount={0} highAlertsCount={0} parcel={makeParcel({})} />);
    expect(screen.getByRole("heading", { name: /farmland/i })).toBeInTheDocument();
  });

  it("muestra todas las métricas de la parcela", () => {
    render(<ParcelDetailPanel flightsCount={0} highAlertsCount={0} parcel={makeParcel({})} />);
    expect(screen.getByText(/5\.78 ha/)).toBeInTheDocument();
    expect(screen.getByText(/Agras T40/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument(); // waypoint count
  });

  it("muestra '—' cuando spray_area_m2 es null", () => {
    render(
      <ParcelDetailPanel
        flightsCount={0}
        highAlertsCount={0}
        parcel={makeParcel({ spray_area_m2: null })}
      />
    );
    // Buscar el label "Spray area" y verificar que el value es "—"
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("muestra '—' cuando drone_model_name es null", () => {
    render(
      <ParcelDetailPanel
        flightsCount={0}
        highAlertsCount={0}
        parcel={makeParcel({ drone_model_name: null })}
      />
    );
    // Hay varios "—" en este caso (porque spray_area_m2 también puede ser null)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("muestra flightsCount y highAlertsCount en la sección resumen", () => {
    render(<ParcelDetailPanel flightsCount={15} highAlertsCount={7} parcel={makeParcel({})} />);
    // El valor "15" puede estar en varias celdas, usamos getAllByText
    expect(screen.getAllByText("15").length).toBeGreaterThan(0);
    // "7" es único del highAlertsCount
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("marca la parcela como Orchard cuando is_orchard es true", () => {
    const orchard = makeParcel({ is_orchard: true, field_type: "Orchards" });
    render(<ParcelDetailPanel flightsCount={0} highAlertsCount={0} parcel={orchard} />);
    expect(screen.getByText(/orchard/i)).toBeInTheDocument();
  });
});
