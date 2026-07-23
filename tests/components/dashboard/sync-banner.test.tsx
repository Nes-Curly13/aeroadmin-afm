// tests/components/dashboard/sync-banner.test.tsx
//
// M12 (audit UX 2026-07-22) — Banner de salud del sync DJI.
//
// Cubre los 4 estados visuales:
//   - ok   verde: <12h desde la última sync exitosa
//   - warn amarillo: 12-24h
//   - danger rojo: >24h o status failed/partial
//   - unknown gris: archivo no existe / corrupto / sin lastSuccessfulSyncAt
//
// Además cubre la lógica pura `deriveSyncTone` y `formatAgo`.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  SyncBanner,
  deriveSyncTone,
  formatAgo,
  type SyncTone
} from "@/components/dashboard/sync-banner";
import type { HealthResponse } from "@/lib/djiag-health";

/** Helper para construir un HealthResponse de test con defaults razonables. */
function makeResponse(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: "ok",
    lastRunAt: "2026-07-23T10:00:00Z",
    lastRunStatus: "ok",
    lastSuccessfulSyncAt: "2026-07-23T10:00:00Z",
    flightsLastSync: 0,
    fumigationsLastSync: 0,
    landsLastSync: 0,
    hoursSinceLastSync: 1,
    warnings: [],
    steps: [],
    ...over
  };
}

describe("deriveSyncTone", () => {
  it("devuelve 'ok' cuando hoursSinceLastSync <= 12 y status='ok'", () => {
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 0.5 }))).toBe("ok");
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 12 }))).toBe("ok");
  });

  it("devuelve 'warn' cuando hoursSinceLastSync está entre 12 y 24 (sin contar 12 ni 24)", () => {
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 12.1 }))).toBe("warn");
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 23.9 }))).toBe("warn");
  });

  it("devuelve 'danger' cuando hoursSinceLastSync > 24", () => {
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 24.1 }))).toBe("danger");
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 48 }))).toBe("danger");
    expect(deriveSyncTone(makeResponse({ hoursSinceLastSync: 168 }))).toBe("danger");
  });

  it("devuelve 'danger' si status='failed' aunque hoursSinceLastSync sea < 12", () => {
    // El último run falló hace 1h: la S3 URL puede haber cambiado pero
    // el sync sigue roto. Esto es más urgente que un sync exitoso viejo.
    const response = makeResponse({
      hoursSinceLastSync: 1,
      lastRunStatus: "failed",
      status: "failed"
    });
    expect(deriveSyncTone(response)).toBe("danger");
  });

  it("devuelve 'danger' si status='partial' aunque hoursSinceLastSync sea < 12", () => {
    const response = makeResponse({
      hoursSinceLastSync: 2,
      lastRunStatus: "partial",
      status: "partial"
    });
    expect(deriveSyncTone(response)).toBe("danger");
  });

  it("devuelve 'unknown' si status='unknown' (archivo no existe / corrupto)", () => {
    const response = makeResponse({
      status: "unknown",
      lastRunAt: null,
      lastSuccessfulSyncAt: null,
      hoursSinceLastSync: null
    });
    expect(deriveSyncTone(response)).toBe("unknown");
  });

  it("devuelve 'unknown' si hoursSinceLastSync es null aunque status='ok'", () => {
    // Caso edge: status=ok pero no hay lastSuccessfulSyncAt (corrupto).
    const response = makeResponse({
      hoursSinceLastSync: null,
      lastSuccessfulSyncAt: null
    });
    expect(deriveSyncTone(response)).toBe("unknown");
  });
});

describe("formatAgo", () => {
  it("devuelve '—' si hours es null", () => {
    expect(formatAgo(null)).toBe("—");
  });

  it("muestra minutos cuando hours < 1", () => {
    expect(formatAgo(0.5)).toBe("hace 30 min");
    expect(formatAgo(0.016)).toBe("hace 1 min");
  });

  it("muestra horas cuando 1 <= hours < 24", () => {
    expect(formatAgo(1)).toBe("hace 1 h");
    expect(formatAgo(5.4)).toBe("hace 5 h");
    expect(formatAgo(23.7)).toBe("hace 24 h");
  });

  it("muestra días cuando hours >= 24", () => {
    expect(formatAgo(24)).toBe("hace 1 día");
    expect(formatAgo(48)).toBe("hace 2 días");
    expect(formatAgo(168)).toBe("hace 7 días");
  });
});

