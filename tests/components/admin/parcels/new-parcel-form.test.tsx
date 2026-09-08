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
  // Sprint S11+ / Fase 3.2 — el form hace fetch de `/api/admin/clients`
  // y `/api/admin/farms?clientId=X` al mount. Por default mockeamos
  // respuestas con listas vacias. Los tests especificos que esperan
  // un parcel POST pueden sobrescribir el default con
  // `mockFetch.mockImplementation` (NO `mockResolvedValueOnce` — ese
  // seria consumido por el catalog fetch).
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.startsWith("/api/admin/clients")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ clients: [] })
      });
    }
    if (typeof url === "string" && url.startsWith("/api/admin/farms")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ farms: [] })
      });
    }
    // Default para parcel POST: success generico. Tests que esperan
    // error/redirect especifico sobrescriben este branch.
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ parcel: { id: 1 } })
    });
  });
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
    // Sprint S11+ / Fase 3.2 — Cliente y Hacienda son SELECTs del
    // catalog. Sus aria-labels son "Cliente o ingenio" y "Nombre de
    // la hacienda" (los del FieldSelect, no los del wrapper label).
    expect(within(group).getByLabelText("Cliente o ingenio")).toBeInTheDocument();
    expect(within(group).getByLabelText("Nombre de la hacienda")).toBeInTheDocument();
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
    // Sprint S11+ / Fase 3.2 — Cliente y Hacienda son ahora SELECTs
    // del catálogo (con fallback de texto libre). Mantenemos el
    // label "Cliente / Ingenio" accesible via aria-label, y "Hacienda"
    // igual. El resto de los campos sigue igual.
    const allFields = [
      "Nombre del lote",
      "Tipo",
      "Suerte",
      "Cliente o ingenio", // select del catalog (Fase 3.2)
      "Nombre de la hacienda", // select del catalog (Fase 3.2)
      "Municipio",
      "Nombre del propietario",
      "Contacto del propietario",
      "Variedad de caña",
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
    // Sprint S11+ / Fase 3.2 — el form hace catalog fetch al mount
    // (1 call a /api/admin/clients). El parcel POST NO debería
    // ejecutarse porque falta la geometría.
    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12");
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/dibujar el polígono/);
    // Solo se llamó al catalog fetch, NO al parcel POST
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toMatch(/^\/api\/admin\/clients/);
  });
});

describe("NewParcelForm — submit con error del server", () => {
  it("muestra banner rojo con el error", async () => {
    const user = userEvent.setup();
    // Sobrescribimos el default de parcel POST a error. El catalog
    // fetch sigue mockeado en beforeEach via mockImplementation
    // (rama `/api/admin/clients`).
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [] })
        });
      }
      if (typeof url === "string" && url === "/api/admin/parcels") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: "land_name es obligatorio" })
        });
      }
      return Promise.resolve({} as Response);
    });

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
    // Sobrescribimos el default parcel POST para devolver id=42
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [] })
        });
      }
      if (typeof url === "string" && url === "/api/admin/parcels") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ parcel: { id: 42 } })
        });
      }
      return Promise.resolve({} as Response);
    });

    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12 — Suerte 3");
    await user.type(getInput(/Suerte/), "Suerte 3");
    // Cliente/Hacienda ahora son SELECTs. Sin catalog, el operador
    // usa el fallback de texto libre (data-testid="client-name-fallback").
    await user.type(screen.getByTestId("client-name-fallback"), "Ingenio La Cabaña");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    // El 2do call es el parcel POST
    const [, init] = mockFetch.mock.calls[1];
    const url = mockFetch.mock.calls[1][0];
    expect(url).toBe("/api/admin/parcels");
    const body = JSON.parse(init.body as string);
    expect(body.land_name).toBe("Lote 12 — Suerte 3");
    expect(body.luck_name).toBe("Suerte 3");
    // Sin client_id en catalog, fallback a client_name denormalizado
    expect(body.client_id).toBeUndefined();
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
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [] })
        });
      }
      if (typeof url === "string" && url === "/api/admin/parcels") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ parcel: { id: 100 } })
        });
      }
      return Promise.resolve({} as Response);
    });

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
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
    // Catalog default en beforeEach, parcel POST default tambien.
    // El test verifica que campos vacios no se mandan.
    render(<NewParcelForm />);
    await user.type(getInput(/Nombre del lote/), "Lote 12");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    // El 2do call es el parcel POST
    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.luck_name).toBeUndefined();
    expect(body.client_name).toBeUndefined();
    expect(body.client_id).toBeUndefined();
    expect(body.farm_id).toBeUndefined();
    expect(body.supervisor_notes).toBeUndefined();
  });
});

