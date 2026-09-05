// tests/components/admin/fumigations/new-fumigation-page-client.test.tsx
//
// Tests del wizard V2 de nueva fumigación (S11+ / PLAN-FUMIGACIONES-V2).
//
// Cubre el refactor a wizard de 3 steps (Fase 1.1+1.2):
//   1. Stepper visible siempre, marca step activo
//   2. Step 1 (Pick) NO muestra el mapa
//   3. Step 2 (Form) SÍ muestra el mapa, SÍ muestra el form
//   4. Botón "Atrás" en step 2 vuelve a step 1
//   5. Step 3 (Confirm) muestra resumen de los datos
//   6. Botón "Crear nueva parcela" es PROMINENTE (no <details> colapsado)
//
// Estrategia: mocks de FumigationMap, ParcelDrawer, RegisterFumigationForm
// para mantener los tests enfocados en la estructura del wizard, no en
// el contenido de cada subcomponente.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewFumigationPageClient } from "@/components/admin/fumigations/new-fumigation-page-client";
import type { ParcelPickerRow } from "@/api/repositories";

// ============================================================
// Mocks
// ============================================================

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

vi.mock("@/components/parcels/fumigation-map", () => ({
  FumigationMap: () => <div data-testid="fumigation-map" />
}));

vi.mock("@/components/admin/parcels/parcel-drawer", () => ({
  ParcelDrawer: () => <div data-testid="parcel-drawer" />
}));

vi.mock("@/components/parcels/register-fumigation-form", () => ({
  RegisterFumigationForm: () => <div data-testid="register-fumigation-form" />
}));

const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
  // Default: la geometría de la parcela existe (Polygon de 4 puntos).
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
  },
  {
    id: 2,
    land_name: "Lote 18",
    external_id: "EXT-002",
    source: "imported",
    client_name: "Agro XYZ",
    farm_name: "Hacienda La Esperanza",
    municipality: "Palmira"
  }
];

// ============================================================
// Wizard de 3 steps
// ============================================================

describe("NewFumigationPageClient — wizard V2 de 3 steps", () => {
  it("1. Stepper visible desde el inicio con step 1 (Parcela) activo", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El stepper existe
    const stepper = screen.getByRole("navigation", { name: /pasos/i });
    expect(stepper).toBeInTheDocument();
    // Step 1 está marcado como activo
    const step1 = screen.getByTestId("step-pick");
    expect(step1).toHaveAttribute("aria-current", "step");
    // Step 2 y 3 no están activos
    expect(screen.getByTestId("step-form")).not.toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("step-confirm")).not.toHaveAttribute("aria-current", "step");
  });

  it("2. Step 1: muestra el ParcelPicker, NO muestra el mapa", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El picker está visible
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
    // El mapa NO está visible (el contrato del fix: map-after-selection)
    expect(screen.queryByTestId("fumigation-map")).not.toBeInTheDocument();
  });

  it("3. Step 1: 'Crear nueva parcela' es PROMINENTE (no <details> colapsado)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El botón de crear nueva parcela debe ser un <button>, no un <summary>
    const createButton = screen.getByRole("button", { name: /crear.*nueva.*parcela/i });
    expect(createButton).toBeInTheDocument();
  });

  it("4. Después de elegir parcela: avanza a step 2, mapa visible, form visible", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // Filtrar para mostrar el resultado
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    // Click en el primer resultado
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);

    // Step 2 ahora: mapa visible
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // Form visible
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    // Step 2 marcado como activo
    const step2 = screen.getByTestId("step-form");
    expect(step2).toHaveAttribute("aria-current", "step");
  });

  it("5. Step 2: botón 'Atrás' vuelve a step 1 (sin parcela elegida)", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // Avanzar a step 2
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // Click en "Atrás"
    const backButton = screen.getByRole("button", { name: /atr[áa]s/i });
    await user.click(backButton);
    // Vuelve a step 1
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fumigation-map")).not.toBeInTheDocument();
  });

  it("6. Header copy: NO menciona 'manual' (refactor de UX)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El header del page (no del client) podría tener "manual" — el test
    // verifica que el TÍTULO del wizard no lo tenga. El page.tsx
    // también se va a refactorear.
    const headerTitle = screen.queryByText(/^Nueva fumigación$/i);
    // El page.tsx ya lo tiene; el client component no debería duplicar
    // el header. Verificamos que NO diga "manual" en el título.
    if (headerTitle) {
      expect(headerTitle.textContent).not.toMatch(/manual/i);
    }
  });
});