describe("SyncBanner", () => {
  it("estado 'ok': banner verde con data-tone='ok' y mensaje de 'al día'", () => {
    const response = makeResponse({ hoursSinceLastSync: 2 });
    render(<SyncBanner response={response} />);
    const banner = screen.getByTestId("dji-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-tone")).toBe("ok");
    // aria-label accesible para screen readers.
    expect(banner.getAttribute("aria-label")).toMatch(/sincronizado/i);
    // Copy esperado: "Última sync DJI hace 2 h. Datos al día."
    expect(banner).toHaveTextContent(/sincronizado/i);
    expect(banner).toHaveTextContent(/hace 2 h/i);
  });

  it("estado 'warn': banner amarillo con data-tone='warn' y mensaje de 'atrasado'", () => {
    const response = makeResponse({ hoursSinceLastSync: 18 });
    render(<SyncBanner response={response} />);
    const banner = screen.getByTestId("dji-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-tone")).toBe("warn");
    expect(banner.getAttribute("aria-label")).toMatch(/sync atrasado/i);
    expect(banner).toHaveTextContent(/sync atrasado/i);
    expect(banner).toHaveTextContent(/hace 18 h/i);
  });

  it("estado 'danger' (>24h): banner rojo con data-tone='danger'", () => {
    // 36h → 1.5 días → Math.round(1.5) = 2 días (banker's rounding
    // would give 2 también en este caso, pero Math.round usa round-half-
    // away-from-zero: 1.5 → 2). Verificamos "días" plural.
    const response = makeResponse({ hoursSinceLastSync: 36 });
    render(<SyncBanner response={response} />);
    const banner = screen.getByTestId("dji-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-tone")).toBe("danger");
    expect(banner.getAttribute("aria-label")).toMatch(/sync caído/i);
    expect(banner).toHaveTextContent(/sync caído/i);
    expect(banner).toHaveTextContent(/hace \d+ días/i);
  });

  it("estado 'danger' (status='failed'): banner rojo aunque hoursSinceLastSync=1", () => {
    const response = makeResponse({
      hoursSinceLastSync: 1,
      lastRunStatus: "failed",
      status: "failed"
    });
    render(<SyncBanner response={response} />);
    const banner = screen.getByTestId("dji-sync-banner");
    expect(banner.getAttribute("data-tone")).toBe("danger");
    // El copy es específico: menciona que el último run falló.
    expect(banner).toHaveTextContent(/corrida del pipeline djI falló/i);
  });

  it("estado 'unknown': banner gris con data-tone='unknown' y mensaje de 'sin datos'", () => {
    const response = makeResponse({
      status: "unknown",
      lastRunAt: null,
      lastSuccessfulSyncAt: null,
      hoursSinceLastSync: null
    });
    render(<SyncBanner response={response} />);
    const banner = screen.getByTestId("dji-sync-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-tone")).toBe("unknown");
    expect(banner.getAttribute("aria-label")).toMatch(/sin datos/i);
    expect(banner).toHaveTextContent(/sin datos/i);
    expect(banner).toHaveTextContent(/no hay datos/i);
  });

  it("muestra un <details> con los warnings del HealthResponse si los hay", () => {
    // Caso danger con >24h + un warning del sistema (>24h stale warning).
    // El banner debe permitir ver el detalle colapsable.
    const response = makeResponse({
      hoursSinceLastSync: 36,
      warnings: ["Última sync exitosa hace 36.0h (>24h)."]
    });
    render(<SyncBanner response={response} />);
    const summary = screen.getByText(/detalle/i);
    expect(summary).toBeInTheDocument();
    // El texto del warning está dentro del <details> (colapsado por default).
    expect(summary.closest("details")).toHaveTextContent(/36\.0h \(>24h\)/i);
  });

  it("NO muestra <details> si no hay warnings", () => {
    const response = makeResponse({ hoursSinceLastSync: 2, warnings: [] });
    render(<SyncBanner response={response} />);
    expect(screen.queryByText(/detalle/i)).not.toBeInTheDocument();
  });

  it("los 4 tonos son mutuamente excluyentes para los data-tone del banner", () => {
    // Sanity: cada uno de los 4 estados produce un data-tone distinto.
    const tones = new Set<SyncTone>();
    const cases: HealthResponse[] = [
      makeResponse({ hoursSinceLastSync: 1 }),
      makeResponse({ hoursSinceLastSync: 18 }),
      makeResponse({ hoursSinceLastSync: 48 }),
      makeResponse({
        status: "unknown",
        lastSuccessfulSyncAt: null,
        hoursSinceLastSync: null
      })
    ];
    for (const c of cases) {
      const { unmount } = render(<SyncBanner response={c} />);
      const banner = screen.getByTestId("dji-sync-banner");
      tones.add(banner.getAttribute("data-tone") as SyncTone);
      unmount();
    }
    expect(tones.size).toBe(4);
  });
});
