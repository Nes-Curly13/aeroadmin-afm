import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

/**
 * Tests del `next.config.ts` para los redirects del Fase 8.
 *
 * Estos tests son deliberadamente simples (regex sobre el array
 * `redirects()`). No testean la ejecución real de Next.js (eso es
 * e2e), pero garantizan que un dev que refactoree el config no
 * elimine los redirects por accidente.
 */
describe("next.config — redirects del Fase 8 (fumigación URL consistency)", () => {
  // `nextConfig` exporta un objeto. `redirects()` es un método que
  // devuelve Promise<Redirect[]>. Lo llamamos y destructuramos.
  async function getRedirects() {
    const redirectsFn = nextConfig.redirects;
    if (!redirectsFn) return [];
    return await redirectsFn();
  }

  it("redirige /fumigacion/:id → /fumigaciones/:id (permanente)", async () => {
    const redirects = await getRedirects();
    const r = redirects.find((x) => x.source === "/fumigacion/:id");
    expect(r).toBeDefined();
    expect(r?.destination).toBe("/fumigaciones/:id");
    expect(r?.permanent).toBe(true);
  });

  it("redirige /fumigacion/:id/edit → /fumigaciones/:id/editar (permanente)", async () => {
    const redirects = await getRedirects();
    const r = redirects.find((x) => x.source === "/fumigacion/:id/edit");
    expect(r).toBeDefined();
    expect(r?.destination).toBe("/fumigaciones/:id/editar");
    expect(r?.permanent).toBe(true);
  });

  it("preserva el redirect legacy /history → /task-history (no regresión)", async () => {
    const redirects = await getRedirects();
    const r = redirects.find((x) => x.source === "/history");
    expect(r).toBeDefined();
    expect(r?.destination).toBe("/task-history");
    expect(r?.permanent).toBe(true);
  });
});
