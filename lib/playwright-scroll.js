// Helpers de scroll para Playwright.
//
// Por qué existe:
//   - DJI usa scroll virtualizado en /mission y /records: solo ~20-30 items
//     están en el DOM al inicio. Sin scroll, los scrapers solo ven una
//     fracción de los datos.
//   - Antes (defectos §2.2 y §2.3 de SCRAPER_DEFECTS.md): el scraper solo
//     capturaba el 16% de parcelas y 30 días de historial.
//   - Este módulo encapsula la lógica de "scrollear hasta que el contador
//     de items no crezca más" sin asumir selectores específicos (los pasa
//     el caller).
//
// API:
//   - scrollUntilStagnant(page, opts): scrollea hasta que getCount deja de
//     crecer por `settleMs` consecutivos, o hasta `maxCycles`.
//   - Devuelve { totalCount, cycles } para logging.
//
// Tests:
//   - La función corre 100% en browser context (page.evaluate), por lo que
//     unit tests con jsdom no son viables. La validación es manual vía
//     --smoke mode del scraper o e2e (futuro). Si querés agregar test
//     sin browser, hay que extraer la lógica pura de "decide_next_action"
//     — no es prioritario ahora.

/**
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {string}  opts.countSelector         — selector CSS para los items a contar (REQUERIDO)
 * @param {number}  [opts.maxCycles=50]        — tope de iteraciones (safety)
 * @param {number}  [opts.settleMs=1500]       — ms sin crecimiento para declarar "estancado"
 * @param {number}  [opts.waitBetweenScrollsMs=600] — pausa entre scrolls (para que el virtual scroller cargue)
 * @param {string}  [opts.scrollTarget='window'] — 'window' para scroll global, o un selector CSS
 * @returns {Promise<{totalCount: number, cycles: number}>}
 */
async function scrollUntilStagnant(page, opts) {
  if (!opts || !opts.countSelector) {
    throw new Error('scrollUntilStagnant: opts.countSelector is required');
  }
  const {
    countSelector,
    maxCycles = 50,
    settleMs = 1500,
    waitBetweenScrollsMs = 600,
    scrollTarget = 'window'
  } = opts;

  return await page.evaluate(
    async ({ countSelector, maxCycles, settleMs, waitBetweenScrollsMs, scrollTarget }) => {
      const getCount = () => document.querySelectorAll(countSelector).length;
      let lastCount = getCount();
      let stagnantSince = Date.now();
      let cycle = 0;

      const scrollDown = () => {
        if (scrollTarget === 'window') {
          window.scrollTo(0, document.body.scrollHeight);
        } else {
          const el = document.querySelector(scrollTarget);
          if (el) el.scrollTo(0, el.scrollHeight);
        }
      };

      while (cycle < maxCycles) {
        scrollDown();
        await new Promise((r) => setTimeout(r, waitBetweenScrollsMs));
        const newCount = getCount();
        cycle += 1;
        if (newCount > lastCount) {
          lastCount = newCount;
          stagnantSince = Date.now();
        } else if (Date.now() - stagnantSince >= settleMs) {
          // No creció en `settleMs` → estancado, salir.
          break;
        }
      }

      return { totalCount: lastCount, cycles: cycle };
    },
    { countSelector, maxCycles, settleMs, waitBetweenScrollsMs, scrollTarget }
  );
}

module.exports = { scrollUntilStagnant };