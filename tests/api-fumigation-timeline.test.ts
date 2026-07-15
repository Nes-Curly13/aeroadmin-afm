// tests/api-fumigation-timeline.test.ts
//
// Tests para GET /api/fumigations/[parcelId]/timeline (M7 — roadmap).
//
// Cubre (checklist §4.2 de docs/guia/02_TDD_AeroAdmin_AFM.md):
//   - Caso feliz: 200 con shape FumigationTimelineResult
//   - 400 con parcelId no numérico, fechas inválidas, from > to
//   - 401 sin sesión
//   - 404 si la parcela no existe
//   - Defaults (ventana últimos 6 meses)
//   - 500 si la BD falla
//
// No muta datos → no aplica invalidación de cache (documentado en el commit).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks hoisted (mismo patrón que tests/api-task-history.test.ts).
const repositoryMocks = vi.hoisted(() => ({
  getParcelById: vi.fn(),
  getFumigationSchedule: vi.fn(),
  getFumigationTimelineForParcel: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);
vi.mock("@/lib/auth", () => authMocks);

import { GET as getTimelineRoute } from "@/app/api/fumigations/[parcelId]/timeline/route";

function makeParcelRow(id = 42) {
  return {
    id,
    external_id: `ext-${id}`,
    land_name: `Parcela Test ${id}`,
    field_type: "Farmland",
    declared_area_ha: 7.5,
    spray_area_m2: 75_000,
    drone_model_code: 1,
    drone_model_name: "T40",
    spray_width_m: 7,
    work_speed_mps: 6,
    optimal_heading_deg: 90,
    radar_height_m: 3,
    edge_offset_m: 1,
    obstacle_offset_m: 2,
    climb_height_m: 4,
    no_spray_zone_m2: 0,
    droplet_size: 300,
    sweep_direction: 0,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null
  };
}

function makeFumigationRow(over: Partial<{
  id: number;
  fumigation_date: Date | string;
  area_fumigated_m2: number | null;
  duration_minutes: number | null;
  drone_nickname: string | null;
  pilot_name: string | null;
}> = {}) {
  return {
    id: 1,
    fumigation_date: new Date("2026-03-15T00:00:00Z"),
    product_used: "Glifosato",
    dose_l_per_ha: 1.5,
    area_fumigated_m2: 10_000,
    duration_minutes: 60,
    drone_code_used: 1,
    drone_nickname: "T40-01",
    pilot_name: "Juan Pérez",
    recorded_by: "operator",
    notes: null,
    source: "manual" as const,
    ...over
  };
}

describe("GET /api/fumigations/[parcelId]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hay sesión válida (admin).
    authMocks.requireAuth.mockResolvedValue({ user: { id: "1", email: "admin@test", role: "admin" } });
    // Default: parcela existe.
    repositoryMocks.getParcelById.mockResolvedValue(makeParcelRow(42));
    // Default: schedule con cadencia 14 días.
    repositoryMocks.getFumigationSchedule.mockResolvedValue({
      parcel_id: 42,
      crop_type: "Caña de azúcar",
      recommended_cadence_days: 14,
      last_fumigation_date: "2026-03-15",
      next_due_date: "2026-03-29",
      is_active: true,
      notes: null
    });
    // Default: 2 fumigaciones en el rango.
    repositoryMocks.getFumigationTimelineForParcel.mockResolvedValue([
      makeFumigationRow({ id: 1, fumigation_date: "2026-01-10" }),
      makeFumigationRow({ id: 2, fumigation_date: "2026-03-15" })
    ]);
  });

  // ============================================================
  // Caso feliz
  // ============================================================
  it("200 con shape FumigationTimelineResult completo", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=2026-01-01&to=2026-06-30"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      parcel: expect.objectContaining({ id: 42, land_name: "Parcela Test 42" }),
      schedule: expect.objectContaining({ recommended_cadence_days: 14 }),
      dateRange: { from: "2026-01-01", to: "2026-06-30" },
      events: expect.any(Array),
      summary: expect.objectContaining({
        count: 2,
        expectedCadenceDays: 14,
        gaps: expect.any(Array)
      })
    });
    // 2 fumigaciones: a→b = 64 días, > 60 → 1 gap
    expect(body.summary.gaps).toEqual([{ from: "2026-01-10", to: "2026-03-15", days: 64 }]);
    // observedCadenceDays: 64 (un solo intervalo)
    expect(body.summary.observedCadenceDays).toBe(64);
  });

  it("default: si no se pasan from/to, ventana = últimos 6 meses", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // El from debe ser ~6 meses antes que to
    const fromDate = new Date(body.dateRange.from + "T00:00:00Z").getTime();
    const toDate = new Date(body.dateRange.to + "T00:00:00Z").getTime();
    const days = Math.round((toDate - fromDate) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(180);
    expect(days).toBeLessThanOrEqual(186);
  });

  // ============================================================
  // 400 — input inválido
  // ============================================================
  it("400 con parcelId no numérico", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/abc/timeline"),
      { params: Promise.resolve({ parcelId: "abc" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/parcelId/) });
    expect(repositoryMocks.getFumigationTimelineForParcel).not.toHaveBeenCalled();
  });

  it("400 con from mal formado", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=15-01-2026&to=2026-06-30"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/from/) });
  });

  it("400 con to mal formado", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=2026-01-01&to=2026-06-31"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/to/) });
  });

  it("400 si from > to", async () => {
    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=2026-06-30&to=2026-01-01"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/from must be <= to/) });
  });

  // ============================================================
  // 401 — sin sesión
  // ============================================================
  it("401 sin sesión", async () => {
    // requireAuth lanza error tipado con status=401
    authMocks.requireAuth.mockImplementationOnce(() => {
      const err = new Error("UNAUTHENTICATED") as Error & { code?: string; status?: number };
      err.code = "UNAUTHENTICATED";
      err.status = 401;
      throw err;
    });

    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(401);
    expect(repositoryMocks.getFumigationTimelineForParcel).not.toHaveBeenCalled();
  });

  // ============================================================
  // 404 — parcela no existe
  // ============================================================
  it("404 si la parcela no existe", async () => {
    repositoryMocks.getParcelById.mockResolvedValueOnce(null);

    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/9999/timeline"),
      { params: Promise.resolve({ parcelId: "9999" }) }
    );

    expect(response.status).toBe(404);
    expect(repositoryMocks.getFumigationTimelineForParcel).not.toHaveBeenCalled();
  });

  // ============================================================
  // Sin schedule (parcela existe pero no tiene cadencia)
  // ============================================================
  it("200 con expectedCadenceDays=null si no hay schedule", async () => {
    repositoryMocks.getFumigationSchedule.mockResolvedValueOnce(null);

    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=2026-01-01&to=2026-06-30"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schedule).toBeNull();
    expect(body.summary.expectedCadenceDays).toBeNull();
  });

  // ============================================================
  // 500 — BD falla
  // ============================================================
  it("500 si la BD falla", async () => {
    repositoryMocks.getFumigationTimelineForParcel.mockRejectedValueOnce(new Error("db offline"));

    const response = await getTimelineRoute(
      new NextRequest("http://localhost:3000/api/fumigations/42/timeline?from=2026-01-01&to=2026-06-30"),
      { params: Promise.resolve({ parcelId: "42" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "db offline" });
  });
});
