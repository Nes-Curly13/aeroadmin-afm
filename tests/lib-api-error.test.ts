// tests/lib-api-error.test.ts
//
// Tests del helper de sanitizacion de errores (issue #28).
//
// Verificamos:
//   1) Detecta pg errors por SQLSTATE code
//   2) Mapea codigos comunes a mensajes user-friendly
//   3) NO filtra nombres de constraints/tables/columns
//   4) Errores no-pg con mensaje "humano" pasan tal cual
//   5) Errores no-pg con mensaje tipo pg caen al fallback
//   6) Strings vacias / unknowns → fallback

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isPgError, clientSafeErrorMessage } from "@/lib/api-error";

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleSpy.mockRestore();
});

describe("isPgError", () => {
  it("1) detecta pg error por SQLSTATE code (5 chars alfanumerico mayuscula)", () => {
    const e = new Error("duplicate key value") as Error & { code?: string };
    e.code = "23505";
    expect(isPgError(e)).toBe(true);
  });

  it("2) retorna false para errores sin code", () => {
    expect(isPgError(new Error("plain"))).toBe(false);
    expect(isPgError("string error")).toBe(false);
    expect(isPgError(null)).toBe(false);
    expect(isPgError(undefined)).toBe(false);
  });

  it("3) retorna false para code con formato invalido", () => {
    const e = new Error("test") as Error & { code?: string };
    e.code = "abc"; // 3 chars, no es SQLSTATE
    expect(isPgError(e)).toBe(false);
    e.code = "12345ABC"; // lowercase mezclado
    expect(isPgError(e)).toBe(false);
  });
});

describe("clientSafeErrorMessage — mapeo de pg errors", () => {
  it("2a) 23505 unique_violation → mensaje user-friendly", () => {
    const e = new Error("duplicate key value violates unique constraint \"uq_dji_fumigations_pkey\"") as Error & { code?: string };
    e.code = "23505";
    const msg = clientSafeErrorMessage(e, "fallback");
    expect(msg).toBe("Ya existe un registro con esos datos unicos");
    // Verifica que NO filtra el nombre de la constraint
    expect(msg).not.toContain("uq_dji_fumigations");
  });

  it("2b) 23503 foreign_key_violation → mensaje user-friendly", () => {
    const e = new Error('insert or update on table "dji_fumigations" violates foreign key constraint "fk_parcel"') as Error & { code?: string };
    e.code = "23503";
    const msg = clientSafeErrorMessage(e, "fallback");
    expect(msg).toBe("La operacion referencia un registro que no existe o fue borrado");
    expect(msg).not.toContain("dji_fumigations");
    expect(msg).not.toContain("fk_parcel");
  });

  it("2c) 42P01 undefined_table → fallback generico", () => {
    const e = new Error('relation "secret_table" does not exist') as Error & { code?: string };
    e.code = "42P01";
    const msg = clientSafeErrorMessage(e, "Error interno del servidor");
    expect(msg).toBe("Error interno del servidor");
    expect(msg).not.toContain("secret_table");
  });

  it("2d) codigo pg desconocido → fallback generico", () => {
    const e = new Error("internal db failure") as Error & { code?: string };
    e.code = "XX001"; // internal error, no en el mapa
    const msg = clientSafeErrorMessage(e, "Algo salio mal");
    expect(msg).toBe("Algo salio mal");
  });
});

describe("clientSafeErrorMessage — no-pg errors", () => {
  it("4) Error generico con mensaje humano pasa tal cual", () => {
    const msg = clientSafeErrorMessage(new Error("no autenticado"), "fallback");
    expect(msg).toBe("no autenticado");
  });

  it("5a) Error con mensaje tipo constraint cae al fallback", () => {
    const msg = clientSafeErrorMessage(
      new Error('duplicate key value violates unique constraint "leaky_name"'),
      "Algo salio mal"
    );
    expect(msg).toBe("Algo salio mal");
    expect(msg).not.toContain("leaky_name");
  });

  it("5b) Error con mensaje tipo 'relation does not exist' cae al fallback", () => {
    const msg = clientSafeErrorMessage(
      new Error('relation "secret" does not exist'),
      "Algo salio mal"
    );
    expect(msg).toBe("Algo salio mal");
  });

  it("5c) Error con mensaje tipo 'column does not exist' cae al fallback", () => {
    const msg = clientSafeErrorMessage(
      new Error('column "internal_field" does not exist'),
      "Algo salio mal"
    );
    expect(msg).toBe("Algo salio mal");
  });

  it("6) string vacia / unknowns → fallback", () => {
    expect(clientSafeErrorMessage(null, "x")).toBe("x");
    expect(clientSafeErrorMessage(undefined, "x")).toBe("x");
    expect(clientSafeErrorMessage("", "x")).toBe("x"); // string vacia cuenta como mensaje "humano" corto
    expect(clientSafeErrorMessage(42, "x")).toBe("x");
  });
});

describe("clientSafeErrorMessage — logging", () => {
  it("loguea el error completo con contexto", () => {
    const e = new Error("test error") as Error & { code?: string };
    e.code = "23505";
    clientSafeErrorMessage(e, "fallback", "POST /api/admin/farms");
    expect(consoleSpy).toHaveBeenCalledWith(
      "[POST /api/admin/farms] error:",
      e
    );
  });

  it("loguea sin contexto si no se pasa", () => {
    clientSafeErrorMessage(new Error("test"), "x");
    expect(consoleSpy).toHaveBeenCalledWith("API error:", expect.any(Error));
  });
});
