import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OperationsSummary } from "@/components/dashboard/operations-summary";

describe("OperationsSummary", () => {
  it("renderiza con datos típicos", () => {
    render(
      <OperationsSummary
        avgArea={42.5}
        avgUsage={500.3}
        highDays={5}
        topMonth="Jun 26"
        topMonthCount={12}
        yearTotalArea={1234.5}
        yearTotalUsage={15000.7}
      />
    );
    expect(screen.getByText(/reporte 2026/i)).toBeInTheDocument();
    expect(screen.getByText("42.5 ha")).toBeInTheDocument();
    expect(screen.getByText("500.3 L")).toBeInTheDocument();
    expect(screen.getByText("Jun 26")).toBeInTheDocument();
    expect(screen.getByText(/12 registros/i)).toBeInTheDocument();
  });

  it("muestra N/A y Sin datos cuando topMonth es undefined", () => {
    render(
      <OperationsSummary
        avgArea={10}
        avgUsage={100}
        highDays={0}
        topMonth={undefined}
        topMonthCount={0}
        yearTotalArea={0}
        yearTotalUsage={0}
      />
    );
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });

  it("renderiza con avgArea=0 y avgUsage=0 sin NaN", () => {
    render(
      <OperationsSummary
        avgArea={0}
        avgUsage={0}
        highDays={0}
        topMonth="May 26"
        topMonthCount={1}
        yearTotalArea={0}
        yearTotalUsage={0}
      />
    );
    expect(screen.getByText("0 ha")).toBeInTheDocument();
    expect(screen.getByText("0.0 L")).toBeInTheDocument();
  });

  it("incluye el texto descriptivo del panel", () => {
    render(
      <OperationsSummary
        avgArea={10}
        avgUsage={100}
        highDays={1}
        topMonth="X"
        topMonthCount={1}
        yearTotalArea={10}
        yearTotalUsage={100}
      />
    );
    expect(screen.getByText(/dji/i)).toBeInTheDocument();
  });
});
