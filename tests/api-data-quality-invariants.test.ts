import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));
vi.mock("@/lib/auth/role", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined)
}));

import { GET } from "@/app/api/data-quality/invariants/route";

/**
 * Regresión de #29: `computeInvariants` usaba `f.parcela_id`
 * (columna inexistente en `dji_fumigations`) → las invariantes 2-5
 * lanzaban y el catch las tragaba. Este test verifica que:
 *   1. se use `f.parcel_id` y NUNCA `f.parcela_id`,
 *   2. se devuelvan warnings de todas las invariantes.
 */
describe("GET /api/data-quality/invariants", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("usa f.parcel_id y nunca f.parcela_id", async () => {
    const sqls: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      sqls.push(sql);
      return { rows: [] };
    });

    const res = await GET(new NextRequest("http://localhost/api/data-quality/invariants"));
    expect(res.status).toBe(200);
    expect(sqls.some((s) => s.includes("f.parcel_id"))).toBe(true);
    expect(sqls.some((s) => s.includes("f.parcela_id"))).toBe(false);
  });

  it("devuelve warnings de las 5 invariantes (no las traga)", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("client_id IS NULL")) return { rows: [{ id: 1 }] };
      if (sql.includes("farm_id IS NULL")) return { rows: [] };
      if (sql.includes("count(f.id) AS n")) return { rows: [{ id: 2, n: "4" }] };
      if (sql.includes("AS fumigation_id"))
        return { rows: [{ fumigation_id: 9, cycle_id: 5, parcel_id: 2 }] };
      if (sql.includes("phase_rules"))
        return { rows: [{ cycle_id: 5, parcela_id: 2, crop_type: "caña de azúcar" }] };
      if (sql.includes("data_validity IN"))
        return { rows: [{ cycle_id: 6, parcela_id: 3, data_validity: "stale" }] };
      return { rows: [] };
    });

    const res = await GET(new NextRequest("http://localhost/api/data-quality/invariants"));
    const body = (await res.json()) as { warnings: Array<{ code: string }> };
    const codes = body.warnings.map((w) => w.code);
    expect(codes).toContain("parcela_no_cliente");
    expect(codes).toContain("parcela_sin_ciclo_activo");
    expect(codes).toContain("fumigacion_ciclo_cerrado");
    expect(codes).toContain("ciclo_sin_phase_rule");
    expect(codes).toContain("parcela_data_stale");
  });

  it("filtra por parcelaId con el param opcional", async () => {
    const sqls: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      sqls.push(sql);
      return { rows: [] };
    });

    await GET(new NextRequest("http://localhost/api/data-quality/invariants?parcelaId=42"));
    // El patrón sargable `($1::bigint IS NULL OR ... = $1)` en cada query.
    expect(sqls.every((s) => s.includes("$1::bigint IS NULL"))).toBe(true);
  });
});
