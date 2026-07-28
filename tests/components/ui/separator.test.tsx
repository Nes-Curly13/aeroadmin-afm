// Tests del primitive Separator.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Separator } from "@/components/ui/separator";

describe("Separator", () => {
  it("renderiza con data-slot=separator", () => {
    const { container } = render(<Separator />);
    expect(container.querySelector("[data-slot=separator]")).not.toBeNull();
  });

  it("orientacion default horizontal → role=separator + data-orientation=horizontal", () => {
    const { container } = render(<Separator />);
    const el = container.querySelector("[data-slot=separator]") as HTMLElement;
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("orientation=vertical propaga aria-orientation=vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.querySelector("[data-slot=separator]") as HTMLElement;
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("horizontal aplica clase data-horizontal:h-px data-horizontal:w-full", () => {
    const { container } = render(<Separator />);
    const el = container.querySelector("[data-slot=separator]") as HTMLElement;
    expect(el.className).toMatch(/data-horizontal:h-px/);
    expect(el.className).toMatch(/data-horizontal:w-full/);
  });

  it("vertical aplica clase data-vertical:w-px data-vertical:self-stretch", () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.querySelector("[data-slot=separator]") as HTMLElement;
    expect(el.className).toMatch(/data-vertical:w-px/);
    expect(el.className).toMatch(/data-vertical:self-stretch/);
  });

  it("className del caller se mergea", () => {
    const { container } = render(<Separator className="my-2" />);
    const el = container.querySelector("[data-slot=separator]") as HTMLElement;
    expect(el.className).toMatch(/my-2/);
  });
});
