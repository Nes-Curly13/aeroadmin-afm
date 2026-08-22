// E2E regression test: /admin/parcels/new — el operador puede dibujar
// el polígono de la parcela haciendo click en el mapa.
//
// Sprint 2026-08-22 — fix/parcel-drawer-click-bug.
//
// Bug original: los clicks sobre el canvas no se traducían a vértices
// del polígono. El doble-click para cerrar tampoco funcionaba. Root
// cause: `draw.setMode("polygon")` se ejecutaba antes de que el
// adapter de terra-draw disparara el callback `ready`. Fix: setear
// el modo DENTRO del callback `ready` y deshabilitar
// `map.doubleClickZoom` explícitamente.
//
// Este test ejercita el flow real en el browser:
//   1. Login como admin
//   2. Navegar a /admin/parcels/new
//   3. Esperar a que el mapa de MapLibre esté cargado
//   4. Hacer 3 clicks sobre el canvas para crear un polígono
//   5. Verificar que el botón "Limpiar" se habilita (es la señal de
//      que el polígono se completó: `setHasPolygon(true)` corre
//      en el handler de `draw.on("finish", ...)`)
//
// Si alguien revierte el fix (saca el `setMode` del callback `ready`
// o no deshabilita `doubleClickZoom`), este test falla porque el
// botón "Limpiar" queda disabled para siempre.

import { expect, test, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15_000 });
}

test.describe("/admin/parcels/new — dibujo del polígono (fix 2026-08-22)", () => {
  test("el operador puede dibujar un polígono clickeando en el mapa", async ({
    page
  }) => {
    // Capturar errores de consola del cliente (terra-draw puede tirar
    // errores si el modo se setea antes del ready). Si el bug vuelve,
    // veremos el error en el reporte de Playwright.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await login(page);
    await page.goto("/admin/parcels/new");
    await expect(page).toHaveURL(/\/admin\/parcels\/new/);

    // Esperar a que el contenedor del mapa esté renderizado
    const mapContainer = page.getByTestId("parcel-drawer-map");
    await expect(mapContainer).toBeVisible({ timeout: 15_000 });

    // Esperar a que MapLibre cargue el style (es cuando se monta terra-draw
    // y se dispara el `ready` callback). Verificamos que el canvas esté
    // presente y tenga tamaño > 0.
    await page.waitForFunction(
      () => {
        const c = document.querySelector(
          '[data-testid="parcel-drawer-map"] canvas'
        ) as HTMLCanvasElement | null;
        return !!(c && c.width > 0 && c.height > 0);
      },
      { timeout: 15_000 }
    );

    // El botón "Limpiar" arranca disabled (no hay polígono)
    const clearBtn = page.getByRole("button", { name: /Limpiar polígono/ });
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeDisabled();

    // Hacer 4 clicks sobre el canvas para crear un polígono cerrado.
    // En terra-draw, el polygon mode requiere 4 vértices distintos para
    // cerrar (los primeros 3 clicks crean vértices, el 4to cierra
    // con el "closing on proximity" del primer vértice).
    const canvas = page.locator('[data-testid="parcel-drawer-map"] canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas no tiene bounding box");

    const points = [
      { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 },
      { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 },
      { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 },
      { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 }
    ];

    for (const p of points) {
      await page.mouse.click(p.x, p.y);
      // Pequeña pausa para que terra-draw procese el pointerup antes del
      // siguiente click. Sin esto, en CI los clicks rápidos se pierden
      // porque el browser no termina de despachar el pointerup.
      await page.waitForTimeout(150);
    }

    // Después del 4to click (que cierra el polígono), el botón "Limpiar"
    // se habilita. Esto es la señal de que el flow de clicks → vértices
    // está funcionando.
    await expect(clearBtn).toBeEnabled({ timeout: 5_000 });

    // Verificar que no se tiraron errores en consola durante el flow
    // (especialmente errores tipo "Mode must be unregistered" que sería
    // la señal de que el bug volvió).
    const blockingErrors = consoleErrors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("Failed to load resource") // tiles del basemap pueden flakear
    );
    expect(blockingErrors).toEqual([]);
  });
});
