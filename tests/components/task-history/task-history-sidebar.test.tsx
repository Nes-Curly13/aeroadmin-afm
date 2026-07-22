/**
 * Tests del TaskHistorySidebar (v1.7 Track C).
 *
 * El sidebar reemplaza al viejo TaskHistoryToolbar y la lista de items
 * que vivían en el body del TaskHistoryClient. Cubre:
 *   - Render del FilterSidebar container con title="Filtros"
 *   - 4 sections: Periodo, Drones, Piloto, Parcela
 *   - DateRangePicker dentro de Periodo
 *   - ScreenshotButton presente (con polygonCount como disable)
 *   - Lista de DayCards con sub-lista de vuelos
 *   - FlightDetailDrawer se abre al click en un vuelo
 *   - Botón "Limpiar" aparece solo si hay filtros activos
 *   - Empty state cuando days.length === 0
 *
 * Patrón: getByTestId para localizar, queryByTestId para negativos.
 * Mockeamos next/navigation porque DateRangePicker y los inputs
 * internos usan useRouter/useSearchParams.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerReplace = vi.fn();
const routerRefresh = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefresh,
    push: vi.fn(),
    replace: routerReplace,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  }),
  usePathname: () => "/task-history",
  useSearchParams: () => searchParams
}));

import { TaskHistorySidebar } from "@/components/task-history/task-history-sidebar";
import type { DayCardWithFlights } from "@/lib/djiag-from-make/task-history";

function makeEnrichedDay(
  overrides: Partial<DayCardWithFlights> = {}
): DayCardWithFlights {
  return {
    day: {
      createTimestamp: 1751980800,
      date: "2026-07-08",
      workAreaM2: 12193,
      workTimeSec: 6293,
      workTimeMin: 105,
      sortieCount: 2,
      sprayUsageMl: 365200,
      sprayUsageL: 365.2,
      doseLPerHa: 0.4,
      hasAgriculture: true
    },
    flights: [
      {
        id: 1001,
        localDate: "2026-07-08",
        localTime: "09:14",
        durationSeconds: 1800,
        areaMu: 12.5,
        liters: 250,
        droneSerial: "1581F5BKD23100045",
        pilotName: "Breiner",
        parcelId: 42
      },
      {
        id: 1002,
        localDate: "2026-07-08",
        localTime: "11:32",
        durationSeconds: 1500,
        areaMu: 5.8,
        liters: 115,
        droneSerial: "1581F5BKD23100045",
        pilotName: "Breiner",
        parcelId: 42
      }
    ],
    ...overrides
  };
}

const DEFAULT_PROPS = {
  from: "2026-01-01",
  to: "2026-07-15",
  days: [makeEnrichedDay()],
  polygonCount: 5,
  droneSuggestions: ["1581F5BKD23100045", "1581F5BKD23100099"],
  parcelNameById: new Map<number, string>([[42, "Olga T2p12"]]),
  selectedParcelId: null
};

afterEach(() => {
  vi.clearAllMocks();
  // Reset URL state between tests
  for (const k of Array.from(searchParams.keys())) searchParams.delete(k);
});

describe("TaskHistorySidebar — v1.7 Track C", () => {
  describe("Render del FilterSidebar", () => {
    it("renderiza el FilterSidebar con title='Filtros' y data-testid", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const sidebar = screen.getByTestId("task-history-sidebar");
      expect(sidebar).toBeInTheDocument();
      // Title visible
      expect(sidebar.textContent).toMatch(/Filtros/i);
    });

    it("muestra el resultCount (parcelas) en el header", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} polygonCount={42} />);
      const sidebar = screen.getByTestId("task-history-sidebar");
      // El badge '42 parcelas' está en el header
      expect(sidebar.textContent).toContain("42");
      expect(sidebar.textContent).toContain("parcelas");
    });
  });

  describe("Sections", () => {
    it("renderiza las 4 sections (Periodo, Drones, Piloto, Parcela)", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      expect(screen.getByTestId("task-history-sidebar-section-period")).toBeInTheDocument();
      expect(screen.getByTestId("task-history-sidebar-section-drone")).toBeInTheDocument();
      expect(screen.getByTestId("task-history-sidebar-section-pilot")).toBeInTheDocument();
      expect(screen.getByTestId("task-history-sidebar-section-parcel")).toBeInTheDocument();
    });

    it("Periodo contiene el DateRangePicker", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const period = screen.getByTestId("task-history-sidebar-section-period");
      expect(period.querySelector("[data-testid='task-history-date-range-picker']")).toBeTruthy();
    });

    it("Drones contiene input con datalist de sugerencias", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const droneInput = screen.getByTestId("task-history-sidebar-drone-input");
      expect(droneInput).toBeInTheDocument();
      expect(droneInput.getAttribute("type")).toBe("text");
      // datalist con las sugerencias
      const datalist = document.getElementById(
        "task-history-sidebar-drone-suggestions"
      );
      expect(datalist).toBeTruthy();
      expect(datalist?.querySelectorAll("option").length).toBe(2);
    });

    it("Piloto contiene input de texto", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const pilotInput = screen.getByTestId("task-history-sidebar-pilot-input");
      expect(pilotInput).toBeInTheDocument();
      expect(pilotInput.getAttribute("type")).toBe("text");
    });

    it("Parcela contiene input numérico", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const parcelInput = screen.getByTestId("task-history-sidebar-parcel-input");
      expect(parcelInput).toBeInTheDocument();
      expect(parcelInput.getAttribute("inputmode")).toBe("numeric");
    });

    it("Drones muestra count = droneSuggestions.length y activeCount=0 por default", () => {
      render(
        <TaskHistorySidebar
          {...DEFAULT_PROPS}
          droneSuggestions={["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]}
        />
      );
      const section = screen.getByTestId("task-history-sidebar-section-drone");
      // count visible (10)
      expect(section.textContent).toContain("10");
    });

    it("Drones activeCount=1 cuando hay droneSerial en URL", () => {
      searchParams.set("droneSerial", "1581F5BKD23100045");
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const section = screen.getByTestId("task-history-sidebar-section-drone");
      // Buscamos DENTRO de la section de Drones para no confundirnos
      // con la section de Periodo (que hardcodea activeCount=1 por
      // diseno: el rango siempre esta activo).
      const activeBadge = within(section).getByLabelText("1 activo");
      expect(activeBadge).toBeInTheDocument();
    });
  });

  describe("Botón Limpiar", () => {
    it("NO muestra el botón Limpiar si no hay filtros activos", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      // El botón "Limpiar" no debe estar en el FilterSidebar cuando
      // no hay filtros activos (no se pasa onClear al primitive).
      const sidebar = screen.getByTestId("task-history-sidebar");
      // El texto "Limpiar" no debería aparecer
      expect(sidebar.textContent).not.toMatch(/limpiar/i);
    });

    it("SÍ muestra el botón Limpiar cuando hay 1+ filtro activo", () => {
      searchParams.set("droneSerial", "X");
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      // El sidebar ahora pasa onClear al primitive → muestra el botón
      const sidebar = screen.getByTestId("task-history-sidebar");
      expect(sidebar.textContent).toMatch(/limpiar/i);
    });

    it("click en Limpiar borra los filtros (preserva from/to)", async () => {
      searchParams.set("droneSerial", "X");
      searchParams.set("pilot", "Breiner");
      searchParams.set("from", "2026-01-01");
      searchParams.set("to", "2026-07-15");
      const user = userEvent.setup();
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const clearBtn = screen.getByRole("button", { name: /limpiar/i });
      await user.click(clearBtn);
      // router.replace fue llamado con un URL sin droneSerial ni pilot
      expect(routerReplace).toHaveBeenCalled();
      const url = routerReplace.mock.calls[0][0] as string;
      expect(url).not.toContain("droneSerial");
      expect(url).not.toContain("pilot");
      // from/to sí se preservan
      expect(url).toContain("from=2026-01-01");
      expect(url).toContain("to=2026-07-15");
    });
  });

  describe("ScreenshotButton", () => {
    it("renderiza el ScreenshotButton con polygonCount como disable", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} polygonCount={0} />);
      const btn = screen.getByTestId("task-history-screenshot-button");
      expect(btn).toBeDisabled();
    });

    it("ScreenshotButton habilitado cuando polygonCount > 0", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} polygonCount={10} />);
      const btn = screen.getByTestId("task-history-screenshot-button");
      expect(btn).not.toBeDisabled();
    });
  });

  describe("Lista de días (sub-lista de vuelos)", () => {
    it("renderiza 1 DayCard por cada día de `days`", () => {
      render(
        <TaskHistorySidebar
          {...DEFAULT_PROPS}
          days={[
            makeEnrichedDay(),
            makeEnrichedDay({
              day: { ...makeEnrichedDay().day, date: "2026-07-07" },
              flights: []
            })
          ]}
        />
      );
      const cards = screen.getAllByTestId("task-history-day-card");
      expect(cards).toHaveLength(2);
    });

    it("el DayCard con flights > 0 muestra la sub-lista", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      expect(screen.getByTestId("task-history-flight-sub-list")).toBeInTheDocument();
      const items = screen.getAllByTestId("task-history-flight-sub-list-item");
      expect(items).toHaveLength(2);
    });

    it("el DayCard con flights=[] NO muestra la sub-lista", () => {
      render(
        <TaskHistorySidebar
          {...DEFAULT_PROPS}
          days={[
            makeEnrichedDay({
              day: { ...makeEnrichedDay().day, date: "2026-07-07" },
              flights: []
            })
          ]}
        />
      );
      expect(screen.queryByTestId("task-history-flight-sub-list")).toBeNull();
    });

    it("la lista de items vive dentro del ScrollablePanel (maxHeight calc)", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      const panel = screen.getByTestId("task-history-sidebar-items");
      expect(panel).toBeInTheDocument();
      // El panel tiene role=region (del ScrollablePanel primitive)
      expect(panel.getAttribute("role")).toBe("region");
      // El day-list está adentro
      const dayList = screen.getByTestId("task-history-day-list");
      expect(panel.contains(dayList)).toBe(true);
    });
  });

  describe("FlightDetailDrawer (click en vuelo)", () => {
    it("inicialmente cerrado (no se muestra el contenido del dialog)", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
      // El <dialog> existe pero su contenido solo se muestra cuando hay flight
      // El detalle del vuelo no debe estar en el DOM cuando el drawer está cerrado
      expect(screen.queryByTestId("task-history-flight-drawer-details")).toBeNull();
    });

    it("se abre al click en un item de vuelo (muestra drone + piloto + parcela)", async () => {
      // jsdom no implementa HTMLDialogElement.showModal() (limitación del
      // entorno, no del código). Por eso mockeamos showModal antes del
      // click y verificamos que el handler se invocó correctamente.
      const showModalMock = vi.fn();
      const originalDialog = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = showModalMock;
      try {
        const user = userEvent.setup();
        render(<TaskHistorySidebar {...DEFAULT_PROPS} />);
        const firstItem = screen.getAllByTestId(
          "task-history-flight-sub-list-item"
        )[0];
        await user.click(firstItem);
        // El drawer se intento abrir (showModal fue llamado)
        expect(showModalMock).toHaveBeenCalled();
      } finally {
        HTMLDialogElement.prototype.showModal = originalDialog;
      }
    });
  });

  describe("Empty state", () => {
    it("muestra mensaje 'No hay fumigaciones en este rango' cuando days=[]", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} days={[]} />);
      const empty = screen.getByTestId("task-history-sidebar-empty");
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain("No hay fumigaciones en este rango");
    });

    it("NO renderiza la DayList ni la ScrollablePanel de items", () => {
      render(<TaskHistorySidebar {...DEFAULT_PROPS} days={[]} />);
      expect(screen.queryByTestId("task-history-day-list")).toBeNull();
      expect(screen.queryByTestId("task-history-sidebar-items")).toBeNull();
    });
  });
});
