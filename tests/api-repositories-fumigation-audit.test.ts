/**
 * tests/api-repositories-fumigation-audit.test.ts
 *
 * Test unitario de los helpers de audit log en api/repositories.ts:
 *   - insertFumigationAuditEvent
 *   - getFumigationAuditTrail
 *
 * Sprint: feature/fumigation-audit-log (2026-08-15) / sub-1.
 *
 * Cubre:
 *   - insertFumigationAuditEvent: happy path (INSERT + return row)
 *   - insertFumigationAuditEvent: action inválido tira error tipado
 *   - insertFumigationAuditEvent: actor_email vacío tira error tipado
 *   - insertFumigationAuditEvent: fumigation_id no-positivo tira error
 *   - insertFumigationAuditEvent: si BD devuelve 23503 (FK) → null
 *     (fumigación no existe). El caller NO rompe.
 *   - getFumigationAuditTrail: devuelve eventos ordenados DESC
 *   - getFumigationAuditTrail: fumigación sin eventos → []
 *   - getFumigationAuditTrail: fumigationId no-positivo tira error
 *
 * Mockeamos `getDb` (de @/lib/db) para no tocar la BD real. El patrón
 * es el mismo que `tests/api-repositories-create-bulk.test.ts`.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => mockQuery(...args)
  })
}));

vi.mock("@/lib/cache", () => ({
  invalidateAfterFumigationMutation: () => mockInvalidate()
}));

const { insertFumigationAuditEvent, getFumigationAuditTrail } = await import(
  "@/api/repositories"
);

// ============================================================
// Helpers
// ============================================================

const NOW_ISO = "2026-08-15T10:00:00.000Z";

function makeRowInserted(overrides: Partial<{
  id: number;
  fumigation_id: number;
  action: "created" | "edited" | "deleted" | "restored";
  actor_email: string;
  changes: Record<string, unknown>;
  created_at: string;
}> = {}) {
  return {
    id: 1,
    fumigation_id: 42,
    action: "created" as const,
    actor_email: "admin@aeroadmin.local",
    changes: {},
    created_at: NOW_ISO,
    ...overrides
  };
}

// ============================================================
// Tests
// ============================================================

beforeEach(() => {
  mockQuery.mockReset();
  mockInvalidate.mockReset();
});

describe("insertFumigationAuditEvent", () => {
  it("INSERT happy path: devuelve el row insertado con id + created_at", async () => {
    const inserted = makeRowInserted({
      id: 7,
      action: "edited",
      actor_email: "supervisor@aeroadmin.local",
      changes: { diff: { dose_l_per_ha: { from: 2.0, to: 2.5 } } }
    });
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    const result = await insertFumigationAuditEvent({
      fumigation_id: 42,
      action: "edited",
      actor_email: "supervisor@aeroadmin.local",
      changes: { diff: { dose_l_per_ha: { from: 2.0, to: 2.5 } } }
    });

    expect(result).toEqual(inserted);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    // SQL contiene el INSERT + RETURNING
    expect(sql).toMatch(/INSERT INTO fumigation_audit_log/i);
    expect(sql).toMatch(/RETURNING/i);
    // Params: fumigation_id, action, actor_email, JSON stringificado
    expect(params).toEqual([
      42,
      "edited",
      "supervisor@aeroadmin.local",
      JSON.stringify({ diff: { dose_l_per_ha: { from: 2.0, to: 2.5 } } })
    ]);
  });

  it("action='created' con snapshot: serializa el fields a JSON", async () => {
    const inserted = makeRowInserted({
      action: "created",
      changes: { fields: { fumigation_date: "2026-08-15", product_used: "X" } }
    });
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    await insertFumigationAuditEvent({
      fumigation_id: 1,
      action: "created",
      actor_email: "admin@aeroadmin.local",
      changes: { fields: { fumigation_date: "2026-08-15", product_used: "X" } }
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe("created");
    expect(params[3]).toBe(
      JSON.stringify({ fields: { fumigation_date: "2026-08-15", product_used: "X" } })
    );
  });

  it("changes defaults a {} si no se provee", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRowInserted()] });

    await insertFumigationAuditEvent({
      fumigation_id: 1,
      action: "restored",
      actor_email: "admin@aeroadmin.local"
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe("{}");
  });

  it("tira error tipado si action no es uno de los 4 válidos", async () => {
    await expect(
      insertFumigationAuditEvent({
        fumigation_id: 1,
        // @ts-expect-error — test negativo, simulamos caller bugueado
        action: "exploted",
        actor_email: "admin@aeroadmin.local"
      })
    ).rejects.toThrow(/action inválido/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("tira error tipado si actor_email es vacío", async () => {
    await expect(
      insertFumigationAuditEvent({
        fumigation_id: 1,
        action: "created",
        actor_email: "   "
      })
    ).rejects.toThrow(/actor_email requerido/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("tira error tipado si fumigation_id no es entero positivo", async () => {
    await expect(
      insertFumigationAuditEvent({
        fumigation_id: 0,
        action: "created",
        actor_email: "admin@aeroadmin.local"
      })
    ).rejects.toThrow(/fumigation_id requerido/);

    await expect(
      insertFumigationAuditEvent({
        fumigation_id: -5,
        action: "created",
        actor_email: "admin@aeroadmin.local"
      })
    ).rejects.toThrow(/fumigation_id requerido/);

    await expect(
      insertFumigationAuditEvent({
        fumigation_id: 1.5,
        action: "created",
        actor_email: "admin@aeroadmin.local"
      })
    ).rejects.toThrow(/fumigation_id requerido/);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("devuelve null si la fumigación no existe (FK 23503 cae al fallback)", async () => {
    // withLocalFallback captura el error y devuelve null (fallback).
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error("FK violation"), { code: "23503" })
    );

    const result = await insertFumigationAuditEvent({
      fumigation_id: 999_999,
      action: "created",
      actor_email: "admin@aeroadmin.local"
    });

    expect(result).toBeNull();
  });
});

describe("getFumigationAuditTrail", () => {
  it("devuelve los eventos en orden DESC (más reciente primero)", async () => {
    const rows = [
      makeRowInserted({
        id: 3,
        action: "edited",
        created_at: "2026-08-15T12:00:00.000Z",
        changes: { diff: { notes: { from: "a", to: "b" } } }
      }),
      makeRowInserted({
        id: 2,
        action: "deleted",
        created_at: "2026-08-15T11:00:00.000Z",
        changes: { snapshot: { product_used: "X" } }
      }),
      makeRowInserted({
        id: 1,
        action: "created",
        created_at: "2026-08-15T10:00:00.000Z",
        changes: { fields: { fumigation_date: "2026-08-15" } }
      })
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const trail = await getFumigationAuditTrail(42);

    expect(trail).toEqual(rows);
    const [sql, params] = mockQuery.mock.calls[0];
    // SQL: SELECT ... FROM fumigation_audit_log WHERE fumigation_id = $1 ORDER BY DESC
    expect(sql).toMatch(/SELECT/i);
    expect(sql).toMatch(/FROM fumigation_audit_log/i);
    expect(sql).toMatch(/WHERE fumigation_id = \$1/i);
    expect(sql).toMatch(/ORDER BY.*DESC/i);
    expect(params).toEqual([42]);
  });

  it("devuelve [] si la fumigación no tiene eventos (caso histórico pre-sprint)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const trail = await getFumigationAuditTrail(42);

    expect(trail).toEqual([]);
  });

  it("devuelve [] si la BD falla (withLocalFallback → fallback [])", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    const trail = await getFumigationAuditTrail(42);

    expect(trail).toEqual([]);
  });

  it("tira error tipado si fumigationId no es entero positivo", async () => {
    await expect(getFumigationAuditTrail(0)).rejects.toThrow(
      /fumigationId requerido/
    );
    await expect(getFumigationAuditTrail(-1)).rejects.toThrow(
      /fumigationId requerido/
    );
    await expect(getFumigationAuditTrail(1.5)).rejects.toThrow(
      /fumigationId requerido/
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
