// tests/lib/flight-plan-styles.test.ts
//
// Tests para el style function del layer de planes de vuelo (Polyline).
// M3-M5 Track B — commit 2 de 3.
//
// Contrato: getFlightPlanStyle devuelve PathOptions que:
//   - Usa solo colores de lib/ui-tokens (nunca hexes nuevos).
//   - Distingue "selected" vs default con weight.
//   - Default usa dashArray para diferenciarse de la fumigación real
//     (sólido). Es señal visual de "plan, no ejecución".

import { describe, expect, it } from "vitest";
import type { PathOptions } from "leaflet";

import { COLORS } from "@/lib/ui-tokens";
import { getFlightPlanStyle } from "@/lib/flight-plan-styles";

describe("getFlightPlanStyle", () => {
  it("devuelve un PathOptions con las keys requeridas para polilíneas", () => {
    // Una Polyline no tiene fill (es 1D, no área), así que NO
    // exigimos fillOpacity. Sí exigimos color + weight + opacity +
    // dashArray porque son lo que da la señal visual "plan DJI".
    const style: PathOptions = getFlightPlanStyle();
    expect(style).toMatchObject({
      color: expect.any(String),
      weight: expect.any(Number),
      opacity: expect.any(Number),
      dashArray: expect.any(String)
    });
  });

  it("todos los colores vienen de ui-tokens (cero hex hardcoded)", () => {
    const style = getFlightPlanStyle();
    const styleSelected = getFlightPlanStyle({ isSelected: true });
    const allowed = new Set<string>(Object.values(COLORS));
    expect(allowed.has(style.color!)).toBe(true);
    expect(allowed.has(styleSelected.color!)).toBe(true);
  });

  it("default: stroke 'info' (cyan/teal) con dashArray '6 4' para distinguir de fumigación", () => {
    // Decisión: la fumigación real (M6, polígonos fumigados) se dibuja
    // sólido, mientras que el plan es dashed — son señales visuales
    // opuestas (intención vs ejecución).
    const style = getFlightPlanStyle();
    expect(style.color).toBe(COLORS.info);
    expect(style.dashArray).toBe("6 4");
  });

  it("default: weight 2, opacity 0.7", () => {
    const style = getFlightPlanStyle();
    expect(style.weight).toBe(2);
    expect(style.opacity).toBe(0.7);
  });

  it("isSelected: weight sube a 3 (sutil pero distinguible)", () => {
    const baseline = getFlightPlanStyle();
    const selected = getFlightPlanStyle({ isSelected: true });
    expect(baseline.weight).toBe(2);
    expect(selected.weight).toBe(3);
    expect(selected.weight).toBeGreaterThan(baseline.weight!);
  });

  it("isSelected explícito false → mismo weight que default", () => {
    const baseline = getFlightPlanStyle();
    const notSelected = getFlightPlanStyle({ isSelected: false });
    expect(notSelected.weight).toBe(baseline.weight);
  });
});
