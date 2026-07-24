// Tests para lib/backfill/update-fumigation-schedule.ts — updateFumigationSchedule
//
// Sprint H2 — TS port del script CLI. Valida el SQL emitido contra
// un QueryRunner mockeado (sin tocar la BD real).

import { describe, expect, it, vi } from "vitest";

import {
  updateFumigationSchedule,
  type QueryRunner
} from "@/lib/backfill/update-fumigation-schedule";

function makeMockClient(opts: { rowCount?: number; rows?: unknown[] } = {}): {
  client: QueryRunner;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rowCount = opts.rowCount ?? 0;
  const rows = opts.rows ?? [];
  const client: QueryRunner = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rowCount, rows };
    })
  };
  return { client, calls };
}

describe("updateFumigationSchedule", () => {
  it("emite un UPDATE con FROM (last_fum) CTE", async () => {
    const { client, calls } = makeMockClient();
    await updateFumigationSchedule(client);

    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toMatch(/WITH last_fum AS \(/);
    expect(sql).toMatch(/UPDATE dji_fumigation_schedule s/);
    expect(sql).toMatch(/FROM last_fum lf/);
    expect(sql).toMatch(/WHERE s\.parcel_id = lf\.parcel_id/);
  });

  it("filtra dji_fumigation_schedule.is_active = true", async () => {
    const { client, calls } = makeMockClient();
    await updateFumigationSchedule(client);
    expect(calls[0].sql).toMatch(/s\.is_active = true/);
  });

  it("usa make_interval(days => s.recommended_cadence_days) para next_due_date", async () => {
    const { client, calls } = makeMockClient();
    await updateFumigationSchedule(client);
    const sql = calls[0].sql;
    expect(sql).toMatch(/make_interval\(days => s\.recommended_cadence_days\)/);
    expect(sql).toMatch(/next_due_date = lf\.last_date \+ make_interval/);
  });

  it("el CTE de last_fum filtra parcel_id IS NOT NULL", async () => {
    const { client, calls } = makeMockClient();
    await updateFumigationSchedule(client);
    const sql = calls[0].sql;
    expect(sql).toMatch(/parcel_id IS NOT NULL/);
  });

  it("retorna { updated: rowCount }", async () => {
    const { client } = makeMockClient({ rowCount: 17, rows: [] });
    const stats = await updateFumigationSchedule(client);
    expect(stats).toEqual({ updated: 17 });
  });

  it("retorna { updated: 0 } cuando no hay schedule rows para actualizar", async () => {
    const { client } = makeMockClient({ rowCount: 0, rows: [] });
    const stats = await updateFumigationSchedule(client);
    expect(stats).toEqual({ updated: 0 });
  });
});
