// Tests del primitive Progress.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue
} from "@/components/ui/progress";

describe("Progress", () => {
  it("renderiza Track + Indicator dentro del Root", () => {
    const { container } = render(<Progress value={34} />);
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.querySelector('[data-slot="progress-track"]')).not.toBeNull();
    expect(root.querySelector('[data-slot="progress-indicator"]')).not.toBeNull();
  });

  it("acepta value numérico (0-100)", () => {
    const { container } = render(<Progress value={50} />);
    const indicator = container.querySelector(
      '[data-slot="progress-indicator"]'
    ) as HTMLElement;
    // @base-ui/react/indicator aplica style="transform: translateX(-50%)" o width:50%
    // según implementación. Verificamos que el root expone el value via aria-valuenow.
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root.getAttribute("aria-valuenow")).toBe("50");
    expect(indicator).not.toBeNull();
  });

  it("valor 0 → aria-valuenow=0", () => {
    const { container } = render(<Progress value={0} />);
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root.getAttribute("aria-valuenow")).toBe("0");
  });

  it("valor 100 → aria-valuenow=100", () => {
    const { container } = render(<Progress value={100} />);
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root.getAttribute("aria-valuenow")).toBe("100");
  });

  it("ProgressLabel renderiza con data-slot=progress-label", () => {
    render(
      <Progress value={10}>
        <ProgressLabel>Cargando parcelas</ProgressLabel>
      </Progress>
    );
    const label = screen.getByText("Cargando parcelas");
    expect(label).toHaveAttribute("data-slot", "progress-label");
  });

  it("ProgressValue muestra el porcentaje", () => {
    render(
      <Progress value={42}>
        <ProgressValue />
      </Progress>
    );
    // @base-ui/react/value formatea como "{n}%" o similar; verificamos que muestra 42.
    const value = screen.getByText(/42/);
    expect(value).toBeInTheDocument();
  });

  it("exhibe role=progressbar", () => {
    const { container } = render(<Progress value={20} />);
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root.getAttribute("role")).toBe("progressbar");
  });

  it("className del caller se mergea en Root", () => {
    const { container } = render(<Progress value={10} className="w-1/2" />);
    const root = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(root.className).toMatch(/w-1\/2/);
  });
});
