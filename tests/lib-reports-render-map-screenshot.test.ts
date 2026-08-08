// tests/lib-reports-render-map-screenshot.test.ts
//
// Test unitario de `renderParcelMapToPng` (feature/reports-level-1
// sub-sprint 3, 2026-08-08).
//
// Cubre:
//   - **Happy path**: el browser navega a la URL del print-map, espera
//     el flag `window.__mapReady`, hace screenshot → buffer PNG
//   - **Fallback a null** cuando `launchBrowser` tira (no chromium)
//   - **Fallback a null** cuando `page.goto` tira (parcel sin geom → 404)
//   - **Fallback a null** cuando el flag nunca se setea (timeout)
//   - **URL construida correctamente** con base + parcelId

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLaunchBrowser = vi.fn();
const mockNewContext = vi.fn();
const mockNewPage = vi.fn();
const mockGoto = vi.fn();
const mockWaitForFunction = vi.fn();
const mockWaitForTimeout = vi.fn();
const mockScreenshot = vi.fn();
const mockContextClose = vi.fn();

vi.mock("@/lib/reports/render-pdf", () => ({
  launchBrowser: (...args: unknown[]) => mockLaunchBrowser(...args)
}));

const { renderParcelMapToPng } = await import(
  "@/lib/reports/render-map-screenshot"
);

function makeBrowser() {
  return {
    newContext: (...args: unknown[]) => mockNewContext(...args)
  };
}

function makeContext() {
  return {
    newPage: (...args: unknown[]) => mockNewPage(...args),
    close: (...args: unknown[]) => mockContextClose(...args)
  };
}

function makePage() {
  return {
    goto: (...args: unknown[]) => mockGoto(...args),
    waitForFunction: (...args: unknown[]) => mockWaitForFunction(...args),
    waitForTimeout: (...args: unknown[]) => mockWaitForTimeout(...args),
    screenshot: (...args: unknown[]) => mockScreenshot(...args)
  };
}

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

beforeEach(() => {
  mockLaunchBrowser.mockReset();
  mockNewContext.mockReset();
  mockNewPage.mockReset();
  mockGoto.mockReset();
  mockWaitForFunction.mockReset();
  mockWaitForTimeout.mockReset();
  mockScreenshot.mockReset();
  mockContextClose.mockReset();

  // Defaults: happy path
  mockLaunchBrowser.mockResolvedValue(makeBrowser());
  mockNewContext.mockResolvedValue(makeContext());
  mockNewPage.mockResolvedValue(makePage());
  mockGoto.mockResolvedValue(undefined);
  mockWaitForFunction.mockResolvedValue(undefined);
  mockWaitForTimeout.mockResolvedValue(undefined);
  mockScreenshot.mockResolvedValue(new Uint8Array(FAKE_PNG));
  mockContextClose.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("renderParcelMapToPng — happy path", () => {
  it("lanza browser, navega a print-map/[id] y devuelve PNG buffer", async () => {
    const buf = await renderParcelMapToPng(42, "http://localhost:3000");
    expect(buf).not.toBeNull();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.length).toBe(FAKE_PNG.length);
    expect(buf![0]).toBe(0x89);
  });

  it("construye la URL correctamente: base + /api/internal/print-map/[id]", async () => {
    await renderParcelMapToPng(123, "http://localhost:3000");
    expect(mockGoto).toHaveBeenCalledWith(
      "http://localhost:3000/api/internal/print-map/123",
      expect.any(Object)
    );
  });

  it("trimea trailing slashes del baseUrl", async () => {
    await renderParcelMapToPng(123, "http://localhost:3000///");
    expect(mockGoto).toHaveBeenCalledWith(
      "http://localhost:3000/api/internal/print-map/123",
      expect.any(Object)
    );
  });

  it("espera el flag window.__mapReady antes de screenshot", async () => {
    await renderParcelMapToPng(42, "http://localhost:3000");
    expect(mockWaitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });

  it("usa el viewport configurado (800x600 default)", async () => {
    await renderParcelMapToPng(42, "http://localhost:3000");
    expect(mockNewContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 800, height: 600 } })
    );
  });

  it("respeta viewport custom", async () => {
    await renderParcelMapToPng(42, "http://localhost:3000", {
      viewport: { width: 1200, height: 800 }
    });
    expect(mockNewContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 1200, height: 800 } })
    );
  });

  it("cierra el context (browser queda singleton)", async () => {
    await renderParcelMapToPng(42, "http://localhost:3000");
    expect(mockContextClose).toHaveBeenCalled();
  });
});

describe("renderParcelMapToPng — fallback a null", () => {
  it("launchBrowser tira → devuelve null", async () => {
    mockLaunchBrowser.mockRejectedValueOnce(new Error("chromium no encontrado"));
    const buf = await renderParcelMapToPng(42, "http://localhost:3000");
    expect(buf).toBeNull();
  });

  it("page.goto tira (404) → devuelve null", async () => {
    mockGoto.mockRejectedValueOnce(new Error("404"));
    const buf = await renderParcelMapToPng(42, "http://localhost:3000");
    expect(buf).toBeNull();
    // El context se cierra igual.
    expect(mockContextClose).toHaveBeenCalled();
  });

  it("waitForFunction timeout (flag nunca se setea) → igual hace screenshot y devuelve buffer", async () => {
    // El flag puede no setearse si los tiles demoran más que el timeout
    // — la idea es que el screenshot se haga igual. El test verifica
    // que el `.catch(() => {})` no propaga el error.
    mockWaitForFunction.mockRejectedValueOnce(new Error("timeout"));
    const buf = await renderParcelMapToPng(42, "http://localhost:3000");
    expect(buf).not.toBeNull();
    // Pero igual esperamos 200ms de buffer y screenshotteamos.
    expect(mockWaitForTimeout).toHaveBeenCalledWith(200);
    expect(mockScreenshot).toHaveBeenCalled();
  });

  it("screenshot tira → devuelve null", async () => {
    mockScreenshot.mockRejectedValueOnce(new Error("screenshot fail"));
    const buf = await renderParcelMapToPng(42, "http://localhost:3000");
    expect(buf).toBeNull();
  });
});