// ============================================================
// Fase 3.2 — catalog-driven Cliente/Hacienda (Sprint S11+)
// ============================================================
//
// Cubre:
//   - Catalog fetch al mount (clients)
//   - Farms fetch cuando hay client_id
//   - Submit con client_id del catalog
//   - Cambiar cliente resetea farm_id
//   - Fallback de texto libre si client_id es null
describe("NewParcelForm — Fase 3.2 catalog Cliente/Hacienda", () => {
  it("hace catalog fetch de /api/admin/clients al mount", async () => {
    render(<NewParcelForm />);
    // Esperar a que el useEffect se ejecute
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    // Verificar que al menos una llamada fue a /api/admin/clients
    const calledWithClients = mockFetch.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].startsWith("/api/admin/clients")
    );
    expect(calledWithClients).toBe(true);
  });

  it("renderiza las opciones del catalog en el select de Cliente", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            clients: [
              { id: 1, name: "Ingenio La Cabaña" },
              { id: 2, name: "Ingenio San Carlos" }
            ]
          })
        });
      }
      return Promise.resolve({} as Response);
    });
    render(<NewParcelForm />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ingenio La Cabaña" })).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "Ingenio San Carlos" })).toBeInTheDocument();
  });

  it("hace farms fetch cuando se elige un cliente", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients") && !url.includes("clientId")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [{ id: 1, name: "Ingenio La Cabaña" }] })
        });
      }
      if (typeof url === "string" && url.startsWith("/api/admin/farms")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            farms: [
              { id: 10, client_id: 1, name: "Hacienda El Edén" },
              { id: 11, client_id: 1, name: "Hacienda La Esperanza" }
            ]
          })
        });
      }
      return Promise.resolve({} as Response);
    });
    const user = userEvent.setup();
    render(<NewParcelForm />);
    // Esperar el catalog fetch
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ingenio La Cabaña" })).toBeInTheDocument();
    });
    // Seleccionar el cliente
    const clientSelect = screen.getByTestId("client-select");
    await user.selectOptions(clientSelect, "1");
    // Esperar el farms fetch
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Hacienda El Edén" })).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "Hacienda La Esperanza" })).toBeInTheDocument();
  });

  it("cambiar el cliente resetea la finca elegida", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients") && !url.includes("clientId")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            clients: [
              { id: 1, name: "Ingenio La Cabaña" },
              { id: 2, name: "Ingenio San Carlos" }
            ]
          })
        });
      }
      if (typeof url === "string" && url.includes("clientId=1")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            farms: [{ id: 10, client_id: 1, name: "Hacienda El Edén" }]
          })
        });
      }
      if (typeof url === "string" && url.includes("clientId=2")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            farms: [{ id: 20, client_id: 2, name: "Hacienda San Jose" }]
          })
        });
      }
      return Promise.resolve({} as Response);
    });
    const user = userEvent.setup();
    render(<NewParcelForm />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ingenio La Cabaña" })).toBeInTheDocument();
    });
    const clientSelect = screen.getByTestId("client-select");
    const farmSelect = screen.getByTestId("farm-select");
    // Elegir cliente 1 + finca
    await user.selectOptions(clientSelect, "1");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Hacienda El Edén" })).toBeInTheDocument();
    });
    await user.selectOptions(farmSelect, "10");
    expect(farmSelect).toHaveValue("10");
    // Cambiar a cliente 2 → farm se resetea
    await user.selectOptions(clientSelect, "2");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Hacienda San Jose" })).toBeInTheDocument();
    });
    expect(farmSelect).toHaveValue("");
  });

  it("el body del POST incluye client_id cuando se eligió un cliente del catalog", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients") && !url.includes("clientId")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [{ id: 5, name: "Ingenio El Carmen" }] })
        });
      }
      if (typeof url === "string" && url.startsWith("/api/admin/farms")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ farms: [] })
        });
      }
      if (typeof url === "string" && url === "/api/admin/parcels") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ parcel: { id: 99 } })
        });
      }
      return Promise.resolve({} as Response);
    });
    const user = userEvent.setup();
    render(<NewParcelForm />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ingenio El Carmen" })).toBeInTheDocument();
    });
    await user.type(getInput(/Nombre del lote/), "Lote Catalog");
    await user.selectOptions(screen.getByTestId("client-select"), "5");
    await user.click(screen.getByTestId("fake-drawer"));
    fireEvent.submit(screen.getByRole("button", { name: /Crear parcela/ }).closest("form")!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
    // Encontrar el call al parcel POST
    const parcelCall = mockFetch.mock.calls.find(
      (call) => call[0] === "/api/admin/parcels"
    );
    expect(parcelCall).toBeDefined();
    const body = JSON.parse(parcelCall![1].body as string);
    expect(body.client_id).toBe(5);
    expect(body.client_name).toBeUndefined(); // FK manda, denormalizado null
  });

  it("muestra el fallback de texto libre cuando NO hay cliente elegido", () => {
    render(<NewParcelForm />);
    // Sin cliente del catalog, el fallback es visible
    expect(screen.getByTestId("client-name-fallback")).toBeInTheDocument();
  });

  it("esconde el fallback de texto libre cuando hay cliente elegido del catalog", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/admin/clients") && !url.includes("clientId")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ clients: [{ id: 1, name: "Ingenio La Cabaña" }] })
        });
      }
      return Promise.resolve({} as Response);
    });
    const user = userEvent.setup();
    render(<NewParcelForm />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ingenio La Cabaña" })).toBeInTheDocument();
    });
    // Antes de elegir: fallback visible
    expect(screen.getByTestId("client-name-fallback")).toBeInTheDocument();
    // Elegir cliente → fallback escondido
    await user.selectOptions(screen.getByTestId("client-select"), "1");
    expect(screen.queryByTestId("client-name-fallback")).not.toBeInTheDocument();
  });
});
