// tests/components/dashboard/overdue-kpi.test.tsx
//
// Test TDD para BUG 3 del audit ui-ux-2026-07: el KPI del dashboard
// que decía "Vencidas" (tone=danger) era demasiado categórico — el
// cálculo es una heurística de cadencia, no una certeza. El audit
// recomienda renombrar a "Atrasadas por cadencia" + helper text que
// explique la heurística.
//
// Cobertura:
//   - El label "Atrasadas por cadencia" se renderiza en el header.
//   - El hint aclara que es recomendación basada en cadencia, no certeza.
//   - El label "Vencidas" NO aparece (regresión: nadie renombra hacia atrás).
//   - El UpcomingFumigations sigue recibiendo totalOverdue intacto (el
//     link "Ver todas (N) →" depende de ese prop).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Hoist ANTES de los vi.doMock() que dependen de él.
const mockGetDashboardMetrics = vi.hoisted(() => vi.fn());
const mockGetParcelsNormalized = vi.hoisted(() => vi.fn());
const mockGetFlights = vi.hoisted(() => vi.fn());
const mockGetAlerts = vi.hoisted(() => vi.fn());
const mockGetUpcomingFumigations = vi.hoisted(() => vi.fn());
const mockGetOverdueParcels = vi.hoisted(() => vi.fn());

// Track B v1.2: app-shell renderiza <MobileSidebarDrawer> que usa useRouter.
// Mockeamos next/navigation porque estos tests renderizan la DashboardPage
// (que envuelve AppShell) en jsdom sin App Router montado.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams()
}));

const stubMetrics = {
  totalFlights: 100,
  totalAreaCovered: 12.5,
  highAlertParcels: 0,
  totalAssets: 5
};

const stubParcelsResult = { data: [], total: 0, page: 1, limit: 200, totalPages: 0 };
const stubFlights = { data: [] };
const stubAlerts: unknown[] = [];

function setUpMocks() {
  mockGetDashboardMetrics.mockResolvedValue(stubMetrics);
  mockGetParcelsNormalized.mockResolvedValue(stubParcelsResult);
  mockGetFlights.mockResolvedValue(stubFlights);
  mockGetAlerts.mockResolvedValue(stubAlerts);
  mockGetUpcomingFumigations.mockResolvedValue([]);
  mockGetOverdueParcels.mockResolvedValue([]);
}

describe("DashboardPage — KPI de cadencia vencida (BUG 3 audit)", () => {
  it("renderiza el label 'Atrasadas por cadencia' en lugar de 'Vencidas'", async () => {
    setUpMocks();

    vi.doMock("@/api/repositories", () => ({
      getDashboardMetrics: mockGetDashboardMetrics,
      getParcelsNormalized: mockGetParcelsNormalized,
      getFlights: mockGetFlights,
      getAlerts: mockGetAlerts,
      getUpcomingFumigations: mockGetUpcomingFumigations,
      getOverdueParcels: mockGetOverdueParcels
    }));

    const { default: DashboardPage } = await import("@/app/page");
    const element = await DashboardPage();
    render(element);

    // El label nuevo aparece como heading del MetricCard
    expect(screen.getByText("Atrasadas por cadencia")).toBeInTheDocument();
    // El label viejo NO aparece en ningún lugar del dashboard
    expect(screen.queryByText("Vencidas")).toBeNull();

    vi.doUnmock("@/api/repositories");
  });

  it("el hint explica que es una recomendación basada en cadencia (no certeza)", async () => {
    setUpMocks();
    vi.doMock("@/api/repositories", () => ({
      getDashboardMetrics: mockGetDashboardMetrics,
      getParcelsNormalized: mockGetParcelsNormalized,
      getFlights: mockGetFlights,
      getAlerts: mockGetAlerts,
      getUpcomingFumigations: mockGetUpcomingFumigations,
      getOverdueParcels: mockGetOverdueParcels
    }));

    const { default: DashboardPage } = await import("@/app/page");
    const element = await DashboardPage();
    render(element);

    // El hint debe aclarar el carácter heurístico
    expect(
      screen.getByText(/recomendación basada en cadencia/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/confirmación manual requerida/i)).toBeInTheDocument();

    vi.doUnmock("@/api/repositories");
  });

  it("pasa totalOverdue a UpcomingFumigations sin alterarlo", async () => {
    // El renombramiento del label NO debe cambiar la lógica del chip
    // "Ver todas (N) →" en el panel de próximas fumigaciones.
    mockGetDashboardMetrics.mockResolvedValue(stubMetrics);
    mockGetParcelsNormalized.mockResolvedValue(stubParcelsResult);
    mockGetFlights.mockResolvedValue(stubFlights);
    mockGetAlerts.mockResolvedValue(stubAlerts);
    mockGetUpcomingFumigations.mockResolvedValue([]);
    // 4 parcelas overdue (severity=overdue) — más que los items del top
    const overdueParcels = Array.from({ length: 4 }, () => ({
      parcel_id: 1,
      land_name: "X",
      crop_type: "Maíz",
      drone_model_name: "T40",
      field_type: "Farmland",
      is_orchard: false,
      recommended_cadence_days: 14,
      last_fumigation_date: "2026-06-01",
      next_due_date: "2026-07-15",
      days_until_next_due: -3,
      area_fumigable_ha: 1.2,
      waypoint_count: 4,
      severity: "overdue" as const
    }));
    mockGetOverdueParcels.mockResolvedValue(overdueParcels);

    vi.doMock("@/api/repositories", () => ({
      getDashboardMetrics: mockGetDashboardMetrics,
      getParcelsNormalized: mockGetParcelsNormalized,
      getFlights: mockGetFlights,
      getAlerts: mockGetAlerts,
      getUpcomingFumigations: mockGetUpcomingFumigations,
      getOverdueParcels: mockGetOverdueParcels
    }));

    const { default: DashboardPage } = await import("@/app/page");
    const element = await DashboardPage();
    render(element);

    // El chip "Ver todas (4) →" sigue funcionando con el conteo correcto
    const link = screen.getByTestId("upcoming-ver-todas-overdue");
    expect(link.textContent).toMatch(/Ver todas \(4\)/);

    vi.doUnmock("@/api/repositories");
  });
});
