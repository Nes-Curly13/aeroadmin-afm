import { describe, expect, it, vi } from "vitest";
import { reportEnv, validateEnv } from "@/lib/env";

/**
 * Tests de validación de env (auditoría #43).
 * `validateEnv` es puro: recibe el env por param, no toca `process.env`.
 */

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("validateEnv", () => {
  it("reporta error si no hay DB configurada", () => {
    const issues = validateEnv(env({ AUTH_SECRET: "x" }));
    expect(issues.some((i) => i.name === "DATABASE_URL" && i.severity === "error")).toBe(true);
  });

  it("acepta DATABASE_URL_DIRECT como alternativa a DATABASE_URL", () => {
    const issues = validateEnv(env({ DATABASE_URL_DIRECT: "postgres://x", AUTH_SECRET: "x" }));
    expect(issues.some((i) => i.name === "DATABASE_URL")).toBe(false);
  });

  it("reporta error si falta AUTH_SECRET y NEXTAUTH_SECRET", () => {
    const issues = validateEnv(env({ DATABASE_URL: "postgres://x" }));
    expect(issues.some((i) => i.name === "AUTH_SECRET" && i.severity === "error")).toBe(true);
  });

  it("acepta NEXTAUTH_SECRET como alias de AUTH_SECRET", () => {
    const issues = validateEnv(env({ DATABASE_URL: "postgres://x", NEXTAUTH_SECRET: "x" }));
    expect(issues.some((i) => i.name === "AUTH_SECRET")).toBe(false);
  });

  it("marca las recomendadas faltantes como warn, no error", () => {
    const issues = validateEnv(env({ DATABASE_URL: "postgres://x", AUTH_SECRET: "x" }));
    const mapToken = issues.find((i) => i.name === "INTERNAL_MAP_TOKEN");
    expect(mapToken?.severity).toBe("warn");
    expect(issues.every((i) => i.severity === "warn")).toBe(true);
  });

  it("no reporta nada si está todo configurado", () => {
    const issues = validateEnv(
      env({
        DATABASE_URL: "postgres://x",
        AUTH_SECRET: "x",
        AUTH_URL: "https://x",
        HEALTH_TOKEN: "x",
        BACKFILL_TOKEN: "x",
        INTERNAL_MAP_TOKEN: "x",
        NEXT_PUBLIC_MAPTILER_KEY: "x"
      })
    );
    expect(issues).toEqual([]);
  });
});

describe("reportEnv", () => {
  it("loguea errores en cualquier entorno y warnings solo en prod", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      reportEnv(env({ NODE_ENV: "development" }));
      // Sin DB ni AUTH_SECRET: 2 errores.
      expect(errSpy).toHaveBeenCalledTimes(2);
      // Warnings no se loguean en dev.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("loguea warnings en producción", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      reportEnv(env({ NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_SECRET: "x" }));
      expect(errSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
