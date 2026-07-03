// CLI: fetch de fumigaciones (aggr_by_day) desde DJI AG, paginando.
//
// Estrategia de captura (cambio 2026-07-03 vs versión anterior):
//   - ANTES: page.evaluate(fetch()) → DJI rechaza con 408 ("请求时间无效")
//     porque el signer WASM no está en window.fetch nativo.
//   - AHORA: page.on('response') ANTES de navegar → capturar las responses
//     de aggr_by_day que el frontend DJI dispara naturalmente (ya firmadas
//     por su interceptor Axios). Mismo patrón que scrape_djiag_perflight.js.
//
// Paginación:
//   - DJI NO expone totalCount ni hasNextPage en aggr_by_day.
//   - El response siempre trae hasta 30 días (page_size default).
//   - Para paginar más allá, el UI de /records tiene un botón "Filter" con un
//     Ant Design RangePicker. Setear fechas custom → UI dispara nuevo
//     aggr_by_day → capturamos la response.
//   - Cursor: lteq del response anterior - 1 día (en ms).
//   - Stop: si response trae < 30 días, última página. O si llegamos al
//     rango objetivo (daysBack).
//
// Output: djiag_exports/fumigations.json con TODOS los días únicos.
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD
//   DJIAG_DAYS_BACK (opcional, default 365)

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');
const { parseAggrByDayResponse } = require('../lib/djiag-fumigations-fetcher');

