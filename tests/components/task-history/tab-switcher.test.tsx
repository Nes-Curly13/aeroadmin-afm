/**
 * Tests del TabSwitcher (client component).
 *
 * Mockea `next/navigation` (useRouter, usePathname, useSearchParams).
 * Verifica:
 *   - Render de Map + List
 *   - Active state con clase verde (border-[#0b5f2d])
 *   - Active desde prop `active=` y desde URL `?view=`
 *   - data-active y aria-selected
 *   - role=tablist
 *   - Click llama router.replace con el nuevo href + router.refresh()
 *   - No hace nada si click en el tab ya activo
 *   - Preserva otros query params
 *   - defaultView custom
 *   - Omite `?view=` cuando es el default (URL limpio)
 *   - ariaLabel custom
 *   - Usa el pathname del hook
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mutable state via vi.hoisted
const mockState = vi.hoisted(() => ({
  pathname: "/history",
  searchParams: new URLSearchParams(),
  replaceMock: vi.fn(),
  refreshMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockState.replaceMock,
    refresh: mockState.refreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => mockState.pathname,
  useSearchParams: () => mockState.searchParams
}));

// Import AFTER mock
import { TabSwitcher } from "@/components/task-history/tab-switcher";

beforeEach(() => {
  mockState.pathname = "/history";
  mockState.searchParams = new URLSearchParams();
  mockState.replaceMock.mockClear();
  mockState.refreshMock.mockClear();
});

afterEach(cleanup);

describe("TabSwitcher", () => {
  it("renderiza los tabs Map y List con icono + texto", () => {
    render(<TabSwitcher />);
    expect(screen.getByTestId("task-history-tab-map")).toBeInTheDocument();
    expect(screen.getByTestId("task-history-tab-list")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByText("List")).toBeInTheDocument();
    // Cada tab tiene un SVG (icono)
    const mapSvg = screen.getByTestId("task-history-tab-map").querySelector("svg");
    const listSvg = screen.getByTestId("task-history-tab-list").querySelector("svg");
    expect(mapSvg).not.toBeNull();
    expect(listSvg).not.toBeNull();
  });

  it("el contenedor tiene role=tablist", () => {
    render(<TabSwitcher />);
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeInTheDocument();
    expect(tablist.getAttribute("data-testid")).toBe("task-history-tab-switcher");
  });

  it("por default (sin URL param) 'map' es el tab activo con border verde", () => {
    render(<TabSwitcher />);
    const mapTab = screen.getByTestId("task-history-tab-map");
    const listTab = screen.getByTestId("task-history-tab-list");
    expect(mapTab.getAttribute("data-active")).toBe("true");
    expect(listTab.getAttribute("data-active")).toBe("false");
    expect(mapTab.getAttribute("aria-selected")).toBe("true");
    expect(listTab.getAttribute("aria-selected")).toBe("false");
    expect(mapTab.className).toContain("border-[#0b5f2d]");
    expect(mapTab.className).toContain("text-[#0b5f2d]");
  });

  it("lee el tab activo desde ?view=list en el URL", () => {
    mockState.searchParams = new URLSearchParams("view=list");
    render(<TabSwitcher />);
    expect(screen.getByTestId("task-history-tab-list").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("task-history-tab-map").getAttribute("data-active")).toBe("false");
  });

  it("acepta un active prop que sobrescribe el URL", () => {
    mockState.searchParams = new URLSearchParams("view=list");
    render(<TabSwitcher active="map" />);
    expect(screen.getByTestId("task-history-tab-map").getAttribute("data-active")).toBe("true");
  });

  it("acepta un defaultView custom", () => {
    render(<TabSwitcher defaultView="list" />);
    expect(screen.getByTestId("task-history-tab-list").getAttribute("data-active")).toBe("true");
  });

  it("ignora valores invalidos de ?view= y cae al default", () => {
    mockState.searchParams = new URLSearchParams("view=invalid");
    render(<TabSwitcher />);
    expect(screen.getByTestId("task-history-tab-map").getAttribute("data-active")).toBe("true");
  });

  it("click en el tab inactivo llama router.replace con el nuevo href", async () => {
    const user = userEvent.setup();
    render(<TabSwitcher />);
    await user.click(screen.getByTestId("task-history-tab-list"));
    expect(mockState.replaceMock).toHaveBeenCalledTimes(1);
    const [href, opts] = mockState.replaceMock.mock.calls[0];
    expect(href).toBe("/history?view=list");
    expect(opts).toEqual({ scroll: false });
  });

  it("click en el tab inactivo llama router.refresh() despues de replace", async () => {
    const user = userEvent.setup();
    render(<TabSwitcher />);
    await user.click(screen.getByTestId("task-history-tab-list"));
    expect(mockState.refreshMock).toHaveBeenCalledTimes(1);
  });

  it("click en el tab ya activo no llama replace ni refresh", async () => {
    const user = userEvent.setup();
    render(<TabSwitcher />);
    // 'map' es el active por default
    await user.click(screen.getByTestId("task-history-tab-map"));
    expect(mockState.replaceMock).not.toHaveBeenCalled();
    expect(mockState.refreshMock).not.toHaveBeenCalled();
  });

  it("preserva otros query params al cambiar de tab", async () => {
    mockState.searchParams = new URLSearchParams("from=2026-07-01&to=2026-07-12");
    const user = userEvent.setup();
    render(<TabSwitcher />);
    await user.click(screen.getByTestId("task-history-tab-list"));
    const [href] = mockState.replaceMock.mock.calls[0];
    expect(href).toContain("from=2026-07-01");
    expect(href).toContain("to=2026-07-12");
    expect(href).toContain("view=list");
  });

  it("omite ?view= cuando el target es el default (URL limpio)", async () => {
    // Partimos de view=list para que el active sea 'list' y hacer click en 'map' (default) haga replace
    mockState.searchParams = new URLSearchParams("view=list");
    const user = userEvent.setup();
    render(<TabSwitcher defaultView="map" />);
    // Al cargar con view=list, currentView=list, el active es list
    // Click en 'map' (default) -> deberia llamar replace sin ?view=
    await user.click(screen.getByTestId("task-history-tab-map"));
    expect(mockState.replaceMock).toHaveBeenCalledTimes(1);
    const [href] = mockState.replaceMock.mock.calls[0];
    expect(href).not.toContain("view=");
  });

  it("usa el pathname del hook para construir el href", async () => {
    mockState.pathname = "/task/history";
    const user = userEvent.setup();
    render(<TabSwitcher />);
    await user.click(screen.getByTestId("task-history-tab-list"));
    const [href] = mockState.replaceMock.mock.calls[0];
    expect(href).toMatch(/^\/task\/history/);
  });

  it("acepta un ariaLabel custom", () => {
    render(<TabSwitcher ariaLabel="Mi tab" />);
    expect(screen.getByLabelText("Mi tab")).toBeInTheDocument();
  });

  it("los iconos SVG tienen aria-hidden=true", () => {
    const { container } = render(<TabSwitcher />);
    const svgs = container.querySelectorAll("svg");
    for (const svg of Array.from(svgs)) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
