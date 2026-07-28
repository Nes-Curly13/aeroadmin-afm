// Tests del primitive Tooltip.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

describe("Tooltip", () => {
  it("renderiza el trigger como hijo focusable", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = screen.getByRole("button", { name: "Hover me" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("data-slot", "tooltip-trigger");
  });

  it("el popup aparece al hacer hover (con delay=0)", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    // @base-ui/react no asigna role="tooltip" al Popup; lo identificamos
    // por data-slot="tooltip-content" (portal-mounted, vive en document.body).
    await user.hover(screen.getByRole("button", { name: "Hover me" }));
    await waitFor(
      () => {
        const popup = document.querySelector('[data-slot="tooltip-content"]');
        expect(popup).not.toBeNull();
        expect(popup).toHaveTextContent("Tooltip text");
      },
      { timeout: 1500 }
    );
  });

  it("el popup tiene data-slot=tooltip-content", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Content here</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await user.hover(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(
      () => {
        const popup = document.querySelector('[data-slot="tooltip-content"]');
        expect(popup).not.toBeNull();
        expect(popup).toHaveAttribute("data-slot", "tooltip-content");
      },
      { timeout: 1500 }
    );
  });

  it("TooltipProvider acepta delay custom sin crashear", () => {
    expect(() =>
      render(
        <TooltipProvider delay={500}>
          <Tooltip>
            <TooltipTrigger>x</TooltipTrigger>
            <TooltipContent>y</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    ).not.toThrow();
  });

  it("sin hover, el popup NO esta en el DOM (closed)", () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>x</TooltipTrigger>
          <TooltipContent>y</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    // El popup está portal-mounted y desmontado cuando closed.
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
});
