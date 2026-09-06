// tests/components/admin/fumigations/step-0-mode.test.tsx
//
// Tests del Step 0 (elección de modalidad) — S11+ Fase 2/5.
//
// Cubre:
//   12. Step 0: 2 cards "Importar vuelo" / "Registro manual"
//   13. Step 0 → "Importar vuelo" → step 1 (pick)
//   14. Step 0 → "Registro manual" → step 1 (pick)
//   15. Stepper muestra 4 steps (modalidad, parcela, detalles, confirmar)
//   16. Step 2 con entryMode="import" muestra el DjiFlightPicker
//   17. Step 2 con entryMode="manual" NO muestra el DjiFlightPicker

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
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

// Mock del DjiFlightPicker para verificar su render condicional.
vi.mock("@/components/fumigations/dji-flight-picker", () => ({
  DjiFlightPicker: ({ parcelaId, onPick }: { parcelaId: number; onPick: (f: unknown) => void }) => (
    <div data-testid="dji-flight-picker" data-parcela-id={parcelaId}>
      <button
        type="button"
        onClick={() => onPick({ id: 1, drone_nickname: "AFM T40 1" })}
      >
        Pick mock flight
      </button>
    </div>
  )
}));

// Mock del form con forwardRef (como el real post-Fase 1.3)
vi.mock("@/components/parcels/register-fumigation-form", async () => {
  const React = await import("react");
  return {
    RegisterFumigationForm: React.forwardRef(function MockRegisterFumigationForm(
      props: { parcelId: number; onRequestReview?: (d: unknown) => void },
      ref: React.Ref<{ getFormData: () => unknown; triggerSubmit: () => Promise<void> }>
    ) {
      const lastData = React.useRef<unknown>(null);
      React.useImperativeHandle(ref, () => ({
        getFormData: () => lastData.current,
        triggerSubmit: () => Promise.resolve()
      }));
      return (
        <div data-testid="register-fumigation-form" data-parcel-id={props.parcelId}>
          {props.onRequestReview ? (
            <button
              type="button"
              data-testid="mock-review-button"
              onClick={() => {
                lastData.current = { fumigation_date: "2026-09-15" };
                props.onRequestReview!(lastData.current);
              }}
            >
              Revisar y confirmar
            </button>
          ) : null}
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

// ============================================================
// Step 0 (modalidad)
// ============================================================

describe("NewFumigationPageClient — Step 0 (Fase 2/5)", () => {
  it("12. Step 0: muestra 2 cards (Importar vuelo / Registro manual)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    expect(
      screen.getByRole("button", { name: /importar vuelo/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /registro manual/i })
    ).toBeInTheDocument();
  });

  it("13. Step 0 → 'Importar vuelo' → step 1 (pick)", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await user.click(screen.getByRole("button", { name: /importar vuelo/i }));
    // El picker de parcelas debe estar visible
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
  });

  it("14. Step 0 → 'Registro manual' → step 1 (pick)", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    await user.click(screen.getByRole("button", { name: /registro manual/i }));
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
  });

  it("15. Stepper muestra 4 steps (modalidad, parcela, detalles, confirmar)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El stepper tiene 4 steps visibles
    expect(screen.getByTestId("step-mode")).toBeInTheDocument();
    expect(screen.getByTestId("step-pick")).toBeInTheDocument();
    expect(screen.getByTestId("step-form")).toBeInTheDocument();
    expect(screen.getByTestId("step-confirm")).toBeInTheDocument();
  });

  it("16. Step 2 con entryMode='import' (post-#51) muestra el DjiFlightPicker", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // Click en "Importar vuelo"
    await user.click(screen.getByRole("button", { name: /importar vuelo/i }));
    // Elegir parcela
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // El DjiFlightPicker debe estar visible
    expect(screen.getByTestId("dji-flight-picker")).toBeInTheDocument();
  });

  it("17. Step 2 con entryMode='manual' NO muestra el DjiFlightPicker", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // Click en "Registro manual"
    await user.click(screen.getByRole("button", { name: /registro manual/i }));
    // Elegir parcela
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // El DjiFlightPicker NO debe estar visible
    expect(screen.queryByTestId("dji-flight-picker")).not.toBeInTheDocument();
    // El form sí
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
  });
});
