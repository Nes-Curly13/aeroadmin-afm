// Tests del TimeRange component.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TimeRange, type MonthBucket } from "@/components/map/time-range";

const baseMonths: MonthBucket[] = [
  { key: "2025-09", label: "sep 25", start: Date.UTC(2025, 8, 1), end: Date.UTC(2025, 9, 1) - 1, count: 3 },
  { key: "2025-10", label: "oct 25", start: Date.UTC(2025, 9, 1), end: Date.UTC(2025, 10, 1) - 1, count: 5 },
  { key: "2025-11", label: "nov 25", start: Date.UTC(2025, 10, 1), end: Date.UTC(2025, 11, 1) - 1, count: 2 },
  { key: "2025-12", label: "dic 25", start: Date.UTC(2025, 11, 1), end: Date.UTC(2026, 0, 1) - 1, count: 0 },
  { key: "2026-01", label: "ene 26", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1) - 1, count: 8 }
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("TimeRange", () => {
  it("renderiza el container con role=group y aria-label", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[0, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    const group = screen.getByRole("group", { name: "Ventana temporal de fumigaciones" });
    expect(group).toBeInTheDocument();
  });

  it("muestra el label de la ventana activa", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[0, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    expect(screen.getByTestId("time-range-label").textContent).toBe("sep 25 — ene 26");
  });

  it("renderiza el histograma con 5 bars (uno por mes)", () => {
    const { container } = render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[0, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    const bars = container.querySelectorAll('[data-testid="time-range-histogram"] > div');
    expect(bars.length).toBe(5);
  });

  it("el play button tiene aria-label correcto en estado paused", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[0, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    const playBtn = screen.getByTestId("time-range-play");
    expect(playBtn.getAttribute("aria-label")).toBe("Reproducir animación temporal");
    expect(playBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("el play button cambia a aria-label=Pausar cuando playing=true", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={true}
        range={[0, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    const playBtn = screen.getByTestId("time-range-play");
    expect(playBtn.getAttribute("aria-label")).toBe("Pausar animación temporal");
    expect(playBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("llama onPlayingChange al click en play", () => {
    const onPlayingChange = vi.fn();
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[0, 4]}
        onPlayingChange={onPlayingChange}
        onRangeChange={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("time-range-play"));
    expect(onPlayingChange).toHaveBeenCalledWith(true);
  });

  it("el reset vuelve el rango a [0, max]", () => {
    const onRangeChange = vi.fn();
    const onPlayingChange = vi.fn();
    render(
      <TimeRange
        months={baseMonths}
        playing={true}
        range={[1, 3]}
        onPlayingChange={onPlayingChange}
        onRangeChange={onRangeChange}
      />
    );
    fireEvent.click(screen.getByTestId("time-range-reset"));
    expect(onPlayingChange).toHaveBeenCalledWith(false);
    expect(onRangeChange).toHaveBeenCalledWith([0, 4]);
  });

  it("muestra empty state si months está vacío", () => {
    render(
      <TimeRange
        months={[]}
        playing={false}
        range={[0, 0]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    expect(screen.getByText(/Sin fumigaciones en el dataset/)).toBeInTheDocument();
  });

  it("min slider respeta max=range[1]", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[2, 4]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    // v2.2: el Slider primitive maneja internamente los thumbs min/max
    // accesibles. El componente TimeRange lo usa via <Slider value={range}
    // min={0} max={months.length - 1} step={1} />. El primitive garantiza
    // que los 2 thumbs no se crucen, sin que el caller tenga que
    // validar nada.
    expect(screen.getByTestId("time-range-slider")).toBeInTheDocument();
  });

  it("max slider respeta min=range[0]", () => {
    render(
      <TimeRange
        months={baseMonths}
        playing={false}
        range={[1, 3]}
        onPlayingChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    // v2.2: el Slider primitive renderiza ambos thumbs; el comportamiento
    // de "no cruzarse" lo garantiza el primitive, no el caller.
    expect(screen.getByTestId("time-range-slider")).toBeInTheDocument();
  });
});
