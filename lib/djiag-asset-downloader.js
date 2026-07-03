// Descarga de assets DJI AG (geometry/parameter/waypoint) — helper puro.
//
// Diseño:
//   - PURO (sin Playwright, sin DB). Solo usa `fetch` global + `fs`.
//   - `fetch` se inyecta por parámetro → testeable con fetch mockeado.
//   - Idempotente: si el archivo destino existe, se skipea (override con
//     `force: true`).
//   - Concurrencia limitada con p-limit inline (sin npm dependency).
//   - Retry con exponential backoff + jitter para 429/5xx y errores de red.
//
// Por qué este helper existe:
//   - §4.2 de SCRAPER_DEFECTS.md documenta que el download original era
//     secuencial sin retry/timeout. Si una signed URL de DJI expiraba,
//     el fetch tiraba y mataba toda la corrida.
//   - Las URLs tienen expiración ~12h. Necesitamos ser robustos.
//
// Filename pattern (alineado con import_djiag_data.js):
//   `${sanitizeExternalId(externalId)}_${kind}.json`
//   donde sanitizeExternalId = `s/[^a-zA-Z0-9._-]/g/_/`

const fs = require('fs');
const path = require('path');

const DEFAULT_KINDS = ['geometry', 'parameter', 'waypoint'];

/**
 * Sanitiza un externalId para usarlo como nombre de archivo.
 * Conserva solo letras, dígitos, guion, guion bajo y punto.
 * Replica el patrón de import_djiag_data.js:315.
 */
function sanitizeExternalId(externalId) {
  return String(externalId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Path absoluto al archivo destino para una combinación externalId+kind.
 *   buildAssetPath('/tmp/files', 'abc-flyer-uuid', 'geometry')
 *   → '/tmp/files/abc-flyer-uuid_geometry.json'
 */
function buildAssetPath(outDir, externalId, kind) {
  const base = `${sanitizeExternalId(externalId)}_${kind}`;
  return path.join(outDir, `${base}.json`);
}

/**
 * Construye el índice de tasks a descargar a partir de una lista de lands.
 * Filtra lands sin externalId y sin URL para el kind solicitado.
 *
 *   [{ externalId, landName, kind, url }, ...]
 *
 * Una task = 1 descarga. 1 land puede generar hasta 3 tasks (geometry/parameter/waypoint).
 */
function buildAssetIndex(lands, kinds = DEFAULT_KINDS) {
  const tasks = [];
  for (const land of lands) {
    if (!land?.externalId) continue;
    const urlByKind = {
      geometry: land.geometryUrl,
      parameter: land.parameterUrl,
      waypoint: land.waypointUrl
    };
    for (const kind of kinds) {
      const url = urlByKind[kind];
      if (!url) continue;
      tasks.push({
        externalId: land.externalId,
        landName: land.name ?? null,
        kind,
        url
      });
    }
  }
  return tasks;
}

/**
 * Promise pool simple (a.k.a. p-limit). Sin dependencias externas.
 *
 *   const limit = pLimit(4);
 *   await Promise.all([1,2,3,4,5,6,7,8].map(n => limit(() => work(n))));
 */
function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(
      (v) => { active--; resolve(v); next(); },
      (e) => { active--; reject(e); next(); }
    );
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch con AbortSignal.timeout + retry exponential backoff.
 *
 * Retry on:
 *   - HTTP 5xx (server error)
 *   - HTTP 429 (too many requests)
 *   - Network errors (ECONNRESET, ETIMEDOUT, fetch failed, etc.)
 *
 * NO retry on:
 *   - HTTP 4xx (except 429) — el server dice "tu request está mal", retry no ayuda
 *   - HTTP 2xx / 3xx — éxito
 *
 * Devuelve el objeto Response. NO valida el body (eso lo hace el caller).
 *
 * @param {string} url
 * @param {object} opts
 * @param {number} [opts.timeoutMs=30000]
 * @param {number} [opts.retries=3]
 * @param {number} [opts.baseDelayMs=500]   — backoff base
 * @param {number} [opts.maxDelayMs=15000]  — cap del backoff
 * @param {Function} [opts.fetchImpl]       — inyectable para tests
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, opts = {}) {
  const {
    timeoutMs = 30000,
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 15000,
    fetchImpl = globalThis.fetch
  } = opts;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      // Network error / timeout
      lastErr = err;
      if (attempt >= retries) throw err;
      await sleep(backoffMs(attempt, baseDelayMs, maxDelayMs));
      continue;
    }
    // Si es retryable (5xx, 429) y aún quedan intentos
    if ((res.status >= 500 || res.status === 429) && attempt < retries) {
      lastErr = new Error(`HTTP ${res.status}`);
      await sleep(backoffMs(attempt, baseDelayMs, maxDelayMs));
      continue;
    }
    // Éxito (2xx/3xx/4xx-no-retryable). Devolver el Response al caller.
    return res;
  }
  // Si llegamos acá, agotamos retries. Si el último fue un error, throw.
  if (lastErr) throw lastErr;
  throw new Error('fetchWithRetry: exhausted retries without response');
}