const PAGE_SIZE = 30;
const SEC_PER_DAY = 86400;
const MS_PER_DAY = SEC_PER_DAY * 1000;
const MAX_UI_PAGINATION_ATTEMPTS = 3;

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'fumigations.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const daysBack = Number(process.env.DJIAG_DAYS_BACK ?? 365);
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - daysBack * SEC_PER_DAY;

  const client = new DjiagKoreanClient();
  try {
    console.log(`[fetch-fumigations] login + navegando a /records...`);
    await client.launch();
    await client.login();
    const page = client.page;

    // 1. Set up response capture ANTES de navegar. Mismo patrón que
    //    scrape_djiag_perflight.js. Guardamos cada body de aggr_by_day con
    //    status 200 en un array.
    const captured = [];
    const handler = async (resp) => {
      const url = resp.url();
      if (!url.includes('flight_records/aggr_by_day')) return;
      if (resp.status() !== 200) {
        console.warn(`  [warn] aggr_by_day status ${resp.status()}: ${url.slice(0, 80)}`);
        return;
      }
      try {
        const body = await resp.json();
        captured.push({ body, ts: Date.now() });
      } catch (err) {
        console.warn(`  [warn] no se pudo parsear aggr_by_day response: ${err.message.slice(0, 60)}`);
      }
    };
    page.on('response', handler);

    // 2. Navegar a /records → el UI dispara la primera request a aggr_by_day
    //    con rango default (los últimos 30 días desde hoy).
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const maxPages = Math.ceil(daysBack / PAGE_SIZE) + 2;

    // 3. Loop de paginación: para cada página siguiente, abrir el Filter
    //    panel del UI y setear un custom range. Si el UI no responde (DJI
    //    cambió los selectors o no hay RangePicker), salir del loop y usar
    //    lo que tengamos — que sigue siendo mejor que 0 días por 408.
    for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
      if (captured.length < pageNum - 1) {
        console.warn(`  [warn] page ${pageNum - 1} no capturada, parando`);
        break;
      }
      const prevBody = captured[pageNum - 2].body;
      const prevParsed = parseAggrByDayResponse(prevBody, PAGE_SIZE);
      if (prevParsed.days.length < PAGE_SIZE) {
        console.log(`  [stop] page ${pageNum - 1} trajo ${prevParsed.days.length} días (última)`);
        break;
      }
      const oldestTsSec = prevParsed.days[prevParsed.days.length - 1].createTimestamp;
      const newLteqMs = (oldestTsSec - SEC_PER_DAY) * 1000;
      const newGteqMs = newLteqMs - PAGE_SIZE * MS_PER_DAY;
      if (newGteqMs < startTs * 1000) {
        console.log(`  [stop] llegamos al inicio del rango objetivo`);
        break;
      }

      console.log(`[fetch-fumigations] page ${pageNum}: lteq=${new Date(newLteqMs).toISOString().slice(0, 10)}`);
      const ok = await setDateRangeInUi(page, newGteqMs, newLteqMs);
      if (!ok) {
        console.warn(`  [stop] UI pagination no disponible (Filter/RangePicker no encontrado). Toca fumigations.json manualmente o implementá los selectors correctos.`);
        break;
      }
      // Esperar a que llegue la response N (esperamos la siguiente después de la última capturada)
      const before = captured.length;
      const ok2 = await waitForCapturedCount(page, captured, before + 1, 10000);
      if (!ok2) {
        console.warn(`  [warn] page ${pageNum} no llegó response en 10s, parando`);
        break;
      }
    }

    page.off('response', handler);

    // 4. Mergear días únicos por date. Cada response trae hasta 30 días con
    //    create_timestamp (segundos UTC al inicio del día). Dedup por date.
    const allDays = [];
    for (const { body } of captured) {
      const parsed = parseAggrByDayResponse(body, PAGE_SIZE);
      allDays.push(...parsed.days);
    }
    const byDate = new Map();
    for (const d of allDays) {
      if (d.date) byDate.set(d.date, d);
    }
    const uniqueDays = [...byDate.values()].sort((a, b) => (b.createTimestamp || 0) - (a.createTimestamp || 0));

    const out = {
      days: uniqueDays,
      totalDays: uniqueDays.length,
      fetchedAt: new Date().toISOString(),
      source: 'kr-ag2-api.dji.com/api/web/v1/flight_records/aggr_by_day',
      dateRange: { startTs, endTs },
      pagination: { pagesCaptured: captured.length }
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(
      `\n[fetch-fumigations] OK: ${uniqueDays.length} días únicos (${captured.length} páginas) → ${path.relative(process.cwd(), outPath)}`
    );
  } catch (err) {
    console.error('[fetch-fumigations] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Abrir el panel Filter del UI de /records y setear el date range custom.
 * Devuelve true si el UI interaction funcionó (response nueva esperada),
 * false si el Filter button o RangePicker no se encontró.
 *
 * Estrategia:
 *   - Click en el botón "Filter" (selector por texto, Ant Design suele usar
 *     .ant-btn con texto "Filter" o similar).
 *   - En el popup que se abre, buscar el Ant Design RangePicker.
 *   - Setear las fechas en los dos inputs del RangePicker y confirmar.
 *   - Ant Design dispara onChange al cambiar fecha → la UI hace el fetch
 *     automáticamente.
 *
 * Si DJI cambió el UI (cosa que ya pasó antes, ver SCRAPER_DEFECTS.md §2.4),
 * los selectores pueden no matchear. Por eso MAX_UI_PAGINATION_ATTEMPTS
 * se queda en 3 y luego sale del loop.
 */
async function setDateRangeInUi(page, gteqMs, lteqMs) {
  for (let attempt = 1; attempt <= MAX_UI_PAGINATION_ATTEMPTS; attempt++) {
    try {
      // 1. Click en "Filter" — el botón en /records suele tener texto "Filter"
      const filterBtn = page.getByRole('button', { name: /filter/i }).first();
      if (await filterBtn.count() === 0) {
        console.warn(`    [ui] attempt ${attempt}: botón "Filter" no encontrado`);
        continue;
      }
      await filterBtn.click({ timeout: 3000, force: true });
      await page.waitForTimeout(800);

      // 2. Localizar el RangePicker de Ant Design (selector estándar)
      const rangePicker = page.locator('.ant-picker-range').first();
      if (await rangePicker.count() === 0) {
        console.warn(`    [ui] attempt ${attempt}: RangePicker no encontrado después de click Filter`);
        // Cerrar el popup antes de reintentar
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        continue;
      }

      // 3. Inputs del RangePicker (son dos: start y end)
      const inputs = rangePicker.locator('input.ant-picker-input input');
      const inputCount = await inputs.count();
      if (inputCount < 2) {
        console.warn(`    [ui] attempt ${attempt}: RangePicker tiene ${inputCount} inputs (esperaba 2)`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        continue;
      }
      const fromStr = formatDateForInput(gteqMs);
      const toStr = formatDateForInput(lteqMs);

      // 4. Llenar los inputs. Ant Design acepta YYYY-MM-DD en formato ISO.
      const startInput = inputs.nth(0);
      const endInput = inputs.nth(1);
      await startInput.click({ timeout: 2000 });
      await startInput.fill('');
      await startInput.fill(fromStr);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await endInput.click({ timeout: 2000 });
      await endInput.fill('');
      await endInput.fill(toStr);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // 5. Si el popup sigue abierto, cerrarlo
      try {
        await page.keyboard.press('Escape');
      } catch {}
      await page.waitForTimeout(800);

      return true;
    } catch (err) {
      console.warn(`    [ui] attempt ${attempt}: error - ${err.message.slice(0, 80)}`);
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } catch {}
    }
  }
  return false;
}

/**
 * Espera a que `arr.length` alcance `target` o timeoutMs.
 * Devuelve true si llegó, false si timeout.
 */
async function waitForCapturedCount(page, arr, target, timeoutMs) {
  const t0 = Date.now();
  while (arr.length < target && Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(200);
  }
  return arr.length >= target;
}

/**
 * ms epoch → 'YYYY-MM-DD' (lo que acepta Ant Design RangePicker input).
 */
function formatDateForInput(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

if (require.main === module) {
  main();
}

module.exports = { main, setDateRangeInUi, formatDateForInput };