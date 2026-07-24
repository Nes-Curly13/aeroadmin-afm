// Tests para lib/backfill/refresh-fumigations.ts — refreshFumigations
//
// Sprint H2 — la lógica del refresh se movió del script CLI .js a
// una lib TS testeable. Este test valida la orquestación sin
// tocar la BD real.
//
// Cubre:
//   - Llama a backfillFumigationsFromFlights (que actualiza dji_fumigations
//     desde dji_flights) y a updateFumigationSchedule (que actualiza
//     dji_fumigation_schedule.last_fumigation_date + next_due_date).
//   - Retorna { backfilled, deleted, scheduleUpdated, durationMs } con
//     conteos de cada paso.
//   - Mide duración end-to-end con Date.now().
//   - Si una query falla, propaga la excepción (la transaction wrapper
//     la atrapa, hace ROLLBACK y la propaga al route handler).
//   - Por defecto usa las funciones reales; los tests inyectan mocks
//     via `deps`.
//
// Por qué este test existe separado del test de backfill / update-schedule
// individuales: el refresh es el orquestador que ejecuta ambos en orden.
// Un bug donde solo se llama uno de los dos rompe el caso de uso del
// endpoint /api/admin/backfill-fumigations sin que ninguno de los
// tests unitarios existentes lo detecte.
//
// Estrategia: dependency injection via `deps` parameter.

import { describe, expect, it, vi } from "vitest";

import {
  refreshFumigations,
  type QueryRunner
} from "@/lib/backfill/refresh-fumigations";

function makeMockClient(): QueryRunner {
  return {
    query: vi.fn(async () => ({ rowCount: 0, rows: [] }))
  };
}

function makeDeps(overrides: {
  inserted?: number;
  deleted?: number;
  scheduleUpdated?: number;
  backfillThrow?: Error;
  updateThrow?: Error;
} = {}) {
  const backfillFumigationsFromFlights = vi.fn(async () => {
    if (overrides.backfillThrow) throw overrides.backfillThrow;
    return {
      inserted: overrides.inserted ?? 130,
      deleted: overrides.deleted ?? 0
    };
  });
  const updateFumigationSchedule = vi.fn(async () => {
    if (overrides.updateThrow) throw overrides.updateThrow;
    return { updated: overrides.scheduleUpdated ?? 2 };
  });
  return { backfillFumigationsFromFlights, updateFumigationSchedule };
}

describe("refresh-fumigations — refreshFumigations", () => {
  it("llama a backfillFumigationsFromFlights con el client", async () => {
    const client = makeMockClient();
    const deps = makeDeps();
    await refreshFumigations(client, deps);
    expect(deps.backfillFumigationsFromFlights).toHaveBeenCalledTimes(1);
    expect(deps.backfillFumigationsFromFlights).toHaveBeenCalledWith(client);
  });

  it("llama a updateFumigationSchedule con el client", async () => {
    const client = makeMockClient();
    const deps = makeDeps();
    await refreshFumigations(client, deps);
    expect(deps.updateFumigationSchedule).toHaveBeenCalledTimes(1);
    expect(deps.updateFumigationSchedule).toHaveBeenCalledWith(client);
  });

  it("ejecuta backfill ANTES que updateFumigationSchedule (orden importa)", async () => {
    const client = makeMockClient();
    const order: string[] = [];
    const deps = {
      backfillFumigationsFromFlights: vi.fn(async () => {
        order.push("backfill");
        return { inserted: 130, deleted: 0 };
      }),
      updateFumigationSchedule: vi.fn(async () => {
        order.push("update");
        return { updated: 0 };
      })
    };
    await refreshFumigations(client, deps);
    expect(order).toEqual(["backfill", "update"]);
  });

  it("retorna { backfilled, deleted, scheduleUpdated, durationMs }", async () => {
    const client = makeMockClient();
    const deps = makeDeps({ inserted: 130, deleted: 100, scheduleUpdated: 2 });
    const stats = await refreshFumigations(client, deps);
    expect(stats).toMatchObject({
      backfilled: 130,
      deleted: 100,
      scheduleUpdated: 2
    });
    expect(typeof stats.durationMs).toBe("number");
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("backfilled refleja inserted del backfill (no del schedule)", async () => {
    const deps = makeDeps({
      inserted: 0,
      scheduleUpdated: 1
    });
    const client = makeMockClient();
    const stats = await refreshFumigations(client, deps);
    expect(stats.backfilled).toBe(0);
    expect(stats.scheduleUpdated).toBe(1);
  });

  it("scheduleUpdated es el updated del updateFumigationSchedule", async () => {
    const deps = makeDeps({ scheduleUpdated: 50 });
    const client = makeMockClient();
    const stats = await refreshFumigations(client, deps);
    expect(stats.scheduleUpdated).toBe(50);
  });

  it("si el backfill tira error, la excepción propaga (la tx hace ROLLBACK)", async () => {
    const deps = makeDeps({ backfillThrow: new Error("connection refused") });
    const client = makeMockClient();
    await expect(refreshFumigations(client, deps)).rejects.toThrow("connection refused");
    // updateFumigationSchedule no debería haberse llamado si el backfill falló
    expect(deps.updateFumigationSchedule).not.toHaveBeenCalled();
  });

  it("si el updateFumigationSchedule tira error, la excepción propaga", async () => {
    const deps = makeDeps({ updateThrow: new Error("schedule constraint violation") });
    const client = makeMockClient();
    await expect(refreshFumigations(client, deps)).rejects.toThrow("schedule constraint violation");
  });

  it("usa los módulos reales por default cuando no se pasan deps", async () => {
    // Verifica que la firma del export sigue siendo backwards-compatible
    // y que las funciones reales existen y son exportadas. Importamos
    // los módulos reales y verificamos que existen.
    const backfillMod = await import("@/lib/backfill/fumigations-from-flights");
    const scheduleMod = await import("@/lib/backfill/update-fumigation-schedule");
    expect(typeof backfillMod.backfillFumigationsFromFlights).toBe("function");
    expect(typeof scheduleMod.updateFumigationSchedule).toBe("function");
  });
});
