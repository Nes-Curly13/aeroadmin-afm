// tests/components/dashboard/planning-board.test.tsx
//
// Tests del tablero MANUAL de planificación (2026-09-15). Reemplaza al
// planning-panel (auto-derivado). El tablero arranca vacío y el operador
// agenda los planes a mano.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() })
}));

import { PlanningBoard } from "@/components/dashboard/planning-board";
import type { FumigationPlan, ParcelPickerRow } from "@/api/repositories";

const TODAY = "2026-09-15";

const parcels: ParcelPickerRow[] = [
  {
    id: 5,
    land_name: "Lote 24",
    external_id: "EXT-1",
    source: "dji",
    client_name: "Agro XYZ",
    farm_name: "La Esperanza",
    municipality: "Palmira"
  }
];

const base: FumigationPlan = {
  id: 1,
  parcel_id: 5,
  land_name: "Lote 24",
  client_name: "Agro XYZ",
  farm_name: "La Esperanza",
  planned_date: "2026-09-10",
  category_id: 2,
  category_slug: "insecticida",
  application_type_id: null,
  application_type_slug: null,
  product_name: "Confidor",
  notes: null,
  status: "planificada",
  completed_fumigation_id: null,
  created_by_email: "op@afm.local",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  days_until: -5,
  is_overdue: true
};

const plan = (over: Partial<FumigationPlan>): FumigationPlan => ({
  ...base,
  ...over
});

const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  refresh.mockReset();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("PlanningBoard — planificación manual", () => {
  it("1. arranca VACÍO (no auto-genera planes)", () => {
    render(<PlanningBoard plans={[]} parcels={parcels} today={TODAY} canManage />);
    expect(screen.getByTestId("planning-empty")).toBeInTheDocument();
    expect(screen.queryByText(/Vencidas/)).not.toBeInTheDocument();
  });

  it("2. agrupa en Vencidas / Esta semana / Próximas", () => {
    render(
      <PlanningBoard
        plans={[
          plan({ id: 1, is_overdue: true, days_until: -3, planned_date: "2026-09-12" }),
          plan({ id: 2, is_overdue: false, days_until: 2, planned_date: "2026-09-17" }),
          plan({ id: 3, is_overdue: false, days_until: 20, planned_date: "2026-10-05" })
        ]}
        parcels={parcels}
        today={TODAY}
        canManage
      />
    );
    expect(screen.getByText(/Vencidas/)).toBeInTheDocument();
    expect(screen.getByText(/Esta semana/)).toBeInTheDocument();
    expect(screen.getByText(/Próximas/)).toBeInTheDocument();
    // Badge exacto "Vencida" (no matchea el header "Vencidas")
    expect(screen.getByText("Vencida")).toBeInTheDocument();
  });

  it("3. cada plan tiene link 'Registrar' al wizard con ?parcel=", () => {
    render(
      <PlanningBoard plans={[plan({})]} parcels={parcels} today={TODAY} canManage />
    );
    const link = screen.getByRole("link", { name: /Registrar/i });
    expect(link).toHaveAttribute("href", "/fumigaciones/nueva?parcel=5");
  });

  it("4. crear plan: POST a la API y refresh", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {} }) });
    render(
      <PlanningBoard plans={[]} parcels={parcels} today={TODAY} canManage />
    );
    await user.click(screen.getByTestId("planning-new-toggle"));
    await user.selectOptions(screen.getByTestId("planning-parcel"), "5");
    await user.click(screen.getByRole("button", { name: /Agendar plan/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/admin/fumigation-plans");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.parcel_id).toBe(5);
    expect(body.planned_date).toBe(TODAY);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("5. 'Marcar como hecha' hace PATCH status=hecha", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(
      <PlanningBoard
        plans={[plan({ id: 9 })]}
        parcels={parcels}
        today={TODAY}
        canManage
      />
    );
    await user.click(
      screen.getByRole("button", { name: /Marcar como hecha/i })
    );
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/fumigation-plans/9",
        expect.objectContaining({ method: "PATCH" })
      )
    );
    const body = JSON.parse(
      (mockFetch.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body).toEqual({ status: "hecha" });
  });

  it("6. canManage=false: sin botón 'Nuevo plan' ni acciones", () => {
    render(
      <PlanningBoard
        plans={[plan({})]}
        parcels={parcels}
        today={TODAY}
        canManage={false}
      />
    );
    expect(screen.queryByTestId("planning-new-toggle")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Marcar como hecha/i })
    ).not.toBeInTheDocument();
    // El link "Registrar" sigue disponible (solo lectura + navegación)
    expect(screen.getByRole("link", { name: /Registrar/i })).toBeInTheDocument();
  });

  it("7. muestra error del server al crear", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "la parcela no existe" })
    });
    render(
      <PlanningBoard plans={[]} parcels={parcels} today={TODAY} canManage />
    );
    await user.click(screen.getByTestId("planning-new-toggle"));
    await user.selectOptions(screen.getByTestId("planning-parcel"), "5");
    await user.click(screen.getByRole("button", { name: /Agendar plan/i }));
    expect(await screen.findByTestId("planning-error")).toHaveTextContent(
      /la parcela no existe/
    );
  });
});
