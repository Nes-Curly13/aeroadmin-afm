/**
 * tests/components/fumigations/vehicle-picker.test.tsx
 *
 * Test unitario del componente `VehiclePicker` (Sprint S7,
 * feature/s7-schema-extension / Fase 1 / PR-B).
 *
 * Cubre:
 *   - Render básico: input + icono + label
 *   - Mostrar value inicial (controlled)
 *   - Disabled propaga al input
 *   - onChange al tipear (input controlado)
 *   - Debounce: tipear rápido no hace 1 fetch por keystroke
 *   - Dropdown: muestra results cuando llega la respuesta
 *   - Dropdown: "+ Crear como nuevo vehículo" cuando la query no
 *     matchea y es formato CHECK válido
 *   - Click en "+ Crear" → POST + onChange con la placa
 *   - Click en resultado → onChange con la placa
 *   - X button: clear selection
 *   - 401 desde el server → error message
 *   - Server error en POST → error message
 *   - aria attributes (aria-expanded, aria-controls, listbox)
 *   - Esc cierra el dropdown
 *
 * Estrategia: usamos `await new Promise(r => setTimeout(r, 400))`
 * para esperar el debounce en vez de fake timers. fake timers +
 * userEvent.setup es frágil en jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehiclePicker } from "@/components/fumigations/vehicle-picker";
import type { DjiVehicle } from "@/lib/types";

// ============================================================
// Mocks
// ============================================================

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  // reset fetch (seteamos a mockFetch en beforeEach)
  delete (globalThis as Record<string, unknown>).fetch;
});

// ============================================================
// Helpers
// ============================================================

function makeVehicle(overrides: Partial<DjiVehicle> = {}): DjiVehicle {
  return {
    id: 1,
    plate: "ABC-1234",
    description: "Toyota Hilux 2020",
    is_active: true,
    created_at: "2026-08-20T10:00:00.000Z",
    ...overrides
  };
}

function mockFetchOk(json: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: async () => json
  } as Response);
}

function mockFetchError(error: string, status = 400) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error })
  } as Response);
}

// Esperar el debounce (300ms en el componente) + un poco de slack
const waitDebounce = () => new Promise((r) => setTimeout(r, 400));

// ============================================================
// Tests
// ============================================================

describe("VehiclePicker — render", () => {
  it("renderiza input con label y placeholder", () => {
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo de transporte/i);
    expect(input).toBeTruthy();
    expect(input.getAttribute("placeholder")).toMatch(/ABC-1234/);
  });

  it("label custom se respeta", () => {
    render(
      <VehiclePicker value={null} onChange={() => {}} label="Mi label custom" />
    );
    expect(screen.getByLabelText(/Mi label custom/)).toBeTruthy();
  });

  it("placeholder custom se respeta", () => {
    render(
      <VehiclePicker
        value={null}
        onChange={() => {}}
        placeholder="busca la placa"
      />
    );
    const input = screen.getByLabelText(/Vehículo de transporte/);
    expect(input.getAttribute("placeholder")).toBe("busca la placa");
  });

  it("muestra value inicial en el input", () => {
    render(<VehiclePicker value="XYZ-9876" onChange={() => {}} />);
    const input = screen.getByLabelText(
      /Vehículo de transporte/i
    ) as HTMLInputElement;
    expect(input.value).toBe("XYZ-9876");
  });

  it("disabled deshabilita el input", () => {
    render(<VehiclePicker value={null} onChange={() => {}} disabled />);
    const input = screen.getByLabelText(/Vehículo/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("syncroniza query con value cuando value cambia programáticamente", () => {
    const { rerender } = render(
      <VehiclePicker value={null} onChange={() => {}} />
    );
    const input = screen.getByLabelText(
      /Vehículo/i
    ) as HTMLInputElement;
    expect(input.value).toBe("");

    rerender(<VehiclePicker value="NEW-PLATE" onChange={() => {}} />);
    expect(input.value).toBe("NEW-PLATE");
  });
});

describe("VehiclePicker — input controlado", () => {
  it("tipear actualiza el input pero NO emite onChange (solo en commit)", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<VehiclePicker value={null} onChange={handleChange} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC");
    expect((input as HTMLInputElement).value).toBe("ABC");
    expect(handleChange).not.toHaveBeenCalled();
  });
});

describe("VehiclePicker — debounce + fetch", () => {
  it("hace 1 fetch después del debounce, no por cada keystroke", async () => {
    const user = userEvent.setup();
    mockFetchOk({ vehicles: [] });
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC-1234");
    // Antes del debounce, no hay fetch
    expect(mockFetch).not.toHaveBeenCalled();
    // Después del debounce, 1 fetch
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/search=ABC-1234/);
  });

  it("no hace fetch si la query coincide con value (ya seleccionado)", async () => {
    mockFetchOk({ vehicles: [] });
    render(<VehiclePicker value="ABC-1234" onChange={() => {}} />);
    // El input arranca con "ABC-1234" (=value), el efecto no hace fetch
    await waitDebounce();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("VehiclePicker — dropdown", () => {
  it("muestra '+ Crear X' cuando query no matchea y es formato CHECK", async () => {
    const user = userEvent.setup();
    mockFetchOk({ vehicles: [] });
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "NEW-9999");
    await waitFor(() =>
      expect(
        screen.getByText(/como nuevo vehículo/i)
      ).toBeTruthy()
    );
    expect(screen.getByText("NEW-9999")).toBeTruthy();
  });

  it("no muestra '+ Crear' si la query coincide con un result existente", async () => {
    const user = userEvent.setup();
    mockFetchOk({ vehicles: [makeVehicle({ plate: "ABC-1234" })] });
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC-1234");
    // Esperar a que el result esté: el li[role=option] del result
    // tiene la descripción (Toyota Hilux 2020) que el "+ Crear" no
    // tiene. Eso evita matchear contra el "+ Crear" que también
    // contiene el texto "ABC-1234" como query.
    await waitFor(() => {
      expect(screen.getByText(/Toyota Hilux 2020/)).toBeTruthy();
    });
    // El "+ Crear" NO debe aparecer (la query matchea un result).
    expect(screen.queryByText(/como nuevo vehículo/i)).toBeNull();
  });

  it("no muestra '+ Crear' si la query no pasa el regex CHECK (muy corta)", async () => {
    const user = userEvent.setup();
    mockFetchOk({ vehicles: [] });
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "AB");
    await waitDebounce();
    expect(screen.queryByText(/como nuevo vehículo/i)).toBeNull();
  });

  it("click en un resultado llama onChange con la placa", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    mockFetchOk({ vehicles: [makeVehicle({ plate: "ABC-1234" })] });
    render(<VehiclePicker value={null} onChange={handleChange} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC");
    await waitFor(() => expect(screen.getByText("ABC-1234")).toBeTruthy());

    // El li[role=option] tiene un button interno; clickeamos el button
    // (más cercano al texto). role=option no expone accesible name
    // cuando el contenido es un <button> con sub-spans.
    const option = screen.getByText("ABC-1234").closest("li");
    expect(option).toBeTruthy();
    const btn = option!.querySelector("button");
    expect(btn).toBeTruthy();
    await user.click(btn!);
    expect(handleChange).toHaveBeenCalledWith("ABC-1234");
  });

  it("click en '+ Crear' llama POST + onChange", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    // Solo mockeamos el POST; el GET (si se dispara) puede quedar
    // sin mock y resolver con undefined — pero el componente
    // chequea `res.ok` que tira si undefined. Para evitar ruido,
    // dejamos que el GET corra pero no nos importa su resultado.
    // El test verifica que mockFetch tiene al menos 1 call con
    // POST al endpoint correcto.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ vehicle: makeVehicle({ plate: "NEW-9999" }) })
    } as Response);
    render(<VehiclePicker value={null} onChange={handleChange} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "new-9999");
    await waitFor(() =>
      expect(screen.getByText(/como nuevo vehículo/i)).toBeTruthy()
    );

    const createLi = screen
      .getByText(/como nuevo vehículo/i)
      .closest("li");
    const btn = createLi!.querySelector("button");
    await user.click(btn!);

    // Esperar a que se llame al endpoint POST. Puede ser la primera
    // o segunda call (dependiendo de si el debounce llegó a disparar
    // el GET). Filtramos las calls por método POST.
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(postCall).toBeTruthy();
    });
    const postCall = mockFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    )!;
    const [url, init] = postCall;
    expect(url).toBe("/api/admin/dji-vehicles");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ plate: "NEW-9999" });
    await waitFor(() =>
      expect(handleChange).toHaveBeenCalledWith("NEW-9999")
    );
  });

  it("click en X limpia la selección", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<VehiclePicker value="ABC-1234" onChange={handleChange} />);

    await user.click(screen.getByRole("button", { name: /Limpiar vehículo/ }));
    expect(handleChange).toHaveBeenCalledWith(null);
  });
});

describe("VehiclePicker — error handling", () => {
  it("error desde server se muestra en el dropdown", async () => {
    const user = userEvent.setup();
    mockFetchError("BD caída", 500);
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC");
    await waitFor(() =>
      expect(screen.getByText(/Error al buscar/i)).toBeTruthy()
    );
    expect(screen.getByText(/BD caída/)).toBeTruthy();
  });

  it("error al crear muestra mensaje en rojo", async () => {
    const user = userEvent.setup();
    // Mock para el POST (devuelve error). El GET (si dispara) puede
    // quedar sin mock; lo aceptamos porque el test verifica el error
    // que muestra el componente tras un POST fallido.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "formato inválido" })
    } as Response);
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "new-9999");
    await waitFor(() =>
      expect(screen.getByText(/como nuevo vehículo/i)).toBeTruthy()
    );
    const createLi = screen
      .getByText(/como nuevo vehículo/i)
      .closest("li");
    const btn = createLi!.querySelector("button");
    await user.click(btn!);

    await waitFor(() => {
      expect(screen.getByText(/formato inválido/)).toBeTruthy();
    });
  });
});

describe("VehiclePicker — accessibility", () => {
  it("aria-expanded refleja open state", async () => {
    const user = userEvent.setup();
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    expect(input.getAttribute("aria-expanded")).toBe("false");
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("listbox con role correcto cuando hay results", async () => {
    const user = userEvent.setup();
    mockFetchOk({ vehicles: [makeVehicle()] });
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
  });

  it("input hidden name='vehicle_plate' con value actual", () => {
    const { rerender } = render(
      <VehiclePicker value={null} onChange={() => {}} />
    );
    const hidden = document.querySelector(
      'input[type="hidden"][name="vehicle_plate"]'
    ) as HTMLInputElement;
    expect(hidden).toBeTruthy();
    expect(hidden.value).toBe("");

    rerender(<VehiclePicker value="ABC-1234" onChange={() => {}} />);
    expect(hidden.value).toBe("ABC-1234");
  });
});

describe("VehiclePicker — keyboard", () => {
  it("Esc cierra el dropdown", async () => {
    const user = userEvent.setup();
    render(<VehiclePicker value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.click(input); // abre
    expect(input.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter sobre un resultado commitea la selección", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    mockFetchOk({ vehicles: [makeVehicle({ plate: "ABC-1234" })] });
    render(<VehiclePicker value={null} onChange={handleChange} />);
    const input = screen.getByLabelText(/Vehículo/i);

    await user.type(input, "ABC");
    await waitFor(() => expect(screen.getByText("ABC-1234")).toBeTruthy());

    // ArrowDown para activar el primer item
    await user.keyboard("{ArrowDown}");
    // Enter para seleccionar
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(handleChange).toHaveBeenCalledWith("ABC-1234")
    );
  });
});
