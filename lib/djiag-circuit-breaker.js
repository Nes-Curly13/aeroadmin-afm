// Circuit breaker para DjiagKoreanClient (S1, audit 2026-07-22, H2).
//
// Problema que resuelve:
//   - Si SmartFarm Web esta caido, login() falla, el cron vuelve a
//     intentar 1h despues, falla, etc. Cada intento = login UI
//     completo (~30s). En 4h = 4 logins fallidos martillando DJI.
//   - Riesgo: rate-limit persistente de la IP, cookies expiradas
//     en storage state, etc.
//
// Solucion: state machine closed -> open -> half-open -> closed/open.
//   - closed: trafico normal, contar failures consecutivos.
//   - open: rechazar todas las llamadas hasta `resetTimeoutMs`
//     (default 5 min). Fail-fast con mensaje claro.
//   - half-open: dejar pasar 1 llamada de prueba. Si pasa -> closed.
//     Si falla -> open (resetear openedAt).
//
// Persistencia:
//   - El state se persiste en `djiag_exports/_health.json` (mismo
//     archivo que usa `lib/djiag-health.ts` para el endpoint
//     `/api/admin/djiag-health`). Seccion `circuitBreaker`.
//   - Si el archivo no existe o no tiene la seccion, empezar fresh.
//   - Al persistir, NO clobberear otras secciones (lastRunAt,
//     lastSuccessfulSyncAt, etc.) — solo actualizar `circuitBreaker`.
//
// Defaults:
//   - failureThreshold: 3
//   - resetTimeoutMs:  5 * 60 * 1000  (5 minutos)
//   - halfOpenMaxConcurrent: 1  (no implementado a nivel de clase,
//     se maneja a nivel de caller — el breaker permite UNA llamada
//     de prueba; las siguientes que lleguen mientras half-open tambien
//     cuentan como failure si la primera falla).
//
// Por que .js (no .ts):
//   - El cliente DJI (djiag-korean-client.js) es CJS y se ejecuta
//     con `node scripts/...`. Para `require('./djiag-circuit-breaker')`
//     desde el .js, este helper debe ser .js.
//   - El companion `lib/djiag-circuit-breaker.d.ts` expone los tipos
//     a consumers TS (mismo patron que djiag-asset-downloader).
//
// Tests: tests/djiag-circuit-breaker.test.ts

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Formatea milisegundos como "XmYYs" (e.g. 270000 -> "4m30s", 5000 -> "0m05s").
 * Usado para el mensaje de error cuando el circuit esta open.
 * Formato consistente (zero-padded) para que sea facil de parsear/loggear.
 */
function formatRemaining(ms) {
  if (ms <= 0) return '0m00s';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

class CircuitBreaker {
  /**
   * @param {object} [options]
   * @param {number} [options.failureThreshold=3]   - failures consecutivos para abrir
   * @param {number} [options.resetTimeoutMs=300000] - ms antes de half-open
   * @param {string} [options.healthFilePath]       - path a _health.json (opcional)
   * @param {() => Date} [options.now]              - clock inyectable (tests)
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.healthFilePath = options.healthFilePath ?? null;
    this._now = options.now ?? (() => new Date());

    // Estado interno. Persistido en disco si healthFilePath.
    this.state = 'closed';
    this.failureCount = 0;
    this.openedAt = null;       // ISO string
    this.lastFailureAt = null;  // ISO string

    // Cargar desde disco al instanciar
    this._loadFromDisk();
  }

  // -- Persistencia ----------------------------------------------------

  _loadFromDisk() {
    if (!this.healthFilePath) return;
    let raw;
    try {
      raw = fs.readFileSync(this.healthFilePath, 'utf8');
    } catch {
      return; // archivo no existe, empezar fresh
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // JSON corrupto, empezar fresh
    }
    const cb = parsed?.circuitBreaker;
    if (!cb || typeof cb !== 'object') return;
    if (cb.state === 'closed' || cb.state === 'open' || cb.state === 'half-open') {
      this.state = cb.state;
      this.failureCount = Number.isFinite(cb.failureCount) ? cb.failureCount : 0;
      this.openedAt = cb.openedAt ?? null;
      this.lastFailureAt = cb.lastFailureAt ?? null;
    }
  }

  _persistToDisk() {
    if (!this.healthFilePath) return;
    let payload = {};
    try {
      const raw = fs.readFileSync(this.healthFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed;
      }
    } catch {
      // archivo no existe o corrupto, empezar fresh
    }
    payload.circuitBreaker = {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt
    };
    try {
      const dir = path.dirname(this.healthFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.healthFilePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // No fallar el flujo principal por no poder persistir
    }
  }

  // -- State machine ---------------------------------------------------

  /**
   * Milisegundos restantes antes de que el circuit pueda transicionar
   * a half-open. 0 si no esta en 'open' o si ya expiro el timeout.
   */
  msUntilHalfOpen() {
    if (this.state !== 'open' || !this.openedAt) return 0;
    const openedAtMs = new Date(this.openedAt).getTime();
    const elapsed = this._now().getTime() - openedAtMs;
    return Math.max(0, this.resetTimeoutMs - elapsed);
  }

  /**
   * Devuelve el state actual, aplicando transiciones automaticas:
   * - open + resetTimeout expirado -> half-open.
   *
   * Como side effect, persiste si hubo transicion.
   */
  getState() {
    if (this.state === 'open' && this.msUntilHalfOpen() === 0) {
      this.state = 'half-open';
      this._persistToDisk();
    }
    return this.state;
  }

  /**
   * Verifica que el circuit permita el paso. Throws si esta 'open'.
   * Para 'closed' y 'half-open' deja pasar.
   *
   * Mensaje de error en 'open': "Circuit open, retry in 4m32s".
   */
  guard() {
    const state = this.getState();
    if (state === 'open') {
      const ms = this.msUntilHalfOpen();
      throw new Error(`Circuit open, retry in ${formatRemaining(ms)}`);
    }
  }

  /**
   * Registra exito. En 'half-open' transiciona a 'closed'. En 'open'
   * (raro, pero posible si pasaron cosas raras) tambien. En 'closed'
   * resetea el contador de failures.
   */
  recordSuccess() {
    if (this.state !== 'closed') {
      this.state = 'closed';
    }
    this.failureCount = 0;
    this.openedAt = null;
    this._persistToDisk();
  }

  /**
   * Registra failure.
   * - En 'half-open': la probe fallo, volver a 'open' (resetear openedAt).
   * - En 'closed': incrementar contador; si >= threshold, abrir.
   * - En 'open': no deberia pasar (guard() rechaza), pero si pasa
   *   (e.g. guard bypassed), contar igual.
   */
  recordFailure() {
    this.failureCount += 1;
    this.lastFailureAt = this._now().toISOString();
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = this._now().toISOString();
    } else if (this.state === 'open') {
      // Re-abrir con timestamp fresco (no deberia pasar por guard())
      this.openedAt = this._now().toISOString();
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this._now().toISOString();
    }
    this._persistToDisk();
  }

  /**
   * Snapshot del state (util para tests / logging).
   */
  snapshot() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs
    };
  }

  /**
   * Reset completo (util para tests).
   */
  reset() {
    this.state = 'closed';
    this.failureCount = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this._persistToDisk();
  }
}

module.exports = {
  CircuitBreaker,
  formatRemaining,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RESET_TIMEOUT_MS
};
