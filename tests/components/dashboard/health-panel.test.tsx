// tests/components/dashboard/health-panel.test.tsx
//
// Cobertura del V0 port de HealthPanel:
//   - data-slot="health-panel" presente.
//   - Banner con tono OK (status=ok) y label "Último run OK".
//   - Banner con tono danger para status=failed.
//   - Banner con tono warn para status=stale y status=partial.
//   - Banner con tono unknown para status=unknown (gris, sin last run).
//   - Grid de 4 metrics (Parcelas, Vuelos, Fumigaciones, Última sync).
//   - Lista de batches/steps (top 5) con icono según status.
//   - Empty state cuando no hay batches.
//   - Warnings se renderizan como lista con bullet.
//   - Cuando se omite `batches`, usa `health.steps` por default.
//
// Decisión de shape documentada: `batches: StepHealth[]` (no
// `DjiImportBatch[]` como en el V0) — el proyecto no expone una tabla
// `dji_import_batches`, usa los steps del pipeline como proxy.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { HealthPanel } from "@/components/dashboard/health-panel";
import type { HealthResponse, StepHealth } from "@/lib/djiag-health-types";

function makeResponse(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: "ok",
    lastRunAt: "2026-07-23T10:00:00Z",
    lastRunStatus: "ok",
    lastSuccessfulSyncAt: "2026-07-23T10:00:00Z",
    flightsLastSync: 120,
    fumigationsLastSync: 18,
    landsLastSync: 6,
    hoursSinceLastSync: 1,
    warnings: [],
    steps: [],
    ...over
  };
}

const sampleSteps: StepHealth[] = [
  { order: 1, name: "flights", status: "ok", durationMs: 1200 },
  { order: 2, name: "fumigations", status: "ok", durationMs: 800 },
  { order: 3, name: "lands", status: "failed", durationMs: 500, error: "Network timeout" }
];

