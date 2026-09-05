/**
 * Tests for the cycles + cycle_events repository functions.
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.
 *
 * Coverage:
 *   - getActiveCycleForParcel — devuelve null si no hay ciclo, devuelve
 *     el ciclo activo si existe.
 *   - listCyclesForParcel — devuelve todos los ciclos (activos y cerrados).
 *   - listEventsForCycle — devuelve eventos ordenados por fecha desc.
 *   - createCycle / createCycleEvent / closeCycle — CRUD básico.
 *   - backfillCyclesFromFumigations — backfill híbrido.
 *
 * Sigue el patron del repo: @vitest-environment node, mock getDb con
 * db.query: (...args) => mockQuery(...args).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn()
}));

import { getDb } from "@/lib/db";
import {
  getActiveCycleForParcel,
  listCyclesForParcel,
  listEventsForCycle,
  createCycle,
  createCycleEvent,
  closeCycle,
  backfillCyclesFromFumigations,
  type Cycle,
  type CycleEvent
} from "@/api/repositories";

type MockRow = Record<string, unknown>;
type MockResult = { rows: MockRow[]; rowCount?: number };

function buildDbMock(handlers: Record<string, (args: unknown[]) => MockResult | Promise<MockResult>>) {
  return {
    query: vi.fn(async (sqlOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      // Soporta ambos formatos: client.query(sql, values) o client.query({text, values}).
      let sql: string;
      let args: unknown[] | undefined;
      if (typeof sqlOrConfig === "string") {
        sql = sqlOrConfig;
        args = values;
      } else {
        sql = sqlOrConfig.text;
        args = sqlOrConfig.values;
      }
      // Matchear por substring del SQL (orden importa — el mas especifico primero).
      const keys = Object.keys(handlers).sort((a, b) => b.length - a.length);
      for (const key of keys) {
        if (sql.includes(key)) {
          return handlers[key](args ?? []);
        }
      }
      throw new Error(`No mock handler for SQL containing: ${sql.slice(0, 80)}...`);
    })
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getActiveCycleForParcel", () => {
  it("devuelve null si no hay ciclo activo", async () => {
    const db = buildDbMock({
      "WHERE parcela_id = $1 AND end_date IS NULL": () => ({ rows: [] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await getActiveCycleForParcel(42);
    expect(result).toBeNull();
  });

  it("devuelve el ciclo activo si existe", async () => {
    const cycle: Cycle = {
      id: 1,
      parcela_id: 42,
      crop_type: "cana",
      variety: null,
      start_date: "2026-03-15",
      end_date: null,
      source: "manual",
      data_validity: "fresh",
      last_validated_at: null,
      validated_by_email: null,
      notes: null,
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z"
    };
    const db = buildDbMock({
      "WHERE parcela_id = $1 AND end_date IS NULL": () => ({ rows: [cycle] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await getActiveCycleForParcel(42);
    expect(result).toEqual(cycle);
  });
});

describe("listCyclesForParcel", () => {
  it("devuelve todos los ciclos (activos y cerrados) ordenados", async () => {
    const cycles: Cycle[] = [
      {
        id: 2,
        parcela_id: 42,
        crop_type: "cana",
        variety: null,
        start_date: "2026-03-15",
        end_date: null,
        source: "manual",
        data_validity: "fresh",
        last_validated_at: null,
        validated_by_email: null,
        notes: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z"
      },
      {
        id: 1,
        parcela_id: 42,
        crop_type: "cana",
        variety: null,
        start_date: "2025-03-15",
        end_date: "2025-12-20",
        source: "manual",
        data_validity: "fresh",
        last_validated_at: null,
        validated_by_email: null,
        notes: null,
        created_at: "2025-03-15T00:00:00Z",
        updated_at: "2025-12-20T00:00:00Z"
      }
    ];
    const db = buildDbMock({
      "ORDER BY start_date DESC": () => ({ rows: cycles })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await listCyclesForParcel(42);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(2);
    expect(result[1].id).toBe(1);
  });
});

describe("listEventsForCycle", () => {
  it("devuelve eventos del ciclo ordenados por fecha desc", async () => {
    const events: CycleEvent[] = [
      {
        id: 2,
        cycle_id: 1,
        event_type: "application",
        event_date: "2026-08-01",
        fumigation_id: 100,
        source: "manual",
        source_ref: null,
        data_validity: "fresh",
        notes: null,
        created_at: "2026-08-01T00:00:00Z"
      },
      {
        id: 1,
        cycle_id: 1,
        event_type: "planting",
        event_date: "2026-03-15",
        fumigation_id: null,
        source: "manual",
        source_ref: null,
        data_validity: "fresh",
        notes: "Siembra CC 85-92",
        created_at: "2026-03-15T00:00:00Z"
      }
    ];
    const db = buildDbMock({
      "ORDER BY event_date DESC, id DESC": () => ({ rows: events })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await listEventsForCycle(1);
    expect(result).toHaveLength(2);
    expect(result[0].event_type).toBe("application");
    expect(result[1].event_type).toBe("planting");
  });
});

describe("createCycle", () => {
  it("inserta un ciclo nuevo y devuelve el row", async () => {
    const cycle: Cycle = {
      id: 1,
      parcela_id: 42,
      crop_type: "cana",
      variety: "CC 85-92",
      start_date: "2026-03-15",
      end_date: null,
      source: "manual",
      data_validity: "fresh",
      last_validated_at: null,
      validated_by_email: null,
      notes: "Test cycle",
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z"
    };
    const db = buildDbMock({
      "INSERT INTO cycles": () => ({ rows: [cycle] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await createCycle({
      parcela_id: 42,
      crop_type: "cana",
      variety: "CC 85-92",
      start_date: "2026-03-15",
      notes: "Test cycle"
    });
    expect(result).toEqual(cycle);
  });

  it("lanza error si INSERT no devuelve row", async () => {
    const db = buildDbMock({
      "INSERT INTO cycles": () => ({ rows: [] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      createCycle({ parcela_id: 42, start_date: "2026-03-15" })
    ).rejects.toThrow("createCycle: INSERT sin row");
  });
});

describe("createCycleEvent", () => {
  it("inserta un event de tipo application con fumigation_id", async () => {
    const event: CycleEvent = {
      id: 1,
      cycle_id: 1,
      event_type: "application",
      event_date: "2026-08-01",
      fumigation_id: 100,
      source: "manual",
      source_ref: null,
      data_validity: "fresh",
      notes: null,
      created_at: "2026-08-01T00:00:00Z"
    };
    const db = buildDbMock({
      "INSERT INTO cycle_events": () => ({ rows: [event] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await createCycleEvent({
      cycle_id: 1,
      event_type: "application",
      event_date: "2026-08-01",
      fumigation_id: 100
    });
    expect(result.event_type).toBe("application");
    expect(result.fumigation_id).toBe(100);
  });
});

describe("closeCycle", () => {
  it("actualiza end_date del ciclo y devuelve el row", async () => {
    const cycle: Cycle = {
      id: 1,
      parcela_id: 42,
      crop_type: "cana",
      variety: null,
      start_date: "2025-03-15",
      end_date: "2025-12-20",
      source: "manual",
      data_validity: "fresh",
      last_validated_at: "2025-12-20T00:00:00Z",
      validated_by_email: null,
      notes: null,
      created_at: "2025-03-15T00:00:00Z",
      updated_at: "2025-12-20T00:00:00Z"
    };
    const db = buildDbMock({
      "UPDATE cycles": () => ({ rows: [cycle] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await closeCycle(1, "2025-12-20");
    expect(result?.end_date).toBe("2025-12-20");
    expect(result?.data_validity).toBe("fresh");
  });

  it("devuelve null si el ciclo no existe", async () => {
    const db = buildDbMock({
      "UPDATE cycles": () => ({ rows: [] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await closeCycle(999, "2025-12-20");
    expect(result).toBeNull();
  });
});

describe("backfillCyclesFromFumigations", () => {
  it("crea N ciclos basado en gaps > 120 dias entre fumigaciones", async () => {
    // El backfill corre 1 query grande. Mockeamos que devuelve 3 rows
    // (3 nuevos ciclos insertados).
    const db = buildDbMock({
      "INSERT INTO cycles": () => ({ rows: [{ inserted: 1 }, { inserted: 1 }, { inserted: 1 }] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await backfillCyclesFromFumigations(120);
    expect(result.cycles_created).toBe(3);
  });

  it("respeta el parametro gap_days custom", async () => {
    const db = buildDbMock({
      "INSERT INTO cycles": () => ({ rows: [{ inserted: 1 }] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await backfillCyclesFromFumigations(60);
    expect(result.cycles_created).toBe(1);
  });

  it("devuelve 0 si no hay fumigaciones suficientes para crear ciclos", async () => {
    const db = buildDbMock({
      "INSERT INTO cycles": () => ({ rows: [] })
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await backfillCyclesFromFumigations(120);
    expect(result.cycles_created).toBe(0);
  });
});
