// Tests para scripts/run-pipeline.js — runBackfillHttpStep
//
// Sprint H2 — el step 6 del pipeline ahora hace un HTTP call al
// endpoint admin /api/admin/backfill-fumigations (en vez de correr
// un script CLI). Estos tests validan el comportamiento del helper
// `runBackfillHttpStep` aislado, mockeando `fetch` global.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBackfillHttpStep } from "@/scripts/run-pipeline";

describe("runBackfillHttpStep (Sprint H2)", () => {
  let savedBackfillUrl: string | undefined;
  let savedBackfillToken: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedBackfillUrl = process.env.BACKFILL_URL;
    savedBackfillToken = process.env.BACKFILL_TOKEN;
    process.env.BACKFILL_URL = "http://localhost:3000";
    process.env.BACKFILL_TOKEN = "test-token-abc";

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    if (savedBackfillUrl === undefined) delete process.env.BACKFILL_URL;
    else process.env.BACKFILL_URL = savedBackfillUrl;
    if (savedBackfillToken === undefined) delete process.env.BACKFILL_TOKEN;
    else process.env.BACKFILL_TOKEN = savedBackfillToken;
  });

  it("falla con mensaje claro si BACKFILL_TOKEN no está configurada", async () => {
    delete process.env.BACKFILL_TOKEN;
    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/BACKFILL_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hace POST a ${BACKFILL_URL}/api/admin/backfill-fumigations con Bearer", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        backfilled: 50,
        deleted: 0,
        scheduleUpdated: 12,
        durationMs: 142
      })
    });

    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({
      backfilled: 50,
      deleted: 0,
      scheduleUpdated: 12,
      durationMs: 142
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/admin/backfill-fumigations");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token-abc");
    expect(init.headers.Accept).toBe("application/json");
  });

  it("respeta BACKFILL_URL custom (no usa localhost)", async () => {
    process.env.BACKFILL_URL = "https://aeroadmin.example.com";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ backfilled: 0, deleted: 0, scheduleUpdated: 0, durationMs: 0 })
    });

    await runBackfillHttpStep();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://aeroadmin.example.com/api/admin/backfill-fumigations");
  });

  it("strip trailing slash del BACKFILL_URL", async () => {
    process.env.BACKFILL_URL = "http://localhost:3000/";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ backfilled: 0, deleted: 0, scheduleUpdated: 0, durationMs: 0 })
    });

    await runBackfillHttpStep();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/admin/backfill-fumigations");
  });

  it("devuelve error con código HTTP 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "" });
    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
    expect(result.error).toMatch(/BACKFILL_TOKEN/);
  });

  it("devuelve error con código HTTP 403", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "" });
    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/403/);
  });

  it("devuelve error con mensaje del body si HTTP 500", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '{"error":"BACKFILL_FAILED","message":"connection refused"}'
    });
    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
    expect(result.error).toMatch(/BACKFILL_FAILED/);
  });

  it("devuelve error claro si el server no está arriba (ECONNREFUSED)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:3000"));
    const result = await runBackfillHttpStep();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No se pudo conectar/);
    expect(result.error).toMatch(/Next\.js server/);
  });
});
