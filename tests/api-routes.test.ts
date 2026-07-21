import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getAlerts: vi.fn(),
  getFlights: vi.fn(),
  getParcelById: vi.fn(),
  updateParcelMetadata: vi.fn(),
  createFumigationEvent: vi.fn(),
  setFumigationCadence: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);
vi.mock("@/lib/auth", () => authMocks);
// v1.4 Track A: POST /api/fumigations ahora llama `requireRole` desde
// `@/lib/auth/role` antes de validar. Mockeamos para no requerir sesion
// real en los tests de este archivo (que son de validacion de input,
// no de auth).
vi.mock("@/lib/auth/role", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined)
}));

import { GET as getAlertsRoute } from "@/app/api/alerts/route";
import { GET as getFlightsRoute } from "@/app/api/flights/route";
import { GET as getParcelByIdRoute, PUT as putParcelRoute } from "@/app/api/parcels/[id]/route";
import { POST as postFumigationRoute } from "@/app/api/fumigations/route";
import { PATCH as patchScheduleRoute } from "@/app/api/fumigation-schedule/[parcelId]/route";

describe("API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hay sesion valida (admin). Tests especificos la sobreescriben.
    authMocks.requireAuth.mockResolvedValue({ user: { id: "1", email: "admin@test", role: "admin" } });
  });

  // ============================================================
  // GET /api/alerts + GET /api/flights (existentes)
  // ============================================================
  it("returns DJI summaries and paginates flights", async () => {
    repositoryMocks.getFlights.mockResolvedValueOnce({ data: [{ id: 2 }], total: 1, page: 1, limit: 20, totalPages: 1 });

    const response = await getFlightsRoute(new NextRequest("http://localhost:3000/api/flights?page=1&limit=20"));

    expect(response.status).toBe(200);
    expect(repositoryMocks.getFlights).toHaveBeenCalledWith(1, 20);
    await expect(response.json()).resolves.toEqual({ data: [{ id: 2 }], total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it("returns alerts without legacy parcel filters", async () => {
    repositoryMocks.getAlerts.mockResolvedValueOnce([{ parcel_id: 9 }]);

    const response = await getAlertsRoute(new NextRequest("http://localhost:3000/api/alerts"));

    expect(response.status).toBe(200);
    expect(repositoryMocks.getAlerts).toHaveBeenCalledWith();
    await expect(response.json()).resolves.toEqual({ data: [{ parcel_id: 9 }] });
  });

  it("rejects invalid pagination with 400", async () => {
    const response = await getFlightsRoute(new NextRequest("http://localhost:3000/api/flights?page=abc"));

    expect(response.status).toBe(400);
    expect(repositoryMocks.getFlights).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "page must be a positive integer."
    });
  });

  it("returns 500 when repositories fail", async () => {
    repositoryMocks.getAlerts.mockRejectedValueOnce(new Error("db offline"));

    const response = await getAlertsRoute(new NextRequest("http://localhost:3000/api/alerts"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "db offline"
    });
  });

  // ============================================================
  // PUT /api/parcels/[id] — nuevo
  // ============================================================
  describe("PUT /api/parcels/[id]", () => {
    it("rechaza sin sesion (401)", async () => {
      authMocks.requireAuth.mockResolvedValueOnce(null);
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({ land_name: "Test" })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(401);
      expect(repositoryMocks.updateParcelMetadata).not.toHaveBeenCalled();
    });

    it("rechaza id invalido (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/parcels/abc", {
        method: "PUT",
        body: JSON.stringify({ land_name: "Test" })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "abc" }) });
      expect(response.status).toBe(400);
      expect(repositoryMocks.updateParcelMetadata).not.toHaveBeenCalled();
    });

    it("rechaza body no JSON (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: "not json"
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(400);
    });

    it("rechaza land_name > 200 chars (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({ land_name: "x".repeat(201) })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("land_name") });
    });

    it("rechaza declared_area_ha negativo (propaga error de repo)", async () => {
      repositoryMocks.updateParcelMetadata.mockRejectedValueOnce(new Error("declared_area_ha debe estar entre 0 y 100000 (hectareas)"));
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({ declared_area_ha: -5 })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(400);
    });

    it("devuelve 404 si la parcela no existe", async () => {
      repositoryMocks.updateParcelMetadata.mockResolvedValueOnce(null);
      const req = new NextRequest("http://localhost:3000/api/parcels/99999", {
        method: "PUT",
        body: JSON.stringify({ land_name: "Test" })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(response.status).toBe(404);
    });

    it("actualiza metadata correctamente (200)", async () => {
      const updated = { id: 1, land_name: "Nueva Milan", field_type: "Farmland", declared_area_ha: 12.5 };
      repositoryMocks.updateParcelMetadata.mockResolvedValueOnce(updated as never);
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({ land_name: "Nueva Milan", field_type: "Farmland", declared_area_ha: 12.5 })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(200);
      expect(repositoryMocks.updateParcelMetadata).toHaveBeenCalledWith(1, {
        land_name: "Nueva Milan",
        field_type: "Farmland",
        declared_area_ha: 12.5
      });
      await expect(response.json()).resolves.toEqual({ data: updated });
    });

    it("acepta body con solo un campo (PATCH semantics)", async () => {
      const updated = { id: 1, land_name: "Solo nombre" };
      repositoryMocks.updateParcelMetadata.mockResolvedValueOnce(updated as never);
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({ land_name: "Solo nombre" })
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(200);
      expect(repositoryMocks.updateParcelMetadata).toHaveBeenCalledWith(1, {
        land_name: "Solo nombre"
      });
    });

    it("acepta body vacio sin tocar BD", async () => {
      const unchanged = { id: 1, land_name: "Sin cambios" };
      repositoryMocks.updateParcelMetadata.mockResolvedValueOnce(unchanged as never);
      const req = new NextRequest("http://localhost:3000/api/parcels/1", {
        method: "PUT",
        body: JSON.stringify({})
      });
      const response = await putParcelRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(response.status).toBe(200);
      // Sin campos para actualizar, debe pasar {} al repo (que hace no-op)
      expect(repositoryMocks.updateParcelMetadata).toHaveBeenCalledWith(1, {});
    });
  });

  // ============================================================
  // POST /api/fumigations — test rapido
  // ============================================================
  describe("POST /api/fumigations", () => {
    it("rechaza parcel_id invalido (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/fumigations", {
        method: "POST",
        body: JSON.stringify({ fumigation_date: "2026-07-07" })
      });
      const response = await postFumigationRoute(req);
      expect(response.status).toBe(400);
    });

    it("rechaza fecha con formato invalido (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/fumigations", {
        method: "POST",
        body: JSON.stringify({ parcel_id: 1, fumigation_date: "07/07/2026" })
      });
      const response = await postFumigationRoute(req);
      expect(response.status).toBe(400);
    });

    it("crea fumigacion (201)", async () => {
      const created = { id: 100, parcel_id: 1, fumigation_date: "2026-07-07", source: "manual" };
      repositoryMocks.createFumigationEvent.mockResolvedValueOnce(created as never);
      const req = new NextRequest("http://localhost:3000/api/fumigations", {
        method: "POST",
        body: JSON.stringify({ parcel_id: 1, fumigation_date: "2026-07-07", dose_l_per_ha: 1.5 })
      });
      const response = await postFumigationRoute(req);
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ data: created });
    });
  });

  // ============================================================
  // PATCH /api/fumigation-schedule/[parcelId] — test rapido
  // ============================================================
  describe("PATCH /api/fumigation-schedule/[parcelId]", () => {
    it("rechaza sin recommended_cadence_days (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/fumigation-schedule/1", {
        method: "PATCH",
        body: JSON.stringify({})
      });
      const response = await patchScheduleRoute(req, { params: Promise.resolve({ parcelId: "1" }) });
      expect(response.status).toBe(400);
    });

    it("actualiza cadencia (200)", async () => {
      repositoryMocks.setFumigationCadence.mockResolvedValueOnce(undefined);
      const req = new NextRequest("http://localhost:3000/api/fumigation-schedule/1", {
        method: "PATCH",
        body: JSON.stringify({ recommended_cadence_days: 21 })
      });
      const response = await patchScheduleRoute(req, { params: Promise.resolve({ parcelId: "1" }) });
      expect(response.status).toBe(200);
      expect(repositoryMocks.setFumigationCadence).toHaveBeenCalledWith(1, 21);
    });

    it("rechaza parcelId invalido (400)", async () => {
      const req = new NextRequest("http://localhost:3000/api/fumigation-schedule/abc", {
        method: "PATCH",
        body: JSON.stringify({ recommended_cadence_days: 14 })
      });
      const response = await patchScheduleRoute(req, { params: Promise.resolve({ parcelId: "abc" }) });
      expect(response.status).toBe(400);
    });
  });
});