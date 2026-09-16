// tests/api-admin-fumigation-plans.test.ts
//
// Tests de /api/admin/fumigation-plans (GET list, POST create).
// Planificación MANUAL (2026-09-15).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const listPlans = vi.fn();
const createPlan = vi.fn();
const requireRoleMock = vi.fn().mockResolvedValue(undefined);
const authMock = vi.fn().mockResolvedValue({ user: { email: "op@afm.local" } });

vi.mock("@/lib/auth/role", () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a)
}));
vi.mock("@/lib/auth", () => ({
  auth: (...a: unknown[]) => authMock(...a)
}));
vi.mock("@/api/repositories", () => ({
  listFumigationPlans: (...a: unknown[]) => listPlans(...a),
  createFumigationPlan: (...a: unknown[]) => createPlan(...a)
}));

import { GET, POST } from "@/app/api/admin/fumigation-plans/route";

function getReq(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/fumigation-plans${query}`
  );
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/fumigation-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/admin/fumigation-plans", () => {
  beforeEach(() => {
    listPlans.mockReset();
    createPlan.mockReset();
    requireRoleMock.mockReset().mockResolvedValue(undefined);
    authMock.mockReset().mockResolvedValue({ user: { email: "op@afm.local" } });
  });

  it("GET lista los planes", async () => {
    listPlans.mockResolvedValueOnce([{ id: 1, status: "planificada" }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plans: unknown[] };
    expect(body.plans).toHaveLength(1);
  });

  it("GET pasa status (CSV) y parcelId a la query", async () => {
    listPlans.mockResolvedValueOnce([]);
    await GET(getReq("?status=planificada,hecha&parcelId=42&limit=10"));
    expect(listPlans).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ["planificada", "hecha"],
        parcelId: 42,
        limit: 10
      })
    );
  });

  it("GET ignora status inválidos", async () => {
    listPlans.mockResolvedValueOnce([]);
    await GET(getReq("?status=basura,hecha"));
    expect(listPlans).toHaveBeenCalledWith(
      expect.objectContaining({ status: ["hecha"] })
    );
  });

  it("POST crea un plan (202/201) e inyecta created_by_email de la sesión", async () => {
    createPlan.mockResolvedValueOnce({ id: 7, status: "planificada" });
    const res = await POST(
      postReq({
        parcel_id: 5,
        planned_date: "2026-10-01",
        category_id: 2,
        product_name: "Glifosato"
      })
    );
    expect(res.status).toBe(201);
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        parcel_id: 5,
        planned_date: "2026-10-01",
        category_id: 2,
        product_name: "Glifosato",
        created_by_email: "op@afm.local"
      })
    );
  });

  it("POST rechaza sin parcel_id (zod 400)", async () => {
    const res = await POST(postReq({ planned_date: "2026-10-01" }));
    expect(res.status).toBe(400);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("POST rechaza planned_date inválida (zod 400)", async () => {
    const res = await POST(postReq({ parcel_id: 5, planned_date: "01/10/2026" }));
    expect(res.status).toBe(400);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("POST mapea FK violation (23503) a 400", async () => {
    createPlan.mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));
    const res = await POST(postReq({ parcel_id: 999, planned_date: "2026-10-01" }));
    expect(res.status).toBe(400);
  });
});
