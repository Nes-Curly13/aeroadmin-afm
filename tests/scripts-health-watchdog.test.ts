// Tests para scripts/health-watchdog.js (Sprint C — H3b + Sprint H2+H6).
//
// Estrategia (misma que scripts-db-backup.test.ts):
//   - Importar el .js via createRequire. El script es CJS y los helpers
//     exportados son `loadLocalEnv`, `fetchHealth`, `evaluateHealth`,
//     `buildAuthHeaders`, `notify`, `sendTelegram`, `sendDiscord`,
//     `appendNotificationLog`, `writeBannerFile`.
//   - `fetchHealth` acepta una función `fetchFn` inyectable (vitest no
//     intercepta `createRequire('node-fetch')` ni CJS `require()` de
//     manera confiable desde scripts CJS).
//   - `evaluateHealth` y `buildAuthHeaders` son funciones puras — se
//     testean directamente sin mocks.
//   - `notify` se testea con `fetchFn` inyectable y `logFilePath` /
//     `bannerFilePath` apuntando a tmpdirs.
//   - Los exit codes del `main()` están cubiertos indirectamente por
//     los tests de las primitivas.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const watchdog = require("../scripts/health-watchdog.js") as {
  loadLocalEnv: () => void;
  fetchHealth: (
    healthUrl: string,
    headers: Record<string, string>,
    fetchFn?: (
      url: string,
      init: Record<string, unknown>
    ) => Promise<{
      ok: boolean;
      status: number;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    }>,
    timeoutMs?: number
  ) => Promise<unknown>;
  evaluateHealth: (
    health: unknown,
    staleHours: number
  ) => { exitCode: 0 | 1; reason: string };
  buildAuthHeaders: (env?: Record<string, string | undefined>) => Record<string, string>;
  notify: (
    severity: string,
    message: string,
    opts?: {
      fetchFn?: typeof fetch;
      logFilePath?: string;
      bannerFilePath?: string;
      now?: () => Date;
      env?: Record<string, string | undefined>;
    }
  ) => Promise<{ channel: "telegram" | "discord" | "log"; ok: boolean; status?: number }>;
  sendTelegram: (
    message: string,
    opts?: { env?: Record<string, string | undefined>; fetchFn?: typeof fetch }
  ) => Promise<{ ok: boolean; error?: string; status?: number; fatal?: boolean }>;
  sendDiscord: (
    message: string,
    opts?: { env?: Record<string, string | undefined>; fetchFn?: typeof fetch }
  ) => Promise<{ ok: boolean; error?: string; status?: number }>;
  appendNotificationLog: (
    severity: string,
    message: string,
    logFilePath: string,
    now?: () => Date
  ) => boolean;
  writeBannerFile: (
    severity: string,
    message: string,
    bannerFilePath: string,
    now?: () => Date
  ) => boolean;
};

describe("health-watchdog — buildAuthHeaders", () => {
  it("usa Authorization: Bearer cuando HEALTH_TOKEN está presente", () => {
    const headers = watchdog.buildAuthHeaders({ HEALTH_TOKEN: "secret-abc" });
    expect(headers.Authorization).toBe("Bearer secret-abc");
    expect(headers.Cookie).toBeUndefined();
  });

  it("usa Cookie cuando solo HEALTH_AUTH_COOKIE está presente (fallback legacy)", () => {
    const headers = watchdog.buildAuthHeaders({ HEALTH_AUTH_COOKIE: "next-auth.session-token=xyz" });
    expect(headers.Cookie).toBe("next-auth.session-token=xyz");
    expect(headers.Authorization).toBeUndefined();
  });

  it("prioriza HEALTH_TOKEN sobre HEALTH_AUTH_COOKIE (token es más simple)", () => {
    const headers = watchdog.buildAuthHeaders({
      HEALTH_TOKEN: "secret-abc",
      HEALTH_AUTH_COOKIE: "next-auth.session-token=xyz"
    });
    expect(headers.Authorization).toBe("Bearer secret-abc");
    expect(headers.Cookie).toBeUndefined();
  });

  it("sin token ni cookie, devuelve solo Accept (la request va a fallar 401)", () => {
    const headers = watchdog.buildAuthHeaders({});
    expect(headers).toEqual({ Accept: "application/json" });
  });
});

