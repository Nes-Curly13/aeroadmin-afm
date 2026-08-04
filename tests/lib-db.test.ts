// tests/lib-db.test.ts
//
// Test unitario para lib/db.ts — verificación del Pool de `pg` y de los
// type parsers.
//
// Sprint 2026-08-04 — feature/parcel-onboarding followups.
//
// Cubre:
//   - **client_encoding='UTF8'** (regresión del bug de mojibake):
//     `new Pool(...)` debe recibir `client_encoding: "UTF8"` en sus
//     opciones. Sin esto, el driver `pg` puede leer strings desde
//     Postgres como Latin-1 / WIN1252 y los caracteres con tilde se
//     rompen al volver por JSON ("Caña de azúcar" → "CaÃ±a de azÃºcar").
//   - **patchPgTypes** sigue intacto: NUMERIC (oid 1700) → number,
//     INT8 (oid 20) → number. El usuario pidió explícitamente NO
//     tocar `patchPgTypes`; este test es el guard de esa promesa.
//   - **Singleton**: `getDb()` retorna la misma instancia en llamadas
//     repetidas (vía `globalThis.__afmPool`).
//   - **Roundtrip UTF-8 vs Latin-1 a nivel de bytes** (test didáctico):
//     demuestra POR QUÉ la opción `client_encoding: "UTF8"` es
//     necesaria. Es independiente del driver `pg` — solo ejercita cómo
//     Node decodifica bytes. El test real de roundtrip con Postgres
//     se hace manualmente (ver docs/ARCHITECTURE.md §smoke).

import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks (hoisted: vi.mock se eleva, así que las refs deben estar
// en vi.hoisted para que estén inicializadas ANTES del mock factory)
// ============================================================

const { PoolMock, setTypeParserMock, fakePoolInstance } = vi.hoisted(() => {
  const fakePoolInstance = { query: vi.fn() };
  const PoolMock = vi.fn().mockImplementation(() => fakePoolInstance);
  const setTypeParserMock = vi.fn();
  return { PoolMock, setTypeParserMock, fakePoolInstance };
});

vi.mock("pg", () => ({
  Pool: PoolMock,
  types: { setTypeParser: setTypeParserMock }
}));

// Después de los mocks. `vi.mock` se eleva por Vitest, así que `getDb`
// ya ve el `Pool` mockeado al importarse.
import { getDb } from "@/lib/db";

// ============================================================
// Helpers
// ============================================================

/** Reset de los flags globales del módulo + de los mocks. */
function resetDbModuleState() {
  (globalThis as { __afmPool?: unknown }).__afmPool = undefined;
  (globalThis as { __afmPgTypesPatched?: boolean }).__afmPgTypesPatched = undefined;
  PoolMock.mockClear();
  setTypeParserMock.mockClear();
  fakePoolInstance.query.mockClear();
}

beforeEach(() => {
  resetDbModuleState();
  // Requerido para que createPool() no tire "DATABASE_URL is not configured".
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.DATABASE_SSL = "false";
});

// ============================================================
// Pool config — el bug de encoding
// ============================================================

describe("getDb() — config del Pool (regresión del bug UTF-8)", () => {
  it("crea el Pool con client_encoding='UTF8' en las opciones", () => {
    getDb();
    expect(PoolMock).toHaveBeenCalledTimes(1);
    const options = PoolMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.client_encoding).toBe("UTF8");
  });

  it("mantiene las otras opciones (max, idleTimeoutMillis, ssl) sin cambios", () => {
    getDb();
    const options = PoolMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.max).toBe(5);
    expect(options.idleTimeoutMillis).toBe(30_000);
    // ssl=false → undefined en la config (el `useSsl ? {...} : undefined`).
    expect(options.ssl).toBeUndefined();
    expect(options.connectionString).toBe(
      "postgres://test:test@localhost:5432/test"
    );
  });

  it("habilita SSL cuando DATABASE_SSL='true'", () => {
    process.env.DATABASE_SSL = "true";
    getDb();
    const options = PoolMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });
});

