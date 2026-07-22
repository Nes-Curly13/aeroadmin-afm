// Helper puro de backoff exponencial con jitter.
//
// XS3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H6).
//
// Por que existe:
//   - `DjiagKoreanClient.login()` (lib/djiag-korean-client.js) no tenia
//     retry logic. Si DJI estaba con rate-limit, martillamos la UI de
//     login en cada corrida.
//   - Replica el patron de `fetchWithRetry` en lib/djiag-asset-downloader.js:
//     exponential backoff + jitter +-25% sobre el delay base.
//
// Por que .js (no .ts):
//   - El cliente DJI (`djiag-korean-client.js`) es CommonJS y se ejecuta
//     directamente con `node scripts/...`. Para poder hacer
//     `require('./djiag-backoff')` desde el .js, este helper debe ser .js.
//   - El companion `lib/djiag-backoff.d.ts` expone los tipos a los tests
//     TS y a cualquier consumidor de Next/vite (mismo patron que
//     `djiag-asset-downloader.js` + `.d.ts`).
//
// API:
//   withBackoff(fn, opts) -> Promise<T>
//     - fn: () => Promise<T>      (la operacion a reintentar)
//     - opts:
//       - maxAttempts: number    (default 3; incluye el intento inicial)
//       - baseDelayMs: number    (default 1500)
//       - maxDelayMs:  number    (default 30_000; cap del delay)
//       - jitter:       number   (default 0.25; +-25% del delay base)
//       - shouldRetry: (err) => boolean
//                          default: errors de red / timeout. NO reintenta
//                          errors de programacion (config faltante, etc).
//       - sleepFn:     (ms) => Promise<void>
//                          default: setTimeout-based. Inyectable para tests.
//       - onRetry:     (info) => void
//                          callback opcional con { attempt, delayMs, err }
//                          antes de cada sleep entre reintentos.
//
// Comportamiento:
//   - attempt 0 (1er intento): si falla y shouldRetry, esperar 1.5s
//   - attempt 1 (2do intento): si falla y shouldRetry, esperar 3s
//   - attempt 2 (3er intento): si falla, throw (no mas reintentos)
//   - Para maxAttempts=N, los delays siguen exponential base*2^i con cap
//     en maxDelayMs. Con default base=1500: 1.5s, 3s, 6s, 12s, 24s, 30s (cap).
//   - Para maxAttempts=3 (default), solo se usan los primeros 2 delays (1.5s, 3s);
//     el 6s esta documentado para referencia / para maxAttempts>3.
//
// Errores:
//   - Si shouldRetry devuelve false en cualquier intento, throw inmediato.
//   - Si se agotan maxAttempts, throw del ultimo error.
//
// Tests: tests/djiag-backoff.test.ts.

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER = 0.25;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Determina si un error es recuperable (red / timeout) y vale reintentar.
 * Por defecto NO reintenta errores explicitos como "DJIAG_EMAIL and
 * DJIAG_PASSWORD required" — eso es un error de programacion, no
 * transitorio.
 */
function defaultShouldRetry(err) {
  if (!err) return false;
  if (typeof err === 'string') return true;
  const name = err.name ?? '';
  const msg = err.message ?? '';
  // Errores de programacion: NO reintentar
  if (msg.includes('DJIAG_EMAIL and DJIAG_PASSWORD')) return false;
  // Playwright TimeoutError
  if (name === 'TimeoutError') return true;
  // Patrones de red comunes
  if (msg.includes('net::ERR_')) return true;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(msg)) return true;
  if (msg.includes('fetch failed')) return true;
  if (msg.toLowerCase().includes('timeout')) return true;
  if (msg.toLowerCase().includes('network')) return true;
  if (msg.toLowerCase().includes('navigation')) return true;
  return false;
}

/**
 * Calcula el delay para un reintento (exponencial + jitter).
 * `attempt` es 0-indexed: attempt=0 -> primer retry, attempt=1 -> segundo, etc.
 */
function computeDelay(attempt, baseDelayMs, maxDelayMs, jitter) {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitterAmount = exponential * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exponential + jitterAmount));
}

/**
 * Ejecuta `fn` con reintentos exponentiales + jitter.
 * Lanza el ultimo error si se agotan los intentos.
 */
async function withBackoff(fn, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitter = DEFAULT_JITTER,
    shouldRetry = defaultShouldRetry,
    sleepFn = defaultSleep,
    onRetry = null
  } = opts;

  if (typeof fn !== 'function') {
    throw new Error('withBackoff: fn must be a function');
  }
  if (maxAttempts < 1) {
    throw new Error('withBackoff: maxAttempts must be >= 1');
  }

  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Error no recuperable: throw inmediato
      if (!shouldRetry(err)) throw err;
      // Ultimo intento: throw
      if (attempt === maxAttempts - 1) break;
      // Esperar antes del siguiente intento
      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      if (typeof onRetry === 'function') {
        try { onRetry({ attempt: attempt + 1, delayMs: delay, err }); } catch {}
      }
      await sleepFn(delay);
    }
  }
  throw lastErr;
}

module.exports = {
  withBackoff,
  computeDelay,
  defaultShouldRetry,
  // Constants exported for tests
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_JITTER
};
