// Tests del form de fumigación con los nuevos inputs de compliance
// ICA + Aerocivil (Sprint C — H2, 2026-07-23).
//
// Cobertura:
//   1. El form muestra los 2 nuevos inputs (Registro ICA + Licencia piloto).
//   2. Al submitir con los 2 campos poblados, el POST los incluye.
//   3. Si los campos están vacíos, el POST los manda como null (no rompe).
//   4. En la lista, fumigaciones con ICA muestran el valor (testid).
//   5. En la lista, fumigaciones sin ICA NO muestran el campo (regresión).
//   6. La matrícula del dron (dji_drone_models.registration_number) NO se
//      edita desde este form — es admin-only, fuera de scope de H2.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// ParcelFumigations es client component y usa useRouter() en el submit handler.
// Mockeamos next/navigation con vi.hoisted (mismo patrón que parcel-fumigations.test.tsx).
const mockState = vi.hoisted(() => ({
  refreshMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: mockState.refreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/parcels/42",
  useSearchParams: () => new URLSearchParams()
}));

// El botón "Registrar fumigación" está envuelto en RoleGate.
const useUserRoleMock = vi.hoisted(() => vi.fn().mockReturnValue("supervisor"));
vi.mock("@/components/auth/use-user-role", () => ({
  useUserRole: useUserRoleMock
}));

// Mockeamos fetch global para capturar el body del POST.
const fetchMock = vi.hoisted(() => vi.fn());
(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
fetchMock.mockResolvedValue({
  ok: true,
  status: 201,
  json: async () => ({ data: { id: 999 } })
});

import { ParcelFumigations } from "@/components/parcels/parcel-fumigations";
import type {
  DjiFumigationEvent,
  DjiFumigationSchedule,
  DjiParcelRecord
} from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 42,
    external_id: "ext-42",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 4000,
    drone_model_code: 201,
    drone_model_name: "Agras T40",
    spray_width_m: 5.5,
    work_speed_mps: 6,
    optimal_heading_deg: 100,
    radar_height_m: 3,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2,
    no_spray_zone_m2: 0,
    droplet_size: 320,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 10,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-06-17T00:00:00Z",
    ...over
  };
}

function makeSchedule(over: Partial<DjiFumigationSchedule> = {}): DjiFumigationSchedule {
  return {
    parcel_id: 42,
    crop_type: "Caña",
    recommended_cadence_days: 14,
    last_fumigation_date: "2026-06-01",
    next_due_date: "2026-06-15",
    is_active: true,
    notes: null,
    ...over
  };
}

describe("ParcelFumigations — compliance ICA + Aerocivil (H2)", () => {
  it("muestra los 2 nuevos inputs (Registro ICA + Licencia piloto) en el form", () => {
    const parcel = makeParcel();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    // El input se llama `product_registered_ica` y `pilot_license` para
    // matchear el body que envía el form al API. Regresión: si alguien
    // renombra, este test lo detecta.
    const icaInput = screen.getByLabelText(/registro ica del producto/i) as HTMLInputElement;
    expect(icaInput).toBeInTheDocument();
    expect(icaInput.name).toBe("product_registered_ica");
    expect(icaInput.type).toBe("text");
    expect(icaInput.maxLength).toBe(50);

    const licenseInput = screen.getByLabelText(/licencia del piloto/i) as HTMLInputElement;
    expect(licenseInput).toBeInTheDocument();
    expect(licenseInput.name).toBe("pilot_license");
    expect(licenseInput.type).toBe("text");
    expect(licenseInput.maxLength).toBe(20);
  });

  it("muestra placeholders que guían al operador con ejemplos de formato", () => {
    const parcel = makeParcel();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const icaInput = screen.getByLabelText(/registro ica del producto/i) as HTMLInputElement;
    expect(icaInput.placeholder).toBe("ej. ICA-1234-PN");

    const licenseInput = screen.getByLabelText(/licencia del piloto/i) as HTMLInputElement;
    expect(licenseInput.placeholder).toBe("ej. PCA-12345");
  });

  it("al submit con los 2 campos poblados, el POST los incluye en el body", async () => {
    const parcel = makeParcel();
    fetchMock.mockClear();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const icaInput = screen.getByLabelText(/registro ica del producto/i) as HTMLInputElement;
    const licenseInput = screen.getByLabelText(/licencia del piloto/i) as HTMLInputElement;
    fireEvent.change(icaInput, { target: { value: "ICA-1234-PN" } });
    fireEvent.change(licenseInput, { target: { value: "PCA-12345" } });

    fireEvent.click(screen.getByRole("button", { name: /guardar fumigación/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.product_registered_ica).toBe("ICA-1234-PN");
    expect(body.pilot_license).toBe("PCA-12345");
    // El endpoint correcto.
    expect(call[0]).toBe("/api/fumigations");
  });

  it("si los campos están vacíos, el POST los manda como null (no rompe)", async () => {
    const parcel = makeParcel();
    fetchMock.mockClear();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);
    // No tocar los inputs — quedan vacíos.
    fireEvent.click(screen.getByRole("button", { name: /guardar fumigación/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    // string vacío → null en el handler. El server recibe null, no "".
    expect(body.product_registered_ica).toBeNull();
    expect(body.pilot_license).toBeNull();
  });

  it("en la lista, fumigaciones con ICA muestran el valor (testid)", () => {
    const eventWithIca: DjiFumigationEvent = {
      id: 1,
      parcel_id: 42,
      fumigation_date: "2026-07-15",
      product_used: "Glifosato",
      dose_l_per_ha: 1.0,
      area_fumigated_m2: 4000,
      drone_code_used: null,
      duration_minutes: 30,
      notes: null,
      human_notes: null,
      recorded_by: "Juan Pérez",
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345",
      recorded_at: "2026-07-15T10:00:00Z",
      source: "manual"
    };
    const parcel = makeParcel();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[eventWithIca]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    expect(screen.getByTestId("fumigation-ica")).toHaveTextContent("ICA-1234-PN");
    expect(screen.getByTestId("fumigation-pilot-license")).toHaveTextContent("PCA-12345");
  });

  it("en la lista, fumigaciones sin ICA NO muestran los campos (regresión)", () => {
    const eventWithoutIca: DjiFumigationEvent = {
      id: 1,
      parcel_id: 42,
      fumigation_date: "2026-07-15",
      product_used: "Glifosato",
      dose_l_per_ha: 1.0,
      area_fumigated_m2: 4000,
      drone_code_used: null,
      duration_minutes: 30,
      notes: null,
      human_notes: null,
      recorded_by: "Juan Pérez",
      product_registered_ica: null,
      pilot_license: null,
      recorded_at: "2026-07-15T10:00:00Z",
      source: "manual"
    };
    const parcel = makeParcel();
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[eventWithoutIca]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    // Sin ICA populated, NO se renderizan los spans de compliance.
    expect(screen.queryByTestId("fumigation-ica")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fumigation-pilot-license")).not.toBeInTheDocument();
  });
});
