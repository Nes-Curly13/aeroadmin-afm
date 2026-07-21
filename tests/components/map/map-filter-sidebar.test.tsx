/**
 * Tests del sidebar de filtros del mapa (v1.7 Track B).
 *
 * Reemplaza a `tests/components/map/map-filters-panel.test.tsx` (v1.3
 * Track A), que testeba el panel horizontal arriba del mapa. La nueva
 * versión (v1.7) vive como sidebar a la derecha del mapa, dentro de un
 * `<FilterSidebar>` primitive con 3 `<FilterSidebarSection>` (uno por
 * filtro).
 *
 * Decisiones cubiertas por los tests:
 *   1. Render con drones disponibles en el select (derivado de summary).
 *   2. Render vacío (sin drones) sigue siendo usable — selects con la
 *      opción "Todos" como default.
 *   3. Lee los searchParams actuales y los refleja en los selects.
 *   4. Cambiar un select navega con router.push() preservando los
 *      otros params y con scroll:false (no perdemos posición de scroll).
 *   5. Botón "Limpiar filtros" del sidebar navega a /map sin params.
 *   6. Accessibility: cada select tiene label accesible.
 *   7. Fumigated tiene 3 opciones: yes / no / (omit = todos).
 *   8. El sidebar muestra el resultado con `resultCount` y `resultLabel`.
 *   9. Cada section muestra el `count` y (cuando hay filtro) el
 *      `activeCount` como badge.
 *
 * Patrón: mock de next/navigation (useRouter, useSearchParams,
 * usePathname) con control per-test. Mismo patrón que la versión v1.3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Estado mockeado de next/navigation. Declarado vía vi.hoisted para que
// los mocks puedan leerlo antes de que se ejecute el import del componente.
const mockState = vi.hoisted(() => ({
  pushMock: vi.fn(),
  // Lo que useSearchParams() devuelve (mutable por test).
  searchParams: new URLSearchParams(),
  pathname: "/map"
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockState.pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  }),
  usePathname: () => mockState.pathname,
  useSearchParams: () => mockState.searchParams
}));

import { MapFilterSidebar } from "@/components/map/map-filter-sidebar";

/**
 * Fila mínima de summary de parcelas — solo necesitamos
 * `drone_model_code` + `drone_model_name` para popular el select.
 */
function makeSummaryRow(over: { drone_model_code: number | null; drone_model_name: string | null; count_by_drone: string }): {
  total_parcels: string;
  total_orchards: string;
  total_farmlands: string;
  total_spray_area_m2: string | null;
  avg_spray_area_m2: string | null;
  drone_model_code: number | null;
  drone_model_name: string | null;
  count_by_drone: string;
} {
  return {
    total_parcels: "200",
    total_orchards: "20",
    total_farmlands: "180",
    total_spray_area_m2: "1500000",
    avg_spray_area_m2: "7500",
    ...over
  };
}

const DEFAULT_SUMMARY = [
  makeSummaryRow({ drone_model_code: 201, drone_model_name: "Agras T40", count_by_drone: "120" }),
  makeSummaryRow({ drone_model_code: 202, drone_model_name: "Agras T50", count_by_drone: "60" }),
  makeSummaryRow({ drone_model_code: 72, drone_model_name: "MG-1P", count_by_drone: "20" })
];

