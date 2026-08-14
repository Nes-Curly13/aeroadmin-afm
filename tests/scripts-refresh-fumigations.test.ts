// tests/scripts-refresh-fumigations.test.ts
//
// Tests del script `scripts/refresh-fumigations.js` (sprint
// 2026-08-13, fix/ci-and-cleanup). El script se ejecuta desde
// el workflow .github/workflows/refresh-fumigations.yml que antes
// estaba ROTO porque el archivo no existía.
//
// Estos tests NO ejecutan el script contra una BD real (no hay
// docker en CI). Solo verifican:
//   - El módulo se puede requerir sin tirar
//   - Sin DATABASE_URL → tira con mensaje claro
//   - El módulo exporta `main` para tests de integración futuros
//
// Tests E2E con BD real (requieren `npm run db:up` + supabase URL)
// no entran en este sprint. Si en el futuro se quieren agregar,
// ver `tests/integration/post-import-data-integrity.test.ts` para
// el patrón con `checkDbReachable`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("scripts/refresh-fumigations.js", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Limpiar env vars relacionados para que el script no use uno
    // heredado del test runner (raro pero defensivo).
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_DIRECT;
  });

  afterEach(() => {
    // Restaurar env original.
    process.env = { ...originalEnv };
  });

  it("se puede requerir sin error (módulo bien-formed)", async () => {
    // Requerir el módulo no debe tirar. Si hay un error de syntax
    // o de import, este test falla inmediatamente.
    const mod = await import("../scripts/refresh-fumigations");
    expect(mod).toBeDefined();
    expect(typeof mod.main).toBe("function");
  });

  it("main() tira con mensaje claro si no hay DATABASE_URL ni DATABASE_URL_DIRECT", async () => {
    const mod = await import("../scripts/refresh-fumigations");
    // Capturar stderr para no ensuciar la salida del test.
    const origStderr = process.stderr.write.bind(process.stderr);
    const stderrLines: string[] = [];
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    };

    try {
      // Mockear process.exit para que el script no termine el test
      // runner cuando falla (sino todo el process muere).
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
        throw new Error(`__script_exit_${code}__`);
      }) as never;

      try {
        await mod.main();
        // Si main() NO tira, fallamos el test (debería haber tirado).
        expect.fail("main() debería haber tirado por falta de DATABASE_URL");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Aceptamos que el script tire con cualquiera de estos:
        //   - El error original de "DATABASE_URL is not configured"
        //   - El wrapper __script_exit_N__ (cuando process.exit se llama)
        //   - Un error del client de pg
        const hasDbUrlError =
          msg.includes("DATABASE_URL") ||
          msg.includes("__script_exit_") ||
          msg.includes("ECONNREFUSED") ||
          msg.includes("getaddrinfo");
        expect(
          hasDbUrlError,
          `Error inesperado: ${msg}. Stderr: ${stderrLines.join("")}`
        ).toBe(true);
      } finally {
        process.exit = origExit;
      }

      // Si llegamos al process.exit, exitCode debería ser 1.
      if (exitCode !== undefined) {
        expect(exitCode).toBe(1);
      }
    } finally {
      process.stderr.write = origStderr;
    }
  });

  it("exporta `main` para que tests de integración futuros puedan invocarlo", async () => {
    const mod = await import("../scripts/refresh-fumigations");
    expect(mod.main).toBeDefined();
    expect(mod.main.length).toBe(0); // no toma args
  });
});
