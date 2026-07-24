// tests/api-fumigation-link.test.ts
//
// Sprint G1 — tests para POST /api/fumigations/[id]/link.
//
// Cubre:
//   - 200 linked: respuesta con status='linked' + event
//   - 200 already_assigned: fumigación ya tiene parcela
//   - 200 not_found: fumigación o parcela no existe
//   - 400 id inválido
//   - 400 parcel_id faltante o no numérico
//   - 400 body inválido (no JSON)
//   - 401/403 si requireRole falla

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  linkFumigationToParcel: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);
vi.mock("@/lib/auth/role", () => authMocks);

import { POST } from "@/app/api/fumigations/[id]/link/route";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/fumigations/42/link", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}

describe("POST /api/fumigations/[id]/link", () => {
  beforeEach(() => {
    repositoryMocks.linkFumigationToParcel.mockReset();
    authMocks.requireRole.mockReset();
  });

  it("200 linked: devuelve status=linked + event", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const event = {
      id: 42,
      parcel_id: 904,
      fumigation_date: "2026-07-01",
      product_used: "Glifosato",
      source: "import" as const,
      recorded_by: "djiag-import"
    };
    repositoryMocks.linkFumigationToParcel.mockResolvedValueOnce({ status: "linked", event });

    const res = await POST(makeReq({ parcel_id: 904 }), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("linked");
    expect(body.event.id).toBe(42);
    expect(body.event.parcel_id).toBe(904);
    expect(repositoryMocks.linkFumigationToParcel).toHaveBeenCalledWith(42, 904);
  });

  it("200 already_assigned cuando la fumigación ya tiene parcela", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    repositoryMocks.linkFumigationToParcel.mockResolvedValueOnce({ status: "already_assigned" });

    const res = await POST(makeReq({ parcel_id: 904 }), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_assigned");
  });

  it("200 not_found cuando la fumigación o parcela no existe", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    repositoryMocks.linkFumigationToParcel.mockResolvedValueOnce({ status: "not_found" });

    const res = await POST(makeReq({ parcel_id: 999_999 }), { params: Promise.resolve({ id: "99999999" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("not_found");
  });

  it("400 cuando el id del path es no numérico", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await POST(makeReq({ parcel_id: 904 }), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("400 cuando parcel_id falta", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await POST(makeReq({}), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
  });

  it("400 cuando parcel_id no es numérico", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await POST(makeReq({ parcel_id: "abc" }), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
  });

  it("400 cuando el body no es JSON", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const res = await POST(
      new NextRequest("http://localhost/api/fumigations/42/link", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" }
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(400);
  });

  it("rechaza si requireRole tira (401/403)", async () => {
    authMocks.requireRole.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      POST(makeReq({ parcel_id: 904 }), { params: Promise.resolve({ id: "42" }) })
    ).rejects.toThrow("Forbidden");
    expect(repositoryMocks.linkFumigationToParcel).not.toHaveBeenCalled();
  });
});
