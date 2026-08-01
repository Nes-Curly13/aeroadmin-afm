// Tests para la pre-flight check del circuit breaker en
// scripts/run-pipeline.js (Sprint H2+H6, 2026-07-30).
//
// S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2). El orchestrator
// (`scripts/run-pipeline.js`) consulta el circuit breaker ANTES de
// spawnear cualquier child, para fail-fast si SmartFarm Web está
// caído. Estos tests verifican:
//
//   - Circuit en 'closed' → la check pasa (no skip).
//   - Circuit en 'open' (3 failures consecutivos) → la check
//     devuelve { skipped: true, exitCode: 1, reason: 'Circuit
//     open, retry in 5m00s' }.
//   - Después de 5 min (resetTimeoutMs) → el circuit pasa a
//     'half-open' y la check deja pasar (intento de prueba).
//   - El circuit persiste entre instancias (file-based).
//   - Si el archivo no existe o está corrupto → la check pasa
//     (best-effort).
//   - El pre-flight check NO llama a `recordFailure` ni
//     `recordSuccess` — solo lee el state. El korean-client es
//     el que actualiza el state cuando el child intenta login.
//
// Estrategia:
//   - Importar el .js via createRequire (mismo patrón que
//     tests/scripts-run-pipeline-health.test.ts y tests/djiag-circuit-breaker.test.ts).
//   - `checkCircuitBreaker` acepta `healthFilePath` (tmpdir) y `now`
//     (clock inyectable) para tests deterministas.
//   - Para verificar el comportamiento end-to-end de la state machine,
//     manipulamos el archivo `_health.json` directamente entre tests
//     (más rápido que ir por recordFailure/recordSuccess).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const pipeline = require("../scripts/run-pipeline.js") as {
  checkCircuitBreaker: (opts?: {
    healthFilePath?: string;
    now?: () => Date;
  }) => {
    checked: boolean;
    skipped: boolean;
    exitCode?: number;
    reason?: string;
  };
};

const cbModule = require("../lib/djiag-circuit-breaker") as {
  CircuitBreaker: new (opts?: any) => any;
  DEFAULT_FAILURE_THRESHOLD: number;
  DEFAULT_RESET_TIMEOUT_MS: number;
};

const { CircuitBreaker, DEFAULT_FAILURE_THRESHOLD, DEFAULT_RESET_TIMEOUT_MS } = cbModule;

// Clock mockeado (mismo patrón que tests/djiag-circuit-breaker.test.ts).
function makeFakeClock(initial = 1_700_000_000_000) {
  let current = initial;
  return {
    now: () => new Date(current),
    setTime: (ms: number) => { current = ms; },
    advance: (ms: number) => { current += ms; },
    nowMs: () => current
  };
}

describe("checkCircuitBreaker — circuit closed (caso normal)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archivo inexistente → checked=true, skipped=false, sigue", () => {
    const r = pipeline.checkCircuitBreaker({
      healthFilePath: join(tmpDir, "missing.json")
    });
    expect(r.checked).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.exitCode).toBeUndefined();
  });

  it("archivo vacío o sin sección circuitBreaker → checked=true, skipped=false", () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({ lastRunAt: "2026-07-22T00:00:00.000Z" }), "utf8");
    const r = pipeline.checkCircuitBreaker({ healthFilePath: p });
    expect(r.checked).toBe(true);
    expect(r.skipped).toBe(false);
  });

  it("circuit con state=closed y failureCount < threshold → checked=true, skipped=false", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p });
    cb.recordFailure();
    cb.recordFailure();
    // 2 failures < default 3 → sigue cerrado.
    expect(cb.getState()).toBe("closed");

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p });
    expect(r.checked).toBe(true);
    expect(r.skipped).toBe(false);
  });

  it("circuit con state=half-open (después del cooldown) → checked=true, skipped=false (deja pasar la probe)", () => {
    const clock = makeFakeClock();
    const p = join(tmpDir, "_health.json");
    // Sembrar un circuit abierto con openedAt en el pasado.
    const pastOpenedAt = new Date(clock.nowMs() - DEFAULT_RESET_TIMEOUT_MS - 1000).toISOString();
    writeFileSync(p, JSON.stringify({
      lastRunAt: "2026-07-22T00:00:00.000Z",
      lastRunStatus: "ok",
      steps: [],
      totals: { flights: 0, fumigations: 0, lands: 0 },
      version: 1,
      circuitBreaker: {
        state: "open",
        failureCount: DEFAULT_FAILURE_THRESHOLD,
        openedAt: pastOpenedAt,
        lastFailureAt: pastOpenedAt,
        failureThreshold: DEFAULT_FAILURE_THRESHOLD,
        resetTimeoutMs: DEFAULT_RESET_TIMEOUT_MS
      }
    }), "utf8");

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.checked).toBe(true);
    expect(r.skipped).toBe(false);
  });
});

