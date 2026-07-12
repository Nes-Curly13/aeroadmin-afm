/**
 * Adversarial probe: render the actual components and verify the
 * EXACT contract strings the verifier prompt requires.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock next/navigation para que TabSwitcher no tire "invariant
// expected app router to be mounted" en jsdom.
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

import { HeaderCard } from "@/components/task-history/header-card";
import { DayCard } from "@/components/task-history/day-card";
import { DayList } from "@/components/task-history/day-list";
import { TabSwitcher } from "@/components/task-history/tab-switcher";
import type { TaskHistoryTotals, DayCard as DayCardData } from "@/lib/djiag-from-make/task-history";

describe("Verifier contract — actual HTML output", () => {
  it("HeaderCard: textContent contains '5462.23mu' (no <span> entre medio)", () => {
    const totals: TaskHistoryTotals = {
      areaMu: 5462.23,
      times: 8028,
      liters: 100884.1,
      duration: { hours: 631, minutes: 11, seconds: 23, djiFormat: "631Hour11min23s" }
    };
    const { container } = render(<HeaderCard totals={totals} />);
    // textContent concatena todos los nodos de texto sin tags en medio.
    // Es la forma correcta de testear "qué ve el usuario" cuando hay
    // span/styling envolviendo parte del texto.
    const text = container.textContent ?? "";
    expect(text).toContain("5462.23mu");
    expect(text).toContain("100884.1L");
    expect(text).toContain("631Hour11min23s");
  });

  it("DayCard: textContent contains '2026/07/08' + 'Wednesday' + '18.29mu' + '1Hour44min53s'", () => {
    const day: DayCardData = {
      date: "2026/07/08",
      weekday: "Wednesday",
      areaMu: 18.29,
      times: 22,
      liters: 365.2,
      duration: { hours: 1, minutes: 44, seconds: 53, djiFormat: "1Hour44min53s" }
    };
    const { container } = render(<DayCard day={day} />);
    // textContent concatenates all text nodes — same approach the producer's tests use
    const text = container.textContent ?? "";
    expect(text).toContain("2026/07/08");
    expect(text).toContain("Wednesday");
    expect(text).toContain("18.29mu");
    expect(text).toContain("1Hour44min53s");
  });

  it("DayCard: concatenated title text matches '2026/07/08Wednesday' (no space)", () => {
    const day: DayCardData = {
      date: "2026/07/08",
      weekday: "Wednesday",
      areaMu: 18.29,
      times: 22,
      liters: 365.2,
      duration: { hours: 1, minutes: 44, seconds: 53, djiFormat: "1Hour44min53s" }
    };
    render(<DayCard day={day} />);
    const title = document.querySelector("h3");
    expect(title?.textContent).toMatch(/2026\/07\/08Wednesday/);
  });

  it("DayList empty: contains 'No hay fumigaciones en este rango'", () => {
    const { container } = render(<DayList days={[]} />);
    const html = container.innerHTML;
    expect(html).toContain("No hay fumigaciones en este rango");
  });

  it("TabSwitcher: active tab has class with green (border-#0b5f2d)", () => {
    const { container } = render(<TabSwitcher />);
    const mapTab = screen.getByTestId("task-history-tab-map");
    // Active class contains green
    expect(mapTab.className).toMatch(/(green|#0b5f2d)/i);
    // Inactive tab does NOT have green
    const listTab = screen.getByTestId("task-history-tab-list");
    expect(listTab.className).not.toContain("#0b5f2d");
    // Sanity: it really rendered
    expect(container.querySelectorAll('[role="tablist"]').length).toBe(1);
  });
});
