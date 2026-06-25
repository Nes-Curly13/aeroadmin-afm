// CLI: llama DIRECTAMENTE al endpoint flight_records desde el contexto
// de la pagina, aprovechando que el frontend de DJI ya tiene un fetch
// monkey-patcheado con el HMAC signer. Sin esperar a que el frontend
// dispare el call, lo hacemos nosotros.
//
// Por que este approach es mas confiable que waitForResponse:
//   - No depende de que el frontend dispare el endpoint
//   - No hay race condition con listeners
//   - Funciona aunque el frontend no este en la vista correcta
//
// Uso: node scripts/dump-flights-direct.js
// Output: JSON crudo a stdout

const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

async function main() {
  const client = new DjiagKoreanClient();
  try {
    console.error('[dump-flights] login + navegando a /records...');
    await client.launch();
    await client.login();
    const page = client.page;
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Llamar al endpoint desde el contexto del browser. El fetch monkey-patcheado
    // del frontend de DJI anade los headers de signing automaticamente.
    const now = Date.now();
    const startOfDay = now - (now % 86400000); // midnight UTC today
    const endOfDay = startOfDay + 86400000 - 1;

    // Rango por defecto: ultimos 30 dias para asegurar data
    const from = startOfDay - 30 * 86400000;
    const to = endOfDay;

    const url = `https://kr-ag2-api.dji.com/api/web/v1/flight_records?filters%5Btimestamp_gteq%5D=${from}&filters%5Btimestamp_lteq%5D=${to}&page=1&page_size=10`;

    console.error(`[dump-flights] fetch desde page context: ${url.slice(0, 100)}...`);

    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const r = await fetch(fetchUrl, { method: 'GET', credentials: 'include' });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = { _rawText: text.slice(0, 2000) }; }
        return { status: r.status, ok: r.ok, body };
      } catch (err) {
        return { error: err.message };
      }
    }, url);

    if (result.error) {
      console.error(`[dump-flights] ERROR desde page: ${result.error}`);
      process.exit(1);
    }

    console.error(`[dump-flights] OK (status ${result.status}, ${JSON.stringify(result.body).length} bytes)`);
    process.stdout.write(JSON.stringify(result.body, null, 2));
  } catch (err) {
    console.error('[dump-flights] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
