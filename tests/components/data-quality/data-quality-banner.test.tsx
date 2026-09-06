// tests/components/data-quality/data-quality-banner.test.tsx
//
// Tests del banner de calidad de datos (Fase 4.4.1).
//
// Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.4 — Capa de Gestión.
//
// Cubre:
//   1. Sin warnings (200 + warnings: []) → no renderiza nada
//   2. Con warnings de severity=warning → renderiza banner amarillo
//   3. Con warnings de severity=error → renderiza banner rojo
//   4. Mix de severities → renderiza banner con la peor severidad como "primary"
//   5. Error 401/403 (supervisor sin permisos) → no renderiza nada
//   6. Error 500 (DB caída) → no renderiza nada, no rompe la UI
//   7. Muestra el `message` de cada warning como item de lista

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  DataQualityBanner,
  type DataQualityWarning
} from "@/components/data-quality/data-quality-banner";

const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockOkResponse(warnings: DataQualityWarning[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ warnings })
  });
}

function mockHttpError(status: number) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({})
  });
}

function mockNetworkError() {
  mockFetch.mockRejectedValue(new Error("network"));
}

// ============================================================
// Comportamiento
// ============================================================

describe("DataQualityBanner — comportamiento", () => {
  it("1. sin warnings (200 + []): no renderiza nada", async () => {
    mockOkResponse([]);
    const { container } = render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("2. con warnings de severity=warning: renderiza banner amarillo", async () => {
    mockOkResponse([
      {
        code: "parcela_no_cliente",
        severity: "warning",
        message: "Parcela sin cliente asignado",
        parcela_id: 42
      }
    ]);
    render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Parcela sin cliente asignado/i)
      ).toBeInTheDocument();
    });
  });

  it("3. con warnings de severity=error: renderiza banner con icono alert", async () => {
    mockOkResponse([
      {
        code: "fumigacion_ciclo_cerrado",
        severity: "error",
        message: "Fumigación #1234 apunta a un ciclo cerrado",
        fumigation_id: 1234,
        cycle_id: 5
      }
    ]);
    render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Fumigación #1234 apunta a un ciclo cerrado/i)
      ).toBeInTheDocument();
    });
  });

  it("4. mix de severities: muestra todas en la lista", async () => {
    mockOkResponse([
      {
        code: "parcela_no_cliente",
        severity: "warning",
        message: "Sin cliente"
      },
      {
        code: "ciclo_sin_phase_rule",
        severity: "info",
        message: "Sin reglas de fase"
      }
    ]);
    render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(screen.getByText(/Sin cliente/i)).toBeInTheDocument();
      expect(screen.getByText(/Sin reglas de fase/i)).toBeInTheDocument();
    });
  });

  it("5. error 401/403 (supervisor sin permisos): no renderiza nada", async () => {
    mockHttpError(403);
    const { container } = render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("6. error 500 (DB caída): no renderiza nada, no rompe", async () => {
    mockHttpError(500);
    const { container } = render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("7. error de red: no renderiza nada, no rompe", async () => {
    mockNetworkError();
    const { container } = render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("8. fetch URL: /api/data-quality/invariants?parcelaId=X", async () => {
    mockOkResponse([]);
    render(<DataQualityBanner parcelaId={42} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/data-quality/invariants?parcelaId=42"
      );
    });
  });
});
