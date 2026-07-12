/**
 * Tests basicos de los interactive controls del Task History.
 * Valida shape de los types y exportabilidad. Los tests de
 * integracion visual van en tests/e2e/task-history.spec.ts.
 */
import { describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "@/components/task-history/date-range-picker";
import { FilterButton } from "@/components/task-history/filter-button";
import { ScreenshotButton } from "@/components/task-history/screenshot-button";

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

describe("DateRangePicker", () => {
  it("is exported", () => {
    expect(typeof DateRangePicker).toBe("function");
  });
});

describe("FilterButton", () => {
  it("is exported", () => {
    expect(typeof FilterButton).toBe("function");
  });
});

describe("ScreenshotButton", () => {
  it("is exported", () => {
    expect(typeof ScreenshotButton).toBe("function");
  });
});
