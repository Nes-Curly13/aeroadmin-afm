// CLI minimalista: solo captura la response de flight_records/aggr_by_day
// y la imprime a stdout. Cero fixtures, cero archivos. Copy-paste el output.
//
// Uso: node scripts/print-aggr-by-day.js
//
// Output: el JSON crudo de la primera página de aggr_by_day, formateado.

const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.error('[print-aggr] login + navegando a /records...');
    await client.launch();
    await client.login();
    const page = client.page;

    // Attach listener ANTES de la navegación (era el bug del script anterior)
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('aggr_by_day') && r.status() === 200,
      { timeout: 60000 }
    );

    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Si no vino, click en el primer day_item
    const firstDay = page.locator('[id^="day_item_"]').first();
    if (await firstDay.count() > 0) {
      console.error('[print-aggr] click en primer day_item...');
      await firstDay.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }

    console.error('[print-aggr] esperando response de aggr_by_day...');
    const response = await responsePromise;
    const body = await response.json();

    console.error(`[print-aggr] OK (${JSON.stringify(body).length} bytes, status ${response.status()})`);
    // A stdout: SOLO el JSON, nada más. Así el user puede pipearlo o copy-pastearlo.
    process.stdout.write(JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('[print-aggr] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
