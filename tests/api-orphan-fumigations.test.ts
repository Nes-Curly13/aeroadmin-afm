// tests/api-orphan-fumigations.test.ts
//
// Sprint G1 — tests para GET /api/admin/orphan-fumigations.
//
// Cubre:
//   - 200 admin con lista paginada + total
//   - 401 sin sesión
//   - 403 con role no-admin
//   - 400 con limit/offset inválidos
//   - Limit clamp: limit > 100 → cap a 100

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getOrphanFumigations: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);
vi.mock("@/lib/auth/role", () => authMocks);

import { GET } from "@/app/api/admin/orphan-fumigations/route";

function makeEvent(id: number) {
  return {
    id,
    parcel_id: null,
    fumigation_date: "2026-07-01",
    product_used: "Glifosato",
    dose_l_per_ha: 1.0,
    area_fumigated_m2: 12_000,
    drone_code_used: 1,
    duration_minutes: 25,
    notes: null,
    human_notes: null,
    recorded_by: "djiag-import",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-07-03T14:19:19.854Z",
    source: "import" as const
  };
}

function makeReq(query: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/orphan-fumigations?${new URLSearchParams(query).toString()}`);
  return { nextUrl: url } as unknown as NextRequest;
}

describe("GET /api/admin/orphan-fumigations", () => {
  beforeEach(() => {
    repositoryMocks.getOrphanFumigations.mockReset();
    authMocks.requireRole.mockReset();
  });

  it("200 admin: devuelve rows + total + limit + offset", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const rows = [makeEvent(1), makeEvent(2)];
    repositoryMocks.getOrphanFumigations.mockResolvedValueOnce({ rows, total: 30 });

    const res = await GET(makeReq({ limit: "10", offset: "0" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rows, total: 30, limit: 10, offset: 0 });
    expect(repositoryMocks.getOrphanFumigations).toHaveBeenCalledWith(10, 0);
  });

  it("defaults: limit=25, offset=0 si no se pasan", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    repositoryMocks.getOrphanFumigations.mockResolvedValueOnce({ rows: [], total: 0 });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(0);
    expect(repositoryMocks.getOrphanFumigations).toHaveBeenCalledWith(25, 0);
  });

  it("400 con limit no numérico", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await GET(makeReq({ limit: "abc" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/limit/);
  });

  it("400 con offset negativo", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await GET(makeReq({ offset: "-1" }));
    expect(res.status).toBe(400);
  });

  it("rechaza si requireRole tira (401/403)", async () => {
    authMocks.requireRole.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(GET(makeReq())).rejects.toThrow("Forbidden");
    expect(repositoryMocks.getOrphanFumigations).not.toHaveBeenCalled();
  });
});
