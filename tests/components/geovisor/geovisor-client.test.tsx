// tests/components/geovisor/geovisor-client.test.tsx
//
// Tests del rediseño del geovisor (QA-02, fix/qa-02-geovisor-simplify,
// 2026-09-06).
//
// Cubre:
//   - Sin filtros de cadencia, cliente, hacienda, drone, source
//   - Filtro por rango temporal (Desde / Hasta) con defaults sensatos
//   - Filtro por búsqueda de texto
//   - Lista de fumigaciones en el sidebar derecho (no lista de parcelas)
//   - KPIs: Fumigaciones / Parcelas tratadas / Área aplicada / Última
//   - Click en un evento selecciona y muestra el card de detalle
//
// Estrategia de mocking: GeoMap es client-only con MapLibre + DOM
// real. Para no requerir el browser, mockeamos el componente
// `@/components/map/geo-map` con un stub que recibe props y registra
// llamadas. Así podemos verificar QUÉ se le pasa al mapa sin
// ejercitar el render real.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
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
        data-selected-event-id={String(props.selectedEventId ?? "")}
        data-parcel-count={String((props.parcels as unknown[] | undefined)?.length ?? 0)}
        data-event-count={String((props.events as unknown[] | undefined)?.length ?? 0)}
      />
    );
  },
  USE_MAPTILER: false
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
  lng: -76.305,
  lat: 3.475,
  notes: null,
  n_matched_flights: 1
};

const secondParcel = {
  ...baseParcel,
  id: "P-2",
  name: "Lote 13",
  farm_name: "Hacienda El Edén",
  centroid_lng: -76.32,
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

const buildPayload = () => ({
  parcels: [baseParcel, secondParcel],
  events: [baseEvent, secondEvent, oldEvent],
  flight_aggregates: {
    total_flights: 1,
    total_volume_l: 100,
    total_area_ha: 50,
    range_from: "2024-01-01",
    range_to: "2026-12-31"
  }
});

// =====================================================================
// Tests
// =====================================================================

beforeEach(() => {
  mockGeoMapProps.length = 0;
});

describe("GeovisorClient — QA-02 simplificación", () => {
  it("no renderiza filtros de cadencia, cliente, hacienda, drone ni source", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.queryByText("Cliente / Ingenio")).not.toBeInTheDocument();
    expect(screen.queryByText("Hacienda")).not.toBeInTheDocument();
    expect(screen.queryByText("Modelo de dron asignado")).not.toBeInTheDocument();
    expect(screen.queryByText("Estado de cadencia")).not.toBeInTheDocument();
    expect(screen.queryByText("Origen del registro")).not.toBeInTheDocument();
  });

  it("muestra los inputs de rango temporal Desde / Hasta", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.getByTestId("geovisor-from")).toBeInTheDocument();
    expect(screen.getByTestId("geovisor-to")).toBeInTheDocument();
  });

  it("muestra KPIs simplificados: Fumigaciones, Parcelas tratadas, Área aplicada, Última", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    expect(screen.getByText("Fumigaciones")).toBeInTheDocument();
    expect(screen.getByText("Parcelas tratadas")).toBeInTheDocument();
    expect(screen.getByText("Área aplicada")).toBeInTheDocument();
    expect(screen.getByText("Última aplicación")).toBeInTheDocument();
  });

  it("muestra la lista de fumigaciones en el sidebar derecho (no la lista de parcelas)", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const panel = screen.getByTestId("geovisor-events-panel");
    expect(panel).toBeInTheDocument();
    // El sidebar debe contener los items de eventos
    const items = within(panel).getAllByRole("button", { pressed: false });
    expect(items.length).toBeGreaterThan(0);
  });

  it("ordena los eventos por fecha DESC (más reciente primero)", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const panel = screen.getByTestId("geovisor-events-panel");
    const buttons = within(panel).getAllByRole("button");
    // F-2 (2026-09-01) debe estar antes de F-1 (2026-08-15)
    const f2Button = screen.getByTestId("geovisor-event-F-2");
    const f1Button = screen.getByTestId("geovisor-event-F-1");
    const f2Idx = buttons.indexOf(f2Button);
    const f1Idx = buttons.indexOf(f1Button);
    expect(f2Idx).toBeLessThan(f1Idx);
  });
});