describe("MapFilterSidebar — v1.7 Track B", () => {
  beforeEach(() => {
    // Cada test arranca con searchParams vacío y mocks limpios.
    mockState.searchParams = new URLSearchParams();
    mockState.pathname = "/map";
    mockState.pushMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza el sidebar con titulo y resultado", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    // Titulo del sidebar (heading h2)
    expect(
      screen.getByRole("heading", { name: "Filtros del mapa" })
    ).toBeInTheDocument();
    // Badge de resultado: aria-label "47 parcelas"
    expect(screen.getByLabelText("47 parcelas")).toBeInTheDocument();
  });

  it("renderiza los 3 sections con titulos accesibles", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    // 3 sections, uno por filtro. Cada uno es un <h3> con su titulo.
    expect(screen.getByRole("heading", { name: "Drones" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cultivo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Fumigadas \(6m\)/i })).toBeInTheDocument();
  });

  it("renderiza los 3 selects con labels accesibles", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(3);

    expect(screen.getByRole("combobox", { name: /drone/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /cultivo/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /fumigaci[oó]n/i })).toBeInTheDocument();
  });

  it("el section de drones muestra el count de opciones del select", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    // 3 drones únicos. El section lo muestra como "3" al lado del titulo.
    const dronesSection = screen.getByTestId("map-filter-section-drones");
    expect(dronesSection).toBeInTheDocument();
    // El count aparece como un span dentro del header del section.
    expect(dronesSection).toHaveTextContent("3");
  });

  it("el section de cultivo muestra count=2 (Farmland + Orchards)", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const cropSection = screen.getByTestId("map-filter-section-crop");
    expect(cropSection).toBeInTheDocument();
    expect(cropSection).toHaveTextContent("2");
  });

  it("el section fumigated NO muestra count, solo activeCount cuando hay filtro", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const fumSection = screen.getByTestId("map-filter-section-fumigated");
    expect(fumSection).toBeInTheDocument();
    // Sin filtro activo: NO debe haber badge "activo" ni count textual
    // numérico (el section no recibe `count`, solo `activeCount`).
    expect(fumSection).not.toHaveTextContent(/\b1\b/);
    expect(fumSection).not.toHaveTextContent(/\b2\b/);
  });

  it("el section fumigated muestra activeCount=1 cuando fumigated=yes", () => {
    mockState.searchParams = new URLSearchParams("fumigated=yes");
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    // Solo el section fumigated tiene activeCount=1.
    const activeBadges = screen.getAllByLabelText("1 activo");
    expect(activeBadges).toHaveLength(1);
  });

  it("muestra activeCount=1 en el section correspondiente cuando hay filtro", () => {
    mockState.searchParams = new URLSearchParams("drone=202&crop=Orchards&fumigated=yes");

    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    // 3 sections, cada uno con activeCount=1 → 3 badges "activo"
    const activeBadges = screen.getAllByLabelText("1 activo");
    expect(activeBadges).toHaveLength(3);
  });

  it("NO muestra badge active cuando activeCount=0 (sin filtros)", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    expect(screen.queryByLabelText(/activo/i)).toBeNull();
  });

  it("el select de drones lista los drones del summary + opción 'Todos'", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;

    // 3 drones + "Todos" = 4 options
    expect(droneSelect.options.length).toBe(4);
    expect(droneSelect.options[0].value).toBe("");
    expect(droneSelect.options[0].text).toMatch(/Todos/);
    // Ordenados por nombre (Agras T40, Agras T50, MG-1P).
    expect(droneSelect.options[1].text).toMatch(/Agras T40/);
    expect(droneSelect.options[2].text).toMatch(/Agras T50/);
    expect(droneSelect.options[3].text).toMatch(/MG-1P/);
  });

  it("el select de cultivo tiene solo Farmland + Orchards + 'Todos'", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const cropSelect = screen.getByRole("combobox", { name: /cultivo/i }) as HTMLSelectElement;
    expect(cropSelect.options.length).toBe(3);
    expect(cropSelect.options[0].value).toBe("");
    expect(cropSelect.options[1].value).toBe("Farmland");
    expect(cropSelect.options[2].value).toBe("Orchards");
  });

  it("el select de fumigación tiene yes / no / 'Todos' (omit)", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const fumSelect = screen.getByRole("combobox", { name: /fumigaci[oó]n/i }) as HTMLSelectElement;
    expect(fumSelect.options.length).toBe(3);
    expect(fumSelect.options[0].value).toBe("");
    expect(fumSelect.options[1].value).toBe("yes");
    expect(fumSelect.options[2].value).toBe("no");
  });

  it("default values son vacíos (sin searchParams)", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;
    const cropSelect = screen.getByRole("combobox", { name: /cultivo/i }) as HTMLSelectElement;
    const fumSelect = screen.getByRole("combobox", { name: /fumigaci[oó]n/i }) as HTMLSelectElement;

    expect(droneSelect.value).toBe("");
    expect(cropSelect.value).toBe("");
    expect(fumSelect.value).toBe("");
  });

  it("lee los searchParams actuales y los refleja en los selects", () => {
    // El usuario llegó a /map?drone=202&crop=Orchards&fumigated=yes
    mockState.searchParams = new URLSearchParams("drone=202&crop=Orchards&fumigated=yes");

    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);

    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;
    const cropSelect = screen.getByRole("combobox", { name: /cultivo/i }) as HTMLSelectElement;
    const fumSelect = screen.getByRole("combobox", { name: /fumigaci[oó]n/i }) as HTMLSelectElement;

    expect(droneSelect.value).toBe("202");
    expect(cropSelect.value).toBe("Orchards");
    expect(fumSelect.value).toBe("yes");
  });

  it("cambiar el select de drone navega con router.push y scroll:false", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;

    fireEvent.change(droneSelect, { target: { value: "201" } });

    expect(mockState.pushMock).toHaveBeenCalledTimes(1);
    const [url, options] = mockState.pushMock.mock.calls[0];
    expect(url).toContain("/map");
    expect(url).toContain("drone=201");
    expect(options).toEqual({ scroll: false });
  });

  it("cambiar el select de crop preserva el filtro de drone existente", () => {
    mockState.searchParams = new URLSearchParams("drone=202");

    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const cropSelect = screen.getByRole("combobox", { name: /cultivo/i }) as HTMLSelectElement;

    fireEvent.change(cropSelect, { target: { value: "Orchards" } });

    expect(mockState.pushMock).toHaveBeenCalledTimes(1);
    const [url] = mockState.pushMock.mock.calls[0];
    expect(url).toContain("drone=202");
    expect(url).toContain("crop=Orchards");
  });

  it("cambiar el select de fumigated a 'no' navega con fumigated=no", () => {
    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const fumSelect = screen.getByRole("combobox", { name: /fumigaci[oó]n/i }) as HTMLSelectElement;

    fireEvent.change(fumSelect, { target: { value: "no" } });

    expect(mockState.pushMock).toHaveBeenCalledTimes(1);
    const [url] = mockState.pushMock.mock.calls[0];
    expect(url).toContain("fumigated=no");
  });

  it("botón 'Limpiar filtros' del sidebar navega a /map sin query params", () => {
    mockState.searchParams = new URLSearchParams("drone=202&crop=Orchards&fumigated=yes");

    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const clearButton = screen.getByRole("button", { name: /limpiar filtros/i });
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);

    expect(mockState.pushMock).toHaveBeenCalledTimes(1);
    const [url, options] = mockState.pushMock.mock.calls[0];
    // El path solo, sin query string.
    expect(url).toBe("/map");
    // Sigue siendo scroll:false para consistencia.
    expect(options).toEqual({ scroll: false });
  });

  it("renderiza con summary vacío (sin drones) — el select queda con solo 'Todos'", () => {
    render(<MapFilterSidebar resultCount={0} summary={[]} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;
    expect(droneSelect.options.length).toBe(1);
    expect(droneSelect.options[0].value).toBe("");
  });

  it("deduplica drones por drone_model_code (no se repiten en el select)", () => {
    // Caso real: el summary agrupa por (drone_model_code, drone_model_name)
    // pero si la BD tiene NULL en code, podemos terminar con 2 filas para
    // el mismo dron. El sidebar debe deduplicar por code (que es el filter key).
    const summaryWithDup = [
      makeSummaryRow({ drone_model_code: 201, drone_model_name: "Agras T40", count_by_drone: "100" }),
      makeSummaryRow({ drone_model_code: 201, drone_model_name: "Agras T40 (otro lote)", count_by_drone: "20" }),
      makeSummaryRow({ drone_model_code: 202, drone_model_name: "Agras T50", count_by_drone: "30" })
    ];

    render(<MapFilterSidebar resultCount={47} summary={summaryWithDup} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;
    // 2 codes únicos + "Todos" = 3 options
    expect(droneSelect.options.length).toBe(3);
  });

  it("omite filas con drone_model_code null del select (no se puede filtrar por null)", () => {
    const summaryWithNull = [
      makeSummaryRow({ drone_model_code: 201, drone_model_name: "Agras T40", count_by_drone: "100" }),
      makeSummaryRow({ drone_model_code: null, drone_model_name: "Sin asignar", count_by_drone: "20" })
    ];

    render(<MapFilterSidebar resultCount={47} summary={summaryWithNull} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;
    // Solo Agras T40 (code no null) + "Todos" = 2 options
    expect(droneSelect.options.length).toBe(2);
  });

  it("vuelve a la opción 'Todos' si el usuario selecciona el value vacío (clear individual)", () => {
    // Caso: el usuario filtró por drone, después quiere quitar SOLO ese filtro.
    mockState.searchParams = new URLSearchParams("drone=202");

    render(<MapFilterSidebar resultCount={47} summary={DEFAULT_SUMMARY} />);
    const droneSelect = screen.getByRole("combobox", { name: /drone/i }) as HTMLSelectElement;

    fireEvent.change(droneSelect, { target: { value: "" } });

    // La URL debe quedar sin el param "drone".
    expect(mockState.pushMock).toHaveBeenCalledTimes(1);
    const [url] = mockState.pushMock.mock.calls[0];
    expect(url).not.toContain("drone=");
  });
});
