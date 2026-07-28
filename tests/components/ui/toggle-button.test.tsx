// Tests del primitive ToggleButton.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToggleButton } from "@/components/ui/toggle-button";

describe("ToggleButton", () => {
  it("renderiza aria-pressed segun el prop pressed", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onPressedChange={() => {}}>
        Filtro
      </ToggleButton>
    );
    const btn = screen.getByRole("button", { name: "Filtro" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    rerender(
      <ToggleButton pressed={true} onPressedChange={() => {}}>
        Filtro
      </ToggleButton>
    );
    expect(screen.getByRole("button", { name: "Filtro" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("llama onPressedChange con el valor opuesto al click", async () => {
    const onChange = vi.fn();
    render(
      <ToggleButton pressed={false} onPressedChange={onChange}>
        Filtro
      </ToggleButton>
    );
    await userEvent.click(screen.getByRole("button", { name: "Filtro" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("no es tipo submit (no dispara form submit)", () => {
    render(
      <form>
        <ToggleButton pressed={false} onPressedChange={() => {}}>
          Filtro
        </ToggleButton>
      </form>
    );
    const btn = screen.getByRole("button", { name: "Filtro" });
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("renderiza el dot color cuando se pasa dotColor", () => {
    const { container } = render(
      <ToggleButton dotColor="#fbbf24" pressed={true} onPressedChange={() => {}} variant="pill">
        Critico
      </ToggleButton>
    );
    const dot = container.querySelector("span[aria-hidden]");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style")).toContain("background-color: rgb(251, 191, 36)");
  });

  it("respeta disabled", async () => {
    const onChange = vi.fn();
    render(
      <ToggleButton disabled pressed={false} onPressedChange={onChange}>
        Filtro
      </ToggleButton>
    );
    await userEvent.click(screen.getByRole("button", { name: "Filtro" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
