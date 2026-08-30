// Tests del bulk operations para fumigaciones (Bloque F, 2026-08-29).
//
// Cubre los 2 endpoints nuevos:
//   - POST /api/admin/fumigations/bulk-delete
//   - POST /api/admin/fumigations/bulk-category
//
// Decisiones de testing:
//   - Mockeamos los repos + audit helpers (no BD). Los happy paths
//     de repo ya tienen cobertura en sus propios tests; acá nos
//     enfocamos en el comportamiento del endpoint.
//   - Mockeamos `next/cache` con `unstable_cache: <T>(fn: T) => fn`
//     por si algún import lo arrastra (consistente con el patrón
//     de la mayoría de tests de API).
//   - Cubrimos: 401, 403, 400 (body vacío / ids no-array / ids > 200),
//     400 (id no positivo), happy path, idempotencia, dedupe,
//     category_id inválido, error interno.
//
// Sprint: feature/bloque-f-bulk-operations.
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks
const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth()
}));

const mockBulkDelete = vi.fn();
const mockBulkCategory = vi.fn();
const mockInsertAudit = vi.fn();
const mockGetFumigationRaw = vi.fn();
vi.mock("@/api/repositories", () => ({
  bulkSoftDeleteFumigations: (...args: unknown[]) => mockBulkDelete(...args),
  bulkUpdateFumigationCategory: (...args: unknown[]) => mockBulkCategory(...args),
  insertFumigationAuditEvent: (...args: unknown[]) => mockInsertAudit(...args),
  getFumigationRawById: (...args: unknown[]) => mockGetFumigationRaw(...args)
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined
}));

import { POST as bulkDelete } from "@/app/api/admin/fumigations/bulk-delete/route";
import { POST as bulkCategory } from "@/app/api/admin/fumigations/bulk-category/route";

beforeEach(() => {
  mockRequireRole.mockReset();
  mockAuth.mockReset();
  mockBulkDelete.mockReset();
  mockBulkCategory.mockReset();
  mockInsertAudit.mockReset();
  mockGetFumigationRaw.mockReset();
  mockRequireRole.mockResolvedValue(undefined);
  mockAuth.mockResolvedValue({ user: { email: "admin@aeroadmin.local" } });
});

function makeReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ============================================================
// bulk-delete
// ============================================================
describe("POST /api/admin/fumigations/bulk-delete", () => {
  it("1. 401 cuando no autenticado", async () => {
    const e = new Error("UNAUTHENTICATED") as Error & { code: string };
    e.code = "UNAUTHENTICATED";
    mockRequireRole.mockRejectedValueOnce(e);
    const res = await bulkDelete(makeReq("https://x.com/api/admin/fumigations/bulk-delete", { ids: [1] }));
    expect(res.status).toBe(401);
  });

  it("2. 403 cuando rol insuficiente", async () => {
    const e = new Error("FORBIDDEN") as Error & { code: string };
    e.code = "FORBIDDEN";
    mockRequireRole.mockRejectedValueOnce(e);
    const res = await bulkDelete(makeReq("https://x.com/api/admin/fumigations/bulk-delete", { ids: [1] }));
    expect(res.status).toBe(403);
  });

  it("3. 400 cuando body no es JSON", async () => {
    const req = new Request("https://x.com/api/admin/fumigations/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "no es json"
    });
    const res = await bulkDelete(req);
    expect(res.status).toBe(400);
  });

  it("4. 400 cuando ids no es array", async () => {
    const res = await bulkDelete(makeReq("https://x.com", { ids: "1,2,3" }));
    expect(res.status).toBe(400);
  });

  it("5. 400 cuando ids está vacío", async () => {
    const res = await bulkDelete(makeReq("https://x.com", { ids: [] }));
    expect(res.status).toBe(400);
  });

  it("6. 400 cuando hay más de 200 ids", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await bulkDelete(makeReq("https://x.com", { ids }));
    expect(res.status).toBe(400);
  });

  it("7. 400 cuando un id no es entero positivo", async () => {
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1, -2, 3] }));
    expect(res.status).toBe(400);
  });

  it("8. happy path: borra 2, skip 0, registra 2 audit", async () => {
    mockBulkDelete.mockResolvedValueOnce({
      affected: [
        { id: 1, before: { id: 1, parcel_id: 100, fumigation_date: "2026-08-01" } },
        { id: 2, before: { id: 2, parcel_id: 101, fumigation_date: "2026-08-02" } }
      ],
      skippedIds: []
    });
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1, 2] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(json.affected_ids).toEqual([1, 2]);
    expect(mockInsertAudit).toHaveBeenCalledTimes(2);
    // Verifico que el actor_email viene del session
    expect(mockInsertAudit.mock.calls[0][0].actor_email).toBe("admin@aeroadmin.local");
    expect(mockInsertAudit.mock.calls[0][0].action).toBe("deleted");
  });

  it("9. dedupe: ids duplicados se procesan como uno solo", async () => {
    mockBulkDelete.mockResolvedValueOnce({
      affected: [{ id: 1, before: { id: 1, parcel_id: 100 } }],
      skippedIds: []
    });
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1, 1, 1] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);
    // El repo recibe unique ids
    expect(mockBulkDelete.mock.calls[0][0]).toEqual([1]);
  });

  it("10. sin afectados: 200 con deleted=0, sin audit", async () => {
    mockBulkDelete.mockResolvedValueOnce({ affected: [], skippedIds: [1, 2, 3] });
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1, 2, 3] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(0);
    expect(json.skipped).toBe(3);
    expect(mockInsertAudit).not.toHaveBeenCalled();
  });

  it("11. audit falla en uno: el batch sigue, los demás sí se registran", async () => {
    mockBulkDelete.mockResolvedValueOnce({
      affected: [
        { id: 1, before: { id: 1, parcel_id: 100 } },
        { id: 2, before: { id: 2, parcel_id: 101 } },
        { id: 3, before: { id: 3, parcel_id: 102 } }
      ],
      skippedIds: []
    });
    mockInsertAudit
      .mockResolvedValueOnce(undefined) // id 1 OK
      .mockRejectedValueOnce(new Error("audit fail")) // id 2 fail
      .mockResolvedValueOnce(undefined); // id 3 OK
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1, 2, 3] }));
    expect(res.status).toBe(200);
    // No rompemos el batch: el endpoint sigue y devuelve OK
    const json = await res.json();
    expect(json.deleted).toBe(3);
    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
  });

  it("12. session sin email: usa fallback unknown@aeroadmin.local", async () => {
    mockAuth.mockResolvedValueOnce({ user: {} }); // sin email
    mockBulkDelete.mockResolvedValueOnce({
      affected: [{ id: 1, before: { id: 1, parcel_id: 100 } }],
      skippedIds: []
    });
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1] }));
    expect(res.status).toBe(200);
    expect(mockInsertAudit.mock.calls[0][0].actor_email).toBe(
      "unknown@aeroadmin.local"
    );
  });

  it("13. error de BD: 500 con mensaje del error", async () => {
    mockBulkDelete.mockRejectedValueOnce(new Error("connection refused"));
    const res = await bulkDelete(makeReq("https://x.com", { ids: [1] }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("connection refused");
  });
});

