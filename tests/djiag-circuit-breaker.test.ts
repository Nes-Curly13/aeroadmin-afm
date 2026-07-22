// Tests para lib/djiag-circuit-breaker.js — state machine con persistencia.
//
// S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2).
//
// Cobertura:
//   - estado inicial: closed
//   - closed -> open despues de N failures (default 3)
//   - open -> half-open despues de resetTimeoutMs
//   - half-open -> closed si pasa (recordSuccess)
//   - half-open -> open si falla (recordFailure, reset openedAt)
//   - guard() throws con countdown cuando esta open
//   - guard() deja pasar cuando esta closed o half-open
//   - persistencia en disco: escribe y lee el state
//   - no clobberea otras secciones del JSON (lastRunAt, etc.)
//   - formatRemaining helper
//   - clock inyectable para tests deterministas
//   - reset() limpia el state
//   - failureThreshold custom
//
// Patron: createRequire para el .js CJS, vi.hoisted + tmpdir para el
// archivo de health, clock mockeado para evitar sleeps reales.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const cbModule = require("../lib/djiag-circuit-breaker") as {
  CircuitBreaker: new (opts?: any) => any;
  formatRemaining: (ms: number) => string;
  DEFAULT_FAILURE_THRESHOLD: number;
  DEFAULT_RESET_TIMEOUT_MS: number;
};

const { CircuitBreaker, formatRemaining, DEFAULT_FAILURE_THRESHOLD, DEFAULT_RESET_TIMEOUT_MS } = cbModule;

// Clock mockeado. Devuelve Date objects controlados por `now`.
// Para "avanzar el tiempo", se cambia el valor de `now`.
function makeFakeClock(initial = 1_700_000_000_000) {
  let current = initial;
  return {
    now: () => new Date(current),
    setTime: (ms: number) => { current = ms; },
    advance: (ms: number) => { current += ms; },
    nowMs: () => current
  };
}

describe("CircuitBreaker — estado inicial", () => {
  it("empieza en 'closed' sin failures", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.failureCount).toBe(0);
    expect(cb.openedAt).toBeNull();
  });

  it("expone los defaults correctos", () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(3);
    expect(DEFAULT_RESET_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});

describe("CircuitBreaker — closed -> open", () => {
  it("abre despues de N failures consecutivos (default 3)", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.openedAt).not.toBeNull();
  });

  it("respeta failureThreshold custom (2)", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  it("respeta failureThreshold custom (5)", () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  it("un success resetea el contador de failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.failureCount).toBe(2);
    cb.recordSuccess();
    expect(cb.failureCount).toBe(0);
    expect(cb.getState()).toBe("closed");
    // Despues del reset, necesita 3 failures nuevos para abrir
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });
});

