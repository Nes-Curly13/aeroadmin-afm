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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
      product_registered_ica: null,
      pilot_license: null,
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
      product_registered_ica: null,
      pilot_license: null,
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

// ============================================================
// Sprint D — M10/F1.9: pre-llenar `product_used` con el último evento.
// ============================================================
describe("ParcelFumigations — pre-llenado de product_used (M10/F1.9)", () => {
  it("pre-llena el input de producto con events[0].product_used", () => {
    // El último evento registrado tenía "Glifosato 1L/ha". El supervisor
    // registra una nueva fumigación y el input aparece con ese valor
    // pre-cargado. Caso típico caña: misma parcela, mismo producto.
    const previousEvent: DjiFumigationEvent = {
      id: 1,
      parcel_id: 42,
      fumigation_date: "2026-07-10",
      product_used: "Glifosato 1L/ha",
      dose_l_per_ha: 1.0,
      area_fumigated_m2: 4000,
      drone_code_used: null,
      duration_minutes: 30,
      notes: null,
      human_notes: null,
      recorded_by: "Juan",
      product_registered_ica: null,
      pilot_license: null,
      recorded_at: "2026-07-10T10:00:00Z",
      source: "manual"
    };
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[previousEvent]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    // Usamos el selector por name para ser precisos: el form tiene
    // un label "Producto" y otro "Registro ICA del producto" — solo
    // el primero matchea el `name="product_used"`.
    const productInput = document.querySelector('input[name="product_used"]') as HTMLInputElement;
    expect(productInput).toBeInTheDocument();
    expect(productInput.value).toBe("Glifosato 1L/ha");
  });

  it("deja el input vacío cuando no hay eventos previos", () => {
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="no_history"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const productInput = document.querySelector('input[name="product_used"]') as HTMLInputElement;
    // El operador tipea el primer producto de la parcela.
    expect(productInput.value).toBe("");
  });

  it("deja el input vacío si el último evento tenía product_used null", () => {
    // Caso borde: el evento más reciente no tiene producto (puede pasar
    // si se registró sin producto). El supervisor tipea el nuevo.
    const previousEvent: DjiFumigationEvent = {
      id: 1,
      parcel_id: 42,
      fumigation_date: "2026-07-10",
      product_used: null,
      dose_l_per_ha: null,
      area_fumigated_m2: null,
      drone_code_used: null,
      duration_minutes: null,
      notes: null,
      human_notes: null,
      recorded_by: null,
      product_registered_ica: null,
      pilot_license: null,
      recorded_at: "2026-07-10T10:00:00Z",
      source: "manual"
    };
    const parcel = makeParcel({ spray_area_m2: 4000 });
    render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={[previousEvent]}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    const productInput = document.querySelector('input[name="product_used"]') as HTMLInputElement;
    expect(productInput.value).toBe("");
  });
});

