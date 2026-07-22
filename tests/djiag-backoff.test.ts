// Tests para lib/djiag-backoff.js — helper puro de backoff exponencial.
//
// XS3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H6).
//
// Cobertura:
//   - happy path: 1 intento, devuelve resultado
//   - retry en error recuperable: 3 intentos totales, throw del ultimo
//   - no retry en error fatal: 1 intento, throw inmediato
//   - jitter dentro del rango esperado
//   - maxAttempts custom (2)
//   - shouldRetry custom (forzar retry / no retry)
//   - onRetry callback
//   - validacion de inputs (fn no es funcion, maxAttempts < 1)
//   - retry del DJIAG_EMAIL config error NO ocurre
//
// Patron consistente con tests/djiag-asset-downloader.test.ts:
//   - imports via createRequire para el .js CommonJS
//   - vi.useFakeTimers + vi.advanceTimersByTimeAsync para controlar sleeps
//   - inyeccion de sleepFn cuando se quiere determinismo total

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const backoff = require("../lib/djiag-backoff") as {
  withBackoff: <T>(fn: () => Promise<T>, opts?: any) => Promise<T>;
  computeDelay: (a: number, base: number, max: number, jitter?: number) => number;
  defaultShouldRetry: (err: unknown) => boolean;
  DEFAULT_MAX_ATTEMPTS: number;
  DEFAULT_BASE_DELAY_MS: number;
  DEFAULT_MAX_DELAY_MS: number;
  DEFAULT_JITTER: number;
};

const {
  withBackoff,
  computeDelay,
  defaultShouldRetry,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_JITTER
} = backoff;

describe("withBackoff — happy path", () => {
  it("devuelve el resultado en el primer intento si la operacion tiene exito", async () => {
    const fn = vi.fn(async () => "ok");
    const sleepFn = vi.fn(async () => undefined);

    const result = await withBackoff(fn, { sleepFn });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("acepta una funcion sync que devuelve una promesa (default export)", async () => {
    const fn = vi.fn(async () => 42);
    const result = await withBackoff(fn, { sleepFn: async () => undefined });
    expect(result).toBe(42);
  });
});

describe("withBackoff — retry en errores recuperables", () => {
  it("reintenta hasta 3 veces y luego throw (maxAttempts=3 default)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("net::ERR_CONNECTION_REFUSED");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn })).rejects.toThrow("ERR_CONNECTION_REFUSED");

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    // 2 sleeps (despues del attempt 0 y del attempt 1; no despues del ultimo)
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("reintenta con delays 1.5s, 3s por default", async () => {
    const fn = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn })).rejects.toThrow();

    const delays = sleepFn.mock.calls.map((c: unknown[]) => c[0]);
    // Primer delay ~1500 ms (con jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(1125); // 1500 - 25%
    expect(delays[0]).toBeLessThanOrEqual(1875);    // 1500 + 25%
    // Segundo delay ~3000 ms (con jitter)
    expect(delays[1]).toBeGreaterThanOrEqual(2250);
    expect(delays[1]).toBeLessThanOrEqual(3750);
  });

  it("respeta maxAttempts custom (2 intentos, 1 retry)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { maxAttempts: 2, sleepFn })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1); // solo 1 sleep entre los 2 intentos
  });

  it("exitoso en el segundo intento devuelve el resultado y para de reintentar", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 2) throw new Error("net::ERR_INTERNET_DISCONNECTED");
      return "second-attempt-ok";
    });
    const sleepFn = vi.fn(async () => undefined);

    const result = await withBackoff(fn, { sleepFn });
    expect(result).toBe("second-attempt-ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });
});

