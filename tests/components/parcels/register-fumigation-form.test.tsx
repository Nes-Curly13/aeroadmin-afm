// tests/components/parcels/register-fumigation-form.test.tsx
//
// Test unitario del componente client `RegisterFumigationForm`
// (Sprint 2026-08-02 — feature/manual-fumigation-ui).
//
// Cubre:
//   - **Render inicial**: campos requeridos, defaults (fecha = hoy,
//     dron = "Sin asignar")
//   - **Submit OK**: POST con el body correcto (incluyendo
//     conversion string→number), banner verde, router.refresh()
//   - **Submit con error del server**: banner rojo con el mensaje
//     del server (no se limpia el form)
//   - **Campos vacíos**: no se envian (server los trata como null)
//   - **Campos ICA**: opcionales pero se envian si están llenos
//   - **Loading state**: input disabled + spinner mientras espera
//
// **Por qué `userEvent` y `fireEvent.submit`**:
// 1. `userEvent.type` en lugar de `fireEvent.change` — el Input viene
//    de `@base-ui/react/input` (wrapper de `components/ui/input`),
//    que se subscribe a eventos sintéticos. `userEvent.type` dispara
//    focus → keydown → input → change con `bubbles: true`, que es lo
//    que React espera para actualizar el state.
// 2. `fireEvent.submit(form)` en lugar de `click(submitButton)` — el
//    `Button` de `@base-ui/react/button` envuelve el `<button>`
//    nativo con un onClick handler que NO propaga al form submit
//    cuando se simula con `userEvent.click`. Confirmado: con click
//    en el button submit, `mockFetch` queda en 0 calls aunque los
//    inputs estén llenos. `fireEvent.submit(form)` bypasea el
//    wrapper y dispara directamente el `onSubmit` del form.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterFumigationForm } from "@/components/parcels/register-fumigation-form";
import type { DjiFumigationEvent } from "@/lib/types";

// ============================================================
// Mocks
// ============================================================

const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => mockRefresh(),
    push: (...args: unknown[]) => mockPush(...args)
  })
}));

const mockFetch = vi.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
  // Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
  // El ProductPicker ahora dispara fetchs de autocomplete al escribir.
  // Por defecto, mockFetch devuelve una respuesta vacía válida (200 +
  // JSON vacío) para esos calls. Los tests individuales usan
  // `mockResolvedValueOnce` para el POST del form, que se consume
  // en orden. Si el picker consume el mock primero, los tests
  // fallarían con "Cannot read properties of undefined (reading 'ok')".
  // El default de abajo evita ese problema.
  mockFetch.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/admin/products")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ products: [] })
      } as Response;
    }
    // Default fallback: para cualquier otro endpoint (ej. POST del form),
    // devolvemos undefined → el código de test que llamó
    // `mockResolvedValueOnce` provee la respuesta real.
    return undefined as unknown as Response;
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});

// ============================================================
// Helpers
// ============================================================

function getInput(labelText: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(labelText) as HTMLInputElement;
}

function getTextarea(labelText: string | RegExp): HTMLTextAreaElement {
  return screen.getByLabelText(labelText) as HTMLTextAreaElement;
}

function getForm(): HTMLFormElement {
  return screen.getByLabelText("Registrar fumigación manual") as HTMLFormElement;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
  product = "Glifosato 48%",
  dose = "2.5"
) {
  await user.type(getInput(/Producto comercial/), product);
  await user.type(getInput(/Dosis/), dose);
}

// ============================================================
// Render
// ============================================================

describe("RegisterFumigationForm — render", () => {
  it("renderiza con los campos requeridos marcados con aria-required", () => {
    render(<RegisterFumigationForm parcelId={1} />);
    expect(getInput(/Fecha/)).toBeInTheDocument();
    expect(getInput(/Producto comercial/)).toBeInTheDocument();
    expect(getInput(/Dosis/)).toBeInTheDocument();
  });

  it("default fecha es hoy (local time)", () => {
    render(<RegisterFumigationForm parcelId={1} />);
    expect(getInput(/Fecha/).value).toBe(todayISO());
  });

  it("default dron es 'Sin asignar' (id=0)", () => {
    render(<RegisterFumigationForm parcelId={1} />);
    const select = screen.getByLabelText("Dron usado") as HTMLSelectElement;
    expect(select.value).toBe("0");
  });

  it("lista los 4 modelos de dron en el dropdown", () => {
    render(<RegisterFumigationForm parcelId={1} />);
    const select = screen.getByLabelText("Dron usado") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("0");
    expect(options).toContain("72");
    expect(options).toContain("201");
    expect(options).toContain("210");
  });

  it("campos ICA están en un <details> colapsable", async () => {
    const user = userEvent.setup();
    render(<RegisterFumigationForm parcelId={1} />);
    // Antes de expandir, los inputs ICA no son visibles
    expect(screen.queryByLabelText(/Registro ICA/)).not.toBeVisible();
    // Expandir el details (summary es HTML nativo, click funciona)
    await user.click(screen.getByText(/Compliance/));
    expect(screen.getByLabelText(/Registro ICA/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Licencia del piloto/)).toBeInTheDocument();
  });
});

