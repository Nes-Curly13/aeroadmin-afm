// tests/components/admin/parcels/new-parcel-form.test.tsx
//
// Test unitario del form client `NewParcelForm`
// (sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 1).
//
// Cubre:
//   - **Render**: campos requeridos + labels
//   - **Submit sin geometría**: muestra error "Tenés que dibujar el polígono"
//   - **Submit con body incompleto**: muestra error del server
//   - **Submit OK**: redirige a /parcelas/{id} después del 201
//
// El `ParcelDrawer` se mockea porque requiere MapLibre + DOM real (no
// funciona en jsdom). El test verifica el flow del form, no la
// interacción con el mapa (eso se cubre con e2e Playwright).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    refresh: () => mockRefresh()
  })
}));

// Mockear ParcelDrawer: en lugar del mapa real, exponemos un botón
// "fake-set-polygon" que inyecta una geometría válida en el state del
// form. Así podemos testear el submit sin tener un mapa real.
vi.mock("@/components/admin/parcels/parcel-drawer", () => ({
  ParcelDrawer: ({
    onPolygonChange
  }: {
    onPolygonChange: (g: { type: "Polygon"; coordinates: number[][][] } | null) => void;
  }) => (
    <button
      type="button"
      data-testid="fake-drawer"
      onClick={() =>
        onPolygonChange({
          type: "Polygon",
          coordinates: [
            [
              [-76.31, 3.47],
              [-76.30, 3.47],
              [-76.30, 3.48],
              [-76.31, 3.48],
              [-76.31, 3.47]
            ]
          ]
        })
      }
    >
      fake-drawer
    </button>
  )
}));

const { NewParcelForm } = await import("@/components/admin/parcels/new-parcel-form");

const mockFetch = vi.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
});
afterEach(() => {
  global.fetch = originalFetch;
});

function getInput(labelText: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(labelText) as HTMLInputElement;
}

describe("NewParcelForm — render", () => {
  it("renderiza con campos requeridos y labels", () => {
    render(<NewParcelForm />);
    expect(getInput(/Nombre del lote/)).toBeInTheDocument();
    // El type es un FieldSelect (no Input) — verificamos via label
    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    // El drawer mockeado está presente
    expect(screen.getByTestId("fake-drawer")).toBeInTheDocument();
  });
});

describe("NewParcelForm — submit sin geometría", () => {
  it("muestra error si submitea sin haber dibujado el polígono", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({} as Response); // no debería llamarse
    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12");
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/dibujar el polígono/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("NewParcelForm — submit con error del server", () => {
  it("muestra banner rojo con el error", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "land_name es obligatorio" })
    } as Response);

    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toBe("land_name es obligatorio");
  });
});

describe("NewParcelForm — submit OK", () => {
  it("hace POST con body shape esperado y redirige al detalle", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ parcel: { id: 42 } })
    } as Response);

    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12 — Suerte 3");
    await user.type(getInput(/Suerte/), "Suerte 3");
    await user.type(getInput(/Cliente \/ Ingenio/), "Ingenio La Cabaña");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/admin/parcels");
    const body = JSON.parse(init.body as string);
    expect(body.land_name).toBe("Lote 12 — Suerte 3");
    expect(body.luck_name).toBe("Suerte 3");
    expect(body.client_name).toBe("Ingenio La Cabaña");
    expect(body.field_type).toBe("Farmland");
    expect(body.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [-76.31, 3.47],
          [-76.30, 3.47],
          [-76.30, 3.48],
          [-76.31, 3.48],
          [-76.31, 3.47]
        ]
      ]
    });
    // Redirige al detalle
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/parcelas/42");
    });
  });

  it("ignora campos vacíos en el body (los manda como null/los omite)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ parcel: { id: 1 } })
    } as Response);

    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.luck_name).toBeUndefined();
    expect(body.client_name).toBeUndefined();
    expect(body.supervisor_notes).toBeUndefined();
  });
});
