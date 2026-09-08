// tests/components/admin/fumigations/wizard-form-zod-validation.test.tsx
//
// Tests del wizard con zod validation del FormState.
// Sprint S11+ / zod PR #3 — Quality Gauntlet #1.
// Refactor V3 (Fase 4, 2026-09-08): wizard ahora tiene 3 steps.
//
// Cubre:
//   - `handleRequestReview` valida con `formStateSchema` antes de avanzar
//   - Form invalido → banner de error visible, fase queda en "como"
//   - Form valido → avanza a step 3 (confirm)
//   - Auto-fill del DjiFlightPicker con data invalida se rechaza
//
// Por que este test es valioso:
//   - Antes de PR #3, el operator podia llegar al step 3 (resumen) con
//     data invalida (e.g. `vehicle_plate: "AB"` por error de tipeo).
//     El error se mostraba recien en el POST, con un banner generico.
//   - Despues: el schema zod valida client-side ANTES de mostrar el
//     resumen. El error es especifico al campo (e.g. "vehicle_plate:
//     formato invalido"). Sin round-trip al server.

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

vi.mock("@/components/fumigations/dji-flight-picker", () => ({
  DjiFlightPicker: () => <div data-testid="dji-flight-picker" />
}));

// Mock parametrizado: el test puede setear el form data que devuelve
// `onRequestReview`. Default = valido.
let mockFormData: Record<string, unknown> | null = {
  fumigation_date: "2026-09-15",
  category_id: "",
  application_type_id: "",
  vehicle_plate: "",
  product_used: "Glifosato 48%",
  product_id: null,
  dose_l_per_ha: "2.5",
  area_fumigated_m2: "",
  duration_minutes: "",
  drone_code_used: "0",
  notes: "",
  product_registered_ica: "",
  pilot_license: ""
};

vi.mock("@/components/parcels/register-fumigation-form", async () => {
  const React = await import("react");
  return {
    RegisterFumigationForm: React.forwardRef(function MockForm(
      props: {
        parcelId: number;
        onRequestReview?: (data: Record<string, unknown>) => void;
      },
      ref: React.Ref<{
        getFormData: () => Record<string, unknown> | null;
        triggerSubmit: () => Promise<void>;
      }>
    ) {
      const lastData = React.useRef<Record<string, unknown> | null>(null);
      React.useImperativeHandle(ref, () => ({
        getFormData: () => lastData.current,
        triggerSubmit: () => Promise.resolve()
      }));
      return React.createElement(
        "div",
        { "data-testid": "register-fumigation-form" },
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "mock-review-button",
            onClick: () => {
              lastData.current = mockFormData
                ? { ...mockFormData }
                : null;
              // El form real llama a props.onRequestReview con su state.
              // El mock respeta esto para que el wizard reaccione.
              if (props.onRequestReview && lastData.current) {
                props.onRequestReview(lastData.current);
              }
            }
          },
          "Revisar y confirmar"
        )
      );
    })
  };
});

// ============================================================
// Setup
// ============================================================

const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
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
  // Reset mock form data to valid
  mockFormData = {
    fumigation_date: "2026-09-15",
    category_id: "",
    application_type_id: "",
    vehicle_plate: "",
    product_used: "Glifosato 48%",
    product_id: null,
    dose_l_per_ha: "2.5",
    area_fumigated_m2: "",
    duration_minutes: "",
    drone_code_used: "0",
    notes: "",
    product_registered_ica: "",
    pilot_license: ""
  };
});

afterEach(() => {
  global.fetch = originalFetch;
});

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

// Helper V3: navega del step 1 (que) al step 2 (como) en modo manual.
async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  // Default tab es "manual" — no necesitamos clickearla
  const searchInput = screen.getByPlaceholderText(/buscar/i);
  await user.type(searchInput, "Lote");
  const result = await screen.findByText(/Lote 24/);
  await user.click(result);
  await user.click(screen.getByTestId("continue-to-como"));
  await waitFor(() => {
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
  });
}

