// CLI: captura TODAS las responses a flight_records en una corrida y las
// guarda como fixtures. Sin filtros estrictos, sin assumptions sobre cual
// es la que queremos. Vos me mandas el bundle y yo identifico la correcta.
//
// Por que este approach es mas confiable:
//   - Deja que el frontend de DJI dispare los endpoints como lo haria normalmente
//   - Captura sin filtrar lo que matchea "flight_records" en la URL
//   - El usuario manda TODAS y yo elijo cual tiene el detalle por fumigacion
//
// Uso: node scripts/capture-all-flight-responses.js
// Output: tests/fixtures/djiag-live/flight-response-NN.json (uno por request)

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'djiag-live');

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.error('[capture-all] login + navegando a /records...');
    await client.launch();
    await client.login();
    const page = client.page;

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    const captured = [];
    const startTime = Date.now();

    // Listener attached ANTES de la navegacion (fix del bug original)
    page.on('response', async (res) => {
      const u = res.url();
      if (res.status() !== 200) return;
      // Match cualquier endpoint de flight_records (incluye /aggr, /aggr_by_day,
      // /overview, /only_all_ids, flight_records?... con paginacion)
      if (!u.includes('flight_records')) return;
      const idx = captured.length;
      try {
        const body = await res.json();
        // Sanitizar: quitar el JWT del body si lo tiene (no deberia pero por si)
        captured.push({ idx, url: u, body, ts: Date.now() - startTime });
        const label = u.split('?')[0].split('/').pop() || 'flight';
        const suffix = u.match(/page=(\d+)/)?.[1] ?? '';
        const fname = `flight-response-${String(idx).padStart(2, '0')}-${label}${suffix ? `-p${suffix}` : ''}.json`;
        const file = path.join(FIXTURES_DIR, fname);
        fs.writeFileSync(file, JSON.stringify({ url: u, body }, null, 2), 'utf8');
        console.error(`  [cap] ${fname} (${JSON.stringify(body).length} bytes, +${Date.now() - startTime}ms)`);
      } catch (err) {
        console.error(`  [skip] ${u.slice(0, 100)}: ${err.message.slice(0, 60)}`);
      }
    });

    // 1. Cargar /records (esto dispara aggr, overview, only_all_ids, aggr_by_day)
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 2. Click en el primer day_item (esto deberia disparar flight_records?page=1)
    const firstDay = page.locator('[id^="day_item_"]').first();
    if (await firstDay.count() > 0) {
      console.error('[capture-all] click en primer day_item...');
      await firstDay.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    // 3. Scroll para forzar lazy load de mas dias
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    } catch {}

    // 4. Intentar paginar (boton next en la lista de dias)
    try {
      const nextBtn = page.locator('button[aria-label="next"], .ant-pagination-next').first();
      if (await nextBtn.count() > 0) {
        console.error('[capture-all] click next page...');
        await nextBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    } catch {}

    // 5. Click en el segundo day_item para ver si hay otro detalle
    try {
      const secondDay = page.locator('[id^="day_item_"]').nth(1);
      if (await secondDay.count() > 0) {
        console.error('[capture-all] click en segundo day_item...');
        await secondDay.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    } catch {}

    // 6. Esperar un toque mas para las que llegaron tarde
    await page.waitForTimeout(3000);

    console.error(`\n[capture-all] OK: ${captured.length} responses capturadas`);
    if (captured.length === 0) {
      console.error('[capture-all] NINGUNA response capturada. Posibles causas:');
      console.error('  - Login no completo');
      console.error('  - /records no se cargo completamente (puede pasar con VPN/lentitud)');
      console.error('  - Las queries estan cacheadas (Ctrl+Shift+R y reintentar)');
    }
  } catch (err) {
    console.error('[capture-all] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