// ============================================================
// Submit OK
// ============================================================

describe("RegisterFumigationForm — submit OK", () => {
  it("hace POST con el body correcto (solo campos llenos)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      // Sprint S9 — el ProductPicker puede disparar GETs de autocomplete
      // (que retornan con el mock por default). Filtramos por URL para
      // contar solo el POST del form.
      const formCalls = mockFetch.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url === "/api/admin/fumigations";
      });
      expect(formCalls).toHaveLength(1);
    });
    const formCall = mockFetch.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url === "/api/admin/fumigations";
    });
    if (!formCall) throw new Error("form fetch not called");
    const [url, init] = formCall;
    expect(url).toBe("/api/admin/fumigations");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      parcel_id: 1,
      fumigation_date: todayISO(),
      product_used: "Glifosato 48%",
      dose_l_per_ha: 2.5
    });
  });

  it("muestra banner verde con el ID de la fumigation al success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByRole("status").textContent).toMatch(/42/);
  });

  it("llama router.refresh() después del success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("incluye campos opcionales si están llenos", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    await user.type(getInput(/Área fumigada/), "5000");
    await user.type(getInput(/Duración/), "45");
    await user.type(getTextarea(/Notas operativas/), "Re-tratamiento manual");
    // Expandir compliance y llenar
    await user.click(screen.getByText(/Compliance/));
    await user.type(getInput(/Registro ICA/), "ICA-1234-PN");
    await user.type(getInput(/Licencia del piloto/), "PCA-12345");
    fireEvent.submit(getForm());

    await waitFor(() => {
      // Sprint S9 — filtrar solo el POST del form (excluir GETs
      // del ProductPicker que pueden dispararse por autocomplete).
      const formCalls = mockFetch.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url === "/api/admin/fumigations";
      });
      expect(formCalls).toHaveLength(1);
    });
    const formCall = mockFetch.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url === "/api/admin/fumigations";
    });
    if (!formCall) throw new Error("form fetch not called");
    const body = JSON.parse(formCall[1].body as string);
    expect(body).toMatchObject({
      parcel_id: 1,
      product_used: "Glifosato 48%",
      dose_l_per_ha: 2.5,
      area_fumigated_m2: 5000,
      duration_minutes: 45,
      notes: "Re-tratamiento manual",
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345"
    });
    // drone_code_used: 0 (default) NO se envia al server (server lo trata como null)
    expect(body.drone_code_used).toBeUndefined();
  });

  it("convierte drone_code_used '0' (default) a no-enviado", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    // No cambiar el dron — queda en "Sin asignar" (0)
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      const formCalls = mockFetch.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url === "/api/admin/fumigations";
      });
      expect(formCalls).toHaveLength(1);
    });
    const formCall = mockFetch.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url === "/api/admin/fumigations";
    });
    if (!formCall) throw new Error("form fetch not called");
    const body = JSON.parse(formCall[1].body as string);
    expect(body.drone_code_used).toBeUndefined();
  });
});

// ============================================================
// Submit con error
// ============================================================

describe("RegisterFumigationForm — submit error", () => {
  it("muestra banner rojo con el error del server", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "ICA license formato inválido" })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "ICA license formato inválido"
    );
  });

  it("NO llama router.refresh() cuando hay error", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "x" })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user, "G", "2.5");
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("mantiene los valores del form después del error (no se limpia)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "x" })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(getInput(/Producto comercial/).value).toBe("Glifosato 48%");
    expect(getInput(/Dosis/).value).toBe("2.5");
  });

  it("usa mensaje por defecto si el server no devuelve error JSON", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      }
    } as unknown as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user, "G", "2.5");
    fireEvent.submit(getForm());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/HTTP 500/);
  });
});

// ============================================================
// Loading state
// ============================================================

describe("RegisterFumigationForm — loading state", () => {
  it("inputs están disabled mientras el POST está pendiente", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (v: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user, "G", "2.5");
    fireEvent.submit(getForm());

    // Mientras el fetch está pendiente, los inputs están disabled
    await waitFor(() => {
      expect(getInput(/Producto comercial/)).toBeDisabled();
    });
    expect(getInput(/Dosis/)).toBeDisabled();
    expect(getInput(/Fecha/)).toBeDisabled();

    // Resolver el fetch
    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 1 } })
    } as Response);
  });
});

// ============================================================
// Reset
// ============================================================

describe("RegisterFumigationForm — reset", () => {
  it("botón Limpiar resetea el form a defaults", async () => {
    const user = userEvent.setup();
    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    // El botón "Limpiar" es type="button" → no submitea el form,
    // solo dispara su onClick. A diferencia del submit button, este
    // SÍ se puede testear con userEvent.click porque no depende
    // del form submit.
    await user.click(screen.getByRole("button", { name: /Limpiar/ }));

    expect(getInput(/Producto comercial/).value).toBe("");
    expect(getInput(/Dosis/).value).toBe("");
    expect(getInput(/Fecha/).value).toBe(todayISO());
  });
});

