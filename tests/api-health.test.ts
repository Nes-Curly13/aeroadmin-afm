import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));

import { GET } from "@/app/api/health/route";

/**
 * Tests del liveness probe /api/health (auditoría #48).
 * No expone detalles del error — solo un booleano.
 */
describe("GET /api/health", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("devuelve 200 ok cuando la BD responde", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: boolean };
    expect(body.status).toBe("ok");
    expect(body.db).toBe(true);
  });

  it("devuelve 200 degraded (sin filtrar el error) cuando la BD falla", async () => {
    mockQuery.mockRejectedValueOnce(new Error("boom: public.dji_parcels no existe"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: boolean; error?: string };
    expect(body.status).toBe("degraded");
    expect(body.db).toBe(false);
    expect(body.error).toBeUndefined();
  });
});