// ============================================================
// Tests
// ============================================================

describe("NewFumigationPageClient — zod validation del FormState (zod PR #3, V3 wizard)", () => {
  it("1. Form valido → avanza al step 3 (sin banner de error)", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    // Sin error banner visible
    expect(screen.queryByTestId("form-validation-error")).not.toBeInTheDocument();
    // Estamos en step 3
    expect(screen.getByTestId("step-confirm")).toHaveAttribute("aria-current", "step");
  });

  it("2. Form con vehicle_plate invalido → banner visible, NO avanza", async () => {
    mockFormData = { ...mockFormData!, vehicle_plate: "AB" }; // muy corto
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    // Banner de error visible
    const banner = screen.getByTestId("form-validation-error");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/vehicle_plate/);
    // Seguimos en step 2 (como) — form visible, step-como activo
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    expect(screen.getByTestId("step-como")).toHaveAttribute("aria-current", "step");
    // step 3 NO es current
    expect(screen.getByTestId("step-confirm")).not.toHaveAttribute("aria-current", "step");
  });

  it("3. Form con dose_l_per_ha invalido → banner con field path", async () => {
    mockFormData = { ...mockFormData!, dose_l_per_ha: "-1" }; // negativo
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    const banner = screen.getByTestId("form-validation-error");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/dose_l_per_ha/);
  });

  it("4. Form con product_used vacio → banner, NO avanza", async () => {
    mockFormData = { ...mockFormData!, product_used: "   " }; // whitespace only
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    expect(screen.getByTestId("form-validation-error")).toBeInTheDocument();
    expect(screen.getByTestId("step-como")).toHaveAttribute("aria-current", "step");
  });

  it("5. Form con fumigation_date formato invalido → banner", async () => {
    mockFormData = { ...mockFormData!, fumigation_date: "15/09/2026" }; // formato DD/MM/YYYY
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    const banner = screen.getByTestId("form-validation-error");
    expect(banner.textContent).toMatch(/fumigation_date/);
  });

  it("6. Despues de corregir y volver a 'Revisar', banner desaparece y avanza", async () => {
    // Primer intento: invalido
    mockFormData = { ...mockFormData!, vehicle_plate: "AB" };
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    expect(screen.getByTestId("form-validation-error")).toBeInTheDocument();

    // El operator corrige (el form sigue siendo el mismo componente, asi
    // que la `lastData` del mock es lo que se manda). Simulo la
    // correccion re-seteando `mockFormData` y re-clickeando.
    mockFormData = { ...mockFormData!, vehicle_plate: "ABC-123" };
    await user.click(screen.getByTestId("mock-review-button"));

    // Banner desaparecido, step 3 activo
    await waitFor(() => {
      expect(screen.queryByTestId("form-validation-error")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("step-confirm")).toHaveAttribute("aria-current", "step");
  });

  it("7. Auto-fill con flight introduce vehicle_plate invalido → bloqueado", async () => {
    // Sprint S11+ / zod PR #3 — caso real: el DjiFlightPicker hace
    // setFormData con un plate problematico. El formStateSchema lo
    // rechaza antes de mostrar el resumen.
    mockFormData = { ...mockFormData!, vehicle_plate: "INVALID PLATE" }; // tiene espacio
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    const banner = screen.getByTestId("form-validation-error");
    expect(banner.textContent).toMatch(/vehicle_plate/);
    expect(screen.getByTestId("step-como")).toHaveAttribute("aria-current", "step");
  });

  it("8. Auto-fill con drone_code_used no-numerico → bloqueado", async () => {
    mockFormData = { ...mockFormData!, drone_code_used: "abc" };
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await goToStep2(user);
    await user.click(screen.getByTestId("mock-review-button"));
    const banner = screen.getByTestId("form-validation-error");
    expect(banner.textContent).toMatch(/drone_code_used/);
  });
});