describe("getDb() — singleton via globalThis.__afmPool", () => {
  it("retorna la misma instancia en llamadas repetidas (un solo Pool)", () => {
    const a = getDb();
    const b = getDb();
    const c = getDb();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(PoolMock).toHaveBeenCalledTimes(1);
  });

  it("si el global __afmPool está pre-setado, NO crea un Pool nuevo", () => {
    const preexisting = { query: vi.fn(), __preexisting: true };
    (globalThis as { __afmPool?: unknown }).__afmPool = preexisting;
    const got = getDb();
    expect(got).toBe(preexisting);
    expect(PoolMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// patchPgTypes — guard de no-regresión
// ============================================================

describe("getDb() — patchPgTypes (NUMERIC + INT8 parsers)", () => {
  it("registra parsers para NUMERIC (oid 1700) e INT8 (oid 20)", () => {
    getDb();
    const oids = setTypeParserMock.mock.calls.map((c) => c[0]);
    expect(oids).toContain(1700);
    expect(oids).toContain(20);
  });

  it("los parsers para NUMERIC e INT8 convierten strings a number (no dejan string)", () => {
    getDb();
    // NUMERIC parser
    const numericParser = setTypeParserMock.mock.calls.find(
      (c) => c[0] === 1700
    )?.[1] as (v: string | null) => unknown;
    expect(typeof numericParser("123.45")).toBe("number");
    expect(numericParser("123.45")).toBe(123.45);
    expect(numericParser(null)).toBeNull();

    // INT8 parser
    const int8Parser = setTypeParserMock.mock.calls.find(
      (c) => c[0] === 20
    )?.[1] as (v: string | null) => unknown;
    expect(typeof int8Parser("9876543210")).toBe("number");
    expect(int8Parser("9876543210")).toBe(9876543210);
    expect(int8Parser(null)).toBeNull();
  });

  it("corre patchPgTypes una sola vez (idempotente vía __afmPgTypesPatched)", () => {
    getDb();
    getDb();
    getDb();
    // Solo 2 registros: NUMERIC + INT8. Si patchPgTypes corriera 3 veces
    // (una por cada getDb) veríamos 6 calls.
    expect(setTypeParserMock).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// Roundtrip UTF-8 vs Latin-1 — test didáctico
// ============================================================
//
// Este test NO depende del driver `pg` ni del mock. Demuestra a nivel
// de bytes POR QUÉ la opción `client_encoding: "UTF8"` es necesaria
// en el Pool: si Postgres devuelve los bytes UTF-8 de "Caña"
// (0xC3 0xB1 para "ñ") y el driver los decodifica como Latin-1, sale
// "Ã±" — el mojibake clásico del bug. Si los decodifica como UTF-8,
// sale "ñ" — correcto.
//
// El test de roundtrip end-to-end con una DB real no es viable en
// vitest unit (no hay test DB dedicada — el pooler de Supabase es
// compartido con prod). La verificación manual del fix se hace con
// `npm run pipeline:djiag` o un INSERT/SELECT ad-hoc.

describe("UTF-8 vs Latin-1 decoding — por qué client_encoding='UTF8'", () => {
  // Casteo a `any` para no atar el test a la versión de Buffer.
  const stringToUtf8Bytes = (s: string): Uint8Array =>
    new TextEncoder().encode(s);
  const bytesToString = (b: Uint8Array, encoding: string): string =>
    new TextDecoder(encoding as never).decode(b);

  it("'Caña de azúcar' en UTF-8 son 16 bytes (los chars con tilde ocupan 2)", () => {
    const bytes = stringToUtf8Bytes("Caña de azúcar");
    // Layout de bytes (0-indexed):
    //   0: 'C'      1 byte
    //   1: 'a'      1 byte
    //   2-3: 'ñ'    2 bytes (0xC3 0xB1)
    //   4: 'a'      1 byte
    //   5-8: ' de ' 4 bytes
    //   9: 'a'      1 byte
    //  10: 'z'      1 byte
    //  11-12: 'ú'   2 bytes (0xC3 0xBA)
    //  13-15: 'car' 3 bytes
    // Total = 16 bytes.
    expect(bytes.length).toBe(16);
    expect(Array.from(bytes.slice(2, 4))).toEqual([0xc3, 0xb1]); // ñ
    expect(Array.from(bytes.slice(11, 13))).toEqual([0xc3, 0xba]); // ú
  });

  it("decodificar los bytes UTF-8 como Latin-1 produce mojibake ('CaÃ±a')", () => {
    const bytes = stringToUtf8Bytes("Caña");
    const mojibake = bytesToString(bytes, "latin1");
    // Esta es la "firma" del bug: si el driver pg no negocia UTF-8,
    // Postgres devuelve los bytes UTF-8 pero el cliente los lee como
    // Latin-1, y el "ñ" (2 bytes 0xC3 0xB1) sale como dos chars
    // "Ã±".
    expect(mojibake).toBe("CaÃ±a");
    expect(mojibake).not.toBe("Caña");
  });

  it("decodificar los bytes UTF-8 como UTF-8 produce el string original (roundtrip OK)", () => {
    const original = "Caña de azúcar";
    const bytes = stringToUtf8Bytes(original);
    const decoded = bytesToString(bytes, "utf-8");
    expect(decoded).toBe(original);
  });

  it("varios strings típicos del dominio (variedad, municipio) roundtrippean bien", () => {
    const samples = [
      "Caña de azúcar",
      "ñoño",
      "café",
      "Variedad CC 85-92 — Suerte 3",
      "Palmira",
      "Ingenio La Cabaña",
      "José María",
      "Héctor Núñez",
    ];
    for (const s of samples) {
      const bytes = stringToUtf8Bytes(s);
      const decoded = bytesToString(bytes, "utf-8");
      expect(decoded, `roundtrip falló para ${JSON.stringify(s)}`).toBe(s);
    }
  });
});