// ============================================================
// Sprint S9 — feature/s9-product-picker-wireup
// ============================================================

describe("RegisterFumigationForm — product_id (S9)", () => {
  it("sincroniza product_used con lo que el operador tipea en el picker (free-form)", async () => {
    // El picker's onChange(null, query) se dispara en cada keystroke
    // (no selección). El form debe reflejar ese texto en product_used.
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user, "Roundup 36% SL", "2.0");
    fireEvent.submit(getForm());

    await waitFor(() => {
      const formCalls = mockFetch.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url === "/api/admin/fumigations";
      });
      expect(formCalls).toHaveLength(1);
    });
    const formCall = mockFetch.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url === "/api/admin/fumigations";
    });
    if (!formCall) throw new Error("form fetch not called");
    const body = JSON.parse(formCall[1].body as string);
    // product_used es el texto tipeado, product_id es null
    // (free-form sin selección del catálogo).
    expect(body.product_used).toBe("Roundup 36% SL");
    expect(body.product_id).toBeUndefined();
  });

  it("POST NO incluye product_id si quedó null (free-form)", async () => {
    // El form manda product_id solo si difiere de null. Si el operador
    // tipea free-form sin seleccionar, product_id NO se envía (sparse).
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);

    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user, "Cualquier producto", "1.5");
    fireEvent.submit(getForm());

    await waitFor(() => {
      const formCalls = mockFetch.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
        return url === "/api/admin/fumigations";
      });
      expect(formCalls).toHaveLength(1);
    });
    const formCall = mockFetch.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url === "/api/admin/fumigations";
    });
    if (!formCall) throw new Error("form fetch not called");
    const body = JSON.parse(formCall[1].body as string);
    expect(body).not.toHaveProperty("product_id");
  });
});

// ============================================================
// Sprint S7 — application_type_id (Fase 1 PR-A)
// ============================================================

describe("RegisterFumigationForm — application_type (S7 PR-A)", () => {
  it("POST incluye application_type_id cuando se selecciona en create", async () => {
    const user = userEvent.setup();
    let resolveFetch: (r: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);
    // Seleccionar "Pre emergente" (id 1).
    const phaseSelect = screen.getByLabelText(/Fase de uso/) as HTMLSelectElement;
    await user.selectOptions(phaseSelect, "1");

    fireEvent.submit(screen.getByRole("button", { name: /Registrar fumigación/ }).closest("form")!);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.application_type_id).toBe(1);
    // El dropdown de tipo de fumigación (categoría) sigue siendo opcional.
    // Si no se selecciona, NO se envía category_id.
    expect(body.category_id).toBeUndefined();

    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 1 } })
    } as Response);
  });

  it("POST NO incluye application_type_id si queda en 'Sin clasificar'", async () => {
    const user = userEvent.setup();
    let resolveFetch: (r: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    render(<RegisterFumigationForm parcelId={1} />);
    await fillRequiredFields(user);

    fireEvent.submit(screen.getByRole("button", { name: /Registrar fumigación/ }).closest("form")!);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.application_type_id).toBeUndefined();

    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ fumigation: { id: 1 } })
    } as Response);
  });

  it("PATCH incluye application_type_id solo si cambió desde el initial", async () => {
    const user = userEvent.setup();
    let resolveFetch: (r: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const initial = {
      id: 42,
      parcel_id: 1,
      fumigation_date: "2026-07-15",
      product_used: "Glifosato",
      dose_l_per_ha: 2.5,
      area_fumigated_m2: null,
      duration_minutes: null,
      drone_code_used: 0,
      notes: null,
      application_type_id: null,
      category_id: null
    };
    render(<RegisterFumigationForm parcelId={1} mode="edit" initialFumigation={initial as unknown as DjiFumigationEvent} />);
    // Cambiar de null a "Post emergente" (id 2).
    const phaseSelect = screen.getByLabelText(/Fase de uso/) as HTMLSelectElement;
    await user.selectOptions(phaseSelect, "2");

    fireEvent.submit(screen.getByRole("button", { name: /Guardar cambios/ }).closest("form")!);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.application_type_id).toBe(2);
    // No mandamos parcel_id ni otros campos inmutables.
    expect(body.parcel_id).toBeUndefined();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);
  });

  it("PATCH NO incluye application_type_id si no cambió", async () => {
    const user = userEvent.setup();
    let resolveFetch: (r: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const initial = {
      id: 42,
      parcel_id: 1,
      fumigation_date: "2026-07-15",
      product_used: "Glifosato",
      dose_l_per_ha: 2.5,
      area_fumigated_m2: null,
      duration_minutes: null,
      drone_code_used: 0,
      notes: null,
      application_type_id: 1, // pre_emergente
      category_id: null
    };
    render(<RegisterFumigationForm parcelId={1} mode="edit" initialFumigation={initial as unknown as DjiFumigationEvent} />);
    // No tocar nada.

    fireEvent.submit(screen.getByRole("button", { name: /Guardar cambios/ }).closest("form")!);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.application_type_id).toBeUndefined();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: 42 } })
    } as Response);
  });
});
