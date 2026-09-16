// tests/api-admin-fumigation-plans-id.test.ts
//
// Tests de /api/admin/fumigation-plans/[id] (PATCH, DELETE).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const updatePlan = vi.fn();
const deletePlan = vi.fn();
const requireRoleMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth/role", () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a)
}));
vi.mock("@/api/repositories", () => ({
  updateFumigationPlan: (...a: unknown[]) => updatePlan(...a),
  deleteFumigationPlan: (...a: unknown[]) => deletePlan(...a)
}));

import { PATCH, DELETE } from "@/app/api/admin/fumigation-plans/[id]/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/fumigation-plans/7", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function deleteReq(): NextRequest {
  return new NextRequest("http://localhost/api/admin/fumigation-plans/7", {
    method: "DELETE"
  });
}

describe("/api/admin/fumigation-plans/[id]", () => {
  beforeEach(() => {
    updatePlan.mockReset();
    deletePlan.mockReset();
    requireRoleMock.mockReset().mockResolvedValue(undefined);
  });

  it("PATCH actualiza el status a 'hecha'", async () => {
    updatePlan.mockResolvedValueOnce({ id: 7, status: "hecha" });
    const res = await PATCH(patchReq({ status: "hecha" }), ctx("7"));
    expect(res.status).toBe(200);
    expect(updatePlan).toHaveBeenCalledWith(7, { status: "hecha" });
  });

  it("PATCH permite limpiar campos con null", async () => {
    updatePlan.mockResolvedValueOnce({ id: 7 });
    await PATCH(patchReq({ product_name: null }), ctx("7"));
    expect(updatePlan).toHaveBeenCalledWith(7, { product_name: null });
  });

  it("PATCH rechaza status inválido (zod 400)", async () => {
    const res = await PATCH(patchReq({ status: "frita" }), ctx("7"));
    expect(res.status).toBe(400);
    expect(updatePlan).not.toHaveBeenCalled();
  });

  it("PATCH 404 si el plan no existe", async () => {
    updatePlan.mockResolvedValueOnce(null);
    const res = await PATCH(patchReq({ status: "cancelada" }), ctx("7"));
    expect(res.status).toBe(404);
  });

  it("PATCH 400 si el id es inválido", async () => {
    const res = await PATCH(patchReq({ status: "hecha" }), ctx("abc"));
    expect(res.status).toBe(400);
    expect(updatePlan).not.toHaveBeenCalled();
  });

  it("DELETE borra el plan (200)", async () => {
    deletePlan.mockResolvedValueOnce(true);
    const res = await DELETE(deleteReq(), ctx("7"));
    expect(res.status).toBe(200);
    expect(deletePlan).toHaveBeenCalledWith(7);
  });

  it("DELETE 404 si no existe", async () => {
    deletePlan.mockResolvedValueOnce(false);
    const res = await DELETE(deleteReq(), ctx("7"));
    expect(res.status).toBe(404);
  });
});
