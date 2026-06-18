import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MapLegend } from "@/components/map/map-legend";

describe("MapLegend", () => {
  const LAYERS = { parcels: true, flights: false, alerts: true };

  it("renderiza las 3 entradas con sus labels", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    expect(screen.getByText(/geometry/i)).toBeInTheDocument();
    expect(screen.getByText(/summaries/i)).toBeInTheDocument();
    expect(screen.getByText(/alerts/i)).toBeInTheDocument();
  });

  it("cada checkbox refleja el estado de su layer", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });

  it("click en checkbox de parcels invoca onToggle('parcels')", () => {
    const onToggle = vi.fn();
    render(<MapLegend layers={LAYERS} onToggle={onToggle} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith("parcels");
  });

  it("click en checkbox de flights invoca onToggle('flights')", () => {
    const onToggle = vi.fn();
    render(<MapLegend layers={LAYERS} onToggle={onToggle} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenCalledWith("flights");
  });

  it("click en checkbox de alerts invoca onToggle('alerts')", () => {
    const onToggle = vi.fn();
    render(<MapLegend layers={LAYERS} onToggle={onToggle} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[2]);
    expect(onToggle).toHaveBeenCalledWith("alerts");
  });

  it("tiene aria-label claro", () => {
    render(<MapLegend ariaLabel="Leyenda personalizada" layers={LAYERS} onToggle={() => {}} />);
    expect(screen.getByRole("region", { name: /leyenda personalizada/i })).toBeInTheDocument();
  });
});