describe("health-watchdog — evaluateHealth (lógica pura)", () => {
  it("status='ok' → exit 0, reason menciona horas", () => {
    const r = watchdog.evaluateHealth(
      { status: "ok", hoursSinceLastSync: 2 },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/OK.*2h.*24h/);
  });

  it("status='ok' pero sin hoursSinceLastSync (caso edge) → exit 0", () => {
    const r = watchdog.evaluateHealth(
      { status: "ok", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/<1h/);
  });

  it("status='stale' → exit 1 con horas explícitas", () => {
    const r = watchdog.evaluateHealth(
      { status: "stale", hoursSinceLastSync: 48 },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/STALE.*48h.*24h/);
  });

  it("status='stale' respeta el threshold custom (HEALTH_STALE_HOURS=4)", () => {
    const r = watchdog.evaluateHealth(
      { status: "stale", hoursSinceLastSync: 27 },
      4
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/27h.*4h/);
  });

  it("status='partial' → exit 1 (steps fallidos)", () => {
    const r = watchdog.evaluateHealth(
      { status: "partial", hoursSinceLastSync: 1 },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/PARTIAL/);
  });

  it("status='failed' → exit 1 (pipeline fallió)", () => {
    const r = watchdog.evaluateHealth(
      { status: "failed", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/FAILED/);
  });

  it("status='unknown' (sin datos) → exit 0, no es error duro", () => {
    const r = watchdog.evaluateHealth(
      { status: "unknown", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/WARN/);
  });

  it("respuesta null o no-objeto → exit 1 (no se puede evaluar)", () => {
    expect(watchdog.evaluateHealth(null, 24).exitCode).toBe(1);
    expect(watchdog.evaluateHealth("string-not-object", 24).exitCode).toBe(1);
    expect(watchdog.evaluateHealth(42, 24).exitCode).toBe(1);
  });

  it("status desconocido (no es uno de los 5 documentados) → exit 0 con WARN", () => {
    const r = watchdog.evaluateHealth(
      { status: "weird-new-status", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/WARN/);
  });
});

describe("health-watchdog — fetchHealth (con fetchFn inyectable)", () => {
  it("hace GET al endpoint correcto con los headers provistos", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ status: "ok" })
    });
    const result = await watchdog.fetchHealth(
      "https://example.com",
      { Accept: "application/json", Authorization: "Bearer xyz" },
      fetchFn,
      5000
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://example.com/api/admin/djiag-health");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: "Bearer xyz" });
    expect(result).toEqual({ status: "ok" });
  });

  it("lanza error tipado con .status si HTTP no es ok (401, 403, 5xx)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("No autenticado."),
      json: () => Promise.reject(new Error("not json"))
    });
    await expect(
      watchdog.fetchHealth("https://example.com", {}, fetchFn, 5000)
    ).rejects.toMatchObject({ status: 401, message: /HTTP 401/ });
  });

  it("aborta y lanza si la request tarda más que timeoutMs", async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    );
    await expect(
      watchdog.fetchHealth("https://example.com", {}, fetchFn, 100)
    ).rejects.toThrow();
  });
});

