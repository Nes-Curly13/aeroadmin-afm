// tests/components/admin/parcels/redraw-geometry-button.test.tsx
//
// Test unitario del componente `RedrawGeometryButton`
// (sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2).
//
// Cubre:
//   - **Render**: trigger button visible con label accesible
//   - **Click → abre el dialog**: el ParcelDrawer mockeado aparece
//   - **Submit sin change_reason**: muestra error "Tenés que escribir un motivo"
//   - **Submit con change_reason OK**: hace PATCH con body shape esperado
//     y dispara router.refresh
//   - **Submit con error del server (400)**: muestra banner rojo
//   - **Submit con geometry null**: error si la parcela no tiene geom
//     y el operador no dibujó una nueva
//
// El `ParcelDrawer` se mockea porque requiere MapLibre + DOM real (no
// funciona en jsdom). El flow del dialog y la lógica de submit sí se
// testea — la interacción con el mapa se cubre con e2e (Playwright).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => mockRefresh()
  })
}));

// Mockear ParcelDrawer para que el test no necesite MapLibre. Exponemos
// un botón "fake-set-polygon" que inyecta una geometría válida (similar
// al patrón de new-parcel-form.test.tsx).
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

const { RedrawGeometryButton } = await import(
  "@/components/admin/parcels/redraw-geometry-button"
);

const mockFetch = vi.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
});
afterEach(() => {
  global.fetch = originalFetch;
});

const INITIAL_GEOM = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-76.31, 3.47],
      [-76.30, 3.47],
      [-76.30, 3.48],
      [-76.31, 3.48],
      [-76.31, 3.47]
    ]
  ]
};

const PARCEL_ID = 42;

describe("RedrawGeometryButton — render", () => {
  it("muestra el trigger button con el label correcto", () => {
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    expect(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    ).toBeInTheDocument();
  });

  it("el dialog arranca cerrado (no se ve el drawer mockeado)", () => {
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    expect(screen.queryByTestId("fake-drawer")).not.toBeInTheDocument();
  });
});

describe("RedrawGeometryButton — abrir el dialog", () => {
  it("click en el trigger muestra el dialog con el drawer y la textarea", async () => {
    const user = userEvent.setup();
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    // El dialog de base-ui usa role="dialog" en el Popup. Una vez
    // abierto, el ParcelDrawer mockeado debe estar visible.
    expect(await screen.findByTestId("fake-drawer")).toBeInTheDocument();
    // Y la textarea de change_reason.
    expect(
      screen.getByLabelText(/Motivo del cambio/)
    ).toBeInTheDocument();
    // Y el botón submit.
    expect(
      screen.getByRole("button", { name: /Guardar nueva geometría/ })
    ).toBeInTheDocument();
  });
});

describe("RedrawGeometryButton — submit sin change_reason", () => {
  it("muestra error si submitea sin escribir el motivo", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({} as Response); // no debería llamarse
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    // El drawer está pre-cargado con INITIAL_GEOM, así que no necesitamos
    // tocarlo. Solo submitear el form sin motivo.
    const form = await screen.findByTestId("redraw-geometry-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /motivo para la auditoría/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("RedrawGeometryButton — submit con geometry null", () => {
  it("muestra error si la parcela no tiene geom inicial y el operador tampoco dibujó", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({} as Response);
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={null}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    // Llenar motivo pero no tocar el drawer (simula que la parcela
    // no tiene geom inicial y el operador no dibujó).
    const reason = await screen.findByTestId("redraw-geometry-reason");
    await user.type(reason, "Límite norte incorrecto según catastro 2024");
    const form = screen.getByTestId("redraw-geometry-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/geometría/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("RedrawGeometryButton — submit OK con PATCH", () => {
  it("hace PATCH con body shape esperado y llama router.refresh", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ parcel: { id: PARCEL_ID } })
    } as Response);

    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    // Llenar motivo y submitar el form (geom ya está pre-cargada).
    const reason = await screen.findByTestId("redraw-geometry-reason");
    await user.type(reason, "Geometría de DJI cubre solo la mitad norte");
    const form = screen.getByTestId("redraw-geometry-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/admin/parcels/${PARCEL_ID}/geometry`);
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.geometry).toEqual(INITIAL_GEOM);
    expect(body.change_reason).toBe(
      "Geometría de DJI cubre solo la mitad norte"
    );
  });

  it("al success, el componente llama router.refresh para re-renderizar el detail page", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ parcel: { id: PARCEL_ID } })
    } as Response);

    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    const reason = await screen.findByTestId("redraw-geometry-reason");
    await user.type(reason, "Re-dibujo por catastro 2024");
    const form = screen.getByTestId("redraw-geometry-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("el contador de caracteres refleja la longitud del motivo", async () => {
    const user = userEvent.setup();
    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    const reason = await screen.findByTestId("redraw-geometry-reason");
    const counter = await screen.findByTestId("redraw-geometry-reason-counter");
    expect(counter.textContent).toBe("0 / 500");
    await user.type(reason, "ajuste");
    expect(counter.textContent).toMatch(/6 \/ 500/);
  });
});

describe("RedrawGeometryButton — submit con error del server", () => {
  it("muestra banner rojo con el error del server (4xx)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "change_reason max 500 chars" })
    } as Response);

    render(
      <RedrawGeometryButton
        parcelId={PARCEL_ID}
        currentGeometry={INITIAL_GEOM}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Re-dibujar polígono/ })
    );
    const reason = await screen.findByTestId("redraw-geometry-reason");
    await user.type(reason, "motivo válido pero el server lo rechaza");
    const form = screen.getByTestId("redraw-geometry-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "change_reason max 500 chars"
    );
  });
});