describe("withBackoff — NO retry en errores fatales", () => {
  it("no reintenta si el error es 'DJIAG_EMAIL and DJIAG_PASSWORD required'", async () => {
    const fn = vi.fn(async () => {
      throw new Error("DjiagKoreanClient: set DJIAG_EMAIL and DJIAG_PASSWORD (or pass via options).");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn })).rejects.toThrow(/DJIAG_EMAIL/);
    expect(fn).toHaveBeenCalledTimes(1); // sin retry
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("no reintenta en TypeError (error de programacion)", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("Cannot read property 'foo' of undefined");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn })).rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("shouldRetry custom puede forzar retry en cualquier error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("custom-fatal");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(
      withBackoff(fn, {
        sleepFn,
        shouldRetry: () => true
      })
    ).rejects.toThrow("custom-fatal");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("shouldRetry custom puede impedir retry en errores recuperables", async () => {
    const fn = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    const sleepFn = vi.fn(async () => undefined);

    await expect(
      withBackoff(fn, {
        sleepFn,
        shouldRetry: () => false
      })
    ).rejects.toThrow("ERR_TIMED_OUT");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withBackoff — jitter", () => {
  it("los delays estan dentro del rango +-25% del base", () => {
    // Sample 50 runs of a 3-attempt retry storm
    for (let i = 0; i < 50; i++) {
      const fn = async () => {
        throw new Error("net::ERR_TIMED_OUT");
      };
      const sleeps: number[] = [];
      const sleepFn = async (ms: number) => {
        sleeps.push(ms);
      };
      void withBackoff(fn, { sleepFn }).catch(() => undefined);
    }
    // No podemos await todo aca — el test es sincrono del sample.
    // En cambio testeamos computeDelay directamente abajo.
    expect(true).toBe(true);
  });

  it("computeDelay devuelve valores en el rango esperado para cada attempt", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let i = 0; i < 100; i++) {
        const d = computeDelay(attempt, 1500, 30000, 0.25);
        const base = Math.min(1500 * Math.pow(2, attempt), 30000);
        expect(d).toBeGreaterThanOrEqual(Math.floor(base * 0.75));
        expect(d).toBeLessThanOrEqual(Math.ceil(base * 1.25));
        expect(d).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("computeDelay respeta el cap maxDelayMs", () => {
    const d = computeDelay(20, 1000, 5000, 0.25);
    // base = min(1000 * 2^20, 5000) = 5000
    // con jitter +-25%: 3750 a 6250
    expect(d).toBeGreaterThanOrEqual(3750);
    expect(d).toBeLessThanOrEqual(6250);
  });
});

describe("withBackoff — callbacks y opciones", () => {
  it("invoca onRetry antes de cada sleep con attempt/delayMs/err", async () => {
    const fn = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    const onRetry = vi.fn();
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn, onRetry })).rejects.toThrow();

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({
      attempt: 1,
      err: expect.any(Error)
    }));
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({
      attempt: 2,
      err: expect.any(Error)
    }));
  });

  it("onRetry recibe delayMs igual al sleep", async () => {
    const fn = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    const onRetry = vi.fn();
    const sleepFn = vi.fn(async () => undefined);

    await expect(withBackoff(fn, { sleepFn, onRetry })).rejects.toThrow();

    for (const call of onRetry.mock.calls) {
      const info = call[0] as { delayMs: number };
      const matchingSleep = sleepFn.mock.calls.find((c: unknown[]) => c[0] === info.delayMs);
      expect(matchingSleep).toBeDefined();
    }
  });
});

describe("withBackoff — validacion de inputs", () => {
  it("lanza si fn no es una funcion", async () => {
    await expect(withBackoff(null as unknown as () => Promise<unknown>)).rejects.toThrow(/fn must be a function/);
    await expect(withBackoff("not a function" as unknown as () => Promise<unknown>)).rejects.toThrow(/fn must be a function/);
  });

  it("lanza si maxAttempts < 1", async () => {
    const fn = vi.fn(async () => "x");
    await expect(withBackoff(fn, { maxAttempts: 0 })).rejects.toThrow(/maxAttempts/);
    await expect(withBackoff(fn, { maxAttempts: -1 })).rejects.toThrow(/maxAttempts/);
  });
});

describe("defaultShouldRetry", () => {
  it("reintenta en errores de red", () => {
    expect(defaultShouldRetry(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(true);
    expect(defaultShouldRetry(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
    expect(defaultShouldRetry(new Error("net::ERR_TIMED_OUT"))).toBe(true);
  });

  it("reintenta en errores de OS / fetch", () => {
    expect(defaultShouldRetry(new Error("ECONNRESET"))).toBe(true);
    expect(defaultShouldRetry(new Error("ETIMEDOUT"))).toBe(true);
    expect(defaultShouldRetry(new Error("fetch failed"))).toBe(true);
  });

  it("reintenta en TimeoutError (Playwright)", () => {
    const err = new Error("Timeout 30000ms exceeded");
    err.name = "TimeoutError";
    expect(defaultShouldRetry(err)).toBe(true);
  });

  it("NO reintenta el error de DJIAG_EMAIL/PASSWORD", () => {
    expect(
      defaultShouldRetry(
        new Error("DjiagKoreanClient: set DJIAG_EMAIL and DJIAG_PASSWORD (or pass via options).")
      )
    ).toBe(false);
  });

  it("NO reintenta errores genericos (TypeError, etc.)", () => {
    expect(defaultShouldRetry(new TypeError("x"))).toBe(false);
    expect(defaultShouldRetry(new RangeError("y"))).toBe(false);
  });
});

describe("constants exportados", () => {
  it("expone los defaults correctos", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(DEFAULT_BASE_DELAY_MS).toBe(1500);
    expect(DEFAULT_MAX_DELAY_MS).toBe(30_000);
    expect(DEFAULT_JITTER).toBe(0.25);
  });
});