describe("health-watchdog — loadLocalEnv", () => {
  let tmpDir: string;
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-watchdog-env-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    savedEnv = {
      HEALTH_URL: process.env.HEALTH_URL,
      HEALTH_TOKEN: process.env.HEALTH_TOKEN,
      HEALTH_AUTH_COOKIE: process.env.HEALTH_AUTH_COOKIE,
      HEALTH_STALE_HOURS: process.env.HEALTH_STALE_HOURS
    };
    delete process.env.HEALTH_URL;
    delete process.env.HEALTH_TOKEN;
    delete process.env.HEALTH_AUTH_COOKIE;
    delete process.env.HEALTH_STALE_HOURS;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("carga HEALTH_URL y HEALTH_TOKEN desde .env.local", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "HEALTH_URL=https://aeroadmin.example.com\nHEALTH_TOKEN=abc123\n",
      "utf8"
    );
    watchdog.loadLocalEnv();
    expect(process.env.HEALTH_URL).toBe("https://aeroadmin.example.com");
    expect(process.env.HEALTH_TOKEN).toBe("abc123");
  });

  it("no pisa HEALTH_TOKEN ya seteada en process.env (CI > .env.local)", () => {
    process.env.HEALTH_TOKEN = "from-ci-secret";
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "HEALTH_TOKEN=from-env-local\n",
      "utf8"
    );
    watchdog.loadLocalEnv();
    expect(process.env.HEALTH_TOKEN).toBe("from-ci-secret");
  });
});

// ============================================================
// notify() — Sprint H2+H6 (2026-07-30)
// Canal de notificación con fallback chain:
//   Telegram → Discord → log file + banner
// ============================================================

