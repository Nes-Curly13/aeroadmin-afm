import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getAlerts: vi.fn(),
  getFlights: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);

import { GET as getAlertsRoute } from "@/app/api/alerts/route";
import { GET as getFlightsRoute } from "@/app/api/flights/route";

describe("API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
});