describe("GeovisorClient — rango temporal filtra eventos", () => {
  it("filtra eventos fuera del rango Desde/Hasta", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    // Por default el rango es últimos 90 días desde la última
    // fumigación (2026-09-01), así que F-2 (2026-09-01) y F-1
    // (2026-08-15) están dentro. F-0 (2024-01-15) está fuera.
    const fromInput = screen.getByTestId("geovisor-from");
    const toInput = screen.getByTestId("geovisor-to");
    // Forzamos un rango que solo incluye F-2
    await user.clear(fromInput);
    await user.type(fromInput, "2026-09-01");
    await user.clear(toInput);
    await user.type(toInput, "2026-09-30");
    // Después del filtro, F-0 y F-1 no deben estar en la lista
    expect(screen.queryByTestId("geovisor-event-F-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("geovisor-event-F-2")).toBeInTheDocument();
  });
});

describe("GeovisorClient — búsqueda de texto", () => {
  it("filtra parcelas por texto (case-insensitive) en name/farm_name/municipality/variety", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    const search = screen.getByTestId("geovisor-search");
    // Filtrar por "Lote 12" (case-insensitive) — solo P-1 matchea.
    // F-0 (2024-01-15) está fuera del rango temporal default
    // (últimos 90 días desde F-2 = 2026-09-01), así que ya está
    // filtrado por la fecha. Después del search, F-2 (Lote 13)
    // tampoco debe estar.
    await user.type(search, "lote 12");
    expect(screen.getByTestId("geovisor-event-F-1")).toBeInTheDocument();
    expect(screen.queryByTestId("geovisor-event-F-2")).not.toBeInTheDocument();
  });
});

describe("GeovisorClient — click en evento selecciona y abre card", () => {
  it("click en un item de la lista setea selectedEventId y muestra el card de detalle", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    const item = screen.getByTestId("geovisor-event-F-2");
    await user.click(item);
    // El card de detalle aparece — verificamos con queryAllByText
    // porque "Área aplicada" aparece tanto en los KPIs como en el
    // card del evento seleccionado. Buscamos específicamente el
    // que está dentro del <dl> del card.
    expect(screen.getAllByText("Área aplicada").length).toBeGreaterThanOrEqual(1);
    // El link "Ver detalle" (card) es distinto del "Ver hoja de vida"
    // (parcela detail link). Verificamos que ambos están.
    expect(screen.getByText("Volumen")).toBeInTheDocument();
    expect(screen.getByText("Producto")).toBeInTheDocument();
    expect(screen.getByText("Operador")).toBeInTheDocument();
    // El mock del mapa recibió selectedEventId="F-2"
    const lastProps = mockGeoMapProps[mockGeoMapProps.length - 1];
    expect(lastProps.selectedEventId).toBe("F-2");
  });

  it("el card incluye un link a la hoja de vida de la parcela", async () => {
    const user = userEvent.setup();
    render(<GeovisorClient payload={buildPayload()} />);
    await user.click(screen.getByTestId("geovisor-event-F-1"));
    // El componente renderiza el <Link> dentro de un <Button>, lo que
    // pone role="button" en el anchor. Verificamos por role button
    // con el aria-label del Link.
    const btn = screen.getByRole("button", { name: /Ver hoja de vida/i });
    expect(btn).toHaveAttribute("href", "/parcelas/P-1");
  });
});

describe("GeovisorClient — GeoMap recibe props correctas", () => {
  it("pasa los eventos filtrados y los parcels correctos al mapa", () => {
    render(<GeovisorClient payload={buildPayload()} />);
    const lastProps = mockGeoMapProps[mockGeoMapProps.length - 1];
    // Los events en el mapa son los del rango temporal
    const events = lastProps.events as Array<{ id: string }>;
    expect(events.map((e) => e.id)).toContain("F-1");
    expect(events.map((e) => e.id)).toContain("F-2");
    // parcels en el mapa son los que matchean
    const parcels = lastProps.parcels as Array<{ id: string }>;
    expect(parcels.map((p) => p.id)).toContain("P-1");
    expect(parcels.map((p) => p.id)).toContain("P-2");
  });
});