describe("health-watchdog — sendTelegram", () => {
  it("devuelve ok=false si TELEGRAM_BOT_TOKEN no está seteada", async () => {
    const r = await watchdog.sendTelegram("hello", { env: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("devuelve ok=false si TELEGRAM_CHAT_ID no está seteada", async () => {
    const r = await watchdog.sendTelegram("hello", {
      env: { TELEGRAM_BOT_TOKEN: "x" }
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TELEGRAM_CHAT_ID/);
  });

  it("hace POST a api.telegram.org con chat_id, text y disable_web_page_preview", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ ok: true })
    });
    const r = await watchdog.sendTelegram("test message", {
      env: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "123" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/api\.telegram\.org\/bottok\/sendMessage$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.chat_id).toBe("123");
    expect(body.text).toBe("test message");
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("trata 401/403/404 como fatal (auth mal configurado)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
      json: () => Promise.reject(new Error("not json"))
    });
    const r = await watchdog.sendTelegram("test", {
      env: { TELEGRAM_BOT_TOKEN: "bad", TELEGRAM_CHAT_ID: "1" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toBe(true);
    expect(r.status).toBe(401);
  });

  it("trata 5xx como transitorio (no fatal)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("Bad Gateway"),
      json: () => Promise.reject(new Error("not json"))
    });
    const r = await watchdog.sendTelegram("test", {
      env: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "1" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toBeUndefined();
    expect(r.status).toBe(502);
  });

  it("captura errores de red y devuelve ok=false sin throw", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await watchdog.sendTelegram("test", {
      env: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "1" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });
});

describe("health-watchdog — sendDiscord", () => {
  it("devuelve ok=false si DISCORD_WEBHOOK_URL no está seteada", async () => {
    const r = await watchdog.sendDiscord("hello", { env: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DISCORD_WEBHOOK_URL/);
  });

  it("hace POST al webhook con el mensaje en content", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
      json: () => Promise.reject(new Error("not json"))
    });
    const r = await watchdog.sendDiscord("hello", {
      env: { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/webhooks/abc");
    expect(init.method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.content).toBe("hello");
  });

  it("captura 4xx/5xx del webhook y devuelve ok=false", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
      json: () => Promise.reject(new Error("not json"))
    });
    const r = await watchdog.sendDiscord("hello", {
      env: { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc" },
      fetchFn: fetchFn as unknown as typeof fetch
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });
});

describe("health-watchdog — appendNotificationLog y writeBannerFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-notif-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appendNotificationLog escribe una línea JSON con ts/severity/message", () => {
    const logPath = path.join(tmpDir, "notif.log");
    const fixedTime = new Date("2026-07-30T10:00:00.000Z");
    watchdog.appendNotificationLog("critical", "pipeline failed", logPath, () => fixedTime);
    const content = fs.readFileSync(logPath, "utf8");
    const line = content.trim();
    const parsed = JSON.parse(line);
    expect(parsed.ts).toBe("2026-07-30T10:00:00.000Z");
    expect(parsed.severity).toBe("critical");
    expect(parsed.message).toBe("pipeline failed");
  });

  it("appendNotificationLog appendea (no sobreescribe)", () => {
    const logPath = path.join(tmpDir, "notif.log");
    const t1 = new Date("2026-07-30T10:00:00.000Z");
    const t2 = new Date("2026-07-30T11:00:00.000Z");
    watchdog.appendNotificationLog("warning", "msg1", logPath, () => t1);
    watchdog.appendNotificationLog("critical", "msg2", logPath, () => t2);
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).message).toBe("msg1");
    expect(JSON.parse(lines[1]!).message).toBe("msg2");
  });

  it("appendNotificationLog crea el directorio si no existe", () => {
    const nestedPath = path.join(tmpDir, "deep", "nested", "notif.log");
    watchdog.appendNotificationLog("info", "hi", nestedPath, () => new Date());
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it("writeBannerFile escribe un JSON con ts/severity/message (sobrescribe)", () => {
    const bannerPath = path.join(tmpDir, "banner.json");
    const t = new Date("2026-07-30T10:00:00.000Z");
    watchdog.writeBannerFile("warning", "stale", bannerPath, () => t);
    const parsed = JSON.parse(fs.readFileSync(bannerPath, "utf8"));
    expect(parsed.ts).toBe("2026-07-30T10:00:00.000Z");
    expect(parsed.severity).toBe("warning");
    expect(parsed.message).toBe("stale");
  });

  it("writeBannerFile sobrescribe (no appendea) — el último gana", () => {
    const bannerPath = path.join(tmpDir, "banner.json");
    const t1 = new Date("2026-07-30T10:00:00.000Z");
    const t2 = new Date("2026-07-30T11:00:00.000Z");
    watchdog.writeBannerFile("info", "first", bannerPath, () => t1);
    watchdog.writeBannerFile("critical", "second", bannerPath, () => t2);
    const parsed = JSON.parse(fs.readFileSync(bannerPath, "utf8"));
    expect(parsed.message).toBe("second");
    expect(parsed.severity).toBe("critical");
  });
});

describe("health-watchdog — notify() fallback chain", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-notify-"));
    savedEnv = {
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
      DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL
    };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("sin env vars de Telegram/Discord → cae al log file y banner (channel: 'log')", async () => {
    const logPath = path.join(tmpDir, "notif.log");
    const bannerPath = path.join(tmpDir, "banner.json");
    const r = await watchdog.notify("critical", "pipeline failed", {
      logFilePath: logPath,
      bannerFilePath: bannerPath
    });
    expect(r.channel).toBe("log");
    expect(r.ok).toBe(true);
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(bannerPath)).toBe(true);
  });

  it("log file contiene la línea JSON con severity + message", async () => {
    const logPath = path.join(tmpDir, "notif.log");
    const bannerPath = path.join(tmpDir, "banner.json");
    await watchdog.notify("warning", "stale data", {
      logFilePath: logPath,
      bannerFilePath: bannerPath
    });
    const line = fs.readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.severity).toBe("warning");
    expect(parsed.message).toBe("stale data");
  });

  it("banner file contiene el último mensaje (sobrescribe)", async () => {
    const logPath = path.join(tmpDir, "notif.log");
    const bannerPath = path.join(tmpDir, "banner.json");
    await watchdog.notify("info", "first", { logFilePath: logPath, bannerFilePath: bannerPath });
    await watchdog.notify("critical", "second", { logFilePath: logPath, bannerFilePath: bannerPath });
    const banner = JSON.parse(fs.readFileSync(bannerPath, "utf8"));
    expect(banner.message).toBe("second");
    expect(banner.severity).toBe("critical");
  });

  it("con TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID → intenta Telegram primero", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ ok: true })
    });
    const r = await watchdog.notify("critical", "alert!", {
      env: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "1" },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: path.join(tmpDir, "notif.log"),
      bannerFilePath: path.join(tmpDir, "banner.json")
    });
    expect(r.channel).toBe("telegram");
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toMatch(/api\.telegram\.org/);
  });

  it("Telegram OK → igual escribe al log file (audit trail)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ ok: true })
    });
    const logPath = path.join(tmpDir, "notif.log");
    await watchdog.notify("warning", "msg", {
      env: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "1" },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: logPath,
      bannerFilePath: path.join(tmpDir, "banner.json")
    });
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("Telegram falla con fatal (401/403) → cae a Discord", async () => {
    // Mock que devuelve 401 para Telegram y 204 para Discord.
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.telegram.org")) {
        return {
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
          json: () => Promise.reject(new Error("not json"))
        };
      }
      // Discord webhook: 204 No Content.
      return {
        ok: true,
        status: 204,
        text: () => Promise.resolve(""),
        json: () => Promise.reject(new Error("not json"))
      };
    });
    const r = await watchdog.notify("critical", "alert", {
      env: {
        TELEGRAM_BOT_TOKEN: "bad",
        TELEGRAM_CHAT_ID: "1",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc"
      },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: path.join(tmpDir, "notif.log"),
      bannerFilePath: path.join(tmpDir, "banner.json")
    });
    // Telegram: 1 call (falla fatal). Discord: 1 call (éxito).
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // El segundo call va a Discord.
    const [discordUrl, discordInit] = fetchFn.mock.calls[1]!;
    expect(discordUrl).toBe("https://discord.com/api/webhooks/abc");
    const body = JSON.parse((discordInit as { body: string }).body);
    expect(body.content).toBe("[critical] alert");
    expect(r.channel).toBe("discord");
  });

  it("Telegram OK + Discord configurado → NO llama a Discord (short-circuit)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ ok: true })
    });
    const r = await watchdog.notify("warning", "msg", {
      env: {
        TELEGRAM_BOT_TOKEN: "tok",
        TELEGRAM_CHAT_ID: "1",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc"
      },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: path.join(tmpDir, "notif.log"),
      bannerFilePath: path.join(tmpDir, "banner.json")
    });
    expect(r.channel).toBe("telegram");
    expect(fetchFn).toHaveBeenCalledTimes(1); // solo Telegram
  });

  it("Telegram no configurado + Discord configurado → va a Discord directo", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
      json: () => Promise.reject(new Error("not json"))
    });
    const r = await watchdog.notify("warning", "msg", {
      env: { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc" },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: path.join(tmpDir, "notif.log"),
      bannerFilePath: path.join(tmpDir, "banner.json")
    });
    expect(r.channel).toBe("discord");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("Telegram y Discord ambos fallan → cae al log file y banner", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
      json: () => Promise.reject(new Error("not json"))
    });
    const logPath = path.join(tmpDir, "notif.log");
    const bannerPath = path.join(tmpDir, "banner.json");
    const r = await watchdog.notify("critical", "alert", {
      env: {
        TELEGRAM_BOT_TOKEN: "tok",
        TELEGRAM_CHAT_ID: "1",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/abc"
      },
      fetchFn: fetchFn as unknown as typeof fetch,
      logFilePath: logPath,
      bannerFilePath: bannerPath
    });
    expect(r.channel).toBe("log");
    // Se intentó Telegram Y Discord (2 calls).
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(bannerPath)).toBe(true);
  });

  it("no crashea si la escritura del log file falla (permisos)", async () => {
    // Path con caracteres inválidos en Windows puede tirar; usamos uno
    // que sabemos que va a fallar: un directorio como archivo.
    const logPath = path.join(tmpDir, "dir-not-file");
    fs.mkdirSync(logPath);
    const bannerPath = path.join(tmpDir, "banner.json");
    // No debe tirar — writeBannerFile puede tirar pero el log
    // helper tiene try/catch.
    const r = await watchdog.notify("info", "msg", {
      logFilePath: logPath, // escribir en un dir → EISDIR
      bannerFilePath: bannerPath
    });
    // channel sigue siendo 'log' (cayó al log fallback).
    expect(r.channel).toBe("log");
    expect(r.ok).toBe(true);
  });
});
