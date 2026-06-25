// CLI minimalista: captura la response de `flight_records` (sin sufijo) y
// la imprime a stdout. Este endpoint devuelve la lista paginada de vuelos
// individuales — 1 fila por fumigación. Es lo que necesitamos para
// popular dji_fumigations.
//
// Uso: node scripts/print-flight-records.js
// Output: JSON crudo de la primera página, formateado.

const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.error('[print-flights] login + navegando a /records...');
    await client.launch();
    await client.login();
    const page = client.page;

    // Capture TODO lo que matchee flight_records (sin sufijo) o aggr_by_day.
    // El primero que llegue, gana. Si el user quiere ambos, lo extendemos.
    const responsePromise = page.waitForResponse(
      (r) => {
        const u = r.url();
        // Match flight_records?... con query params, pero NO aggr/aggr_by_day/overview/only_all_ids
        const isFlightsList = u.includes('/flight_records?') || u.match(/\/flight_records\?/);
        const isAggr = u.includes('aggr');
        return r.status() === 200 && isFlightsList && !isAggr;
      },
      { timeout: 60000 }
    );

    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Forzar: click en el primer day_item
    const firstDay = page.locator('[id^="day_item_"]').first();
    if (await firstDay.count() > 0) {
      console.error('[print-flights] click en primer day_item...');
      await firstDay.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }

    console.error('[print-flights] esperando response de flight_records (lista)...');
    const response = await responsePromise;
    const body = await response.json();

    console.error(`[print-flights] OK (${JSON.stringify(body).length} bytes, status ${response.status()})`);
    process.stdout.write(JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('[print-flights] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
