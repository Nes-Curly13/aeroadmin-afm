import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricCard } from "@/components/metric-card";

describe("components/metric-card (shim)", () => {
  it("re-exporta correctamente el componente nuevo", () => {
    expect(MetricCard).toBeDefined();
    render(<MetricCard label="shim" value="ok" />);
    expect(screen.getByText("shim")).toBeInTheDocument();
  });
});
