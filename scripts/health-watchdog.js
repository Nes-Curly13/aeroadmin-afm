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
// Notificaciones (Sprint H2+H6, 2026-07-30):
//   El watchdog puede notificar a canales externos cuando detecta
//   un estado "stale/partial/failed". El fallback chain es:
//     1. Telegram (si TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID están seteadas)
//     2. Discord webhook (si DISCORD_WEBHOOK_URL está seteada)
//     3. Log local: `djiag_exports/_watchdog-notifications.log` (append JSON
//        lines) + `djiag_exports/_watchdog-banner.json` (último mensaje,
//        para que el admin panel pueda mostrar un banner).
//   Ver `notify(severity, message, opts?)` más abajo.
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
//   - status='unknown'    — archivo _health.json ausente o corrupto

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

// ============================================================
// notify() — canal de notificación del watchdog
// (Sprint H2+H6, 2026-07-30)
// ============================================================
//
// Fallback chain:
//   1. Telegram (si TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
//   2. Discord webhook (si DISCORD_WEBHOOK_URL)
//   3. Log file + banner file (siempre, last-resort)
//
// Test: si no hay env vars de Telegram ni Discord, igual escribe al
// log file. NO crashea. Las funciones `sendTelegram` y `sendDiscord`
// son exportadas para tests unitarios (mismo patrón que `fetchHealth`).
//
// Severities aceptadas: 'ok' | 'info' | 'warning' | 'critical'.
// El caller puede usar la que quiera — la función no valida el
// contenido, solo lo pasa al canal correspondiente.

/**
 * Envía un mensaje por Telegram usando `sendMessage`. Devuelve
 * `{ ok: true, status, body }` o `{ ok: false, error, status? }`.
 *
 * Por qué se exporta: para que el test pueda mockear el canal sin
 * tocar el fallback chain.
 */
