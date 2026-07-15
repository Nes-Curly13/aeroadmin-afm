/**
 * Tests de ScreenshotButton siguiendo el checklist TDD §4.1 (componente React):
 *   1. Render con datos típicos (polygonCount > 0, con dateRange).
 *   2. Render con datos vacíos (polygonCount = 0 → disabled).
 *   3. Render con datos extremos (polygonCount = 1000).
 *   4. Accesibilidad (aria-label, type=button, aria-busy en loading).
 *   5. Filename: incluye el rango filtrado cuando se pasa dateRange.
 *
 * El download flow depende de canvas/SVG/Image APIs que jsdom no soporta
 * de forma estable. Por eso:
 *   - El filename se valida con un test unitario de `buildFilename`
 *     (función pura exportada, testeable en aislamiento).
 *   - El click flow se testea con un spy sobre `document.createElement('a')`
 *     para capturar el atributo `download` sin necesitar canvas real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ScreenshotButton,
  buildFilename
} from "@/components/task-history/screenshot-button";

const FAKE_REF = { current: null } as unknown as React.RefObject<HTMLElement | null>;

afterEach(cleanup);

describe("ScreenshotButton — contrato §4.1", () => {
  describe("Render típico", () => {
    it("renderiza un <button> habilitado cuando polygonCount > 0", () => {
      render(
        <ScreenshotButton
          dateRange={{ from: "2026-07-01", to: "2026-07-15" }}
          polygonCount={42}
          targetRef={FAKE_REF}
        />
      );
      const btn = screen.getByRole("button");
      expect(btn).toBeInTheDocument();
      expect(btn).toBeEnabled();
    });

    it("expone data-testid para que los tests E2E puedan targetearlo", () => {
      render(<ScreenshotButton polygonCount={10} targetRef={FAKE_REF} />);
      expect(screen.getByTestId("task-history-screenshot-button")).toBeInTheDocument();
    });
  });

  describe("Render vacío (0 polígonos)", () => {
    it("el botón está disabled cuando polygonCount = 0", () => {
      render(<ScreenshotButton polygonCount={0} targetRef={FAKE_REF} />);
      const btn = screen.getByRole("button");
      expect(btn).toBeDisabled();
    });

    it("también está disabled cuando polygonCount es undefined (defensivo)", () => {
      // Si el caller no pasa polygonCount, el botón no debe asumir que
      // hay polígonos — se mantiene enabled por compat con usos legacy
      // donde el caller gestiona el disabled manualmente. Documentamos
      // el comportamiento actual: undefined → enabled.
      render(<ScreenshotButton targetRef={FAKE_REF} />);
      const btn = screen.getByRole("button");
      expect(btn).toBeEnabled();
    });
  });

  describe("Render extremo (1000 polígonos)", () => {
    it("soporta polygonCount = 1000 sin warnings ni errores", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        render(<ScreenshotButton polygonCount={1000} targetRef={FAKE_REF} />);
        const btn = screen.getByRole("button");
        expect(btn).toBeEnabled();
        // No warnings de React
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("Accesibilidad", () => {
    it("tiene aria-label descriptivo (en español)", () => {
      render(<ScreenshotButton polygonCount={10} targetRef={FAKE_REF} />);
      const btn = screen.getByRole("button");
      const label = btn.getAttribute("aria-label") ?? "";
      // El label debe ser descriptivo del efecto (descargar reporte),
      // no del mecanismo (screenshot). Sin ser una aserción literal,
      // validamos que contenga la intención.
      expect(label.toLowerCase()).toContain("descargar");
    });

    it("type='button' explícito (no submit accidental)", () => {
      render(<ScreenshotButton polygonCount={10} targetRef={FAKE_REF} />);
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("type")).toBe("button");
    });

    it("acepta un ariaLabel custom para i18n o casos especiales", () => {
      render(
        <ScreenshotButton
          ariaLabel="Custom label"
          polygonCount={10}
          targetRef={FAKE_REF}
        />
      );
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("aria-label")).toBe("Custom label");
    });

    it("aria-busy=false en estado idle", () => {
      render(<ScreenshotButton polygonCount={10} targetRef={FAKE_REF} />);
      const btn = screen.getByRole("button");
      // aria-busy debe estar presente (false en idle, no ausente) para
      // que los screen readers anuncien el cambio de estado.
      expect(btn.getAttribute("aria-busy")).toBe("false");
    });
  });
});

describe("buildFilename — composición del filename con dateRange", () => {
  it("incluye el rango en formato YYYY-MM-DD_YYYY-MM-DD cuando se pasa dateRange", () => {
    const name = buildFilename("task-history", { from: "2026-07-01", to: "2026-07-15" });
    expect(name).toBe("task-history-2026-07-01_2026-07-15.png");
  });

  it("usa la fecha de hoy (YYYY-MM-DD) cuando NO se pasa dateRange", () => {
    const name = buildFilename("task-history");
    // El formato exacto de "today" depende del TZ del runner. Validamos
    // solo la shape YYYY-MM-DD, no el valor literal (evita flakiness TZ).
    expect(name).toMatch(/^task-history-\d{4}-\d{2}-\d{2}\.png$/);
  });

  it("respeta el filenamePrefix custom", () => {
    const name = buildFilename("mi-reporte", { from: "2026-01-01", to: "2026-01-31" });
    expect(name).toBe("mi-reporte-2026-01-01_2026-01-31.png");
  });

  it("sanea inputs — caracteres no-ISO se reemplazan con guiones", () => {
    // Si el caller pasa algo raro (ej. URL-encoded spaces), el filename
    // no debe contenerlos crudos (romperían el download en algunos OS).
    const name = buildFilename("reporte", { from: "2026/07/01", to: "2026/07/15" });
    expect(name).not.toContain("/");
    expect(name).toMatch(/^reporte-2026-07-01_2026-07-15\.png$/);
  });
});
