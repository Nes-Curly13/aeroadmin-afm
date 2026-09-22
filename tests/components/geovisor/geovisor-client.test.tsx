// tests/components/geovisor/geovisor-client.test.tsx
//
// Tests del geovisor. Refactor 2026-09-21: el sidebar con cajas + card flotante
// + popup MapLibre se unificó en un único `InspectorPanel` con 3 modos
// (Contexto / Parcelas / Fumigaciones). El mapa ya no abre popups.
//
// Cubre:
//   - QA-02: sin filtros de cadencia/cliente/hacienda/drone/source
//   - Rango temporal (Desde / Hasta) y búsqueda de texto
//   - KPIs
//   - Inspector: modos, contexto de parcela, detalle de fumigación, volver
//   - Huérfanas (asignar / ver fumigación)
//   - GeoMap recibe events/parcels correctos
//
// Estrategia: GeoMap es client-only (MapLibre + DOM). Se mockea con un stub
// que registra las props, para verificar qué recibe el mapa sin render real.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// =====================================================================
// Mock de GeoMap
// =====================================================================

const mockGeoMapProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/map/geo-map", () => ({
  GeoMap: (props: Record<string, unknown>) => {
    mockGeoMapProps.push(props);
    return (
      <div
        data-testid="mock-geo-map"
        data-parcel-count={String((props.parcels as unknown[] | undefined)?.length ?? 0)}
        data-event-count={String((props.events as unknown[] | undefined)?.length ?? 0)}
      />
    );
  },
  USE_MAPTILER: false
}));

vi.mock("react-resizable-panels", () => ({
  PanelGroup: (p: { children?: unknown; "data-testid"?: string }) => (
    <div data-testid={p["data-testid"]}>{p.children as never}</div>
  ),
  Panel: (p: { children?: unknown; "data-testid"?: string }) => (
    <div data-testid={p["data-testid"]}>{p.children as never}</div>
  ),
  PanelResizeHandle: () => <div />
}));

// AssignParcelDialog usa useRouter().refresh() — mock para jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

const { GeovisorClient } = await import("@/components/geovisor/geovisor-client");

// =====================================================================
// Fixtures
// =====================================================================

const baseParcel = {
  id: "P-1",
  name: "Lote 12",
  farm_name: "Hacienda El Edén",
  client_name: "Ingenio La Cabaña",
  municipality: "Palmira",
  variety: "CC 85-92",
  area_ha: 10,
  source: "dji" as const,
  drone_model_id: 72 as const,
  centroid_lng: -76.31,
  centroid_lat: 3.47,
  geom: {
    type: "Polygon" as const,
    coordinates: [[
      [-76.31, 3.47],
      [-76.30, 3.47],
      [-76.30, 3.48],
      [-76.31, 3.48],
      [-76.31, 3.47]
    ] as [number, number][]]
  },
  status: "al_dia" as const,
  last_fumigation_at: "2026-08-15T12:00:00Z",
  next_due_at: null,
  cadence_days: 30,
  fumigations_count: 1
};

const baseEvent = {
  id: "F-1",
  parcel_id: "P-1",
  executed_at: "2026-08-15T12:00:00Z",
  source: "manual" as const,
  area_treated_ha: 8.5,
  volume_l: 100,
  flights_count: 1,
  product: "Glifosato",
  operator: "Juan Pérez",
  drone_nickname: "AFM T50-1",
  lng: -76.305,
  lat: 3.475,
  notes: null,
  n_matched_flights: 1
};

const secondParcel = {
  ...baseParcel,
  id: "P-2",
  name: "Lote 13",
  centroid_lng: -76.32,
  centroid_lat: 3.47,
  fumigations_count: 1
};

// Parcela SIN fumigaciones (para el empty state del contexto).
const thirdParcel = {
  ...baseParcel,
  id: "P-3",
  name: "Lote 30",
  farm_name: "Hacienda El Edén",
  fumigations_count: 0,
  last_fumigation_at: null,
  centroid_lng: -76.33,
  centroid_lat: 3.47
};

const secondEvent = {
  ...baseEvent,
  id: "F-2",
  parcel_id: "P-2",
  executed_at: "2026-09-01T08:00:00Z"
};

const oldEvent = {
  ...baseEvent,
  id: "F-0",
  parcel_id: "P-1",
  executed_at: "2024-01-15T10:00:00Z"
};

