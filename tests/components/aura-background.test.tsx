/**
 * tests/components/aura-background.test.tsx
 *
 * Smoke test del componente AuraBackground (Sprint 2026-08-15).
 * Solo verifica la estructura — el render real con blend modes lo
 * valida visualmente el operador.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuraBackground } from "@/components/aura-background";

describe("AuraBackground", () => {
  it("renderiza las 2 capas decorativas + el wrapper de contenido", () => {
    const { container } = render(
      <AuraBackground>
        <p>contenido</p>
      </AuraBackground>
    );

    // El container tiene la clase aura-bg
    const bgContainer = container.querySelector(".aura-bg");
    expect(bgContainer).not.toBeNull();

    // Hay 2 capas decorativas
    const layer1 = container.querySelector(".aura-layer-1");
    const layer2 = container.querySelector(".aura-layer-2");
    expect(layer1).not.toBeNull();
    expect(layer2).not.toBeNull();

    // Las capas son decorativas (aria-hidden)
    expect(layer1?.getAttribute("aria-hidden")).toBe("true");
    expect(layer2?.getAttribute("aria-hidden")).toBe("true");

    // El contenido vive dentro del wrapper con z-index 1
    expect(screen.getByText("contenido")).toBeDefined();
    const contentWrapper = container.querySelector(".relative.z-\\[1\\]");
    expect(contentWrapper).not.toBeNull();
  });

  it("no agrega background-color al container (debe ser transparente para que el multiply componga contra el body)", () => {
    const { container } = render(
      <AuraBackground>
        <span>x</span>
      </AuraBackground>
    );
    const bgContainer = container.querySelector(".aura-bg") as HTMLElement;
    // inline style no debe tener backgroundColor
    expect(bgContainer.style.backgroundColor).toBe("");
  });
});