function backoffMs(attempt, baseDelayMs, maxDelayMs) {
  // Exponential: 500, 1000, 2000, 4000... + jitter ±25%
  const base = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

/**
 * Orquesta la descarga de N assets con concurrencia limitada.
 * Devuelve stats agregados (downloaded/skipped/failed/bytes).
 *
 * Idempotencia: si el archivo destino existe y force=false, skip sin fetch.
 *
 * @param {object} args
 * @param {Array}  args.lands           — lands normalizados (de parseLandsResponse)
 * @param {string} args.outDir
 * @param {string[]} [args.kinds]
 * @param {number} [args.concurrency=4]
 * @param {number} [args.timeoutMs=30000]
 * @param {number} [args.retries=3]
 * @param {boolean} [args.force=false]
 * @param {Function} [args.fetchImpl]   — inyectable para tests
 * @param {object} [args.logger]        — { warn, log } opcional; default null
 * @returns {Promise<{total, downloaded, skipped, failed, bytes, errors}>}
 */
async function runDownload(args = {}) {
  const {
    lands,
    outDir,
    kinds = DEFAULT_KINDS,
    concurrency = 4,
    timeoutMs = 30000,
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 15000,
    force = false,
    fetchImpl = globalThis.fetch,
    logger = null
  } = args;

  if (!Array.isArray(lands)) throw new Error('runDownload: lands must be an array');
  if (!outDir) throw new Error('runDownload: outDir is required');

  const tasks = buildAssetIndex(lands, kinds);
  fs.mkdirSync(outDir, { recursive: true });

  const stats = {
    total: tasks.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    errors: []
  };

  const limit = pLimit(concurrency);

  const work = tasks.map((task) => limit(async () => {
    const targetPath = buildAssetPath(outDir, task.externalId, task.kind);

    // Idempotencia: si existe, skip
    if (!force && fs.existsSync(targetPath)) {
      stats.skipped += 1;
      return;
    }

    try {
      const res = await fetchWithRetry(task.url, {
        timeoutMs,
        retries,
        baseDelayMs,
        maxDelayMs,
        fetchImpl
      });
      if (!res || !res.ok) {
        throw new Error(`HTTP ${res?.status ?? 'no-response'}`);
      }
      const text = await res.text();
      // Validar que sea JSON parseable (los endpoints de DJI devuelven JSON).
      try {
        JSON.parse(text);
      } catch {
        throw new Error(`response is not valid JSON (first 80 chars: ${text.slice(0, 80).replace(/\s+/g, ' ')})`);
      }
      fs.writeFileSync(targetPath, text, 'utf8');
      stats.downloaded += 1;
      stats.bytes += Buffer.byteLength(text, 'utf8');
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({
        externalId: task.externalId,
        kind: task.kind,
        url: task.url,
        error: err.message
      });
      if (logger?.warn) {
        logger.warn(`  [fail] ${task.externalId}/${task.kind}: ${err.message}`);
      }
    }
  }));

  await Promise.all(work);
  return stats;
}

module.exports = {
  // constants
  DEFAULT_KINDS,
  // path / index
  sanitizeExternalId,
  buildAssetPath,
  buildAssetIndex,
  // fetch primitives
  pLimit,
  backoffMs,
  fetchWithRetry,
  // high-level
  runDownload
};