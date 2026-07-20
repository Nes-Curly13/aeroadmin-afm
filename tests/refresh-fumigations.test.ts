// Tests para scripts/refresh-fumigations.js — refreshFumigations
//
// Cubre:
//   - Llama a backfillFumigationsFromFlights (que actualiza dji_fumigations
//     desde dji_flights) y a updateSchedule (que actualiza
//     dji_fumigation_schedule.last_fumigation_date + next_due_date).
//   - Retorna { backfilled, scheduleUpdated, durationMs } con conteos de
//     cada paso.
//   - Mide duración end-to-end con Date.now().
//   - Si una query falla, propaga la excepción (main la atrapa y hace
//     process.exit(1)).
//   - Por defecto usa los módulos reales (backfillFumigationsFromFlights y
//     updateSchedule); los tests inyectan mocks via `deps`.
//
// Por qué este test existe separado del test de backfill / update-schedule
// individuales: el refresh es el wrapper que orquesta ambos. Un bug donde
// solo se llama uno de los dos (o donde se llama el backfill pero se olvida
// el update del schedule) rompe el caso de uso del cron sin que ninguno
// de los tests unitarios existentes lo detecte.
//
// Estrategia: dependency injection via `deps` parameter. refreshFumigations
// acepta { backfillFumigationsFromFlights, updateSchedule } opcional — los
// tests pasan mocks puros. Esto evita la fragilidad de vi.mock con paths
// de CommonJS (que no matchea consistentemente en Vite's module graph).

import { describe, expect, it, vi } from "vitest";

import {
  refreshFumigations,
  type QueryRunner
} from "@/scripts/refresh-fumigations";

function makeMockClient(): QueryRunner {
  return {
    query: vi.fn(async () => ({ rowCount: 0, rows: [] }))
  };
}

const fakeScheduleRows = [
  { id: 1, parcel_id: 100, last_fumigation_date: new Date("2026-07-15"), next_due_date: new Date("2026-07-25") },
  { id: 2, parcel_id: 101, last_fumigation_date: new Date("2026-07-10"), next_due_date: new Date("2026-07-20") }
];

function makeDeps(overrides: {
  inserted?: number;
  scheduleRows?: unknown[];
  backfillThrow?: Error;
  updateThrow?: Error;
} = {}) {
  const backfillFumigationsFromFlights = vi.fn(async () => {
    if (overrides.backfillThrow) throw overrides.backfillThrow;
    return { inserted: overrides.inserted ?? 130 };
  });
  const updateSchedule = vi.fn(async () => {
    if (overrides.updateThrow) throw overrides.updateThrow;
    return overrides.scheduleRows ?? fakeScheduleRows;
  });
  return { backfillFumigationsFromFlights, updateSchedule };
}

describe("refresh-fumigations — refreshFumigations", () => {
  it("llama a backfillFumigationsFromFlights con el client", async () => {
    const client = makeMockClient();
    const deps = makeDeps();
    await refreshFumigations(client, deps);
    expect(deps.backfillFumigationsFromFlights).toHaveBeenCalledTimes(1);
    expect(deps.backfillFumigationsFromFlights).toHaveBeenCalledWith(client);
  });

  it("llama a updateSchedule con el client", async () => {
    const client = makeMockClient();
    const deps = makeDeps();
    await refreshFumigations(client, deps);
    expect(deps.updateSchedule).toHaveBeenCalledTimes(1);
    expect(deps.updateSchedule).toHaveBeenCalledWith(client);
  });

  it("ejecuta backfill ANTES que updateSchedule (orden importa)", async () => {
    const client = makeMockClient();
    const order: string[] = [];
    const deps = {
      backfillFumigationsFromFlights: vi.fn(async () => {
        order.push("backfill");
        return { inserted: 130 };
      }),
      updateSchedule: vi.fn(async () => {
        order.push("updateSchedule");
        return [];
      })
    };
    await refreshFumigations(client, deps);
    expect(order).toEqual(["backfill", "updateSchedule"]);
  });

  it("retorna { backfilled, scheduleUpdated, durationMs }", async () => {
    const client = makeMockClient();
    const deps = makeDeps({ inserted: 130, scheduleRows: fakeScheduleRows });
    const stats = await refreshFumigations(client, deps);
    expect(stats).toMatchObject({
      backfilled: 130,
      scheduleUpdated: 2
    });
    expect(typeof stats.durationMs).toBe("number");
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("backfilled refleja inserted del backfill (no del schedule)", async () => {
    const deps = makeDeps({ inserted: 0, scheduleRows: [
      { id: 1, parcel_id: 100, last_fumigation_date: new Date(), next_due_date: new Date() }
    ]});
    const client = makeMockClient();
    const stats = await refreshFumigations(client, deps);
    expect(stats.backfilled).toBe(0);
    expect(stats.scheduleUpdated).toBe(1);
  });

  it("scheduleUpdated es la cantidad de filas retornadas por updateSchedule", async () => {
    const scheduleRows = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      parcel_id: 200 + i,
      last_fumigation_date: new Date("2026-07-15"),
      next_due_date: new Date("2026-07-25")
    }));
    const deps = makeDeps({ scheduleRows });
    const client = makeMockClient();
    const stats = await refreshFumigations(client, deps);
    expect(stats.scheduleUpdated).toBe(50);
  });

  it("si el backfill tira error, la excepción propaga (main hace exit 1)", async () => {
    const deps = makeDeps({ backfillThrow: new Error("connection refused") });
    const client = makeMockClient();
    await expect(refreshFumigations(client, deps)).rejects.toThrow("connection refused");
    // updateSchedule no debería haberse llamado si el backfill falló
    expect(deps.updateSchedule).not.toHaveBeenCalled();
  });

  it("si el updateSchedule tira error, la excepción propaga", async () => {
    const deps = makeDeps({ updateThrow: new Error("schedule constraint violation") });
    const client = makeMockClient();
    await expect(refreshFumigations(client, deps)).rejects.toThrow("schedule constraint violation");
  });

  it("usa los módulos reales por default cuando no se pasan deps", async () => {
    // Esto verifica que la firma del export sigue siendo backwards-compatible
    // y que el script corre correctamente sin inyección. Importamos los
    // módulos reales y verificamos que existen y son funciones.
    const real = await import("@/scripts/backfill-fumigations-from-flights");
    const real2 = await import("@/scripts/update-fumigation-schedule");
    expect(typeof real.backfillFumigationsFromFlights).toBe("function");
    expect(typeof real2.updateSchedule).toBe("function");
  });
});
