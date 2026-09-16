// tests/api-repositories-fumigation-plans.test.ts
//
// Tests de las funciones de repositorio de la planificación MANUAL de
// fumigaciones (2026-09-15). Sigue el patrón del repo: mock de
// `@/lib/db` con `getDb`, y un `query` que matchea por substring SQL.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn()
}));

import { getDb } from "@/lib/db";
import {
  listFumigationPlans,
  getFumigationPlanById,
  createFumigationPlan,
  updateFumigationPlan,
  deleteFumigationPlan,
  type FumigationPlan
} from "@/api/repositories";

const planRow: FumigationPlan = {
  id: 1,
  parcel_id: 5,
  land_name: "Lote 24",
  client_name: "Agro XYZ",
  farm_name: "La Esperanza",
  planned_date: "2026-10-01",
  category_id: 2,
  category_slug: "herbicida",
  application_type_id: null,
  application_type_slug: null,
  product_name: "Glifosato",
  notes: null,
  status: "planificada",
  completed_fumigation_id: null,
  created_by_email: "op@afm.local",
  created_at: "2026-09-15T10:00:00Z",
  updated_at: "2026-09-15T10:00:00Z",
  days_until: 16,
  is_overdue: false
};

const query = vi.fn();

function installDb() {
  (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ query });
}

describe("repositories — fumigation plans (manual)", () => {
  beforeEach(() => {
    query.mockReset();
    installDb();
  });

  it("listFumigationPlans: SELECT con hoy como $1 y orden por fecha", async () => {
    query.mockResolvedValueOnce({ rows: [planRow], rowCount: 1 });
    const plans = await listFumigationPlans();
    expect(plans).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM fumigation_plans");
    expect(sql).toContain("ORDER BY fp.planned_date ASC");
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("listFumigationPlans: agrega filtros de status y parcelId", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listFumigationPlans({ status: ["planificada"], parcelId: 5 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("fp.parcel_id = $2");
    expect(sql).toContain("fp.status = ANY($3::text[])");
    expect(params[1]).toBe(5);
    expect(params[2]).toEqual(["planificada"]);
  });

  it("createFumigationPlan: INSERT + re-lectura del plan", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({ rows: [planRow], rowCount: 1 }); // getById
    const plan = await createFumigationPlan({
      parcel_id: 5,
      planned_date: "2026-10-01",
      category_id: 2,
      product_name: "  Glifosato  ",
      created_by_email: "op@afm.local"
    });
    expect(plan.id).toBe(1);
    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO fumigation_plans")
    );
    expect(insertCall).toBeDefined();
    const [, insertParams] = insertCall as [string, unknown[]];
    expect(insertParams[0]).toBe(5);
    expect(insertParams[1]).toBe("2026-10-01");
    // product_name se trimea
    expect(insertParams[4]).toBe("Glifosato");
  });

  it("createFumigationPlan: tira si el INSERT no devuelve id", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      createFumigationPlan({ parcel_id: 5, planned_date: "2026-10-01" })
    ).rejects.toThrow(/INSERT sin row/);
  });

  it("updateFumigationPlan: SET status + updated_at y re-lectura", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ ...planRow, status: "hecha" }], rowCount: 1 });
    const plan = await updateFumigationPlan(1, { status: "hecha" });
    expect(plan?.status).toBe("hecha");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE fumigation_plans SET");
    expect(sql).toContain("status = $1");
    expect(sql).toContain("updated_at = NOW()");
    expect(params[0]).toBe("hecha");
    expect(params[1]).toBe(1);
  });

  it("updateFumigationPlan: patch vacío no hace UPDATE (solo re-lee)", async () => {
    query.mockResolvedValueOnce({ rows: [planRow], rowCount: 1 });
    const plan = await updateFumigationPlan(1, {});
    expect(plan?.id).toBe(1);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("UPDATE fumigation_plans"))
    ).toBe(false);
  });

  it("deleteFumigationPlan: true si borró, false si no existía", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await deleteFumigationPlan(1)).toBe(true);
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await deleteFumigationPlan(999)).toBe(false);
  });

  it("getFumigationPlanById: null si no existe", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getFumigationPlanById(999)).toBeNull();
  });
});
