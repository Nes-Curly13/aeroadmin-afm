/**
 * tests/components/fumigations/fumigation-audit-trail.test.tsx
 *
 * Test del componente FumigationAuditTrail. Sprint 2026-08-15 —
 * feature/fumigation-audit-log / sub-3.
 *
 * Cubre:
 *   - Estado vacío: muestra el mensaje "sin historial" + nota explicativa
 *   - 1 evento created: renderiza con icono verde y label correcto
 *   - 1 evento edited con diff: muestra el botón "N campos cambiados"
 *     y, al hacer click, expande el diff con la lista de cambios
 *   - 1 evento deleted con snapshot: muestra el snapshot de campos
 *   - 1 evento restored: muestra "restaurada desde {fecha} (borrada por X)"
 *   - Múltiples eventos: los renderiza en el orden que llegan (la query
 *     ya los devuelve DESC; el componente no reordena)
 *   - a11y: cada item tiene aria-label descriptivo
 *
 * Sin mocks de red — el componente recibe los eventos como props.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FumigationAuditTrail } from "@/components/fumigations/fumigation-audit-trail";
import type { FumigationAuditEvent } from "@/lib/types";

afterEach(() => {
  cleanup();
});

function makeEvent(overrides: Partial<FumigationAuditEvent> = {}): FumigationAuditEvent {
  return {
    id: 1,
    fumigation_id: 42,
    action: "created",
    actor_email: "admin@aeroadmin.local",
    changes: {},
    created_at: new Date(Date.now() - 60_000).toISOString(), // hace 1 min
    ...overrides
  };
}

describe("FumigationAuditTrail — estado vacío", () => {
  it("muestra mensaje 'sin historial' cuando no hay eventos", () => {
    render(<FumigationAuditTrail events={[]} />);
    expect(screen.getByText(/Sin historial de cambios/i)).toBeDefined();
  });

  it("aclara que fumigaciones históricas no tienen eventos registrados", () => {
    render(<FumigationAuditTrail events={[]} />);
    expect(
      screen.getByText(/Las fumigaciones creadas antes del 2026-08-15/i)
    ).toBeDefined();
  });
});

describe("FumigationAuditTrail — render de cada action", () => {
  it("renderiza evento 'created' con label e icono verde", () => {
    render(
      <FumigationAuditTrail
        events={[makeEvent({ id: 1, action: "created" })]}
      />
    );
    expect(screen.getByText("Fumigación creada")).toBeDefined();
    expect(screen.getByText("admin@aeroadmin.local")).toBeDefined();
    // aria-label del <li> combina label + actor + relative time
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("aria-label")).toMatch(/Fumigación creada por admin@aeroadmin.local/);
  });

  it("renderiza evento 'edited' con el botón 'N campos cambiados'", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 2,
            action: "edited",
            changes: {
              diff: {
                product_used: { from: "Roundup", to: "Glifosato 48%" },
                dose_l_per_ha: { from: 2.0, to: 2.5 }
              }
            }
          })
        ]}
      />
    );
    expect(screen.getByText("Fumigación editada")).toBeDefined();
    // Botón que dice "2 campos cambiados" (con plural)
    const button = screen.getByRole("button", { name: /2 campos cambiados/ });
    expect(button).toBeDefined();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("expande el diff al hacer click en el botón", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 3,
            action: "edited",
            changes: {
              diff: {
                product_used: { from: "Roundup", to: "Glifosato 48%" }
              }
            }
          })
        ]}
      />
    );
    const button = screen.getByRole("button", { name: /1 campo cambiado/ });
    // Click → expand
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // El diff se renderiza en una región con aria-label "Detalle de cambios"
    const region = screen.getByRole("region", { name: "Detalle de cambios" });
    expect(within(region).getByText("Producto:")).toBeDefined();
    // Valores del diff
    expect(within(region).getByText("Roundup")).toBeDefined();
    expect(within(region).getByText("Glifosato 48%")).toBeDefined();
  });

  it("colapsa el diff al hacer click de nuevo en el botón", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 4,
            action: "edited",
            changes: {
              diff: { notes: { from: "a", to: "b" } }
            }
          })
        ]}
      />
    );
    const button = screen.getByRole("button", { name: /1 campo cambiado/ });
    fireEvent.click(button); // expand
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button); // collapse
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("renderiza evento 'deleted' con snapshot de campos no-vacíos", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 5,
            action: "deleted",
            changes: {
              snapshot: {
                product_used: "Glifosato 48%",
                dose_l_per_ha: 2.5,
                notes: null, // no debería renderizarse
                category_id: null
              }
            }
          })
        ]}
      />
    );
    expect(screen.getByText("Fumigación eliminada")).toBeDefined();
    // El snapshot region existe
    const region = screen.getByRole("region", { name: /Snapshot de la fumigación/ });
    expect(within(region).getByText("Glifosato 48%")).toBeDefined();
    expect(within(region).getByText("2.50")).toBeDefined(); // dose con 2 decimales
    // No debe renderizar nulls
    expect(within(region).queryByText("Notas:")).toBeNull();
  });

  it("renderiza evento 'restored' con metadata del estado pre-restore", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 6,
            action: "restored",
            changes: {
              restored_from: {
                deleted_at: "2026-08-14T10:00:00.000Z",
                deleted_by: "supervisor@afm.local"
              }
            }
          })
        ]}
      />
    );
    expect(screen.getByText("Fumigación restaurada")).toBeDefined();
    expect(
      screen.getByText(/Restaurada desde.*borrada por supervisor@afm\.local/)
    ).toBeDefined();
  });
});

describe("FumigationAuditTrail — múltiples eventos", () => {
  it("renderiza N items con el orden recibido (la query ya devuelve DESC)", () => {
    const events = [
      makeEvent({ id: 10, action: "edited", created_at: "2026-08-15T12:00:00.000Z" }),
      makeEvent({ id: 9, action: "created", created_at: "2026-08-15T10:00:00.000Z" })
    ];
    render(<FumigationAuditTrail events={events} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // El primero es el edited (id 10), el segundo el created (id 9)
    expect(items[0].getAttribute("aria-label")).toMatch(/Fumigación editada/);
    expect(items[1].getAttribute("aria-label")).toMatch(/Fumigación creada/);
  });

  it("el <ol> raíz tiene aria-label con el count de eventos", () => {
    const events = [
      makeEvent({ id: 1, action: "created" }),
      makeEvent({ id: 2, action: "edited" }),
      makeEvent({ id: 3, action: "deleted" })
    ];
    render(<FumigationAuditTrail events={events} />);
    const ol = screen.getByRole("list");
    expect(ol.getAttribute("aria-label")).toBe("Historial de la fumigación (3 eventos)");
  });

  it("singular '1 evento' cuando hay un solo evento", () => {
    render(<FumigationAuditTrail events={[makeEvent()]} />);
    const ol = screen.getByRole("list");
    expect(ol.getAttribute("aria-label")).toBe("Historial de la fumigación (1 evento)");
  });
});

describe("FumigationAuditTrail — formato de valores del diff", () => {
  it("formatea fecha YYYY-MM-DD a DD/MM/YYYY", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 1,
            action: "edited",
            changes: {
              diff: {
                fumigation_date: { from: "2026-08-01", to: "2026-08-15" }
              }
            }
          })
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 campo cambiado/ }));
    const region = screen.getByRole("region", { name: "Detalle de cambios" });
    expect(within(region).getByText("01/08/2026")).toBeDefined();
    expect(within(region).getByText("15/08/2026")).toBeDefined();
  });

  it("formatea null como '—' en el diff", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 1,
            action: "edited",
            changes: {
              diff: {
                notes: { from: "antes", to: null }
              }
            }
          })
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 campo cambiado/ }));
    const region = screen.getByRole("region", { name: "Detalle de cambios" });
    expect(within(region).getByText("—")).toBeDefined();
  });

  it("formatea entero sin decimales y float con 2", () => {
    render(
      <FumigationAuditTrail
        events={[
          makeEvent({
            id: 1,
            action: "edited",
            changes: {
              diff: {
                duration_minutes: { from: 30, to: 45 }, // enteros
                dose_l_per_ha: { from: 2.1, to: 2.5 } // floats NO enteros
              }
            }
          })
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /2 campos cambiados/ }));
    const region = screen.getByRole("region", { name: "Detalle de cambios" });
    // Enteros: sin decimales
    expect(within(region).getByText("30")).toBeDefined();
    expect(within(region).getByText("45")).toBeDefined();
    // Floats: 2 decimales (Number.isInteger(2.1) === false → toFixed(2))
    expect(within(region).getByText("2.10")).toBeDefined();
    expect(within(region).getByText("2.50")).toBeDefined();
  });
});