describe("<HealthPanel />", () => {
  it("aplica data-slot='health-panel' al contenedor", () => {
    const { container } = render(<HealthPanel health={makeResponse()} />);
    expect(container.querySelector('[data-slot="health-panel"]')).not.toBeNull();
  });

  it("status=ok → banner con data-tone='ok' y label 'Último run OK'", () => {
    render(<HealthPanel health={makeResponse()} />);
    const banner = screen.getByTestId("health-banner");
    expect(banner.getAttribute("data-tone")).toBe("ok");
    expect(screen.getByTestId("health-status-line").textContent).toMatch(/Último run OK/);
  });

  it("status=failed → banner con data-tone='danger'", () => {
    render(<HealthPanel health={makeResponse({ status: "failed", lastRunStatus: "failed" })} />);
    const banner = screen.getByTestId("health-banner");
    expect(banner.getAttribute("data-tone")).toBe("danger");
    expect(screen.getByTestId("health-status-line").textContent).toMatch(/Último run Error/);
  });

  it("status=stale → banner con data-tone='warn' (no danger)", () => {
    // stale: el último run fue ok pero hace >24h. No es un fallo, es
    // una señal de "se está atrasando". V0 lo pintaría rojo, pero el
    // criterio de AFM es: solo failed/partial son críticos.
    render(
      <HealthPanel
        health={makeResponse({ status: "stale", lastRunStatus: "ok", hoursSinceLastSync: 36 })}
      />
    );
    const banner = screen.getByTestId("health-banner");
    expect(banner.getAttribute("data-tone")).toBe("warn");
  });

  it("status=partial → banner con data-tone='warn'", () => {
    render(
      <HealthPanel health={makeResponse({ status: "partial", lastRunStatus: "partial" })} />
    );
    const banner = screen.getByTestId("health-banner");
    expect(banner.getAttribute("data-tone")).toBe("warn");
    expect(screen.getByTestId("health-status-line").textContent).toMatch(/Último run Parcial/);
  });

  it("status=unknown → banner con data-tone='unknown', sin 'Última corrida'", () => {
    render(
      <HealthPanel
        health={makeResponse({
          status: "unknown",
          lastRunAt: null,
          lastSuccessfulSyncAt: null,
          hoursSinceLastSync: null
        })}
      />
    );
    const banner = screen.getByTestId("health-banner");
    expect(banner.getAttribute("data-tone")).toBe("unknown");
    expect(screen.getByTestId("health-last-run-at").textContent).toMatch(
      /Sin registro de última corrida/
    );
  });

  it("renderiza el grid de 4 metrics con los valores del health", () => {
    render(<HealthPanel health={makeResponse()} />);
    const metrics = screen.getByTestId("health-metrics");
    expect(metrics).toHaveTextContent("Parcelas sincronizadas");
    expect(metrics).toHaveTextContent("6"); // landsLastSync
    expect(metrics).toHaveTextContent("Vuelos del último run");
    expect(metrics).toHaveTextContent("120"); // flightsLastSync
    expect(metrics).toHaveTextContent("Fumigaciones del último run");
    expect(metrics).toHaveTextContent("18"); // fumigationsLastSync
    expect(metrics).toHaveTextContent("Última sync hace");
  });

  it("muestra el último run at en formato ISO (legible para el operador)", () => {
    render(
      <HealthPanel
        health={makeResponse({ lastRunAt: "2026-07-23T10:00:00Z" })}
      />
    );
    const lastRunEl = screen.getByTestId("health-last-run-at");
    expect(lastRunEl.textContent).toMatch(/2026-07-23T10:00:00/);
  });

  it("renderiza la lista de batches (steps) con icono según status", () => {
    render(<HealthPanel health={makeResponse({ steps: sampleSteps })} />);
    const list = screen.getByTestId("health-batches");
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBe(3);
    // Cada item tiene data-batch-name
    expect(items[0].getAttribute("data-batch-name")).toBe("flights");
    expect(items[1].getAttribute("data-batch-name")).toBe("fumigations");
    expect(items[2].getAttribute("data-batch-name")).toBe("lands");
    // El step failed tiene data-step-status="failed"
    expect(items[2].getAttribute("data-step-status")).toBe("failed");
  });

  it("muestra el error de un step failed", () => {
    render(<HealthPanel health={makeResponse({ steps: sampleSteps })} />);
    expect(screen.getByTestId("health-batch-error-lands").textContent).toBe("Network timeout");
  });

  it("empty state cuando no hay steps ni batches", () => {
    render(<HealthPanel health={makeResponse({ steps: [] })} />);
    expect(screen.getByTestId("health-batches-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("health-batches")).toBeNull();
  });

  it("usa `batches` prop cuando se pasa (override de health.steps)", () => {
    const overrideBatches: StepHealth[] = [
      { order: 1, name: "custom-step", status: "ok" }
    ];
    render(
      <HealthPanel
        batches={overrideBatches}
        health={makeResponse({
          steps: [{ order: 1, name: "from-steps", status: "ok" } as StepHealth]
        })}
      />
    );
    // El batch "from-steps" NO debe estar; "custom-step" sí.
    expect(screen.getByTestId("health-batches").textContent).toMatch(/custom-step/);
    expect(screen.getByTestId("health-batches").textContent).not.toMatch(/from-steps/);
  });

  it("limita la lista de batches a 5 (top 5)", () => {
    const manySteps: StepHealth[] = Array.from({ length: 10 }, (_, i) => ({
      order: i + 1,
      name: `step-${i}`,
      status: "ok" as const
    }));
    render(<HealthPanel health={makeResponse({ steps: manySteps })} />);
    const items = within(screen.getByTestId("health-batches")).getAllByRole("listitem");
    expect(items.length).toBe(5);
  });

  it("renderiza warnings como lista con bullet", () => {
    render(
      <HealthPanel
        health={makeResponse({
          warnings: [
            "Última sync exitosa hace 36.0h (>24h).",
            "La última corrida del pipeline falló."
          ]
        })}
      />
    );
    const warnings = screen.getByTestId("health-warnings");
    expect(warnings).toHaveTextContent("• Última sync exitosa hace 36.0h");
    expect(warnings).toHaveTextContent("• La última corrida del pipeline falló");
  });

  it("no renderiza el bloque de warnings si está vacío", () => {
    render(<HealthPanel health={makeResponse({ warnings: [] })} />);
    expect(screen.queryByTestId("health-warnings")).toBeNull();
  });
});
