/**
 * Tests del TaskHistoryClient (v1.7 Track C).
 *
 * Después del refactor de v1.7 Track C, el TaskHistoryClient:
 *   - NO renderiza su propio header (movido al AppShell).
 *   - NO renderiza DateRangePicker, FilterButton, ni ScreenshotButton
 *     (movidos al TaskHistorySidebar).
 *   - SÍ renderiza el TabSwitcher (sigue siendo parte del body).
 *   - SÍ renderiza el MapView a la izquierda (~60% del ancho).
 *   - SÍ renderiza el TaskHistorySidebar a la derecha (~40% del ancho),
 *     que contiene los filtros + la lista de DayCards con sub-lista.
 *
 * El test sigue usando data-testid para localizar elementos y mockea
 * el MapView (Leaflet no carga en jsdom).
 *
 * Patrón de assertion: `getByTestId` para los elementos que esperamos
 * y `queryByTestId` para los que NO esperamos.
 */
import { render, screen, within } from "@testing-library/react";
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
  DayCardWithFlights
} from "@/lib/djiag-from-make/task-history";
import type { NormalizedFumigationDay } from "@/lib/djiag-fumigations-fetcher";
import type { MapPolygon } from "@/components/task-history/map-view";

function makeNormalizedDay(
  overrides: Partial<NormalizedFumigationDay> = {}
): NormalizedFumigationDay {
  return {
    createTimestamp: 1788892800,
    date: "2026-07-08",
    workAreaM2: 12193,
    workTimeSec: 6293,
    workTimeMin: 105,
    sortieCount: 22,
    sprayUsageMl: 365200,
    sprayUsageL: 365.2,
    doseLPerHa: 1.5,
    hasAgriculture: true,
    ...overrides
  };
}

const DAY_A: NormalizedFumigationDay = makeNormalizedDay();
const DAY_B: NormalizedFumigationDay = makeNormalizedDay({ date: "2026-07-07" });

const ENRICHED: DayCardWithFlights[] = [
  { day: DAY_A, flights: [] },
  { day: DAY_B, flights: [] }
];

const POLYGONS: MapPolygon[] = [];

afterEach(() => {
  vi.clearAllMocks();
});

describe("TaskHistoryClient — v1.7 Track C layout", () => {
  it("NO renderiza el h1 'Task History' (movido al AppShell)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.queryByRole("heading", { name: /task history/i })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("NO renderiza DateRangePicker en el body (movido al sidebar)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    // v1.7: el DateRangePicker se movio al sidebar. Verificamos que
    // esta dentro del sidebar (NO duplicado en el body).
    const sidebar = screen.getByTestId("task-history-sidebar");
    expect(
      within(sidebar).getByTestId("task-history-date-range-picker")
    ).toBeInTheDocument();
    // Y NO hay un DateRangePicker suelto fuera del sidebar.
    // Buscamos por todo el documento y contamos ocurrencias:
    // debe haber exactamente 1 (dentro del sidebar).
    const all = screen.queryAllByTestId("task-history-date-range-picker");
    expect(all).toHaveLength(1);
  });

  it("NO renderiza FilterButton (reemplazado por inputs inline en el sidebar)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.queryByTestId("task-history-filter-button")).toBeNull();
  });

  it("SÍ renderiza el ScreenshotButton (movido al sidebar pero presente en la page)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    // ScreenshotButton está en la sidebar (que vive adentro del client).
    expect(screen.getByTestId("task-history-screenshot-button")).toBeInTheDocument();
  });

  it("SÍ renderiza el TabSwitcher (sigue siendo parte del cuerpo)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.getByTestId("task-history-tab-switcher")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-tab-map")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-tab-list")).toBeInTheDocument();
  });

  it("SÍ renderiza el MapView a la izquierda", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.getByTestId("task-history-map-mock")).toBeInTheDocument();
  });

  it("SÍ renderiza la sidebar (FilterSidebar container)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.getByTestId("task-history-sidebar")).toBeInTheDocument();
  });

  it("SÍ renderiza los FilterSidebarSections (Periodo, Drones, Piloto, Parcela)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={["1581F5BKD23100045"]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.getByTestId("task-history-sidebar-section-period")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-sidebar-section-drone")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-sidebar-section-pilot")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-sidebar-section-parcel")).toBeInTheDocument();
  });

  it("SÍ renderiza los DayCards en el scrollable panel", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    // El sidebar renderiza los DayCards con sub-lista.
    const cards = screen.getAllByTestId("task-history-day-card");
    expect(cards).toHaveLength(2);
    // El contenedor de la lista tiene data-testid.
    expect(screen.getByTestId("task-history-day-list")).toBeInTheDocument();
    // El ScrollablePanel envuelve la lista.
    expect(screen.getByTestId("task-history-sidebar-items")).toBeInTheDocument();
  });

  it("el contenedor del contenido tiene data-testid='task-history-content' (target del screenshot)", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    // El ScreenshotButton usa
    // document.querySelector("[data-testid='task-history-content']")
    // para encontrar este contenedor.
    expect(screen.getByTestId("task-history-content")).toBeInTheDocument();
  });

  it("renderiza el banner de parcel seleccionado cuando selectedParcelId no es null", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={42}
        to="2026-07-15"
      />
    );
    const banner = screen.getByTestId("task-history-selected-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("42");
  });

  it("NO renderiza el banner de parcel seleccionado cuando selectedParcelId es null", () => {
    render(
      <TaskHistoryClient
        days={ENRICHED}
        droneSuggestions={[]}
        from="2026-01-01"
        parcelNameById={new Map()}
        polygons={POLYGONS}
        selectedParcelId={null}
        to="2026-07-15"
      />
    );
    expect(screen.queryByTestId("task-history-selected-banner")).toBeNull();
  });
});
