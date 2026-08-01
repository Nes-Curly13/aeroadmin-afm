// Debug: navigate /records and capture ALL responses to find the aggregate one
const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

(async () => {
  const client = new DjiagKoreanClient();
  try {
    console.log('[debug-records] launching + login...');
    await client.launch();
    await client.login();
    const page = client.page;

    const captured = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      if (!url.includes('kr-ag2-api.dji.com')) return;
      try {
        const body = await resp.json().catch(() => null);
        captured.push({
          status: resp.status(),
          url,
          request: resp.request().method() + ' ' + url.split('?')[0] + '?' + (url.split('?')[1] || '').slice(0, 200),
          bodyPreview: body ? Object.keys(body) : null,
          dataKeys: body?.data ? Object.keys(body.data) : null,
          fullBody: body
        });
      } catch (e) {
        captured.push({ status: resp.status(), url, error: e.message });
      }
    });

    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    const aggr = captured.filter(c => c.url.includes('aggr_by_day') || c.url.includes('aggregate') || c.url.includes('aggr'));
    console.log(`\n[debug-records] total responses captured: ${captured.length}`);
    console.log(`[debug-records] aggregate-related: ${aggr.length}`);
    for (const r of aggr) {
      console.log(`\n  URL: ${r.url}`);
      console.log(`  status: ${r.status}`);
      console.log(`  body keys: ${r.bodyPreview}`);
      console.log(`  data keys: ${r.dataKeys}`);
      if (r.fullBody?.data?.aggr_info) {
        console.log(`  aggr_info: array of ${r.fullBody.data.aggr_info.length}`);
        console.log(`  first item: ${JSON.stringify(r.fullBody.data.aggr_info[0]).slice(0, 300)}`);
      } else if (r.fullBody) {
        console.log(`  full body: ${JSON.stringify(r.fullBody).slice(0, 500)}`);
      }
    }

    fs.writeFileSync(path.join(process.cwd(), 'djiag_exports', 'debug-records-responses.json'), JSON.stringify(captured, null, 2), 'utf8');
    console.log('\n[debug-records] all responses saved to djiag_exports/debug-records-responses.json');
  } catch (err) {
    console.error('[debug-records] ERR:', err.message);
  } finally {
    await client.close();
  }
})();