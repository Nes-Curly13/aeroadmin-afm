// CLI: watchdog del health endpoint del scraper DJI AG.
//
// Por qué existe (Sprint C — H3b, audit ops-2026-07 §H3):
//   - El scraper DJI AG corre como un pipeline local (`scripts/run-pipeline.js`)
//     y escribe `djiag_exports/_health.json` al final. El endpoint
//     `/api/admin/djiag-health` (Sprint A, XS1) expone ese estado a la UI.
//   - Si el scraper se rompe (login fallido, rate limit, etc.) el archivo
//     no se actualiza y nadie se entera por días. Este script lo detecta:
//     corre cada 6h vía GitHub Actions, y si el `lastSuccessfulSyncAt` es
//     > HEALTH_STALE_HOURS horas, falla el workflow.
//   - El operator puede agregar una notificación (Slack/Discord/email)
//     al workflow via la UI de GitHub — fuera del scope de este script.
//
// Uso:
//   node scripts/health-watchdog.js
//
// Variables de entorno (.env.local para dev, GH secrets para CI):
//   HEALTH_URL              — base URL (default: http://localhost:3000)
//   HEALTH_TOKEN            — bearer token compartido con el server
//                             (cuando el endpoint lo valida). Si el server
//                             no está configurado con HEALTH_TOKEN, este
//                             script va a fallar con 401/403 — esperado.
//   HEALTH_AUTH_COOKIE      — alternativa: cookie de sesión NextAuth
//                             del admin (no recomendado, complicado de rotar)
//   HEALTH_STALE_HOURS      — threshold de "stale" (default: 24)
//
// Exit codes:
//   0 = healthy (status='ok' o 'unknown' con warning de no-data)
//   1 = stale (>24h sin update) o error HTTP / timeout
//   2 = configuración faltante (HEALTH_URL o credenciales)
//
// Contrato del endpoint (lib/djiag-health.ts):
//   - status='ok'         → lastRunStatus='ok' AND hoursSinceLastSync<=24
//   - status='stale'      → lastRunStatus='ok' AND hoursSinceLastSync>24
//   - status='partial'    → lastRunStatus='partial'
//   - status='failed'     → lastRunStatus='failed'
//   - status='unknown'    → archivo _health.json ausente o corrupto

const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

/**
 * Llama al endpoint de health y devuelve el JSON parseado.
 *
 * Acepta una función `fetchFn` inyectable para tests (Node 18+ expone
 * `fetch` global, pero vitest no siempre lo mockea correctamente desde
 * un script CJS — la DI es portable).
 */
async function fetchHealth(healthUrl, headers, fetchFn = globalThis.fetch, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${healthUrl}/api/admin/djiag-health`, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    if (!res.ok) {
      // 401/403/5xx → tiramos error tipado para que el caller mapee a exit 1
      const text = await res.text().catch(() => '');
      const err = new Error(`Health endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve la decisión de exit code a partir de la respuesta del endpoint.
 * Función pura — testeable sin fetch.
 *
 * @param {object|null} health — JSON parseado del endpoint, o null si
 *                               hubo error de red / parseo.
 * @param {number} staleHours — threshold configurable.
 * @returns {{ exitCode: 0|1, reason: string }}
 */
function evaluateHealth(health, staleHours) {
  if (!health || typeof health !== 'object') {
    return { exitCode: 1, reason: 'Health response vacío o no es objeto' };
  }
  const status = String(health.status ?? 'unknown');
  const hours = typeof health.hoursSinceLastSync === 'number' ? health.hoursSinceLastSync : null;

  if (status === 'ok') {
    return { exitCode: 0, reason: `OK: last update hace ${hours ?? '<1'}h (<${staleHours}h)` };
  }
  if (status === 'stale') {
    return {
      exitCode: 1,
      reason: `STALE: last update hace ${hours}h (>= ${staleHours}h)`
    };
  }
  if (status === 'partial') {
    return { exitCode: 1, reason: `PARTIAL: última corrida tuvo steps fallidos` };
  }
  if (status === 'failed') {
    return { exitCode: 1, reason: `FAILED: última corrida del pipeline falló` };
  }
  // status === 'unknown' (sin datos). No es un error duro: el watchdog
  // puede estar activo antes de la primera corrida del pipeline.
  return { exitCode: 0, reason: 'WARN: sin datos (archivo _health.json ausente o corrupto)' };
}

/**
 * Construye los headers de auth a partir de las env vars. Solo se setea
 * Authorization si HEALTH_TOKEN está presente. Si HEALTH_AUTH_COOKIE
 * está presente (sin token), se usa Cookie.
 */
function buildAuthHeaders(env = process.env) {
  const headers = { Accept: 'application/json' };
  if (env.HEALTH_TOKEN) {
    headers.Authorization = `Bearer ${env.HEALTH_TOKEN}`;
  } else if (env.HEALTH_AUTH_COOKIE) {
    headers.Cookie = env.HEALTH_AUTH_COOKIE;
  }
  return headers;
}

async function main() {
  loadLocalEnv();

  const healthUrl = process.env.HEALTH_URL ?? 'http://localhost:3000';
  const staleHours = Number(process.env.HEALTH_STALE_HOURS ?? '24');
  if (!Number.isFinite(staleHours) || staleHours < 1) {
    console.error(
      `[watchdog] ERROR: HEALTH_STALE_HOURS inválido ("${process.env.HEALTH_STALE_HOURS}"); debe ser entero >= 1.`
    );
    process.exit(2);
  }
  if (!process.env.HEALTH_TOKEN && !process.env.HEALTH_AUTH_COOKIE) {
    console.error(
      `[watchdog] ERROR: ni HEALTH_TOKEN ni HEALTH_AUTH_COOKIE están configuradas.\n` +
        `  Para producción: configurar HEALTH_TOKEN en GitHub Secrets (Settings → Secrets and variables → Actions)\n` +
        `  y agregar la misma variable al deploy de Vercel para que el endpoint la valide.\n` +
        `  Para dev local: agregar HEALTH_TOKEN=<valor> a .env.local.`
    );
    process.exit(2);
  }

  const headers = buildAuthHeaders();
  let health;
  try {
    health = await fetchHealth(healthUrl, headers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'status' in err) {
      // CJS: no usamos `as` (eso es TS). En su lugar leemos la propiedad
      // y validamos el tipo en runtime.
      const errWithStatus = /** @type {{ status: number }} */ (err);
      const status = errWithStatus.status;
      if (status === 401 || status === 403) {
        console.error(
          `[watchdog] ERROR: HTTP ${status} (auth inválida). Verificá que HEALTH_TOKEN coincida con el del server.`
        );
      } else {
        console.error(`[watchdog] ERROR: HTTP ${status}: ${msg}`);
      }
    } else if (msg.includes('aborted') || msg.includes('abort')) {
      console.error('[watchdog] ERROR: timeout (>10s) llamando al endpoint.');
    } else {
      console.error(`[watchdog] ERROR: ${msg}`);
    }
    process.exit(1);
  }

  const decision = evaluateHealth(health, staleHours);
  if (decision.exitCode === 0) {
    console.log(`[watchdog] ${decision.reason}`);
  } else {
    console.error(`[watchdog] ${decision.reason}`);
  }
  process.exit(decision.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[watchdog] ERROR inesperado:', err);
    process.exit(1);
  });
}

// Exports para tests (vitest + createRequire). Mismo patrón que
// scripts/djiag-circuit-breaker.js y scripts/djiag-asset-downloader.js.
module.exports = {
  loadLocalEnv,
  fetchHealth,
  evaluateHealth,
  buildAuthHeaders
};
