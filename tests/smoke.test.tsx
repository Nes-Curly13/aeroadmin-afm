import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricCard } from "@/components/ui/metric-card";

describe("smoke: vitest jsdom + RTL", () => {
  it("renderiza un componente simple con RTL", () => {
    render(<MetricCard label="Test" value="42" hint="hint" accent={<span>x</span>} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