// 2026-09-20 — fumigación huérfana (sin parcela).
const orphanEvent = {
  ...baseEvent,
  id: "300",
  parcel_id: "null",
  executed_at: "2026-09-05T08:00:00Z",
  needs_parcel_assignment: true,
  assignment_note: "5 vuelos sin parcela (centroide 3.93, -76.27)",
  hull: null,
  lng: -76.33,
  lat: 3.49
};

const buildPayload = () => ({
  parcels: [baseParcel, secondParcel, thirdParcel],
  events: [baseEvent, secondEvent, oldEvent, orphanEvent],
  flight_aggregates: {
    total_flights: 1,
    total_volume_l: 100,
    total_area_ha: 50,
    range_from: "2024-01-01",
    range_to: "2026-12-31"
  }
});

beforeEach(() => {
  mockGeoMapProps.length = 0;
});

// =====================================================================
// QA-02: filtros / inputs / KPIs
// =====================================================================

describe("GeovisorClient — QA-02 simplificación", () => {
  it("no renderiza filtros de cadencia, cliente, hacienda, drone ni source", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.queryByText("Cliente / Ingenio")).not.toBeInTheDocument();
    expect(screen.queryByText("Modelo de dron asignado")).not.toBeInTheDocument();
    expect(screen.queryByText("Estado de cadencia")).not.toBeInTheDocument();
    expect(screen.queryByText("Origen del registro")).not.toBeInTheDocument();
  });

  it("muestra los inputs de rango temporal Desde / Hasta", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.getByTestId("geovisor-from")).toBeInTheDocument();
    expect(screen.getByTestId("geovisor-to")).toBeInTheDocument();
  });

  it("muestra KPIs simplificados", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.getAllByText("Fumigaciones").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Parcelas tratadas")).toBeInTheDocument();
    expect(screen.getByText("Área aplicada")).toBeInTheDocument();
    expect(screen.getByText("Última aplicación")).toBeInTheDocument();
  });
});

// =====================================================================
// Rango temporal / búsqueda
// =====================================================================

describe("GeovisorClient — rango temporal filtra eventos", () => {
  it("filtra eventos fuera del rango Desde/Hasta", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    const fromInput = screen.getByTestId("geovisor-from");
    const toInput = screen.getByTestId("geovisor-to");
    await user.clear(fromInput);
    await user.type(fromInput, "2026-09-01");
    await user.clear(toInput);
    await user.type(toInput, "2026-09-30");
    expect(screen.queryByTestId("geovisor-event-F-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("geovisor-event-F-2")).toBeInTheDocument();
  });
});

describe("GeovisorClient — búsqueda de texto", () => {
  it("filtra parcelas por texto (case-insensitive)", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    const search = screen.getByTestId("geovisor-search");
    await user.type(search, "lote 12");
    expect(screen.getByTestId("geovisor-event-F-1")).toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-2")).not.toBeInTheDocument();
  });
});

// =====================================================================
// Inspector — modos y contexto
// =====================================================================

