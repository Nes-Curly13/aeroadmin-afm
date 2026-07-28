// Tests del primitive Switch.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch } from "@/components/ui/switch";

describe("Switch", () => {
  it("usa role=switch y aria-checked", () => {
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} label="Etiquetas" />
    );
    const sw = screen.getByRole("switch", { name: "Etiquetas" });
    expect(sw.getAttribute("aria-checked")).toBe("false");

    rerender(<Switch checked={true} onCheckedChange={() => {}} label="Etiquetas" />);
    expect(screen.getByRole("switch", { name: "Etiquetas" }).getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("llama onCheckedChange con el valor opuesto al click", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Etiquetas" />);
    await userEvent.click(screen.getByRole("switch", { name: "Etiquetas" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renderiza el label visible", () => {
    render(<Switch checked={false} onCheckedChange={() => {}} label="Mostrar etiquetas" />);
    expect(screen.getByText("Mostrar etiquetas")).toBeInTheDocument();
  });

  it("respeta disabled", async () => {
    const onChange = vi.fn();
    render(
      <Switch checked={false} disabled onCheckedChange={onChange} label="Etiquetas" />
    );
    await userEvent.click(screen.getByRole("switch", { name: "Etiquetas" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