describe("CircuitBreaker — open -> half-open -> closed/open", () => {
  let tmpDir: string;
  let clock: ReturnType<typeof makeFakeClock>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cb-test-"));
    clock = makeFakeClock();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("transiciona a half-open despues de resetTimeoutMs (5 min default)", () => {
    const cb = new CircuitBreaker({
      healthFilePath: join(tmpDir, "_health.json"),
      now: clock.now
    });
    // 3 failures -> open
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    // Avanzar 4 minutos: todavia open
    clock.advance(4 * 60 * 1000);
    expect(cb.getState()).toBe("open");

    // Avanzar 1 minuto mas: ya pasaron 5 min -> half-open
    clock.advance(60 * 1000);
    expect(cb.getState()).toBe("half-open");
  });

  it("half-open -> closed si pasa (recordSuccess)", () => {
    const cb = new CircuitBreaker({ now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(DEFAULT_RESET_TIMEOUT_MS + 1000);

    expect(cb.getState()).toBe("half-open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.failureCount).toBe(0);
    expect(cb.openedAt).toBeNull();
  });

  it("half-open -> open si falla (recordFailure resetea openedAt)", () => {
    const cb = new CircuitBreaker({ now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    const initialOpenedAt = cb.openedAt;
    clock.advance(DEFAULT_RESET_TIMEOUT_MS + 1000);

    expect(cb.getState()).toBe("half-open");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    // openedAt debe haberse actualizado
    expect(cb.openedAt).not.toBe(initialOpenedAt);
    expect(new Date(cb.openedAt).getTime()).toBeGreaterThan(new Date(initialOpenedAt).getTime());
  });

  it("respeta resetTimeoutMs custom (10 segundos)", () => {
    const cb = new CircuitBreaker({ resetTimeoutMs: 10_000, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(9_999);
    expect(cb.getState()).toBe("open");
    clock.advance(2);
    expect(cb.getState()).toBe("half-open");
  });
});

describe("CircuitBreaker — guard()", () => {
  let tmpDir: string;
  let clock: ReturnType<typeof makeFakeClock>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cb-test-"));
    clock = makeFakeClock();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deja pasar en 'closed'", () => {
    const cb = new CircuitBreaker();
    expect(() => cb.guard()).not.toThrow();
  });

  it("deja pasar en 'half-open'", () => {
    const cb = new CircuitBreaker({ now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(DEFAULT_RESET_TIMEOUT_MS + 1000);
    expect(cb.getState()).toBe("half-open");
    expect(() => cb.guard()).not.toThrow();
  });

  it("throws con countdown cuando esta 'open'", () => {
    const cb = new CircuitBreaker({
      healthFilePath: join(tmpDir, "_health.json"),
      now: clock.now
    });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    // Acabamos de abrir; msUntilHalfOpen ~= 300000
    expect(() => cb.guard()).toThrow(/Circuit open, retry in 5m00s/);
  });

  it("el countdown refleja el tiempo restante real", () => {
    const cb = new CircuitBreaker({ now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(2 * 60 * 1000 + 30 * 1000); // 2m30s elapsed
    // Quedan 2m30s
    expect(() => cb.guard()).toThrow(/Circuit open, retry in 2m30s/);
  });

  it("el countdown en formato 0m05s cuando faltan 5 segundos", () => {
    const cb = new CircuitBreaker({ now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(DEFAULT_RESET_TIMEOUT_MS - 5_000);
    expect(() => cb.guard()).toThrow(/Circuit open, retry in 0m05s/);
  });
});

describe("CircuitBreaker — persistencia en disco", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cb-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("escribe el state en _health.json al hacer recordFailure", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    expect(parsed.circuitBreaker).toBeDefined();
    expect(parsed.circuitBreaker.state).toBe("open");
    expect(parsed.circuitBreaker.failureCount).toBe(3);
    expect(parsed.circuitBreaker.openedAt).not.toBeNull();
  });

  it("lee el state desde disco al instanciar", () => {
    const p = join(tmpDir, "_health.json");
    // Pre-poblar el archivo con state 'open'
    writeFileSync(p, JSON.stringify({
      lastRunAt: "2026-07-22T00:00:00.000Z",
      circuitBreaker: {
        state: "open",
        failureCount: 3,
        openedAt: new Date(Date.now() + 60_000).toISOString(), // abierto hace poco
        lastFailureAt: null
      }
    }), "utf8");

    const cb = new CircuitBreaker({ healthFilePath: p });
    expect(cb.getState()).toBe("open");
    expect(cb.failureCount).toBe(3);
  });

  it("no clobberea otras secciones del JSON (lastRunAt, lastSuccessfulSyncAt, etc.)", () => {
    const p = join(tmpDir, "_health.json");
    const preExisting = {
      lastRunAt: "2026-07-22T10:00:00.000Z",
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: "2026-07-22T10:00:00.000Z",
      steps: [{ order: 1, name: "scrape", status: "ok" }],
      totals: { flights: 5, fumigations: 2, lands: 1207 },
      version: 1
    };
    writeFileSync(p, JSON.stringify(preExisting), "utf8");

    const cb = new CircuitBreaker({ healthFilePath: p });
    cb.recordFailure();

    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.lastRunAt).toBe("2026-07-22T10:00:00.000Z");
    expect(after.lastRunStatus).toBe("ok");
    expect(after.lastSuccessfulSyncAt).toBe("2026-07-22T10:00:00.000Z");
    expect(after.steps).toEqual([{ order: 1, name: "scrape", status: "ok" }]);
    expect(after.totals).toEqual({ flights: 5, fumigations: 2, lands: 1207 });
    expect(after.version).toBe(1);
    expect(after.circuitBreaker).toBeDefined();
  });

  it("crea el directorio si no existe", () => {
    const nested = join(tmpDir, "deep", "nested", "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: nested });
    cb.recordFailure();
    expect(existsSync(nested)).toBe(true);
  });

  it("maneja archivo corrupto como 'sin state' (no throw)", () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, "{ not valid json", "utf8");
    expect(() => new CircuitBreaker({ healthFilePath: p })).not.toThrow();
    const cb = new CircuitBreaker({ healthFilePath: p });
    expect(cb.getState()).toBe("closed");
  });

  it("maneja archivo inexistente como 'sin state' (no throw)", () => {
    const p = join(tmpDir, "missing.json");
    expect(() => new CircuitBreaker({ healthFilePath: p })).not.toThrow();
    const cb = new CircuitBreaker({ healthFilePath: p });
    expect(cb.getState()).toBe("closed");
  });

  it("el state persiste entre instancias separadas", () => {
    const p = join(tmpDir, "_health.json");
    const cb1 = new CircuitBreaker({ healthFilePath: p, failureThreshold: 2 });
    cb1.recordFailure();
    cb1.recordFailure();
    expect(cb1.getState()).toBe("open");

    // Simular reinicio: nueva instancia, mismo healthFilePath
    const cb2 = new CircuitBreaker({ healthFilePath: p, failureThreshold: 2 });
    expect(cb2.getState()).toBe("open");
    expect(cb2.failureCount).toBe(2);
  });

  it("si el archivo no tiene seccion circuitBreaker, empieza fresh", () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({ lastRunAt: "2026-07-22" }), "utf8");
    const cb = new CircuitBreaker({ healthFilePath: p });
    expect(cb.getState()).toBe("closed");
    expect(cb.failureCount).toBe(0);
  });
});

describe("CircuitBreaker — snapshot y reset", () => {
  it("snapshot() devuelve todos los campos relevantes", () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
    cb.recordFailure();
    const snap = cb.snapshot();
    expect(snap.state).toBe("closed");
    expect(snap.failureCount).toBe(1);
    expect(snap.failureThreshold).toBe(5);
    expect(snap.resetTimeoutMs).toBe(60_000);
    expect(snap.openedAt).toBeNull();
  });

  it("reset() limpia el state y persiste", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cb-test-"));
    try {
      const p = join(tmpDir, "_health.json");
      const cb = new CircuitBreaker({ healthFilePath: p });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("open");
      cb.reset();
      expect(cb.getState()).toBe("closed");
      expect(cb.failureCount).toBe(0);
      expect(cb.openedAt).toBeNull();
      // Persistido
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      expect(parsed.circuitBreaker.state).toBe("closed");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("formatRemaining", () => {
  it("formatea minutos y segundos con zero-padding (formato XmYYs)", () => {
    expect(formatRemaining(60_000)).toBe("1m00s");
    expect(formatRemaining(65_000)).toBe("1m05s");
    expect(formatRemaining(125_000)).toBe("2m05s");
    expect(formatRemaining(270_000)).toBe("4m30s");
    expect(formatRemaining(300_000)).toBe("5m00s");
  });

  it("incluye 0m para tiempos bajo 1 minuto (formato consistente)", () => {
    expect(formatRemaining(5_000)).toBe("0m05s");
    expect(formatRemaining(30_000)).toBe("0m30s");
    expect(formatRemaining(59_000)).toBe("0m59s");
  });

  it("maneja ms restantes como ceiling en segundos (no perder tiempo)", () => {
    // 100ms -> 1s (no 0s) — el caller debe esperar al menos 1s.
    expect(formatRemaining(100)).toBe("0m01s");
    expect(formatRemaining(999)).toBe("0m01s");
  });

  it("devuelve '0m00s' para valores <= 0", () => {
    expect(formatRemaining(0)).toBe("0m00s");
    expect(formatRemaining(-100)).toBe("0m00s");
    expect(formatRemaining(-60_000)).toBe("0m00s");
  });
});
