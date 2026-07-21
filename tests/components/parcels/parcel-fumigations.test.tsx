/**
 * parcel-fumigations.test.tsx
 *
 * Track B (perf/ux v1.1) — MEJORA 2: pre-llenar el campo
 * `area_fumigated_m2` con `parcel.spray_area_m2` cuando existe.
 *
 * Track C (v1.4) — MEJORA 1: input de nota humana (`human_notes`),
 * separado de `notes` (provenance del backfill).
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
 * Track C — human_notes (v1.4):
 *   5. El form tiene un `<textarea name="human_notes">` para que el operador
 *      pueda dejar contexto libre ("lluvia", "producto nuevo", etc.).
 *   6. La nota humana se muestra en el historial del evento, separada de
 *      `notes` (que es provenance del backfill y NO debe renderizarse).
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

// Track B v1.4: el botón "Registrar fumigación" está envuelto en un
// <RoleGate allow={["admin","supervisor"]}>. El gate llama a
// useUserRole(), que en runtime hace un fetch a /api/auth/me. En test
// no queremos pegarle al endpoint, así que mockeamos el hook para que
// devuelva "supervisor" (uno de los roles permitidos). El comportamiento
// del RoleGate se cubre por separado en role-gate.test.tsx.
const useUserRoleMock = vi.hoisted(() => vi.fn().mockReturnValue("supervisor"));
vi.mock("@/components/auth/use-user-role", () => ({
  useUserRole: useUserRoleMock
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

// ============================================================
// Track C v1.4 — MEJORA 1: input de nota humana del operador
// (separado de `notes` que es provenance del backfill).
// ============================================================
describe("ParcelFumigations — human_notes (Track C v1.4)", () => {
  it("el form tiene un textarea con name='human_notes' (no 'notes')", () => {
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

    // El input se llama `human_notes` (no `notes`) para que el POST mande
    // el body a la nueva columna SQL. Regresión: si alguien renombra de
    // vuelta, este test lo detecta.
    const textarea = screen.getByLabelText(/agregar nota|nota/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.name).toBe("human_notes");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("el textarea tiene maxLength=2000 (alineado con CHECK del schema)", () => {
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

    const textarea = screen.getByLabelText(/agregar nota|nota/i) as HTMLTextAreaElement;
    // El maxLength es solo UX (el server es la defensa real), pero
    // mantenerlo consistente evita mensajes confusos al operador.
    expect(textarea.maxLength).toBe(2000);
  });

  it("muestra human_notes en el historial del evento cuando está presente", () => {
    const eventWithHumanNote: DjiFumigationEvent = {
      id: 1,
      parcel_id: 42,
      fumigation_date: "2026-07-15",
      product_used: "Glifosato",
      dose_l_per_ha: 1.0,
      area_fumigated_m2: 4000,
      drone_code_used: null,
      duration_minutes: 30,
      notes: null, // provenance no presente
      human_notes: "Se atrasó por lluvia matinal, equipo reportó viento fuerte",
      recorded_by: "Juan Pérez",
      recorded_at: "2026-07-15T10:00:00Z",
      source: "manual"
    };
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[eventWithHumanNote]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    // La nota humana se renderiza en el card del evento.
    expect(
      screen.getByText(/se atrasó por lluvia matinal/i)
    ).toBeInTheDocument();
  });

  it("NO muestra notes cuando es provenance JSON (separación técnica vs humana)", () => {
    // Aunque el evento venga con `notes` con JSON de provenance y `human_notes`
    // null, el render filtra la provenance y no muestra nada. La nota humana
    // se renderizaría SOLO si está presente.
    const eventWithProvenanceOnly: DjiFumigationEvent = {
      id: 2,
      parcel_id: 42,
      fumigation_date: "2026-07-10",
      product_used: null,
      dose_l_per_ha: null,
      area_fumigated_m2: null,
      drone_code_used: null,
      duration_minutes: null,
      notes: JSON.stringify({ backfilled_from: "dji_flights", flight_count: 5 }),
      human_notes: null,
      recorded_by: null,
      recorded_at: "2026-07-10T10:00:00Z",
      source: "djiscraper"
    };
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[eventWithProvenanceOnly]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    // El JSON de provenance NO debe aparecer en el DOM (es metadata técnica).
    expect(
      screen.queryByText(/backfilled_from/)
    ).not.toBeInTheDocument();
    // El label del valor tampoco.
    expect(
      screen.queryByText(/"flight_count"/)
    ).not.toBeInTheDocument();
  });
});
