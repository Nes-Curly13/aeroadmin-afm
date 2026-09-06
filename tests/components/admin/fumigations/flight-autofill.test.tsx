// tests/components/admin/fumigations/flight-autofill.test.tsx
//
// Tests del auto-fill del form desde un vuelo DJI seleccionado.
// Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 2.5 — follow-up PR.
//
// Cubre:
//   18. Al pickear un flight, el form se pre-llena vía setFormData
//   19. Al pickear OTRO flight, se actualiza con los nuevos datos
//   20. El hint "Auto-llenado" se muestra después de pickear un flight
//
// Estrategia: el mock del form expone un spy de `setFormData` que
// captura el último call. El test verifica los args del spy, no el
// render del form (eso lo cubre el form tests).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewFumigationPageClient } from "@/components/admin/fumigations/new-fumigation-page-client";
import type { ParcelPickerRow } from "@/api/repositories";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

vi.mock("@/components/parcels/fumigation-map", () => ({
  FumigationMap: () => <div data-testid="fumigation-map" />
}));

vi.mock("@/components/admin/parcels/parcel-drawer", () => ({
  ParcelDrawer: () => <div data-testid="parcel-drawer" />
}));

// Mock del DjiFlightPicker con 2 flights para que el test pueda
// "pickear" uno y luego el otro.
vi.mock("@/components/fumigations/dji-flight-picker", () => ({
  DjiFlightPicker: ({
    onPick
  }: {
    parcelaId: number;
    onPick: (f: unknown) => void;
  }) => (
    <div data-testid="dji-flight-picker">
      <button
        type="button"
        data-testid="pick-flight-1"
        onClick={() =>
          onPick({
            id: 1,
            flight_id: 638640703,
            drone_nickname: "Agras T40 / T50",
            pilot_name: "breiner pelaez",
            start_at: "2026-09-15T08:00:00.000Z",
            end_at: "2026-09-15T08:45:00.000Z",
            duration_seconds: 2700,
            area_m2: "12000.00",
            spray_usage_ml: 15000,
            lng: "-76.50",
            lat: "3.45"
          })
        }
      >
        Pick flight 1
      </button>
      <button
        type="button"
        data-testid="pick-flight-2"
        onClick={() =>
          onPick({
            id: 2,
            flight_id: 638640800,
            drone_nickname: "Agras T16 / T20",
            pilot_name: "breiner pelaez",
            start_at: "2026-09-10T09:00:00.000Z",
            end_at: "2026-09-10T09:30:00.000Z",
            duration_seconds: 1800,
            area_m2: "8500.00",
            spray_usage_ml: 10000,
            lng: "-76.51",
            lat: "3.46"
          })
        }
      >
        Pick flight 2
      </button>
    </div>
  )
}));

// Mock del form con spy de setFormData via ref.
const setFormDataSpy = vi.fn();
const formDataState: Record<string, unknown> = {};
vi.mock("@/components/parcels/register-fumigation-form", async () => {
  const React = await import("react");
  return {
    RegisterFumigationForm: React.forwardRef(function MockRegisterFumigationForm(
      _props: { parcelId: number; onRequestReview?: (d: unknown) => void },
      ref: React.Ref<{
        getFormData: () => unknown;
        triggerSubmit: () => Promise<void>;
        setFormData: (data: Record<string, unknown>) => void;
      }>
    ) {
      React.useImperativeHandle(ref, () => ({
        getFormData: () => formDataState,
        triggerSubmit: () => Promise.resolve(),
        setFormData: (data: Record<string, unknown>) => {
          // Update the shared state + spy
          Object.assign(formDataState, data);
          setFormDataSpy(data);
        }
      }));
      return (
        <div data-testid="register-fumigation-form">
          <span data-testid="mock-form-rendered" />
        </div>
      );
    })
  };
});

const mockFetch = vi.fn();
const originalFetch = global.fetch;

const recentParcels: ParcelPickerRow[] = [
  {
    id: 1,
    land_name: "Lote 24",
    external_id: "EXT-001",
    source: "manual",
    client_name: "Agro XYZ",
    farm_name: "Hacienda La Esperanza",
    municipality: "Palmira"
  }
];

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
  // Clear the shared form state
  for (const k of Object.keys(formDataState)) delete formDataState[k];
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        parcel: {
          spray_geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-76.5, 3.4],
                [-76.4, 3.4],
                [-76.4, 3.5],
                [-76.5, 3.5],
                [-76.5, 3.4]
              ]
            ]
          }
        }
      })
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Helper: navega del step 0 al step 2 (form) en modo "import"
async function goToFormInImportMode(user: ReturnType<typeof userEvent.setup>) {
  // Step 0: "Importar vuelo"
  await user.click(screen.getByRole("button", { name: /importar vuelo/i }));
  // Step 1: elegir parcela
  const searchInput = screen.getByPlaceholderText(/buscar/i);
  await user.type(searchInput, "Lote");
  const result = await screen.findByText(/Lote 24/);
  await user.click(result);
  await waitFor(() => {
    expect(screen.getByTestId("dji-flight-picker")).toBeInTheDocument();
  });
}

// ============================================================
// Auto-fill del form con datos del vuelo DJI
// ============================================================

describe("NewFumigationPageClient — Auto-fill con vuelo DJI (Fase 2.5 follow-up)", () => {
  it("18. Al pickear un flight, setFormData se llama con sus datos derivados", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToFormInImportMode(user);
    setFormDataSpy.mockClear();
    // Pick flight 1
    await user.click(screen.getByTestId("pick-flight-1"));
    // setFormData fue llamado con los datos derivados del flight
    await waitFor(() => {
      expect(setFormDataSpy).toHaveBeenCalled();
    });
    const args = setFormDataSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(args.fumigation_date).toBe("2026-09-15");
    expect(args.duration_minutes).toBe("45"); // 2700s / 60
    expect(args.area_fumigated_m2).toBe("12000.00");
    expect(args.drone_code_used).toBe("201"); // Agras T40/T50 → id 201
    expect((args.notes as string)).toMatch(/Importado de vuelo DJI #638640703/);
  });

  it("19. Al pickear OTRO flight, setFormData se llama con los nuevos datos", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToFormInImportMode(user);
    // Pick flight 1
    await user.click(screen.getByTestId("pick-flight-1"));
    await waitFor(() => {
      expect(setFormDataSpy).toHaveBeenCalled();
    });
    const firstCall = setFormDataSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall.fumigation_date).toBe("2026-09-15");
    // Pick flight 2
    setFormDataSpy.mockClear();
    await user.click(screen.getByTestId("pick-flight-2"));
    await waitFor(() => {
      expect(setFormDataSpy).toHaveBeenCalled();
    });
    const secondCall = setFormDataSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(secondCall.fumigation_date).toBe("2026-09-10");
    expect(secondCall.duration_minutes).toBe("30"); // 1800s / 60
    expect(secondCall.area_fumigated_m2).toBe("8500.00");
  });

  it("20. El hint 'Auto-llenado' se muestra después de pickear un flight", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToFormInImportMode(user);
    await user.click(screen.getByTestId("pick-flight-1"));
    // El hint debe mencionar el flight_id y "auto-llenado"
    await waitFor(() => {
      expect(
        screen.getByText(/auto-llenado.*638640703/i)
      ).toBeInTheDocument();
    });
  });
});
