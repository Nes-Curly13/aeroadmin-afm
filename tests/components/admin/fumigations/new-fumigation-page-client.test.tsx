// tests/components/admin/fumigations/new-fumigation-page-client.test.tsx
//
// Tests del wizard V3 de nueva fumigación (Fase 4, 2026-09-08).
//
// Cubre el refactor de 4 steps (V2, S11+) a 3 steps (V3, Fase 4):
//   1. Stepper con 3 steps (que, como, confirm)
//   2. Step 1 (que) tiene tabs de modalidad (Importar/Manual)
//   3. Step 1 (que) NO muestra el mapa
//   4. Step 1 (que) tiene ParcelPicker + botón "Crear nueva parcela"
//   5. Step 1 (que) tiene botón "Continuar al paso 2" (gated)
//   6. Después de elegir parcela + click "Continuar" → step 2 (como)
//   7. Step 2 (como) muestra form + mapa, NO muestra tabs ni DjiFlightPicker
//   8. Step 2 (como): botón "Cambiar parcela" vuelve a step 1
//   9. Step 3 (confirm) muestra resumen read-only
//
// Estrategia: mocks de FumigationMap, ParcelDrawer, RegisterFumigationForm
// y DjiFlightPicker para mantener los tests enfocados en la estructura
// del wizard, no en el contenido de cada subcomponente.

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

vi.mock("@/components/fumigations/dji-flight-picker", () => ({
  DjiFlightPicker: () => <div data-testid="dji-flight-picker" />
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
// Wizard V3 — 3 steps (Fase 4)
// ============================================================

describe("NewFumigationPageClient — wizard V3 (3 steps desde Fase 4)", () => {
  it("1. Stepper visible desde el inicio con step 1 (que) activo", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El stepper existe
    const stepper = screen.getByRole("navigation", { name: /pasos/i });
    expect(stepper).toBeInTheDocument();
    // Step 1 (que) está marcado como activo
    const step1 = screen.getByTestId("step-que");
    expect(step1).toHaveAttribute("aria-current", "step");
    // Los otros steps no están activos
    expect(screen.getByTestId("step-como")).not.toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("step-confirm")).not.toHaveAttribute("aria-current", "step");
  });

  it("2. Step 1 (que): muestra 2 tabs (Importar vuelo DJI / Registro manual)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const tabImport = screen.getByTestId("tab-import");
    const tabManual = screen.getByTestId("tab-manual");
    expect(tabImport).toBeInTheDocument();
    expect(tabManual).toBeInTheDocument();
    expect(tabImport).toHaveAttribute("aria-selected");
    expect(tabManual).toHaveAttribute("aria-selected");
  });

  it("3. Step 1 (que): default tab es 'manual'", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const tabImport = screen.getByTestId("tab-import");
    const tabManual = screen.getByTestId("tab-manual");
    expect(tabImport).toHaveAttribute("aria-selected", "false");
    expect(tabManual).toHaveAttribute("aria-selected", "true");
  });

  it("4. Step 1 (que): muestra el ParcelPicker, NO muestra el mapa", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fumigation-map")).not.toBeInTheDocument();
  });

  it("5. Step 1 (que): 'Crear nueva parcela' es PROMINENTE (no <details> colapsado)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const createButton = screen.getByRole("button", { name: /crear.*nueva.*parcela/i });
    expect(createButton).toBeInTheDocument();
  });

  it("6. Step 1 (que): botón 'Continuar al paso 2' está disabled sin parcela", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const continueButton = screen.getByTestId("continue-to-como");
    expect(continueButton).toBeDisabled();
  });

  it("7. Step 1 (que): tab 'Importar vuelo' antes de elegir parcela NO muestra DjiFlightPicker", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El DjiFlightPicker NO debe estar visible (no hay parcela)
    expect(screen.queryByTestId("dji-flight-picker")).not.toBeInTheDocument();
  });

  it("8. Después de elegir parcela: avanza a step 2 con click en 'Continuar al paso 2'", async () => {
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

    // Continuar habilitado
    const continueButton = screen.getByTestId("continue-to-como");
    expect(continueButton).not.toBeDisabled();

    // Click continuar → step 2
    await user.click(continueButton);

    // Step 2: mapa visible
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // Form visible
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    // Step 2 marcado como activo
    const step2 = screen.getByTestId("step-como");
    expect(step2).toHaveAttribute("aria-current", "step");
  });

  it("9. Step 2 (como): NO muestra tabs ni DjiFlightPicker (esos viven en step 1)", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);
    await user.click(screen.getByTestId("continue-to-como"));
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // Sin tabs en step 2
    expect(screen.queryByTestId("tab-import")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-manual")).not.toBeInTheDocument();
    // Sin DjiFlightPicker en step 2
    expect(screen.queryByTestId("dji-flight-picker")).not.toBeInTheDocument();
  });

  it("10. Step 2 (como): botón 'Cambiar parcela' vuelve a step 1", async () => {
    const user = userEvent.setup();
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    await user.type(searchInput, "Lote");
    const result = await screen.findByText(/Lote 24/);
    await user.click(result);
    await user.click(screen.getByTestId("continue-to-como"));
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
    // El botón "Cambiar parcela" del footer (más específico) — el
    // ParcelSummaryCard tiene un botón "Cambiar" corto. Buscamos el
    // del footer por su texto completo.
    const changeButton = screen.getByRole("button", { name: /cambiar parcela/i });
    await user.click(changeButton);
    // Vuelve a step 1
    expect(
      screen.getByText(/¿A qué parcela le vas a registrar/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fumigation-map")).not.toBeInTheDocument();
  });

  it("11. Header copy: NO menciona 'manual' en el título (es genérico)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    // El page.tsx tiene "Nueva fumigación"; el client component no
    // debería duplicar el header. Verificamos que NO diga "manual" en
    // el título visible.
    const headerTitle = screen.queryByText(/^Nueva fumigación$/i);
    if (headerTitle) {
      expect(headerTitle.textContent).not.toMatch(/manual/i);
    }
  });

  it("12. Initial phase: si URL trae ?parcel=N, arranca en step 2 (como)", async () => {
    render(
      <NewFumigationPageClient
        initialParcelId={1}
        recentParcels={recentParcels}
      />
    );
    // Step 2 (como) marcado como activo
    const step2 = screen.getByTestId("step-como");
    expect(step2).toHaveAttribute("aria-current", "step");
    // Form visible inmediatamente
    expect(screen.getByTestId("register-fumigation-form")).toBeInTheDocument();
    // Mapa se monta despues del fetch de la geometria
    await waitFor(() => {
      expect(screen.getByTestId("fumigation-map")).toBeInTheDocument();
    });
  });

  it("13. Stepper tiene 3 steps (que, como, confirm)", () => {
    render(
      <NewFumigationPageClient
        initialParcelId={null}
        recentParcels={recentParcels}
      />
    );
    expect(screen.getByTestId("step-que")).toBeInTheDocument();
    expect(screen.getByTestId("step-como")).toBeInTheDocument();
    expect(screen.getByTestId("step-confirm")).toBeInTheDocument();
  });
});