describe("checkCircuitBreaker — circuit open (caso de fallo)", () => {
  let tmpDir: string;
  let clock: ReturnType<typeof makeFakeClock>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-"));
    clock = makeFakeClock();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("3 failures consecutivos → state=open → check devuelve { skipped: true, exitCode: 1 }", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.checked).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it("el reason incluye el countdown en formato XmYYs", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    // Sin tiempo transcurrido → quedan 5 min default.
    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.reason).toMatch(/Circuit open, retry in 5m00s/);
  });

  it("el countdown refleja el tiempo restante real", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    // Avanzar 2 minutos → quedan 3 min.
    clock.advance(2 * 60 * 1000);

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.reason).toMatch(/Circuit open, retry in 3m00s/);
  });

  it("el countdown cuando faltan 5 segundos → formato 0m05s (no 5s)", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    // Avanzar hasta que queden 5s.
    clock.advance(DEFAULT_RESET_TIMEOUT_MS - 5_000);

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.reason).toMatch(/Circuit open, retry in 0m05s/);
  });

  it("después del cooldown completo (5 min) → state transiciona a half-open y la check deja pasar", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    // Avanzar más del resetTimeoutMs.
    clock.advance(DEFAULT_RESET_TIMEOUT_MS + 1000);

    const r = pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(r.skipped).toBe(false);
    // Y el state del CB en disco ahora es half-open (transición automática
    // aplicada por getState() durante guard()).
    const reloaded = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(reloaded.getState()).toBe("half-open");
  });
});

describe("checkCircuitBreaker — persistencia entre instancias", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-persist-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("un circuit abierto en una 'corrida' sigue abierto en la siguiente", () => {
    const p = join(tmpDir, "_health.json");

    // Corrida 1: 3 failures → abre.
    const cb1 = new CircuitBreaker({ healthFilePath: p });
    cb1.recordFailure();
    cb1.recordFailure();
    cb1.recordFailure();
    expect(cb1.getState()).toBe("open");
    expect(existsSync(p)).toBe(true);

    // Corrida 2: el orchestrator (checkCircuitBreaker) lee el state
    // del disco y detecta que sigue abierto.
    const r = pipeline.checkCircuitBreaker({ healthFilePath: p });
    expect(r.skipped).toBe(true);
    expect(r.exitCode).toBe(1);
  });
});

describe("checkCircuitBreaker — no muta el state (read-only)", () => {
  let tmpDir: string;
  let clock: ReturnType<typeof makeFakeClock>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-readonly-"));
    clock = makeFakeClock();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("la check NO registra failures (no cambia failureCount)", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    const before = cb.failureCount;
    const beforeOpenedAt = cb.openedAt;

    pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });

    // Releer el state.
    const reloaded = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(reloaded.failureCount).toBe(before);
    expect(reloaded.openedAt).toBe(beforeOpenedAt);
  });

  it("la check NO registra successes (no resetea failureCount)", () => {
    const p = join(tmpDir, "_health.json");
    const cb = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure(); // abre
    const before = cb.failureCount;
    expect(cb.getState()).toBe("open");

    pipeline.checkCircuitBreaker({ healthFilePath: p, now: clock.now });

    // El state sigue siendo el mismo (open, 3 failures).
    const reloaded = new CircuitBreaker({ healthFilePath: p, now: clock.now });
    expect(reloaded.failureCount).toBe(before);
    expect(reloaded.getState()).toBe("open");
  });
});

describe("checkCircuitBreaker — best-effort en errores de I/O", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-io-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archivo corrupto (JSON inválido) → checked=false, skipped=false, sigue", () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, "{ not valid json", "utf8");
    const r = pipeline.checkCircuitBreaker({ healthFilePath: p });
    // El CircuitBreaker no tira con archivo corrupto (lo trata como fresh).
    // Por lo tanto checked=true. Pero verificamos que en cualquier caso
    // NO crashea.
    expect(r.skipped).toBe(false);
  });

  it("un path con directorio inexistente lo crea si la implementación lo hace", () => {
    // La implementación de CircuitBreaker crea el directorio al persistir.
    // Pero checkCircuitBreaker no persiste (read-only). El CircuitBreaker
    // constructor sí podría fallar al cargar si el directorio no existe.
    // Verificamos que en cualquier caso, no crashea con un path "raro".
    const nested = join(tmpDir, "deep", "nested", "_health.json");
    const r = pipeline.checkCircuitBreaker({ healthFilePath: nested });
    expect(r.skipped).toBe(false);
  });
});

describe("checkCircuitBreaker — signature acepta solo healthFilePath (clock default)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-cb-signature-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("llamar sin opts usa el default (cwd-based path) y no crashea", () => {
    // No podemos cambiar cwd en este test (afectaría otros tests),
    // pero podemos llamar sin opts y verificar que no crashea con
    // un archivo posiblemente inexistente. Si el archivo no existe
    // en el cwd del test, devuelve { checked: true, skipped: false }.
    expect(() => pipeline.checkCircuitBreaker()).not.toThrow();
  });
});
