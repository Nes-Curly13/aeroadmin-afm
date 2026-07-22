import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "1268692918907510784-flyer-test-uuid",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 4075,
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
    ...over
  };
}

// Mock the dynamic import of ParcelMiniMap (Leaflet no funciona en jsdom)
vi.mock("@/components/parcels/parcel-mini-map", () => ({
  ParcelMiniMap: () => <div data-testid="parcel-mini-map-stub" />
}));

// Mock fetch global para que ParcelEditPanel y CadenceEditor no hagan
// requests reales durante el render en jsdom.
const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
vi.stubGlobal("fetch", fetchMock);

// Mock next/navigation para que useRouter() funcione en jsdom (sin App Router real).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  })
}));

import { ParcelDetail } from "@/components/parcels/parcel-detail";

describe("ParcelDetail", () => {
  it("renderiza el nombre y los chips principales", () => {
    render(<ParcelDetail parcel={makeParcel()} />);
    expect(screen.getByRole("heading", { level: 1, name: /porvenir ste 3/i })).toBeInTheDocument();
    expect(screen.getByText("Farmland")).toBeInTheDocument();
    expect(screen.getByText("Agras T40 / T50")).toBeInTheDocument();
  });

  it("muestra el DJI ID en el header", () => {
    render(<ParcelDetail parcel={makeParcel()} />);
    const code = screen.getByText("1268692918907510784-flyer-test-uuid");
    expect(code).toBeInTheDocument();
  });

  it("renderiza orchard cuando is_orchard=true con el chip correcto", () => {
    render(
      <ParcelDetail
        parcel={makeParcel({
          is_orchard: true,
          field_type: "Orchards",
          land_name: "Mi Orchard"
        })}
      />
    );
    expect(screen.getByRole("heading", { level: 1, name: /mi orchard/i })).toBeInTheDocument();
    expect(screen.getByText("Orchards")).toBeInTheDocument();
  });

  it("muestra comparación de áreas cuando hay declared y spray", () => {
    render(<ParcelDetail parcel={makeParcel({ declared_area_ha: 10, spray_area_m2: 5000 })} />);
    // 5000 m² = 0.5 ha; ratio = 0.05
    expect(screen.getByText(/0\.500 ha/)).toBeInTheDocument();
    expect(screen.getByText(/10\.000 ha/)).toBeInTheDocument();
  });

  it("muestra hints de 'editá para agregar' en la sección Contexto del lote cuando no hay metadata del supervisor", () => {
    render(<ParcelDetail parcel={makeParcel()} />);
    // El render no rompe sin crop_type / planting_date / owner_* / supervisor_notes.
    // Los hints guían al supervisor a completar la metadata.
    expect(screen.getByText(/^cultivo$/i)).toBeInTheDocument();
    expect(screen.getByText(/editá para agregar el cultivo/i)).toBeInTheDocument();
    expect(screen.getByText(/editá para registrar cuándo se plantó/i)).toBeInTheDocument();
    expect(screen.getByText(/editá para agregar el nombre del cañero/i)).toBeInTheDocument();
    expect(screen.getByText(/editá para agregar teléfono o email/i)).toBeInTheDocument();
  });

  it("muestra los valores reales de metadata cuando están poblados", () => {
    render(
      <ParcelDetail
        parcel={makeParcel({
          crop_type: "Caña de azúcar",
          planting_date: "2025-03-15",
          owner_name: "Juan Pérez",
          owner_contact: "+57 300 123 4567",
          location_label: "Palmira, Valle del Cauca",
          supervisor_notes: "Lote con pendiente pronunciada al norte."
        })}
      />
    );
    expect(screen.getByText("Caña de azúcar")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("+57 300 123 4567")).toBeInTheDocument();
    expect(screen.getByText("Palmira, Valle del Cauca")).toBeInTheDocument();
    expect(screen.getByText(/lote con pendiente pronunciada al norte/i)).toBeInTheDocument();
  });

  it("muestra un botón 'Editar' en la sección Contexto del lote", () => {
    render(<ParcelDetail parcel={makeParcel()} />);
    // El test-id existe especificamente para que el botón inline en Contexto
    // se pueda targetear sin confundir con el 'Editar metadata' del header.
    expect(screen.getByTestId("parcel-context-edit-button")).toBeInTheDocument();
  });

  it("al click en 'Editar' de Contexto abre el form (desaparecen los 2 botones y aparece el form)", async () => {
    const user = userEvent.setup();
    render(<ParcelDetail parcel={makeParcel()} />);
    // Inicialmente: AMBOS botones visibles (header + Contexto).
    expect(screen.getByTestId("parcel-context-edit-button")).toBeInTheDocument();
    expect(screen.getByTestId("parcel-edit-metadata-button")).toBeInTheDocument();
    // Form NO visible todavia.
    expect(screen.queryByPlaceholderText(/caña de azúcar, maíz/i)).not.toBeInTheDocument();
    // Click en el botón de Contexto.
    await user.click(screen.getByTestId("parcel-context-edit-button"));
    // Ahora: ambos botones desaparecen (estamos en editing), y el form se
    // renderiza (ParcelEditPanel muestra los inputs).
    expect(screen.queryByTestId("parcel-context-edit-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("parcel-edit-metadata-button")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/caña de azúcar, maíz/i)).toBeInTheDocument();
  });

  it("muestra el placeholder de área cuando no hay declared ni spray", () => {
    render(<ParcelDetail parcel={makeParcel({ declared_area_ha: null, spray_area_m2: 0 })} />);
    expect(screen.getByText(/no hay área declarada ni fumigable/i)).toBeInTheDocument();
  });

  it("muestra los parámetros de aspersión con formato correcto", () => {
    render(<ParcelDetail parcel={makeParcel({ spray_width_m: 5.5, work_speed_mps: 5.3, droplet_size: 1 })} />);
    expect(screen.getByText(/5\.50 m/)).toBeInTheDocument();
    expect(screen.getByText(/5\.30 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/1 µm/)).toBeInTheDocument();
  });

  it("incluye links a /map, /history y / en la sección de acciones", () => {
    render(<ParcelDetail parcel={makeParcel({ id: 42 })} />);
    const mapLink = screen.getByRole("link", { name: /ver en mapa completo/i });
    expect(mapLink).toHaveAttribute("href", "/map");
    const historyLink = screen.getByRole("link", { name: /ver historial operativo/i });
    expect(historyLink).toHaveAttribute("href", "/history");
    const dashboardLink = screen.getByRole("link", { name: /volver al dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });

  it("muestra el waypoint count en el chip del header", () => {
    render(<ParcelDetail parcel={makeParcel({ waypoint_count: 165 })} />);
    expect(screen.getByText(/165 waypoints/i)).toBeInTheDocument();
  });

  it("no muestra el chip de waypoints cuando waypoint_count=0", () => {
    render(<ParcelDetail parcel={makeParcel({ waypoint_count: 0 })} />);
    expect(screen.queryByText(/waypoints/i)).not.toBeInTheDocument();
  });
});