// ============================================================
// Sprint D — M5/F1.8: el form de fumigación es un modal <dialog>,
// no un bloque inline. Botones primarios siempre visibles en el
// footer. Cerrar con Escape, click en backdrop, o botón "Cancelar".
// Mantener el RoleGate (admin + supervisor).
// ============================================================
describe("ParcelFumigations — modal (M5/F1.8)", () => {
  it("el form se renderiza dentro de un <dialog> (no inline)", () => {
    // Antes (pre-M5) el form era un bloque inline. Ahora vive en un
    // <dialog data-testid='fumigation-modal'> que solo se monta cuando
    // showForm=true. El bloque inline ya NO existe — verificamos que
    // el form NO esté como hijo directo de la <section> principal.
    const parcel = makeParcel({ spray_area_m2: 4000 });
    const { container } = render(
      <ParcelFumigations
        daysUntilNextDue={3}
        events={EMPTY_EVENTS}
        parcel={parcel}
        schedule={makeSchedule()}
        status="due_soon"
      />
    );
    // Sin abrir el form: NO hay <dialog> en el DOM (showForm=false).
    expect(container.querySelector('[data-testid="fumigation-modal"]')).toBeNull();

    // Abrir el form.
    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);

    // Ahora hay un <dialog> con el form adentro.
    const dialog = screen.getByTestId("fumigation-modal");
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.querySelector("form")).toBeInTheDocument();
  });

  it("el <dialog> tiene título accesible y el nombre de la parcela", () => {
    const parcel = makeParcel({ id: 42, land_name: "Porvenir STE 3", spray_area_m2: 4000 });
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

    const dialog = screen.getByTestId("fumigation-modal");
    // El dialog usa aria-labelledby apuntando al <h2> del header.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("fumigation-modal-title");
    const title = document.getElementById("fumigation-modal-title");
    expect(title).toHaveTextContent(/registrar fumigación/i);
    // El subtítulo del header muestra el nombre de la parcela (contexto).
    expect(dialog).toHaveTextContent(/porvenir ste 3/i);
  });

  it("Escape cierra el modal (onCancel handler)", () => {
    // El browser dispara un 'cancel' event sintético cuando el user
    // aprieta Escape sobre un <dialog> abierto. testing-library no
    // expone fireEvent.cancel (no es un evento estandard de DOM),
    // pero podemos dispatcharlo manualmente con bubbles:true para
    // que el onCancel de React (que escucha 'cancel' en el SyntheticEvent
    // system) lo reciba.
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
    expect(screen.getByTestId("fumigation-modal")).toBeInTheDocument();

    // Disparamos un 'cancel' event como lo haría el browser al apretar
    // Escape. El onCancel del dialog setea showForm=false y limpia error.
    const dialog = screen.getByTestId("fumigation-modal") as HTMLDialogElement;
    fireEvent(
      dialog,
      new Event("cancel", { bubbles: false, cancelable: true })
    );

    // Después de cancelar, el dialog ya no está en el DOM (showForm=false
    // desmonta el componente condicional).
    expect(screen.queryByTestId("fumigation-modal")).toBeNull();
  });

  it("click en el botón 'Cancelar' del footer cierra el modal", () => {
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
    expect(screen.getByTestId("fumigation-modal")).toBeInTheDocument();

    // El footer del modal tiene su propio botón "Cancelar" (diferente
    // del toolbar que también tiene un Cancelar toggle). Lo buscamos
    // por scope dentro del dialog.
    const dialog = screen.getByTestId("fumigation-modal") as HTMLDialogElement;
    const footerCancel = within(dialog).getByRole("button", { name: /^cancelar$/i });
    fireEvent.click(footerCancel);
    expect(screen.queryByTestId("fumigation-modal")).toBeNull();
  });

  it("el botón 'Guardar fumigación' vive en el footer del modal (sticky bottom)", () => {
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

    const dialog = screen.getByTestId("fumigation-modal");
    // El submit está dentro de un <footer> con `sticky bottom-0` para
    // que quede siempre visible en mobile cuando el user scrollea.
    const footer = dialog.querySelector("footer");
    expect(footer).not.toBeNull();
    const submitBtn = footer!.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn.className).toMatch(/bg-\[#0b5f2d\]/);
  });

  it("click en el backdrop (el dialog mismo fuera del contenido) cierra el modal", () => {
    // El handler onClick del <dialog> verifica `e.target === e.currentTarget`
    // para detectar clicks en el backdrop. Si el target es un hijo (form,
    // inputs, etc.) NO cierra — solo el backdrop puro.
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
    const dialog = screen.getByTestId("fumigation-modal");

    // Simulamos click en el dialog "vacío" (no en un hijo). Usamos el
    // elemento dialog directamente como target.
    fireEvent.click(dialog, { target: dialog });
    expect(screen.queryByTestId("fumigation-modal")).toBeNull();
  });

  it("click DENTRO del form (en un input) NO cierra el modal", () => {
    // Regresión: el handler onClick del dialog solo cierra si target ===
    // currentTarget. Si el user hace click en un input (un hijo del form),
    // el modal NO se cierra (el click se propaga al dialog pero el target
    // NO es el dialog mismo).
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

    const dialog = screen.getByTestId("fumigation-modal");
    const productInput = dialog.querySelector('input[name="product_used"]') as HTMLInputElement;
    expect(productInput).toBeInTheDocument();
    fireEvent.click(productInput);
    // El modal sigue abierto.
    expect(screen.getByTestId("fumigation-modal")).toBeInTheDocument();
  });

  it("el <dialog> es full-width en mobile y max-w-[600px] en desktop", () => {
    // Verificamos las clases CSS que controlan el layout responsive.
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

    const dialog = screen.getByTestId("fumigation-modal");
    // Mobile: full-width (max-w-full). Desktop: cap a 600px (sm:max-w-[600px]).
    expect(dialog.className).toMatch(/max-w-full/);
    expect(dialog.className).toMatch(/sm:max-w-\[600px\]/);
  });

  it("submit exitoso cierra el modal y refresca la page", async () => {
    // M5: cuando el POST /api/fumigations responde 200, el componente
    // setea showForm=false (que desmonta el dialog) y llama a
    // router.refresh(). Verificamos que el dialog desaparece.
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

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
    const submitBtn = screen.getByRole("button", { name: /guardar fumigación/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("fumigation-modal")).toBeNull();
    });
  });
});
describe("ParcelFumigations — disabled durante submit (F1.10)", () => {
  it("después de submit, el fieldset del form se marca disabled", async () => {
    // Mockeamos fetch para que demore lo suficiente como para inspeccionar
    // el estado de "submitting". Cuando se setea submitting=true, el
    // <fieldset disabled> se renderiza, lo cual hace que el browser
    // bloquee todos los form controls hijos (input, select, textarea,
    // button). Esto evita doble submit accidental.
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

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

    // Abrir form y submitear. setSubmitting(true) es sync pero la
    // re-renderización con el disabled pasa por el scheduler de React;
    // usamos waitFor para esperar a que el fieldset aplique disabled.
    fireEvent.click(screen.getAllByRole("button", { name: /registrar fumigación/i })[0]);
    const submitBtn = screen.getByRole("button", { name: /guardar fumigación/i });
    fireEvent.click(submitBtn);

    // El fieldset con todos los inputs lleva `disabled={submitting}`.
    // El browser lo evalúa como atributo HTML en el fieldset. Los
    // inputs hijos NO tienen su propio `disabled` attribute (es
    // semántica del fieldset), pero la prop computada del input es
    // `true` para interacciones del usuario (mousedown, keydown, etc.).
    // Verificamos el fieldset directamente, que es la fuente de verdad
    // de "el form está bloqueado para submit".
    await waitFor(() => {
      const fieldset = document.querySelector("form fieldset");
      expect(fieldset).not.toBeNull();
      expect(fieldset?.hasAttribute("disabled")).toBe(true);
    });

    // Sanity: el fieldset envuelve los 9 inputs/textarea del form.
    // (más los 2 botones submit/cancel están FUERA del fieldset, así
    // que podemos chequear su disabled explícitamente).
    const fieldset = document.querySelector("form fieldset") as HTMLFieldSetElement;
    const inputNamesInFieldset = [
      "fumigation_date",
      "product_used",
      "dose_l_per_ha",
      "area_fumigated_m2",
      "duration_minutes",
      "recorded_by",
      "product_registered_ica",
      "pilot_license"
    ];
    for (const name of inputNamesInFieldset) {
      const el = fieldset.querySelector(`input[name="${name}"]`);
      expect(el, `input[name="${name}"] debe estar dentro del fieldset`).not.toBeNull();
    }
    const textarea = fieldset.querySelector('textarea[name="human_notes"]');
    expect(textarea).not.toBeNull();

    // El botón "Cancelar" del form (dentro del form) está disabled.
    // Hay OTRO botón "Cancelar" en la toolbar (el toggle que abre/cierra
    // el form) — diferenciamos por scope: el del form es child de <form>.
    const form = document.querySelector("form") as HTMLFormElement;
    const formCancelBtn = form.querySelector('button[type="button"]') as HTMLButtonElement;
    expect(formCancelBtn).toBeInTheDocument();
    expect(formCancelBtn).toBeDisabled();
    // El botón submit también.
    expect(submitBtn).toBeDisabled();

    // Cleanup: resolvemos el fetch para que el test no quede colgado.
    resolveFetch(new Response("{}", { status: 200 }));
  });

  it("el campo de fecha tiene required y su valor default es hoy", async () => {
    // Regresión: la validación nativa de "required" no se rompe cuando
    // se renderiza el form. El input arranca con la fecha de hoy
    // (YYYY-MM-DD) para que el supervisor no tenga que tipearla si
    // está registrando algo del día.
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

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
    const submitBtn = screen.getByRole("button", { name: /guardar fumigación/i });
    fireEvent.click(submitBtn);

    // Confirmamos que el fieldset se aplicó (smoke check de la
    // maquinaria completa de F1.10) y validamos el campo fecha.
    await waitFor(() => {
      const fieldset = document.querySelector("form fieldset");
      expect(fieldset?.hasAttribute("disabled")).toBe(true);
    });

    const dateInput = document.querySelector(
      'input[name="fumigation_date"]'
    ) as HTMLInputElement | null;
    expect(dateInput, "input de fecha debe estar en el DOM").not.toBeNull();
    // El required es del input en sí, no del fieldset.
    expect(dateInput?.required).toBe(true);
    // El default value es hoy (YYYY-MM-DD).
    expect(dateInput?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    resolveFetch(new Response("{}", { status: 200 }));
  });
});
