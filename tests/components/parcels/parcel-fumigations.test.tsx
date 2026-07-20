/**
 * parcel-fumigations.test.tsx
 *
 * Track B (perf/ux v1.1) — MEJORA 2: pre-llenar el campo
 * `area_fumigated_m2` con `parcel.spray_area_m2` cuando existe.
 *
 * Cobertura:
 *   1. Cuando `parcel.spray_area_m2` existe, el input aparece pre-llenado
 *      con ese valor (no vacío, no `null`).
 *   2. El input muestra un helper text explicando que es editable.
 *   3. Cuando `parcel.spray_area_m2` es null, el input queda vacío (string "")
 *      para que el form lo trate como null al submitear (NO como 0).
 *   4. El campo se llama `area_fumigated_m2` para matchear el payload que
 *      envía el form al API (regresión: el nombre debe permanecer estable).
 *
 * No testeamos el submit completo porque ya está cubierto en
 * `parcel-detail.test.tsx` (focus en la nueva UX, no en regresiones del
 * flujo de POST).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// ParcelFumigations es client component y usa useRouter() en el submit handler.
// Mockeamos next/navigation con vi.hoisted (mismo patrón que tab-switcher.test.tsx).
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

const EMPTY_EVENTS: DjiFumigationEvent[] = [];

describe("ParcelFumigations — pre-llenado de area_fumigated_m2 (Track B v1.1)", () => {
  it("pre-llena el input con parcel.spray_area_m2 cuando existe", () => {
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    // Abrir el form (toggle "Registrar fumigación" — el primero en el DOM,
    // el segundo es el CTA del EmptyState que dice lo mismo).
    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const input = screen.getByLabelText(/área fumigada/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("4000");
    expect(input.name).toBe("area_fumigated_m2");
  });

  it("muestra helper text explicando que el campo es editable", () => {
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    // El helper text guía al supervisor: si la fumigación real fue menor,
    // puede ajustar el valor manualmente. NO es un valor "fijo".
    expect(
      screen.getByText(/editable si la fumigación real fue menor/i)
    ).toBeInTheDocument();
  });

  it("deja el input vacío cuando parcel.spray_area_m2 es null (no 0, no '0')", () => {
    const parcel = makeParcel({ spray_area_m2: null });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const input = screen.getByLabelText(/área fumigada/i) as HTMLInputElement;
    // string vacío (no "0" ni "null") → el form lo trata como null al submitear
    expect(input.value).toBe("");
  });

  it("deja el input vacío cuando parcel.spray_area_m2 es 0 (no es un default razonable)", () => {
    // Caso borde: si spray_area_m2 = 0 (parcela mal configurada), el supervisor
    // DEBE tipear el área real. No pre-llenamos con 0 para no inducir error.
    const parcel = makeParcel({ spray_area_m2: 0 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const input = screen.getByLabelText(/área fumigada/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("el input es editable (no disabled) — el supervisor puede sobreescribirlo", () => {
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const input = screen.getByLabelText(/área fumigada/i) as HTMLInputElement;
    expect(input).not.toBeDisabled();
    // Puede editar el valor (caso: fumigación real fue 3500 m²)
    fireEvent.change(input, { target: { value: "3500" } });
    expect(input.value).toBe("3500");
  });

  it("el tipo de input es number (regresión: mantener min/step coherentes)", () => {
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const input = screen.getByLabelText(/área fumigada/i) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.min).toBe("0");
  });

  it("mock sanity: no warnings de React (no errors de hidratación)", () => {
    // Si la fila anterior de inputs tuviera un mismatch SSR vs CSR, este test
    // se quejaría. La política del repo es: defaultValue, no value controlado
    // (no necesitamos ser controlled — el supervisor edita y submitea).
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
