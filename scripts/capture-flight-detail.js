// CLI: captura agresivamente la response de `flight_records?page=1` (per-flight
// detail). A diferencia de aggr_by_day, este endpoint NO se dispara solo al
// cargar /records — necesita un drill-down dentro de un day_item.
//
// Por que es agresivo:
//   - Click en day_item
//   - Espera a que el detail panel se abra
//   - Click en cualquier boton "ver mas" o paginacion dentro del panel
//   - Scroll dentro del panel
//   - Captura cualquier response con /flight_records? en la URL (con ?)
//
// Uso: node scripts/capture-flight-detail.js
// Output: tests/fixtures/djiag-live/flight-detail-NN.json

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'djiag-live');

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.error('[capture-detail] login + navegando a /records...');
    await client.launch();
    await client.login();
    const page = client.page;

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    const captured = [];
    page.on('response', async (res) => {
      const u = res.url();
      if (res.status() !== 200) return;
      // Match: /flight_records?... con ?, no /aggr /aggr_by_day /overview /only_all_ids
      if (!u.includes('/flight_records?')) return;
      if (u.includes('aggr')) return;
      if (u.includes('overview')) return;
      if (u.includes('only_all_ids')) return;
      try {
        const body = await res.json();
        const idx = captured.length;
        captured.push({ url: u, body });
        const fname = `flight-detail-${String(idx).padStart(2, '0')}.json`;
        fs.writeFileSync(path.join(FIXTURES_DIR, fname), JSON.stringify({ url: u, body }, null, 2), 'utf8');
        console.error(`  [cap] ${fname} (${JSON.stringify(body).length} bytes)`);
      } catch {}
    });

    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Drill-down: click en cada day_item hasta que dispare la lista de vuelos
    const dayItems = await page.locator('[id^="day_item_"]').all();
    console.error(`[capture-detail] ${dayItems.length} day_items encontrados`);

    for (let i = 0; i < Math.min(dayItems.length, 3); i++) {
      try {
        const item = dayItems[i];
        await item.scrollIntoViewIfNeeded();
        await item.click({ timeout: 5000 });
        await page.waitForTimeout(4000);
        console.error(`  [click] day_item #${i + 1}`);

        // Intentar click en cualquier "view all" o pagination dentro del panel abierto
        try {
          // Boton "ver todos" o "load more" en el detalle
          const loadMore = page.locator('button:has-text("View"), button:has-text("More"), button:has-text("Load"), [class*="load-more"]').first();
          if (await loadMore.count() > 0) {
            await loadMore.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(2000);
            console.error(`  [click] load more button`);
          }
        } catch {}

        // Intentar scroll dentro del panel de detalle
        try {
          await page.evaluate(() => {
            const detail = document.querySelector('[class*="detail"], [class*="panel"], [class*="drawer"]');
            if (detail) detail.scrollTop = detail.scrollHeight;
          });
          await page.waitForTimeout(1000);
        } catch {}

        // Intentar paginacion dentro del panel
        try {
          const nextBtn = page.locator('button[aria-label="next"], .ant-pagination-next, [class*="pager"] li:last-child a').last();
          if (await nextBtn.count() > 0) {
            await nextBtn.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(2000);
            console.error(`  [click] next page`);
          }
        } catch {}
      } catch (err) {
        console.warn(`  [warn] day_item #${i + 1}: ${err.message.slice(0, 60)}`);
      }
    }

    await page.waitForTimeout(3000);
    console.error(`\n[capture-detail] ${captured.length} responses capturadas`);

    if (captured.length === 0) {
      console.error('[capture-detail] NINGUNA response. Posibles razones:');
      console.error('  - El per-flight list no se dispara con este UI flow');
      console.error('  - Hay un step intermedio que no hicimos (hover, tab, etc.)');
      console.error('  - El endpoint requiere headers/params especificos que el UI no envia');
      console.error('');
      console.error('Alternativa: hacelo manual en DevTools Network (ver mensajes anteriores).');
    }
  } catch (err) {
    console.error('[capture-detail] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