describe("GeovisorClient — Inspector", () => {
  it("arranca en Fumigaciones y las ordena DESC", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.getByTestId("geovisor-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-tab-fumigaciones")).toHaveAttribute("aria-selected", "true");
    const f2 = screen.getByTestId("geovisor-event-F-2");
    const f1 = screen.getByTestId("geovisor-event-F-1");
    // F-2 (2026-09-01) aparece antes que F-1 (2026-08-15) en el DOM.
    expect(f2.compareDocumentPosition(f1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("el modo Parcelas lista las parcelas", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("inspector-tab-parcelas"));
    expect(screen.getByTestId("geovisor-parcel-P-1")).toBeInTheDocument();
    expect(screen.getByTestId("geovisor-parcel-P-2")).toBeInTheDocument();
  });

  it("contexto vacío cuando no hay selección", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("inspector-tab-contexto"));
    expect(screen.getByTestId("inspector-empty")).toBeInTheDocument();
  });

  it("seleccionar una parcela muestra su ficha y solo SUS fumigaciones", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("inspector-tab-parcelas"));
    await user.click(screen.getByTestId("geovisor-parcel-P-1"));
    expect(screen.getByTestId("inspector-parcel-summary")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("inspector-parcel-summary")).getByText("Lote 12")
    ).toBeInTheDocument();
    // F-1 es de P-1; F-2 es de P-2 → no debe aparecer en el contexto.
    expect(screen.getByTestId("geovisor-event-F-1")).toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-2")).not.toBeInTheDocument();
  });

  it("parcela sin fumigaciones muestra el empty state del contexto", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("inspector-tab-parcelas"));
    await user.click(screen.getByTestId("geovisor-parcel-P-3"));
    expect(screen.getByTestId("inspector-parcel-summary")).toBeInTheDocument();
    expect(screen.getByText(/Sin fumigaciones en el rango/i)).toBeInTheDocument();
  });

  it("seleccionar una fumigación muestra el detalle y 'volver' regresa", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("geovisor-event-F-2"));
    expect(screen.getByTestId("inspector-fumigation-detail")).toBeInTheDocument();
    expect(screen.getByText("Volumen")).toBeInTheDocument();
    expect(screen.getByText("Dron")).toBeInTheDocument();
    await user.click(screen.getByTestId("inspector-back"));
    expect(screen.queryByTestId("inspector-fumigation-detail")).not.toBeInTheDocument();
  });

  it("el detalle de una fumigación con parcela ofrece la hoja de vida", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("geovisor-event-F-1"));
    const btn = screen.getByRole("button", { name: /Ver hoja de vida/i });
    expect(btn).toHaveAttribute("href", "/parcelas/P-1");
  });

  it("cambiar de parcela actualiza las fumigaciones del contexto", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("inspector-tab-parcelas"));
    await user.click(screen.getByTestId("geovisor-parcel-P-1"));
    expect(screen.getByTestId("geovisor-event-F-1")).toBeInTheDocument();
    await user.click(screen.getByTestId("inspector-tab-parcelas"));
    await user.click(screen.getByTestId("geovisor-parcel-P-2"));
    expect(screen.getByTestId("geovisor-event-F-2")).toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-1")).not.toBeInTheDocument();
  });
});

// =====================================================================
// Huérfanas
// =====================================================================

describe("GeovisorClient — fumigaciones huérfanas", () => {
  it("muestra la huérfana en la lista con 'Sin asignar'", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const panel = screen.getByTestId("geovisor-events-panel");
    expect(within(panel).getByTestId("geovisor-event-300")).toBeInTheDocument();
    expect(within(panel).getByText(/Sin asignar/)).toBeInTheDocument();
  });

  it("sin canAssign: no muestra el botón de asignar", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} canAssign={false} />);
    await user.click(screen.getByTestId("geovisor-event-300"));
    expect(screen.queryByTestId("assign-parcel-300")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver detalle de la fumigación/i })).toBeInTheDocument();
  });

  it("con canAssign: muestra el botón de asignar y el link a la fumigación", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} canAssign />);
    await user.click(screen.getByTestId("geovisor-event-300"));
    expect(screen.getByTestId("assign-parcel-300")).toBeInTheDocument();
    const link = screen.getByRole("button", { name: /Ver detalle de la fumigación/i });
    expect(link).toHaveAttribute("href", "/fumigaciones/300");
  });

  it("la huérfana no muestra link a hoja de vida de parcela", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} canAssign />);
    await user.click(screen.getByTestId("geovisor-event-300"));
    expect(screen.queryByRole("button", { name: /Ver hoja de vida/i })).not.toBeInTheDocument();
  });
});

// =====================================================================
// GeoMap props
// =====================================================================

describe("GeovisorClient — GeoMap recibe props correctas", () => {
  it("pasa los eventos filtrados y los parcels al mapa", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const lastProps = mockGeoMapProps[mockGeoMapProps.length - 1];
    const events = lastProps.events as Array<{ id: string }>;
    expect(events.map((e) => e.id)).toContain("F-1");
    expect(events.map((e) => e.id)).toContain("F-2");
    const parcels = lastProps.parcels as Array<{ id: string }>;
    expect(parcels.map((p) => p.id)).toContain("P-1");
    expect(parcels.map((p) => p.id)).toContain("P-2");
  });

  it("pasa is_orphan y assignment_note al mapa para las huérfanas", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const lastProps = mockGeoMapProps[mockGeoMapProps.length - 1];
    const events = lastProps.events as Array<{
      id: string;
      is_orphan?: boolean;
      assignment_note?: string | null;
    }>;
    const orphan = events.find((e) => e.id === "300");
    expect(orphan?.is_orphan).toBe(true);
    expect(orphan?.assignment_note).toContain("5 vuelos sin parcela");
  });
});
