// tests/components/admin/fumigations/flight-autofill.test.tsx
//
// Tests del auto-fill del form desde un vuelo DJI seleccionado.
// Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 2.5 (V2) + refactor V3 (Fase 4).
//
// Cambios V3 (Fase 4, 2026-09-08):
//   - El DjiFlightPicker ahora vive en el step 1 ("¿Qué se fumigó?"), no
//     en el step 2 ("Detalles"). El auto-fill ocurre cuando se pickea
//     el flight (en step 1) y se aplica al form cuando se monta (en
//     step 2) via el `pendingFlightData` effect.
//
// Cubre:
//   18. Al pickear un flight en step 1, el form se pre-llena cuando
//       se monta en step 2 (via pendingFlightData)
//   19. Al pickear OTRO flight, el form se actualiza con los nuevos datos
//   20. El hint "Auto-llenado" se muestra en step 1 después de pickear
//
// Estrategia: el mock del form expone un spy de `setFormData` que
// captura todos los calls. El test verifica los args del spy, no el
// render del form.

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

// Helper V3: navega al step 2 con import + flight pickeado
async function goToFormInImportMode(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: tab "Importar vuelo DJI"
  await user.click(screen.getByTestId("tab-import"));
  // Step 1: elegir parcela
  const searchInput = screen.getByPlaceholderText(/buscar/i);
  await user.type(searchInput, "Lote");
  const result = await screen.findByText(/Lote 24/);
  await user.click(result);
  // Step 1: DjiFlightPicker visible
  await waitFor(() => {
    expect(screen.getByTestId("dji-flight-picker")).toBeInTheDocument();
  });
}

// ============================================================
// Auto-fill del form con datos del vuelo DJI (V3)
// ============================================================

describe("NewFumigationPageClient — Auto-fill con vuelo DJI (V3 / Fase 4)", () => {
  it("18. Al pickear un flight en step 1 y avanzar a step 2, setFormData se llama con sus datos derivados", async () => {
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
    // Continuar al step 2
    await user.click(screen.getByTestId("continue-to-como"));
    // El form se monta y el effect empuja el pendingFlightData
    await waitFor(() => {
      expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(setFormDataSpy).toHaveBeenCalled();
    });
    // Buscar la llamada con los datos del flight 1
    const calls = setFormDataSpy.mock.calls;
    const flight1Call = calls.find((call) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.fumigation_date === "2026-09-15";
    });
    expect(flight1Call).toBeDefined();
    const args = flight1Call![0] as Record<string, unknown>;
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
    // Pick flight 2 (reemplaza el pick)
    await user.click(screen.getByTestId("pick-flight-2"));
    // Continuar al step 2
    await user.click(screen.getByTestId("continue-to-como"));
    await waitFor(() => {
      expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(setFormDataSpy).toHaveBeenCalled();
    });
    // La ultima llamada con datos del flight 2 debe tener la fecha 2026-09-10
    const calls = setFormDataSpy.mock.calls;
    const flight2Call = calls.find((call) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.fumigation_date === "2026-09-10";
    });
    expect(flight2Call).toBeDefined();
    const args = flight2Call![0] as Record<string, unknown>;
    expect(args.duration_minutes).toBe("30"); // 1800s / 60
    expect(args.area_fumigated_m2).toBe("8500.00");
  });

  it("20. El hint 'Auto-llenado' se muestra en step 1 después de pickear un flight", async () => {
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
