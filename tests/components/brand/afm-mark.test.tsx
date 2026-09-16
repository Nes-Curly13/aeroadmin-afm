/**
 * tests/components/brand/afm-mark.test.tsx
 *
 * Tests para <AfmMark /> — wrapper del logo de AFM Topografía.
 *
 * Cubrimos:
 *   1. Default variant "emblem" → src=/afm-emblem.svg
 *   2. variant="emblem" aspect 423/423 → cuadrado (size = altura)
 *   3. variant="full" aspect 485/695 (size = altura, width = size*0.698)
 *   4. variant="full" propaga unoptimized=true (SVG complejo)
 *   5. variant="emblem" propaga unoptimized=true
 *   6. alt por default es descriptivo y distinto por variant
 *   7. alt custom pisa al default
 *   8. priority se propaga cuando se pide
 *
 * Mockeamos next/image para inspeccionar props sin rasterizar.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const imageSpy = vi.fn(({ src, alt, width, height, unoptimized, priority, className }: {
  src: string;
  alt: string;
  width: number;
  height: number;
  unoptimized?: boolean;
  priority?: boolean;
  className?: string;
}) => (
  <img
    data-testid="afm-mark-img"
    data-src={src}
    data-alt={alt}
    data-width={String(width)}
    data-height={String(height)}
    data-unoptimized={unoptimized ? "true" : "false"}
    data-priority={priority ? "true" : "false"}
    className={className}
  />
));

vi.mock("next/image", () => ({
  default: (props: Parameters<typeof imageSpy>[0]) => imageSpy(props),
}));

import { AfmMark } from "@/components/brand/afm-mark";

describe("<AfmMark />", () => {
  it("1) default variant es 'emblem' → src=/afm-emblem.svg", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-src")).toBe("/afm-emblem.svg");
  });

  it("2) variant='emblem' es cuadrado (size = altura = ancho)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="emblem" size={40} />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-width")).toBe("40");
    expect(img.getAttribute("data-height")).toBe("40");
  });

  it("3) variant='full' calcula width por aspect 485/695 (size = altura)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="full" size={100} />);
    const img = getByTestId("afm-mark-img");
    // height=100, width=100*0.6978≈70
    expect(img.getAttribute("data-height")).toBe("100");
    expect(img.getAttribute("data-width")).toBe("70");
    expect(img.getAttribute("data-src")).toBe("/afm-logo-full.svg");
  });

  it("4) variant='full' propaga unoptimized=true (SVG complejo)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="full" />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-unoptimized")).toBe("true");
  });

  it("5) variant='emblem' propaga unoptimized=true", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="emblem" />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-unoptimized")).toBe("true");
  });

  it("6) alt por default es descriptivo y distinto por variant", () => {
    imageSpy.mockClear();
    const { getByTestId, rerender } = render(<AfmMark variant="emblem" />);
    const markAlt = getByTestId("afm-mark-img").getAttribute("data-alt");
    expect(markAlt).toMatch(/AFM/);
    expect(markAlt?.length).toBeGreaterThan(3);

    rerender(<AfmMark variant="full" />);
    const fullAlt = getByTestId("afm-mark-img").getAttribute("data-alt");
    expect(fullAlt).toMatch(/AFM/);
    expect(fullAlt).not.toBe(markAlt);
  });

  it("7) alt custom pisa al default", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark alt="Mi login header" />);
    expect(getByTestId("afm-mark-img").getAttribute("data-alt")).toBe("Mi login header");
  });

  it("8) priority se propaga cuando se pide", () => {
    imageSpy.mockClear();
    const { getByTestId, rerender } = render(<AfmMark />);
    expect(getByTestId("afm-mark-img").getAttribute("data-priority")).toBe("false");

    rerender(<AfmMark priority />);
    expect(getByTestId("afm-mark-img").getAttribute("data-priority")).toBe("true");
  });
});
