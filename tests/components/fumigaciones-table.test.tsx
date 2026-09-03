/**
 * tests/components/fumigaciones-table.test.tsx
 *
 * Tests del `FumigacionesTableClient` (Sprint S8 / Bloque F,
 * 2026-08-29). Cubre el comportamiento de bulk operations en el UI:
 *   - Render de la tabla con checkboxes
 *   - Toggle de checkbox individual
 *   - "Select all" del header
 *   - Barra de bulk actions aparece cuando hay selección
 *   - Click en "Borrar N" → confirm() + fetch + router.refresh
 *   - Click en "Asignar categoría" → confirm() + fetch + router.refresh
 *
 * No testeamos la presentación detallada (clases Tailwind, copy
 * de aria-label, etc.) — esos son detalles visuales. El comportamiento
 * clave (state + fetch + refresh) sí.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Mocks
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    refresh: () => mockRefresh()
  }))
}));

import { FumigacionesTableClient } from "@/app/(auth)/fumigaciones/fumigaciones-table";
import type { DjiFumigationEvent } from "@/lib/types";

const mockFetch = vi.fn();
const originalFetch = global.fetch;
const originalConfirm = window.confirm;

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  mockRefresh.mockReset();
  // Default: confirm siempre true (happy path)
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  global.fetch = originalFetch;
  window.confirm = originalConfirm;
  cleanup();
});

function makeEvent(overrides: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 1,
    parcel_id: 100,
    fumigation_date: "2026-08-15",
    product_used: "Glifosato 48%",
    // Sprint S9 — feature/s9-product-picker-wireup. FK opcional
    // al catálogo products. Default null (free-form sin seleccionar).
    product_id: null,
    dose_l_per_ha: 2.0,
    area_fumigated_m2: 5000,
    drone_code_used: 72,
    duration_minutes: 25,
    notes: null,
    human_notes: null,
    recorded_by: "test@aeroadmin.local",
    product_registered_ica: "ICA-12345",
    pilot_license: "PL-001",
    category_id: 1,
    application_type_id: null,
    vehicle_plate: null,
    recorded_at: "2026-08-15T10:00:00Z",
    source: "manual",
    ...overrides
  };
}

const baseProps = {
  sourceFilter: null,
  categoryFilter: null,
  fromDate: null,
  toDate: null,
  parcelFilter: null,
  droneFilter: null,
  query: "",
  page: 1,
  rawSearchParams: {} as Record<string, string | undefined>
};

describe("FumigacionesTableClient — bulk operations UI", () => {
  it("1. render: muestra la tabla con checkbox por fila + select-all en header", () => {
    const events = [makeEvent({ id: 1 }), makeEvent({ id: 2 })];
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    // 1 select-all + 2 row checkboxes = 3 total
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(screen.getByLabelText(/seleccionar todas/i)).toBeTruthy();
  });

  it("2. toggle de un checkbox individual: actualiza la barra con el count", () => {
    const events = [makeEvent({ id: 1 }), makeEvent({ id: 2 }), makeEvent({ id: 3 })];
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    // Sin selección inicial: no hay barra
    expect(screen.queryByRole("region", { name: /acciones en bulk/i })).toBeNull();
    // Click en la fila 1
    const row1 = screen.getByLabelText("Seleccionar fumigación #1");
    fireEvent.click(row1);
    // Aparece la barra con count=1
    expect(screen.getByRole("region", { name: /acciones en bulk/i })).toBeTruthy();
    expect(screen.getByText(/1 fumigaci[oó]n seleccionada?/i)).toBeTruthy();
    // Click otra fila
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #3"));
    expect(screen.getByText(/2 fumigaciones seleccionadas/i)).toBeTruthy();
  });

  it("3. select-all: tilda todas las filas visibles", () => {
    const events = [
      makeEvent({ id: 1 }),
      makeEvent({ id: 2 }),
      makeEvent({ id: 3 })
    ];
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    const selectAll = screen.getByLabelText(/seleccionar todas/i);
    fireEvent.click(selectAll);
    expect(screen.getByText(/3 fumigaciones seleccionadas/i)).toBeTruthy();
    // Click de nuevo deselecciona todo
    fireEvent.click(selectAll);
    expect(screen.queryByRole("region", { name: /acciones en bulk/i })).toBeNull();
  });

  it("4. click en 'Borrar N' → confirm + POST /bulk-delete + router.refresh", async () => {
    const events = [makeEvent({ id: 1 }), makeEvent({ id: 2 })];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deleted: 2, skipped: 0, affected_ids: [1, 2], skipped_ids: [] })
    });
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    // Seleccionar todo
    fireEvent.click(screen.getByLabelText(/seleccionar todas/i));
    // Click en Borrar
    const deleteBtn = screen.getByRole("button", { name: /borrar fumigaciones seleccionadas/i });
    fireEvent.click(deleteBtn);
    // confirm() fue llamado
    expect(window.confirm).toHaveBeenCalled();
    // fetch se llamó con la URL correcta
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/fumigations/bulk-delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ ids: [1, 2] })
        })
      );
    });
    // router.refresh se llamó después del success
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("5. click en categoría → confirm + POST /bulk-category", async () => {
    const events = [makeEvent({ id: 1 })];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updated: 1, skipped: 0, affected_ids: [1], skipped_ids: [] })
    });
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    // Seleccionar
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #1"));
    // Click en "Asignar Herbicida" (id=1, label=Herbicida)
    const herbicidaBtn = screen.getByRole("button", { name: /asignar categor[ií]a herbicida/i });
    fireEvent.click(herbicidaBtn);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/fumigations/bulk-category",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ ids: [1], category_id: 1 })
        })
      );
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("6. click en 'Sin clasificar' → POST con category_id null", async () => {
    const events = [makeEvent({ id: 1 })];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updated: 1, skipped: 0 })
    });
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #1"));
    fireEvent.click(
      screen.getByRole("button", { name: /asignar 'sin clasificar'/i })
    );
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/fumigations/bulk-category",
        expect.objectContaining({
          body: JSON.stringify({ ids: [1], category_id: null })
        })
      );
    });
  });

  it("7. confirm cancela: no fetchea nada", async () => {
    const events = [makeEvent({ id: 1 })];
    window.confirm = vi.fn(() => false);
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #1"));
    fireEvent.click(
      screen.getByRole("button", { name: /borrar fumigaciones seleccionadas/i })
    );
    // No fetch, no refresh
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("8. response no-ok: muestra mensaje de error del server, no refresh", async () => {
    const events = [makeEvent({ id: 1 })];
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Forbidden",
      json: async () => ({ error: "rol insuficiente" })
    });
    render(<FumigacionesTableClient events={events} {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #1"));
    fireEvent.click(
      screen.getByRole("button", { name: /borrar fumigaciones seleccionadas/i })
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/rol insuficiente/i);
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("9. reset de selección al cambiar de página", () => {
    const events = [makeEvent({ id: 1 })];
    const { rerender } = render(
      <FumigacionesTableClient events={events} {...baseProps} page={1} />
    );
    fireEvent.click(screen.getByLabelText("Seleccionar fumigación #1"));
    expect(screen.getByText(/1 fumigaci[oó]n seleccionada?/i)).toBeTruthy();
    // Cambiar a page=2
    rerender(<FumigacionesTableClient events={events} {...baseProps} page={2} />);
    // La selección se resetea
    expect(screen.queryByRole("region", { name: /acciones en bulk/i })).toBeNull();
  });

  it("10. tabla vacía: select-all está disabled", () => {
    render(<FumigacionesTableClient events={[]} {...baseProps} />);
    const selectAll = screen.getByLabelText(/seleccionar todas/i) as HTMLInputElement;
    expect(selectAll.disabled).toBe(true);
  });
});
