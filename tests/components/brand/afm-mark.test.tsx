/**
 * tests/components/brand/afm-mark.test.tsx
 *
 * Tests para <AfmMark /> — wrapper unificado del branding AFM.
 *
 * Cubrimos:
 *   1. Default variant es "mark" → src=/afm-logo-mark.svg
 *   2. variant="mark" calcula dimensiones por aspect 120/40
 *      (size es la altura, width = size * 3.0)
 *   3. variant="full" calcula dimensiones por aspect 485/695
 *      (size es el ancho, height = size / 0.697)
 *   4. variant="full" propaga unoptimized al <Image> (issue QA-01
 *      → PR #68: optimizer de Next.js devuelve 400 con el monograma)
 *   5. variant="mark" NO propaga unoptimized (texto + currentColor
 *      se rasteriza bien)
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
  it("1) default variant es 'mark' → src=/afm-logo-mark.svg", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-src")).toBe("/afm-logo-mark.svg");
  });

  it("2) variant='mark' calcula dimensiones por aspect 120/40 (size = altura)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="mark" size={40} />);
    const img = getByTestId("afm-mark-img");
    // height=40, width=40*3.0=120
    expect(img.getAttribute("data-width")).toBe("120");
    expect(img.getAttribute("data-height")).toBe("40");
  });

  it("3) variant='full' calcula dimensiones por aspect 485/695 (size = ancho)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="full" size={97} />);
    const img = getByTestId("afm-mark-img");
    // width=97, height=97/0.697≈139 (485/695≈0.6975)
    const w = Number(img.getAttribute("data-width"));
    const h = Number(img.getAttribute("data-height"));
    expect(w).toBe(97);
    // 97 / (485/695) = 97 * 695/485 ≈ 139
    expect(h).toBeGreaterThan(135);
    expect(h).toBeLessThan(145);
  });

  it("4) variant='full' propaga unoptimized=true (fix SVG 400 QA-01 → PR #68)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="full" />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-unoptimized")).toBe("true");
  });

  it("5) variant='mark' NO propaga unoptimized (texto + currentColor)", () => {
    imageSpy.mockClear();
    const { getByTestId } = render(<AfmMark variant="mark" />);
    const img = getByTestId("afm-mark-img");
    expect(img.getAttribute("data-unoptimized")).toBe("false");
  });

  it("6) alt por default es descriptivo y distinto por variant", () => {
    imageSpy.mockClear();
    const { getByTestId, rerender } = render(<AfmMark variant="mark" />);
    const markAlt = getByTestId("afm-mark-img").getAttribute("data-alt");
    expect(markAlt).toMatch(/AFM/);
    expect(markAlt?.length).toBeGreaterThan(3);

    rerender(<AfmMark variant="full" />);
    const fullAlt = getByTestId("afm-mark-img").getAttribute("data-alt");
    expect(fullAlt).toMatch(/AeroAdmin|AFM/);
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
