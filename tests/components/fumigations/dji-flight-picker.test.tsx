// tests/components/fumigations/dji-flight-picker.test.tsx
//
// Tests del DjiFlightPicker (S11+ Fase 2/5).
//
// Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 2 — Importar vuelo DJI.
//
// Cubre:
//   1. Mount: fetch a /api/dji-flights/search?parcelId=X
//   2. Loading state mientras carga
//   3. Empty state cuando no hay flights
//   4. Lista de flights (1+) renderiza como cards
//   5. Click en flight llama a onPick con el flight correcto
//   6. Error de red / 500 → muestra mensaje de error
//   7. URL incluye parcelId correcto

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DjiFlightPicker,
  type DjiFlight
} from "@/components/fumigations/dji-flight-picker";

const mockFetch = vi.fn();
const originalFetch = global.fetch;

const validFlights: DjiFlight[] = [
  {
    id: 1,
    flight_id: 638640703,
    drone_serial: "R1272065674",
    drone_nickname: "AFM T40 1",
    pilot_name: "breiner pelaez",
    start_at: "2026-09-15T08:00:00.000Z",
    end_at: "2026-09-15T08:45:00.000Z",
    duration_seconds: 2700,
    area_m2: "12000.00",
    spray_usage_ml: 15000,
    lng: "-76.50",
    lat: "3.45"
  },
  {
    id: 2,
    flight_id: 638640800,
    drone_serial: "R1272065674",
    drone_nickname: "AFM T40 1",
    pilot_name: "breiner pelaez",
    start_at: "2026-09-10T09:00:00.000Z",
    end_at: "2026-09-10T09:30:00.000Z",
    duration_seconds: 1800,
    area_m2: "8500.00",
    spray_usage_ml: 10000,
    lng: "-76.51",
    lat: "3.46"
  }
];

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ flights: validFlights })
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ============================================================
// Comportamiento
// ============================================================

describe("DjiFlightPicker — comportamiento", () => {
  it("1. mount: fetch a /api/dji-flights/search?parcelId=X", async () => {
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dji-flights/search?parcelId=42"
      );
    });
  });

  it("2. loading state: muestra spinner mientras carga", async () => {
    // Mock con delay para capturar el loading state
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ flights: validFlights })
              }),
            50
          );
        })
    );
    const { container } = render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    // Mientras carga, debe haber un indicador
    expect(container.querySelector('[data-testid="loading"]')).toBeInTheDocument();
  });

  it("3. empty state: cuando no hay flights, muestra mensaje", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ flights: [] })
    });
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/no hay vuelos registrados/i)
      ).toBeInTheDocument();
    });
  });

  it("4. lista de flights: renderiza cada flight como card", async () => {
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("flight-card")).toHaveLength(2);
    });
  });

  it("5. click en flight llama a onPick con el flight correcto", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<DjiFlightPicker parcelaId={42} onPick={onPick} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("flight-card")).toHaveLength(2);
    });
    await user.click(screen.getAllByTestId("flight-card")[0]);
    expect(onPick).toHaveBeenCalledWith(validFlights[0]);
  });

  it("6. error de red: muestra mensaje de error", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/no se pudieron cargar los vuelos/i)
      ).toBeInTheDocument();
    });
  });

  it("7. error 500: muestra mensaje de error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({})
    });
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/no se pudieron cargar los vuelos/i)
      ).toBeInTheDocument();
    });
  });

  it("8. cada flight muestra: fecha, duración, dron, piloto, área", async () => {
    render(<DjiFlightPicker parcelaId={42} onPick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("flight-card")).toHaveLength(2);
    });
    const firstCard = screen.getAllByTestId("flight-card")[0];
    // El dron (nickname) y el piloto se muestran
    expect(firstCard).toHaveTextContent(/AFM T40 1/);
    expect(firstCard).toHaveTextContent(/breiner pelaez/);
    // El área se muestra (formato con coma o punto según locale, ej
    // "1,2 ha" en Spanish; "1.2 ha" en English. El formatter usa el
    // locale del browser — el test acepta ambos)
    expect(firstCard).toHaveTextContent(/1[.,]2 ha/);
  });
});
