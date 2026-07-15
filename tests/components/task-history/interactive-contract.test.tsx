/**
 * Contract tests para los componentes interactivos del Task History
 * (F3+F4). Verifica que el output HTML matchea el contrato del
 * Figma `AFM_SIG` frame B — no drift permitido.
 *
 * Patrón de assertion: `textContent` (concatena nodos de texto sin
 * tags en medio), `toHaveAttribute`, `getByTestId`, regex.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  }),
  usePathname: () => "/task-history",
  useSearchParams: () => new URLSearchParams()
}));

import { DateRangePicker } from "@/components/task-history/date-range-picker";
import { FilterButton } from "@/components/task-history/filter-button";
import { ScreenshotButton } from "@/components/task-history/screenshot-button";

describe("DateRangePicker — Figma contract", () => {
  it("renderiza 2 inputs tipo date con labels 'Fecha de inicio' y 'Fecha de fin'", () => {
    const { container } = render(<DateRangePicker />);
    const fromInput = screen.getByTestId("task-history-date-from") as HTMLInputElement;
    const toInput = screen.getByTestId("task-history-date-to") as HTMLInputElement;
    expect(fromInput.type).toBe("date");
    expect(toInput.type).toBe("date");
    // Ambos populated con default (últimos 6 meses)
    expect(fromInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // aria-labels específicos
    expect(fromInput.getAttribute("aria-label")).toMatch(/fecha de inicio/i);
    expect(toInput.getAttribute("aria-label")).toMatch(/fecha de fin/i);
    expect(container).toBeTruthy();
  });

  it("'Fecha de fin' tiene min='Fecha de inicio' (constraint de rango)", () => {
    render(<DateRangePicker />);
    const fromInput = screen.getByTestId("task-history-date-from") as HTMLInputElement;
    const toInput = screen.getByTestId("task-history-date-to") as HTMLInputElement;
    // cross-constraints: previene que el user cree rangos inválidos
    expect(toInput.getAttribute("min")).toBe(fromInput.value);
    expect(fromInput.getAttribute("max")).toBe(toInput.value);
  });
});

describe("FilterButton — Figma contract", () => {
  it("renderiza un <details> con summary 'Filter' y panel con 4 controles (parcelId, droneSerial, pilot, cropType)", () => {
    const { container } = render(<FilterButton />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    // summary con label "Filter" (en inglés, igual al plan)
    expect(container.querySelector("summary")?.textContent).toMatch(/filter/i);
    // 3 inputs (parcelId, droneSerial, pilot) + 1 select (cropType) = 4 controles
    const inputs = container.querySelectorAll("input");
    const selects = container.querySelectorAll("select");
    expect(inputs.length).toBe(3);
    expect(selects.length).toBe(1);
    // 4 data-testid presentes
    expect(screen.getByTestId("task-history-filter-parcelId")).toBeTruthy();
    expect(screen.getByTestId("task-history-filter-droneSerial")).toBeTruthy();
    expect(screen.getByTestId("task-history-filter-pilot")).toBeTruthy();
    expect(screen.getByTestId("task-history-filter-cropType")).toBeTruthy();
  });

  it("input 'Parcel ID' tiene inputMode='numeric' (numeric keyboard en mobile)", () => {
    const { container } = render(<FilterButton />);
    const parcelaInput = screen.getByTestId("task-history-filter-parcelId") as HTMLInputElement;
    expect(parcelaInput.getAttribute("inputmode")).toBe("numeric");
    expect(container).toBeTruthy();
  });

  it("botones Apply y Reset presentes con type='button'", () => {
    render(<FilterButton />);
    const apply = screen.getByTestId("task-history-filter-apply") as HTMLButtonElement;
    const reset = screen.getByTestId("task-history-filter-reset") as HTMLButtonElement;
    expect(apply.getAttribute("type")).toBe("button");
    expect(reset.getAttribute("type")).toBe("button");
  });
});

describe("ScreenshotButton — Figma contract", () => {
  it("renderiza un <button> con aria-label en español y SVG icon", () => {
    // S2 (2026-07-13): los strings del botón pasaron a español
    // (convención §2 del proyecto) y el aria-label describe la
    // intención ("Descargar reporte") en vez del mecanismo
    // ("screenshot"). El icono SVG sigue presente.
    const ref = { current: null };
    const { container } = render(
      <ScreenshotButton targetRef={ref as React.RefObject<HTMLElement | null>} />
    );
    const btn = screen.getByRole("button");
    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel.toLowerCase()).toContain("descargar");
    // Icono SVG presente
    expect(container.querySelector("svg")).toBeTruthy();
    // Texto visible contiene 'Descargar reporte' (label idle por default)
    expect(btn.textContent).toMatch(/descargar reporte/i);
  });

  it("el botón es type='button' (no submit accidental)", () => {
    const ref = { current: null };
    const { container } = render(
      <ScreenshotButton targetRef={ref as React.RefObject<HTMLElement | null>} />
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("type")).toBe("button");
  });

  it("usa data-testid para que los tests E2E puedan targetearlo", () => {
    const ref = { current: null };
    render(<ScreenshotButton targetRef={ref as React.RefObject<HTMLElement | null>} />);
    expect(screen.getByTestId("task-history-screenshot-button")).toBeTruthy();
  });
});
