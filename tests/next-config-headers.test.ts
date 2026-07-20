// Tests de humo sobre la configuración de seguridad de Next.js.
//
// Por que este test existe (2026-07-20, sprint Q4 / track C):
//   - `next.config.ts` define headers de seguridad HTTP (CSP, HSTS,
//     X-Frame-Options, etc.) en el hook `headers()`.
//   - Si alguien borra el `Content-Security-Policy` o relaja
//     `X-Frame-Options: DENY` → `SAMEORIGIN` en un PR futuro, el problema
//     no se detecta en build ni en runtime: la app sigue funcionando.
//   - Este test lee la config y valida que los headers que SÍ importan
//     (los de seguridad, no los de cache/CDN) están en el shape correcto.
//
// Contrato (ver docs/guia/01_SDD §8 — "Seguridad"):
//   - CSP explícita con default-src 'self'
//   - HSTS con max-age >= 1 año + includeSubDomains + preload
//   - X-Frame-Options DENY (anti-clickjacking)
//   - X-Content-Type-Options nosniff
//   - Referrer-Policy strict-origin-when-cross-origin
//   - Permissions-Policy bloquea camera, microphone, geolocation
//
// NO testeamos: la existencia de redirect /history → /task-history
// (eso es funcional, no de seguridad, y ya tiene su test e2e).

import { describe, expect, it } from "vitest";

// Importar el config directo: es un módulo ESM con default export.
// Vite (usado por vitest) transforma el .ts a .js en runtime.
import nextConfig from "@/next.config";

interface HeaderEntry {
  key: string;
  value: string;
}

interface HeadersRoute {
  source: string;
  headers: HeaderEntry[];
}

async function getCatchAllHeaders(): Promise<HeaderEntry[]> {
  const cfg = nextConfig as {
    headers?: () => Promise<HeadersRoute[]>;
  };
  if (!cfg.headers) return [];
  const routes = await cfg.headers();
  // Buscar el catch-all (source: "/:path*") que aplica a TODAS las rutas.
  const catchAll = routes.find((r) => r.source === "/:path*");
  return catchAll?.headers ?? [];
}

function findHeader(headers: HeaderEntry[], key: string): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("next.config.ts — headers de seguridad", () => {
  it("define el catch-all headers() que aplica a /:path*", async () => {
    const headers = await getCatchAllHeaders();
    expect(headers.length).toBeGreaterThan(0);
  });

  describe("Content-Security-Policy", () => {
    it("está presente", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy");
      expect(csp).toBeDefined();
    });

    it("default-src 'self' (default deny)", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy") ?? "";
      expect(csp).toMatch(/default-src\s+'self'/);
    });

    it("script-src permite 'self' + inline + eval (Next.js lo requiere en dev/hydration)", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy") ?? "";
      expect(csp).toMatch(/script-src\s+'self'\s+'unsafe-inline'\s+'unsafe-eval'/);
    });

    it("style-src permite Google Fonts", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy") ?? "";
      expect(csp).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    });

    it("img-src permite tiles de OpenStreetMap y marker icons de unpkg (Leaflet)", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy") ?? "";
      // Las tiles usan subdominios (a.tile, b.tile, c.tile) — wildcard obligatorio.
      expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.tile\.openstreetmap\.org/);
      expect(csp).toMatch(/img-src[^;]*https:\/\/unpkg\.com/);
    });

    it("frame-ancestors 'none' (anti-clickjacking, equivalente a X-Frame-Options DENY)", async () => {
      const headers = await getCatchAllHeaders();
      const csp = findHeader(headers, "Content-Security-Policy") ?? "";
      expect(csp).toMatch(/frame-ancestors\s+'none'/);
    });
  });

  describe("Strict-Transport-Security", () => {
    it("max-age >= 1 año (31536000 segundos)", async () => {
      const headers = await getCatchAllHeaders();
      const hsts = findHeader(headers, "Strict-Transport-Security") ?? "";
      expect(hsts).toMatch(/max-age=31536000/);
    });

    it("incluye includeSubDomains", async () => {
      const headers = await getCatchAllHeaders();
      const hsts = findHeader(headers, "Strict-Transport-Security") ?? "";
      expect(hsts).toMatch(/includeSubDomains/);
    });

    it("incluye preload (apto para hstspreload.org)", async () => {
      const headers = await getCatchAllHeaders();
      const hsts = findHeader(headers, "Strict-Transport-Security") ?? "";
      expect(hsts).toMatch(/preload/);
    });
  });

  describe("Anti-clickjacking + MIME sniffing", () => {
    it("X-Frame-Options DENY (no SAMEORIGIN, no ausente)", async () => {
      const headers = await getCatchAllHeaders();
      const xfo = findHeader(headers, "X-Frame-Options") ?? "";
      expect(xfo).toBe("DENY");
    });

    it("X-Content-Type-Options nosniff", async () => {
      const headers = await getCatchAllHeaders();
      expect(findHeader(headers, "X-Content-Type-Options")).toBe("nosniff");
    });
  });

  describe("Referrer + Permissions", () => {
    it("Referrer-Policy strict-origin-when-cross-origin", async () => {
      const headers = await getCatchAllHeaders();
      expect(findHeader(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });

    it("Permissions-Policy bloquea geolocation, camera, microphone", async () => {
      const headers = await getCatchAllHeaders();
      const pp = findHeader(headers, "Permissions-Policy") ?? "";
      // El header es una lista separada por comas: feature1=(), feature2=(self), etc.
      // La app no necesita geolocalización del usuario (Leaflet solo muestra
      // parcelas en el mapa, no la posición del operador) → geolocation=().
      expect(pp).toMatch(/geolocation=\(\)/);
      expect(pp).toMatch(/camera=\(\)/);
      expect(pp).toMatch(/microphone=\(\)/);
    });
  });
});
