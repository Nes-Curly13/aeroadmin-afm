import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getRules = vi.fn();
const createRule = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("@/api/repositories", () => ({
  getPhaseApplicationRules: (...a: unknown[]) => getRules(...a),
  createPhaseApplicationRule: (...a: unknown[]) => createRule(...a)
}));

import { GET, POST } from "@/app/api/admin/phase-application-rules/route";

function req(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/phase-application-rules", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

describe("/api/admin/phase-application-rules", () => {
  beforeEach(() => {
    getRules.mockReset();
    createRule.mockReset();
  });

  it("GET lista las reglas", async () => {
    getRules.mockResolvedValueOnce([{ id: 1, phase: "establecimiento" }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: unknown[] };
    expect(body.rules).toHaveLength(1);
  });

  it("POST crea una regla válida", async () => {
    createRule.mockResolvedValueOnce({ id: 9, phase: "vegetativa" });
    const res = await POST(
      req({
        phase: "vegetativa",
        category_slug: "insecticida",
        window_from_day: 121,
        window_to_day: 270,
        is_required: false
      })
    );
    expect(res.status).toBe(201);
    expect(createRule).toHaveBeenCalledOnce();
  });

  it("POST rechaza sin phase", async () => {
    const res = await POST(req({ category_slug: "herbicida" }));
    expect(res.status).toBe(400);
    expect(createRule).not.toHaveBeenCalled();
  });

  it("POST rechaza ventana inválida (to < from)", async () => {
    const res = await POST(
      req({ phase: "establecimiento", category_slug: "herbicida", window_from_day: 30, window_to_day: 10 })
    );
    expect(res.status).toBe(400);
  });
});
