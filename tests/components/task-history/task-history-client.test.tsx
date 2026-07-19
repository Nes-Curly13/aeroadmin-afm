/**
 * Tests del TaskHistoryClient (Q1 Coder A — Commit 1).
 *
 * Después del wrap con AppShell (ver docs/audit/ui-ux-2026-07.md §4.1),
 * el TaskHistoryClient ya NO renderiza su propio header (h1 "Task
 * History") ni el toolbar (DateRangePicker / FilterButton /
 * ScreenshotButton). Esos viven ahora en el `actions` slot del AppShell
 * que envuelve la page.
 *
 * El cliente solo renderiza el cuerpo: TabSwitcher + HeaderCard +
 * DayList + mapa. La ref de screenshot ahora usa un `targetSelector`
 * compartido por data-testid="task-history-content".
 *
 * Patrón de assertion: `getByTestId` para los elementos que esperamos
 * y `queryByText` / `queryByRole` para los que NO esperamos.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  }),
  usePathname: () => "/task-history",
  useSearchParams: () => new URLSearchParams()
}));

// Mock dinámico del MapView (Leaflet) — jsdom no carga leaflet sin
// DOM real, igual que hacen los otros tests del Task History.
vi.mock("@/components/task-history/map-view", () => ({
  MapView: () => <div data-testid="task-history-map-mock" />
}));

import { TaskHistoryClient } from "@/app/task-history/TaskHistoryClient";
import type {
  DayCard as DayCardData,
  TaskHistoryTotals
} from "@/lib/djiag-from-make/task-history";

const TOTALS: TaskHistoryTotals = {
  areaMu: 5462.23,
  times: 8028,
  liters: 100884.1,
  duration: { hours: 631, minutes: 11, seconds: 23, djiFormat: "631Hour11min23s" }
};

const DAYS: DayCardData[] = [
  {
    date: "2026/07/08",
    weekday: "Wednesday",
    areaMu: 18.29,
    times: 22,
    liters: 365.2,
    duration: { hours: 1, minutes: 44, seconds: 53, djiFormat: "1Hour44min53s" }
  }
];

const POLYGONS: [] = [];

afterEach(() => {
  vi.clearAllMocks();
});

describe("TaskHistoryClient — sin header propio (Q1 Commit 1)", () => {
  it("NO renderiza el h1 'Task History' (movido al AppShell)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    // El h1 con texto "Task History" ya no debe existir en este componente
    expect(screen.queryByRole("heading", { name: /task history/i })).toBeNull();
    // Cualquier <h1> dentro del cliente es un leak del header viejo
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("NO renderiza DateRangePicker (movido al AppShell actions)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.queryByTestId("task-history-date-range-picker")).toBeNull();
    expect(screen.queryByTestId("task-history-date-from")).toBeNull();
    expect(screen.queryByTestId("task-history-date-to")).toBeNull();
  });

  it("NO renderiza FilterButton (movido al AppShell actions)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.queryByTestId("task-history-filter-button")).toBeNull();
  });

  it("NO renderiza ScreenshotButton (movido al AppShell actions)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.queryByTestId("task-history-screenshot-button")).toBeNull();
  });

  it("SÍ renderiza el TabSwitcher (sigue siendo parte del cuerpo)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.getByTestId("task-history-tab-switcher")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-tab-map")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-tab-list")).toBeInTheDocument();
  });

  it("SÍ renderiza el HeaderCard con los totales del rango", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.getByTestId("task-history-header-card")).toBeInTheDocument();
  });

  it("SÍ renderiza el DayList con los días del rango", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.getByTestId("task-history-day-list")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-day-card")).toBeInTheDocument();
  });

  it("el contenedor del contenido tiene data-testid='task-history-content' (target del screenshot desde AppShell)", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    // El ScreenshotButton en AppShell actions usa
    // document.querySelector("[data-testid='task-history-content']")
    // para encontrar este contenedor. Si cambia el testid, hay que
    // actualizar el ScreenshotButton's targetSelector en la page.
    expect(screen.getByTestId("task-history-content")).toBeInTheDocument();
  });

  it("renderiza el banner de parcel seleccionado cuando selectedParcelId no es null", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={42}
        totals={TOTALS}
      />
    );
    expect(screen.getByTestId("task-history-selected-banner")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-selected-banner").textContent).toContain("42");
  });

  it("NO renderiza el banner de parcel seleccionado cuando selectedParcelId es null", () => {
    render(
      <TaskHistoryClient
        days={DAYS}
        polygons={POLYGONS}
        selectedParcelId={null}
        totals={TOTALS}
      />
    );
    expect(screen.queryByTestId("task-history-selected-banner")).toBeNull();
  });
});
