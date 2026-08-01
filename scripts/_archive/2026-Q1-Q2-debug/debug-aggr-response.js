// Debug: capture raw aggr_by_day response from DJI
const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

const SEC_PER_DAY = 86400;
const PAGE_SIZE = 30;

(async () => {
  const daysBack = 30;
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - daysBack * SEC_PER_DAY;

  const client = new DjiagKoreanClient();
  try {
    console.log('[debug-aggr] launching + login...');
    await client.launch();
    await client.login();
    const page = client.page;

    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const url = `https://kr-ag2-api.dji.com/api/web/v1/flight_records/aggr_by_day?filters%5Btimestamp_gteq%5D=${startTs * 1000}&filters%5Btimestamp_lteq%5D=${endTs * 1000}&page=1&page_size=${PAGE_SIZE}`;
    console.log(`[debug-aggr] fetching: ${url.slice(0, 100)}...`);

    const result = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { method: 'GET', credentials: 'include' });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 2000) }; }
        return { status: r.status, ok: r.ok, body };
      } catch (e) {
        return { error: e.message };
      }
    }, url);

    console.log('[debug-aggr] status:', result.status, 'ok:', result.ok);
    console.log('[debug-aggr] body keys:', result.body ? Object.keys(result.body) : 'no body');
    if (result.body?.data) {
      console.log('[debug-aggr] data keys:', Object.keys(result.body.data));
      const ai = result.body.data.aggr_info;
      console.log('[debug-aggr] aggr_info type:', Array.isArray(ai) ? 'array' : typeof ai);
      if (Array.isArray(ai)) console.log('[debug-aggr] aggr_info length:', ai.length);
      else console.log('[debug-aggr] aggr_info value:', JSON.stringify(ai).slice(0, 500));
    }

    const outPath = path.join(process.cwd(), 'djiag_exports', 'debug-aggr-response.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`[debug-aggr] saved to ${outPath}`);
  } catch (err) {
    console.error('[debug-aggr] ERR:', err.message);
  } finally {
    await client.close();
  }
})();