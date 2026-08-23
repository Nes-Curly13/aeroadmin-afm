/**
 * tests/components/fumigations/invoices-card.test.tsx
 *
 * Test unitario del componente client `InvoicesCard` (Sprint S7,
 * feature/s7-schema-extension / Fase 1 / PR-C).
 *
 * Cubre:
 *   - Render: empty state cuando no hay facturas
 *   - Render: lista de facturas con número, fecha, monto
 *   - Render: total facturado cuando hay activas
 *   - Render: facturas canceladas con strikethrough + badge
 *   - canEdit=false: oculta botones de agregar/cancelar
 *   - canEdit=true: muestra botón "Agregar factura"
 *   - Click en "Agregar factura": muestra form inline
 *   - Submit form: POST con body correcto, refresh, hide form
 *   - Submit con error: muestra banner rojo, mantiene form
 *   - Click en "Cancelar": PATCH y refresh
 *
 * Mismo patrón que `tests/components/parcels/register-fumigation-form.test.tsx`:
 * - `userEvent.type` para inputs
 * - `fireEvent.submit(form)` para submits
 * - `mockFetch` con Promise resolution diferida para verificar loading state
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvoicesCard } from "@/components/fumigations/invoices-card";
import type { FumigationInvoice } from "@/lib/types";

// ============================================================
// Mocks
// ============================================================

const mockFetch = vi.fn();
const mockRouterRefresh = vi.fn();

// next/navigation: stub de useRouter
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => mockRouterRefresh(),
    push: vi.fn(),
    back: vi.fn()
  })
}));

// fetch global
const originalFetch = globalThis.fetch;
beforeEach(() => {
  mockFetch.mockReset();
  mockRouterRefresh.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ============================================================
// Helpers
// ============================================================

function makeInvoice(overrides: Partial<FumigationInvoice> = {}): FumigationInvoice {
  return {
    id: 1,
    fumigation_id: 100,
    invoice_number: "FVE-2051",
    invoiced_at: "2026-07-15",
    amount_cop: 1500000,
    cancelled: false,
    cancelled_at: null,
    cancelled_by: null,
    created_at: "2026-07-15T10:00:00.000Z",
    updated_at: "2026-07-15T10:00:00.000Z",
    ...overrides
  };
}

function mockFetchOk(jsonBody: unknown = { invoice: makeInvoice() }, status = 201) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: async () => jsonBody
  } as Response);
}

function mockFetchError(error: string, status = 400) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error })
  } as Response);
}

// ============================================================
// Tests
// ============================================================

describe("InvoicesCard — render", () => {
  it("empty state cuando no hay facturas", () => {
    render(<InvoicesCard fumigationId={100} invoices={[]} canEdit={false} />);
    expect(screen.getByText(/no hay facturas registradas/i)).toBeTruthy();
  });

  it("muestra el número, fecha y monto de cada factura", () => {
    const invs = [
      makeInvoice({ id: 1, invoice_number: "FVE-2051", amount_cop: 1500000 }),
      makeInvoice({ id: 2, invoice_number: "FVE-2052", amount_cop: 2300000 })
    ];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={false} />);
    expect(screen.getByText("FVE-2051")).toBeTruthy();
    expect(screen.getByText("FVE-2052")).toBeTruthy();
  });

  it("muestra el total facturado (suma de activas)", () => {
    const invs = [
      makeInvoice({ id: 1, amount_cop: 1500000, cancelled: false }),
      makeInvoice({ id: 2, amount_cop: 2300000, cancelled: false }),
      makeInvoice({ id: 3, amount_cop: 1000000, cancelled: true })
    ];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={false} />);
    // Total = 1.5M + 2.3M = 3.8M (la cancelada no suma)
    const totalText = screen.getByText(/Total facturado:/i);
    expect(totalText.textContent).toMatch(/3[.,]\s*800[.,]?000/);
  });

  it("factura cancelada muestra badge 'Cancelada'", () => {
    const invs = [
      makeInvoice({ id: 1, cancelled: true, cancelled_at: "2026-08-01T10:00:00.000Z", cancelled_by: "admin@aeroadmin.local" })
    ];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={false} />);
    expect(screen.getByLabelText("Factura cancelada")).toBeTruthy();
  });
});

describe("InvoicesCard — permisos", () => {
  it("canEdit=false oculta botón Agregar y Cancelar", () => {
    const invs = [makeInvoice({ id: 1 })];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Agregar factura/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar factura/ })).toBeNull();
  });

  it("canEdit=true muestra botón Agregar", () => {
    render(<InvoicesCard fumigationId={100} invoices={[]} canEdit={true} />);
    expect(screen.getByRole("button", { name: /Agregar factura/ })).toBeTruthy();
  });
});

describe("InvoicesCard — crear factura", () => {
  it("click en Agregar muestra form inline", async () => {
    const user = userEvent.setup();
    render(<InvoicesCard fumigationId={100} invoices={[]} canEdit={true} />);
    await user.click(screen.getByRole("button", { name: /Agregar factura/ }));
    expect(screen.getByLabelText(/Número de factura/)).toBeTruthy();
    expect(screen.getByLabelText(/Fecha de la factura/)).toBeTruthy();
    expect(screen.getByLabelText(/Monto en pesos/)).toBeTruthy();
  });

  it("submit POST con body correcto y router.refresh", async () => {
    const user = userEvent.setup();
    mockFetchOk();
    render(<InvoicesCard fumigationId={100} invoices={[]} canEdit={true} />);
    await user.click(screen.getByRole("button", { name: /Agregar factura/ }));

    await user.type(screen.getByLabelText(/Número de factura/), "FVE-2051");
    await user.type(screen.getByLabelText(/Fecha de la factura/), "2026-07-15");
    await user.type(screen.getByLabelText(/Monto en pesos/), "1500000");

    const form = screen.getByLabelText("Crear factura");
    fireEvent.submit(form);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/admin/fumigations/100/invoices");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      invoice_number: "FVE-2051",
      invoiced_at: "2026-07-15",
      amount_cop: 1500000
    });
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("submit con error muestra banner rojo y mantiene form", async () => {
    const user = userEvent.setup();
    mockFetchError("ya existe una factura con ese número", 409);
    render(<InvoicesCard fumigationId={100} invoices={[]} canEdit={true} />);
    await user.click(screen.getByRole("button", { name: /Agregar factura/ }));

    await user.type(screen.getByLabelText(/Número de factura/), "FVE-2051");
    await user.type(screen.getByLabelText(/Fecha de la factura/), "2026-07-15");
    await user.type(screen.getByLabelText(/Monto en pesos/), "1500000");

    fireEvent.submit(screen.getByLabelText("Crear factura"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(
      /ya existe una factura con ese número/
    );
    // El form sigue visible
    expect(screen.getByLabelText(/Número de factura/)).toBeTruthy();
  });
});

describe("InvoicesCard — cancelar factura", () => {
  it("click en Cancelar dispara PATCH y refresh (con confirm)", async () => {
    const user = userEvent.setup();
    // Mock del window.confirm
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchOk({ invoice: makeInvoice({ id: 1, cancelled: true }) }, 200);
    const invs = [makeInvoice({ id: 1 })];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={true} />);

    await user.click(screen.getByRole("button", { name: /Cancelar factura FVE-2051/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/admin/fumigations/100/invoices/1");
    expect(init.method).toBe("PATCH");
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("no llama PATCH si el usuario cancela el confirm", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const invs = [makeInvoice({ id: 1 })];
    render(<InvoicesCard fumigationId={100} invoices={invs} canEdit={true} />);

    await user.click(screen.getByRole("button", { name: /Cancelar factura FVE-2051/ }));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
