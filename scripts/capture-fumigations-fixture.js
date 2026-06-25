// CLI: captura las responses de los endpoints de flight_records (Task History)
// y las guarda como fixtures para que el importer de fumigaciones pueda
// desarrollarse contra data real.
//
// NO requiere que peges JSON a mano — usa el Korean client de Playwright
// para navegar, login y capturar.
//
// Bug fix (2026-06-19): el listener de responses se attacha ANTES de la
// navegación. Antes se attachaba después, así que se perdía las responses
// que disparan durante `page.goto` (que es la mayoría).
//
// Uso:
//   node scripts/capture-fumigations-fixture.js
//
// Output:
//   tests/fixtures/djiag-live/aggr_by_day-page-1.json
//   tests/fixtures/djiag-live/aggr_by_day-page-2.json
//   tests/fixtures/djiag-live/flight_overview-precision-1.json
//   tests/fixtures/djiag-live/flight_only_all_ids.json
//   tests/fixtures/djiag-live/flight_aggr.json
//
// Después podés abrir esos JSONs y mandármelos a mí.

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'djiag-live');

/**
 * Guarda una response capturada a disco. Si la response ya existe, la pisa
 * (asumimos que queremos la última versión).
 */
function saveFixture(label, payload) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const file = path.join(FIXTURES_DIR, `${label}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  const size = payload ? JSON.stringify(payload).length : 0;
  console.log(`  → ${path.relative(process.cwd(), file)} (${size} bytes)`);
}

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.log('[capture] login + navegando a /records (Task History)...');
    await client.launch();
    await client.login();
    const page = client.page;

    // Vamos a capturar EN PARALELO: navegamos a /records, y todas las responses
    // que matcheen patrones conocidos se guardan. El listener se attacha
    // ANTES del goto para no perder las responses que disparan durante la
    // navegación (era el bug del script anterior).
    const captured = new Map(); // label → payload

    page.on('response', async (res) => {
      const u = res.url();
      if (res.status() !== 200) return;
      let label = null;
      if (u.includes('aggr_by_day')) label = 'flight_aggr_by_day-page-1';
      else if (u.includes('only_all_ids')) label = 'flight_only_all_ids';
      else if (u.match(/overview\?.*precision=1/)) label = 'flight_overview-precision-1';
      else if (u.match(/overview\?.*precision=4/)) label = 'flight_overview-precision-4';
      else if (u.match(/flight_records\/aggr[^_]/)) label = 'flight_aggr';
      if (label && !captured.has(label)) {
        try {
          const body = await res.json();
          captured.set(label, { url: u, body });
          console.log(`  [cap] ${label}`);
        } catch {}
      }
    });

    // Acción 1: navegar a /records y esperar a que cargue la lista de días
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Acción 2: click en el primer day_item para abrir el detalle (dispara aggr_by_day si no vino)
    let dayItemExists = false;
    try {
      const firstDay = page.locator('[id^="day_item_"]').first();
      if (await firstDay.count() > 0) {
        dayItemExists = true;
        console.log('[capture] click en primer day_item para disparar aggr_by_day...');
        await firstDay.click({ timeout: 5000 });
        await page.waitForTimeout(4000);
      }
    } catch (err) {
      console.warn(`  [warn] click day_item: ${err.message.slice(0, 80)}`);
    }

    // Acción 3: scroll para forzar lazy load
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    } catch {}

    // Acción 4: intentar paginar a página 2 si existe botón
    try {
      const nextBtn = page.locator('button[aria-label="next"], .ant-pagination-next, li.ant-pagination-next a').first();
      if (await nextBtn.count() > 0) {
        console.log('[capture] paginando a página 2 de aggr_by_day...');
        await nextBtn.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      }
    } catch {}
    console.log(`\n[capture] ${captured.size} fixtures capturados:`);
    for (const [label, payload] of captured.entries()) {
      saveFixture(label, payload);
    }

    if (captured.size === 0) {
      console.warn('[capture] ⚠ no se capturó ninguna response. Posibles causas:');
      console.warn('  - Login no completó (revisar .env.local)');
      console.warn('  - /records no carga las queries en headless (raro pero pasa)');
      console.warn('  - Las queries están cacheadas (probar con Ctrl+Shift+R en UI y reintentar)');
    }
  } catch (err) {
    console.error('[capture] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, saveFixture, FIXTURES_DIR };
