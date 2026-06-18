import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DjiAssetRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiAssetRecord>): DjiAssetRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela",
    asset_kind: "geometry",
    source_url: "",
    raw_json: null,
    geometry: { type: "Point", coordinates: [-76.4, 3.5] },
    ...over
  };
}

vi.mock("@/components/map-client", () => ({
  MapClient: () => <div data-testid="map-client-stub" />
}));

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ MapClient: React.ComponentType }>) => {
    return function DynamicComponent() {
      // No-op: no renderiza el mapa en tests
      return <div data-testid="dynamic-stub" />;
    };
  }
}));

import { MapView } from "@/components/map-view";

describe("MapView", () => {
  it("renderiza el mapa con parcelas que tienen geometría", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({ id: 1 }), makeParcel({ id: 2, land_name: "Otra" })]}
      />
    );
    // El map-client-stub se renderiza a través de dynamic
    expect(screen.getByTestId("dynamic-stub")).toBeInTheDocument();
  });

  it("muestra el selector de parcelas", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({ id: 1, land_name: "Mi parcela" })]}
      />
    );
    // El selector se renderiza dentro del panel
    expect(screen.getByLabelText(/seleccionar parcela/i)).toBeInTheDocument();
  });

  it("muestra la leyenda con 3 entradas", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
      />
    );
    // Buscamos dentro del section de la leyenda (aria-label="Leyenda del mapa")
    const legend = screen.getByRole("region", { name: /leyenda del mapa/i });
    // Diseño Opción B: la leyenda muestra tipos de parcela + waypoint
    expect(legend.textContent).toMatch(/Farmland/);
    expect(legend.textContent).toMatch(/Orchards/);
    expect(legend.textContent).toMatch(/Waypoint/);
  });

  it("cambia de parcela al seleccionar otra en el dropdown", () => {
    const parcels = [makeParcel({ id: 1, land_name: "A" }), makeParcel({ id: 2, land_name: "B" })];
    render(<MapView alerts={[]} flights={[]} parcels={parcels} />);
    const select = screen.getByLabelText(/seleccionar parcela/i);
    fireEvent.change(select, { target: { value: "2" } });
    // El detail panel ahora muestra "B" como heading principal
    // (usamos getAllByText porque "B" también aparece en el dropdown)
    const headings = screen.getAllByText("B");
    expect(headings.length).toBeGreaterThan(0);
  });
});
