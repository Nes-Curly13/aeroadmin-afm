/**
 * tests/lib-data-constants-application-types.test.ts
 *
 * Test unitario del helper `applicationType` y el array `APPLICATION_TYPES`
 * en lib/data-constants.ts.
 *
 * Este catálogo es el espejo client-side de la tabla `application_types`
 * (migration 20260824000000). Si en el futuro se cambia el orden o los
 * slugs, este test se rompe — eso es deseable, porque significa que el
 * form de fumigaciones necesita actualizarse también.
 *
 * Sprint: feature/s7-schema-extension (2026-08-24) / Fase 0.
 */

import { describe, expect, it } from "vitest";
import {
  APPLICATION_TYPES,
  applicationType
} from "@/lib/data-constants";

describe("APPLICATION_TYPES (espejo client-side)", () => {
  it("tiene exactamente 4 tipos seeded (pre/post emergencia, bioestimulante, otro)", () => {
    expect(APPLICATION_TYPES).toHaveLength(4);
  });

  it("los slugs cubren los 4 que siembra la migration", () => {
    const slugs = APPLICATION_TYPES.map((t) => t.slug);
    expect(slugs).toContain("pre_emergente");
    expect(slugs).toContain("post_emergente");
    expect(slugs).toContain("bioestimulante");
    expect(slugs).toContain("otro");
  });

  it("los ids son únicos y positivos", () => {
    const ids = APPLICATION_TYPES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThan(0);
    }
  });

  it("los colors son tokens semánticos válidos (Tailwind)", () => {
    const allowed = ["amber", "orange", "green", "slate", "red", "blue", "purple"];
    for (const t of APPLICATION_TYPES) {
      expect(allowed).toContain(t.color);
    }
  });

  it("está ordenado por sort_order (pre antes que post antes que bio antes que otro)", () => {
    // pre_emergente=10, post_emergente=20, bioestimulante=30, otro=99
    const labels = APPLICATION_TYPES.map((t) => t.label);
    expect(labels).toEqual([
      "Pre emergente",
      "Post emergente",
      "Bioestimulante",
      "Otro"
    ]);
  });
});

describe("applicationType helper (lookup por id)", () => {
  it("devuelve el type cuando el id matchea", () => {
    const pre = applicationType(1);
    expect(pre?.slug).toBe("pre_emergente");
    expect(pre?.color).toBe("amber");
  });

  it("devuelve null si el id no existe", () => {
    expect(applicationType(999)).toBeNull();
  });

  it("devuelve null si el id es null o undefined (compat con `fumigationCategory`)", () => {
    expect(applicationType(null)).toBeNull();
    expect(applicationType(undefined)).toBeNull();
  });
});
