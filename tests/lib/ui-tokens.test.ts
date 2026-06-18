import { describe, expect, it } from "vitest";

import {
  COLORS,
  ELEVATION,
  SPACING,
  getDashboardKpiTone,
  getStatusTone
} from "@/lib/ui-tokens";

describe("ui-tokens — colors", () => {
  it("exporta los 6 colores semánticos requeridos", () => {
    expect(COLORS.primary).toBe("#0b5f2d");
    expect(COLORS.success).toBe("#2c7f44");
    expect(COLORS.warning).toBe("#c7a43a");
    expect(COLORS.danger).toBe("#a93232");
    expect(COLORS.info).toBe("#1f4d80");
    expect(COLORS.neutral).toBe("#4a5b50");
  });

  it("los colores son strings inmutables (no se pueden reasignar)", () => {
    expect(() => {
      // @ts-expect-error — verificamos runtime immutability
      COLORS.primary = "#000";
    }).toThrow();
  });
});

describe("ui-tokens — spacing", () => {
  it("expone xs, sm, md, lg, xl con valores crecientes en px/rem", () => {
    const scale = [SPACING.xs, SPACING.sm, SPACING.md, SPACING.lg, SPACING.xl];
    for (let i = 1; i < scale.length; i++) {
      expect(scale[i]).toBeGreaterThan(scale[i - 1]);
    }
  });
});

describe("ui-tokens — elevation", () => {
  it("expone card, panel, overlay con strings CSS de shadow", () => {
    expect(ELEVATION.card).toContain("rgba");
    expect(ELEVATION.panel).toContain("rgba");
    expect(ELEVATION.overlay).toContain("rgba");
  });
});

describe("getStatusTone", () => {
  it("mapea LOW a success", () => {
    expect(getStatusTone("LOW")).toBe("success");
  });

  it("mapea MEDIUM a warning", () => {
    expect(getStatusTone("MEDIUM")).toBe("warning");
  });

  it("mapea HIGH a danger", () => {
    expect(getStatusTone("HIGH")).toBe("danger");
  });
});

describe("getDashboardKpiTone", () => {
  it("totalFlights -> default", () => {
    expect(getDashboardKpiTone("totalFlights")).toBe("default");
  });

  it("totalAreaCovered -> success (cobertura es positivo)", () => {
    expect(getDashboardKpiTone("totalAreaCovered")).toBe("success");
  });

  it("totalAssets -> info", () => {
    expect(getDashboardKpiTone("totalAssets")).toBe("info");
  });

  it("highAlertParcels -> danger", () => {
    expect(getDashboardKpiTone("highAlertParcels")).toBe("danger");
  });

  it("métrica desconocida -> default (fallback seguro)", () => {
    expect(getDashboardKpiTone("foo" as never)).toBe("default");
  });
});
