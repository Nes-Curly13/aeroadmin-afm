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
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

describe("NewParcelForm — Fase 3 secciones", () => {
  it("renderiza las 3 secciones con headers numerados", () => {
    render(<NewParcelForm />);
    // Cada SectionHeader tiene un numero del 1 al 3 dentro del
    // circle del h4. Verificamos los 3 headings.
    expect(
      screen.getByRole("heading", { name: /1\s*Identificación/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /2\s*Tenencia y ubicación/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /3\s*Cultivo/i })
    ).toBeInTheDocument();
  });

  it("cada sección es accesible como role=group con aria-labelledby", () => {
    render(<NewParcelForm />);
    // Los 3 grupos tienen role=group
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBe(3);
    // Cada grupo referencia un heading distinto por aria-labelledby
    const labelledByIds = groups.map((g) => g.getAttribute("aria-labelledby"));
    expect(labelledByIds).toEqual([
      "parcel-section-id",
      "parcel-section-tenure",
      "parcel-section-crop"
    ]);
  });

  it("Sección 1 (Identificación) contiene Nombre, Tipo, Suerte", () => {
    render(<NewParcelForm />);
    const group = screen.getByRole("group", { name: /1\s*Identificación/i });
    expect(within(group).getByLabelText(/Nombre del lote/)).toBeInTheDocument();
    expect(within(group).getByLabelText("Tipo")).toBeInTheDocument();
    expect(within(group).getByLabelText(/Suerte/)).toBeInTheDocument();
  });

  it("Sección 2 (Tenencia) contiene Cliente, Hacienda, Municipio, Propietario, Contacto", () => {
    render(<NewParcelForm />);
    const group = screen.getByRole("group", { name: /2\s*Tenencia y ubicación/i });
    expect(within(group).getByLabelText(/Cliente \/ Ingenio/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/^Hacienda/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/Municipio/)).toBeInTheDocument();
    // "Propietario" aparece en 2 aria-labels (Nombre del propietario,
    // Contacto del propietario) — usamos el unique aria-label completo
    // del campo Propietario.
    expect(within(group).getByLabelText("Nombre del propietario")).toBeInTheDocument();
    expect(within(group).getByLabelText("Contacto del propietario")).toBeInTheDocument();
  });

  it("Sección 3 (Cultivo) contiene Variedad, Cultivo, Fecha, Notas", () => {
    render(<NewParcelForm />);
    const group = screen.getByRole("group", { name: /3\s*Cultivo/i });
    expect(within(group).getByLabelText(/Variedad/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/Tipo de cultivo/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/Fecha de siembra/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/Notas del supervisor/)).toBeInTheDocument();
  });

  it("los 12 campos alfanuméricos están todos presentes (no se perdió ninguno en el refactor)", () => {
    render(<NewParcelForm />);
    // Usamos substring match (sin ^) porque los aria-labels son
    // verbose ("Nombre del propietario", "Contacto del propietario",
    // "Tipo de cultivo", "Notas del supervisor", etc.) y queremos
    // matchear por la keyword visible al usuario.
    const allFields = [
      "Nombre del lote",
      "Tipo",
      "Suerte",
      "Cliente / Ingenio",
      "Hacienda",
      "Municipio",
      "Propietario",
      "Contacto del propietario",
      "Variedad",
      "Tipo de cultivo",
      "Fecha de siembra",
      "Notas del supervisor"
    ];
    for (const label of allFields) {
      expect(
        screen.getByLabelText(label),
        `field "${label}" should be in the document`
      ).toBeInTheDocument();
    }
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

  it("redirige a ?action=fumigar cuando el operador marca 'Fumigar inmediatamente'", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ parcel: { id: 100 } })
    } as Response);

    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote Fumigable");
    await user.click(screen.getByTestId("fake-drawer"));
    // Marcar el checkbox
    const checkbox = screen.getByRole("checkbox", {
      name: /Fumigar inmediatamente después/i
    });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    // Redirige con ?action=fumigar
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/parcelas/100?action=fumigar");
    });
  });

  it("el checkbox está desmarcado por default", () => {
    render(<NewParcelForm />);
    const checkbox = screen.getByRole("checkbox", {
      name: /Fumigar inmediatamente después/i
    });
    expect(checkbox).not.toBeChecked();
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
