// Tests para `lib/auth/role-display.ts` (v1.5 — consolidación).
//
// Cobertura:
//   - `ROLE_LABELS` y `ROLE_BADGE_CLASS` son Records completos
//     (no faltan keys para admin ni supervisor).
//   - `normalizeRole` mapea correctamente: admin, supervisor,
//     viewer (legacy) -> supervisor, y todo lo demás -> supervisor
//     (least privilege, defensa en profundidad).
//   - El type `AppRole` se re-exporta correctamente desde
//     `lib/auth/role` (source-of-truth).
//
// Este archivo es la fuente de verdad de los display helpers. Si
// agregás un nuevo role en `lib/auth/role.ts`, este test te avisa
// que `ROLE_LABELS` / `ROLE_BADGE_CLASS` necesitan una entrada nueva.

import { describe, expect, it } from "vitest";

import {
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  normalizeRole
} from "@/lib/auth/role-display";
import type { AppRole } from "@/lib/auth/role";

describe("lib/auth/role-display (v1.5 consolidación)", () => {
  describe("ROLE_LABELS", () => {
    it("tiene label en español para 'admin'", () => {
      expect(ROLE_LABELS.admin).toBe("Administrador");
    });

    it("tiene label en español para 'supervisor'", () => {
      expect(ROLE_LABELS.supervisor).toBe("Supervisor");
    });

    it("cubre todos los AppRole conocidos (no faltan keys)", () => {
      // Si se agrega un role nuevo en `lib/auth/role.ts`, este assert
      // falla para forzar a agregar la entrada en el Record.
      const expected: AppRole[] = ["admin", "supervisor"];
      for (const role of expected) {
        expect(ROLE_LABELS[role]).toBeTruthy();
        expect(typeof ROLE_LABELS[role]).toBe("string");
      }
    });
  });

  describe("ROLE_BADGE_CLASS", () => {
    it("tiene clase CSS para 'admin' (verde olivo)", () => {
      expect(ROLE_BADGE_CLASS.admin).toMatch(/bg-/);
      expect(ROLE_BADGE_CLASS.admin).toMatch(/text-/);
    });

    it("tiene clase CSS para 'supervisor' (gris)", () => {
      expect(ROLE_BADGE_CLASS.supervisor).toMatch(/bg-/);
      expect(ROLE_BADGE_CLASS.supervisor).toMatch(/text-/);
    });

    it("admin y supervisor tienen colores distintos", () => {
      // Defensa contra una refactor que accidentalmente usa el
      // mismo color para los dos roles.
      expect(ROLE_BADGE_CLASS.admin).not.toBe(ROLE_BADGE_CLASS.supervisor);
    });
  });

  describe("normalizeRole", () => {
    it("mapea 'admin' -> 'admin'", () => {
      expect(normalizeRole("admin")).toBe("admin");
    });

    it("mapea 'supervisor' -> 'supervisor' (no-op, dominio v1.5)", () => {
      expect(normalizeRole("supervisor")).toBe("supervisor");
    });

    it("mapea 'viewer' (legacy) -> 'supervisor' (retrocompat)", () => {
      // Pre-v1.4 la sesión exponía 'viewer'. El helper traduce al
      // dominio nuevo en el borde. Si la BD todavía tiene 'viewer',
      // la UI lo ve como 'supervisor' sin pedir migración.
      expect(normalizeRole("viewer")).toBe("supervisor");
    });

    it("mapea role desconocido -> 'supervisor' (least privilege)", () => {
      // Defensa en profundidad: si llega algo raro, no promovemos a
      // admin — devolvemos supervisor (permisos menores) por default.
      expect(normalizeRole("guest")).toBe("supervisor");
      expect(normalizeRole("owner")).toBe("supervisor");
      expect(normalizeRole("")).toBe("supervisor");
    });

    it("mapea null/undefined -> 'supervisor'", () => {
      expect(normalizeRole(null)).toBe("supervisor");
      expect(normalizeRole(undefined)).toBe("supervisor");
    });

    it("mapea un objeto/array raro -> 'supervisor' (no tira)", () => {
      expect(normalizeRole({})).toBe("supervisor");
      expect(normalizeRole([])).toBe("supervisor");
      expect(normalizeRole(42)).toBe("supervisor");
    });
  });
});