// ============================================================
// bulk-category
// ============================================================
describe("POST /api/admin/fumigations/bulk-category", () => {
  it("14. 401 cuando no autenticado", async () => {
    const e = new Error("UNAUTHENTICATED") as Error & { code: string };
    e.code = "UNAUTHENTICATED";
    mockRequireRole.mockRejectedValueOnce(e);
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [1], category_id: 1 })
    );
    expect(res.status).toBe(401);
  });

  it("15. 400 cuando category_id no es int positivo ni null", async () => {
    const res = await bulkCategory(makeReq("https://x.com", { ids: [1], category_id: "abc" }));
    expect(res.status).toBe(400);
  });

  it("16. 400 cuando category_id no existe en el catálogo", async () => {
    const res = await bulkCategory(makeReq("https://x.com", { ids: [1], category_id: 999 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("999");
  });

  it("17. happy path: actualiza 3 con category_id 1, registra 3 audit edited", async () => {
    mockBulkCategory.mockResolvedValueOnce({
      affected: [
        { id: 1, oldCategoryId: null },
        { id: 2, oldCategoryId: 2 },
        { id: 3, oldCategoryId: 3 }
      ],
      skippedIds: [4]
    });
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [1, 2, 3, 4], category_id: 1 })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(3);
    expect(json.skipped).toBe(1);
    expect(json.affected_ids).toEqual([1, 2, 3]);
    expect(mockInsertAudit).toHaveBeenCalledTimes(3);
    // Cada audit tiene action=edited y diff={ category_id: { from, to } }
    for (const call of mockInsertAudit.mock.calls) {
      expect(call[0].action).toBe("edited");
      expect(call[0].changes.diff).toHaveProperty("category_id");
      expect(call[0].changes.diff.category_id).toHaveProperty("from");
      expect(call[0].changes.diff.category_id).toHaveProperty("to");
    }
  });

  it("18. happy path: acepta null para limpiar categoría (Sin clasificar)", async () => {
    mockBulkCategory.mockResolvedValueOnce({
      affected: [{ id: 1, oldCategoryId: 1 }],
      skippedIds: []
    });
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [1], category_id: null })
    );
    expect(res.status).toBe(200);
    expect(mockInsertAudit.mock.calls[0][0].changes.diff.category_id).toEqual({
      from: 1,
      to: null
    });
  });

  it("19. FK violation (23503): 400 con mensaje claro", async () => {
    mockBulkCategory.mockRejectedValueOnce(
      Object.assign(new Error("FK violation"), { code: "23503" })
    );
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [1], category_id: 1 })
    );
    expect(res.status).toBe(400);
  });

  it("20. 400 cuando ids está vacío", async () => {
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [], category_id: 1 })
    );
    expect(res.status).toBe(400);
  });

  it("21. 400 cuando > 200 ids", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await bulkCategory(
      makeReq("https://x.com", { ids, category_id: 1 })
    );
    expect(res.status).toBe(400);
  });

  it("22. dedupe: ids duplicados se procesan como uno solo", async () => {
    mockBulkCategory.mockResolvedValueOnce({
      affected: [{ id: 1, oldCategoryId: null }],
      skippedIds: []
    });
    const res = await bulkCategory(
      makeReq("https://x.com", { ids: [1, 1, 2, 2], category_id: 1 })
    );
    expect(res.status).toBe(200);
    expect(mockBulkCategory.mock.calls[0][0]).toEqual([1, 2]);
  });
});
