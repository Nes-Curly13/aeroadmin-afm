import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricCard } from "@/components/ui/metric-card";

describe("MetricCard", () => {
  it("renderiza label, value, hint y accent", () => {
    render(<MetricCard accent={<span data-testid="accent">*</span>} hint="cobertura" label="Misiones" value="42" />);
    expect(screen.getByText("Misiones")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("cobertura")).toBeInTheDocument();
    expect(screen.getByTestId("accent")).toBeInTheDocument();
  });

  it("funciona sin hint", () => {
    render(<MetricCard label="Sin hint" value="7" />);
    expect(screen.getByText("Sin hint")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("funciona sin accent", () => {
    render(<MetricCard label="Sin accent" value="1" />);
    expect(screen.queryByTestId("accent")).not.toBeInTheDocument();
  });

  it("aplica el tone via data-tone attribute", () => {
    const { rerender } = render(<MetricCard label="x" tone="success" value="1" />);
    expect(screen.getByText("1").closest("[data-tone]")).toHaveAttribute("data-tone", "success");

    rerender(<MetricCard label="x" tone="danger" value="1" />);
    expect(screen.getByText("1").closest("[data-tone]")).toHaveAttribute("data-tone", "danger");

    rerender(<MetricCard label="x" tone="warning" value="1" />);
    expect(screen.getByText("1").closest("[data-tone]")).toHaveAttribute("data-tone", "warning");
  });

  it("default tone es default", () => {
    render(<MetricCard label="x" value="1" />);
    expect(screen.getByText("1").closest("[data-tone]")).toHaveAttribute("data-tone", "default");
  });

  it("pasa testId al contenedor", () => {
    render(<MetricCard label="x" testId="my-metric" value="1" />);
    expect(screen.getByTestId("my-metric")).toBeInTheDocument();
  });

  it("soporta los 5 tonos sin errores", () => {
    const tones = ["default", "success", "warning", "danger", "info"] as const;
    for (const tone of tones) {
      const { unmount } = render(<MetricCard label={`tone-${tone}`} tone={tone} value="1" />);
      expect(screen.getByText(`tone-${tone}`)).toBeInTheDocument();
      unmount();
    }
  });
});