async function sendTelegram(message, opts = {}) {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados' };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        // parse_mode omitido: dejamos que el cliente Telegram renderice
        // como texto plano. Si el operador quiere bold/links, puede
        // editar el mensaje antes de pasar.
        disable_web_page_preview: true
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 401/403/404 → token mal configurado. Tratar como "not configured"
      // y dejar que el fallback chain continúe.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, error: `Telegram auth/not-found (${res.status}): ${text.slice(0, 200)}`, status: res.status, fatal: true };
      }
      return { ok: false, error: `Telegram HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: `Telegram fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Envía un mensaje por Discord webhook. Devuelve `{ ok: true, status }`
 * o `{ ok: false, error, status? }`.
 */
async function sendDiscord(message, opts = {}) {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, error: 'DISCORD_WEBHOOK_URL no configurada' };
  }
  try {
    const res = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        // Discord trunca a 2000 chars; cortamos defensivamente.
        // El caller puede usar `username` y `avatar_url` para branding
        // custom, pero acá no los seteamos para no hardcodear.
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Discord devuelve 204 No Content en éxito. Si status >= 400,
      // es un error (webhook borrado, rate limit, etc.).
      return { ok: false, error: `Discord HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: `Discord fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Escribe una línea JSON al log file (append). Crea el directorio
 * si no existe. Si el write falla, NO throw — solo loguea a stderr.
 */
function appendNotificationLog(severity, message, logFilePath, now) {
  try {
    const dir = path.dirname(logFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      ts: (now ?? (() => new Date()))().toISOString(),
      severity,
      message
    }) + '\n';
    fs.appendFileSync(logFilePath, entry, 'utf8');
    return true;
  } catch (err) {
    console.warn(`[watchdog] no se pudo escribir log de notificación: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Escribe el banner file (sobreescribe). Es el último mensaje
 * enviado; el admin panel puede leer este archivo y mostrar un
 * banner rojo/amarillo según severity.
 *
 * Si falla, NO throw. Best-effort.
 */
function writeBannerFile(severity, message, bannerFilePath, now) {
  try {
    const dir = path.dirname(bannerFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      ts: (now ?? (() => new Date()))().toISOString(),
      severity,
      message
    };
    fs.writeFileSync(bannerFilePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn(`[watchdog] no se pudo escribir banner: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Notifica al operador vía el fallback chain. Función principal.
 *
 * Comportamiento:
 *   1. Si `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` están seteadas Y
 *      `sendTelegram` tiene éxito → devuelve `{ channel: 'telegram', ok: true }`.
 *      Si falla con `fatal: true` (401/403/404), cae al siguiente canal.
 *      Si falla con error transitorio, también cae.
 *   2. Si `DISCORD_WEBHOOK_URL` está seteada Y `sendDiscord` tiene éxito
 *      → devuelve `{ channel: 'discord', ok: true }`.
 *   3. Cae al log file + banner (siempre — incluso si Telegram/Discord
 *      ya escribieron, no; esto es last-resort, no se ejecuta si un
 *      canal externo tuvo éxito).
 *
 * En CUALQUIER caso, no crashea. El log + banner son best-effort.
 *
 * @param {string} severity — 'ok' | 'info' | 'warning' | 'critical'
 * @param {string} message  — texto a enviar
 * @param {object} [opts]
 * @param {Function} [opts.fetchFn]         — inyectable para tests (default globalThis.fetch)
 * @param {string}  [opts.logFilePath]     — default `djiag_exports/_watchdog-notifications.log`
 * @param {string}  [opts.bannerFilePath]  — default `djiag_exports/_watchdog-banner.json`
 * @param {() => Date} [opts.now]          — clock inyectable (default new Date)
 * @param {object}  [opts.env]             — env override para tests (default process.env)
 * @returns {Promise<{ channel: 'telegram'|'discord'|'log', ok: true, status?: number, message: string, fatal?: boolean, error?: string }>}
 */
async function notify(severity, message, opts = {}) {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const logFilePath = opts.logFilePath ?? path.join(process.cwd(), 'djiag_exports', '_watchdog-notifications.log');
  const bannerFilePath = opts.bannerFilePath ?? path.join(process.cwd(), 'djiag_exports', '_watchdog-banner.json');

  const fullMessage = `[${severity}] ${message}`;

  // 1. Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const r = await sendTelegram(fullMessage, { env, fetchFn });
    if (r.ok) {
      // Aún así, escribimos al log para tener audit trail.
      appendNotificationLog(severity, message, logFilePath, now);
      return { channel: 'telegram', ok: true, status: r.status };
    }
    // Si es fatal (auth mal), probamos Discord. Si es transitorio
    // (5xx, network), también probamos Discord como fallback.
    console.warn(`[watchdog] notify: Telegram falló (${r.error}); intentando Discord.`);
  }

  // 2. Discord
  if (env.DISCORD_WEBHOOK_URL) {
    const r = await sendDiscord(fullMessage, { env, fetchFn });
    if (r.ok) {
      appendNotificationLog(severity, message, logFilePath, now);
      return { channel: 'discord', ok: true, status: r.status };
    }
    console.warn(`[watchdog] notify: Discord falló (${r.error}); cayendo al log.`);
  }

  // 3. Log + banner (last-resort, siempre)
  appendNotificationLog(severity, message, logFilePath, now);
  writeBannerFile(severity, message, bannerFilePath, now);
  return { channel: 'log', ok: true };
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
    // Sprint H2+H6 (2026-07-30). Notificar al operador cuando el
    // estado es problemático (stale/partial/failed). El estado
    // 'unknown' (sin datos) NO notifica — es benign durante la
    // primera corrida o cuando el pipeline nunca corrió.
    //
    // `notify()` no crashea si no hay env vars configuradas (cae
    // al log file + banner). Si el log write falla, sigue sin
    // crashear. Por eso no lo rodeamos de try/catch.
    //
    // Severity mapping:
    //   - 'failed'  → critical (login roto, scraper caído, etc.)
    //   - 'partial' → warning (algunos steps fallaron)
    //   - 'stale'   → warning (última sync > HEALTH_STALE_HOURS)
    const severity =
      health?.status === 'failed' ? 'critical' : 'warning';
    const notifyMsg =
      `AeroAdmin AFM djiag-health: ${decision.reason}. ` +
      `Revisar: ${healthUrl}/admin/djiag-health`;
    notify(severity, notifyMsg).catch((e) =>
      console.warn(`[watchdog] notify falló: ${e instanceof Error ? e.message : String(e)}`)
    );
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
  buildAuthHeaders,
  // Sprint H2+H6 (2026-07-30). notify() y sus helpers internos.
  // Exportados para tests unitarios (mismo patrón que fetchHealth).
  notify,
  sendTelegram,
  sendDiscord,
  appendNotificationLog,
  writeBannerFile
};
