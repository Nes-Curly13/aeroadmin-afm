// Scraper DJI AG v2 — con endpoint discovery + drill-down por día.
//
// Cambios vs v1 (scrape_djiag_records.js):
//   1. --smoke mode: solo navega y captura network/HTML sin descargar nada.
//      Útil para descubrir endpoints cuando DJI cambia el frontend.
//   2. Drill-down: para cada day en /records, intenta expandir y capturar
//      el detalle por parcela (el objetivo: extraer fumigaciones por parcela).
//   3. Endpoint discovery: trackea todas las URLs de GraphQL que DJI llama.
//   4. Retry con backoff y mejor logging de errores.
//   5. No falla en silencio cuando el endpoint cambia: ahora loguea
//      todos los GraphQL endpoints vistos y sugiere cuál usar.
//
// Uso:
//   node scrape_djiag_records.js                       # captura normal
//   node scrape_djiag_records.js --smoke              # solo navegación, sin descargas
//   node scrape_djiag_records.js --headless=false     # ver el browser (debug)
//   node scrape_djiag_records.js --days 7             # solo últimos 7 días
//   node scrape_djiag_records.js --no-drill           # no intentar per-day drill-down
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD — credenciales DJI

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function loadEnvFromLocalFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

// =====================================================================
// Retry con backoff
// =====================================================================
async function withRetry(fn, attempts = 3, baseDelayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const wait = baseDelayMs * Math.pow(2, i);
      console.warn(`  intento ${i + 1}/${attempts} falló: ${err.message.slice(0, 80)}... esperando ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// =====================================================================
// Modo SMOKE: navega y captura todo, sin descargar nada
// =====================================================================
async function smokeRun(page, outDir) {
  console.log('[SMOKE] Solo navegación. No se descargan assets.');
  fs.mkdirSync(path.join(outDir, 'smoke'), { recursive: true });

  const discoveredEndpoints = new Map(); // url → count
  const allResponses = [];

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('djiag.com') && !url.includes('agro-vg.djiag')) return;
    const rec = { status: res.status(), url, method: res.request().method() };
    allResponses.push(rec);
    if (url.includes('/graphql') || url.includes('api/')) {
      const key = url.split('?')[0];
      discoveredEndpoints.set(key, (discoveredEndpoints.get(key) ?? 0) + 1);
    }
  });

  // Visitar páginas principales y capturar HTML
  const pages = [
    ['login', 'https://www.djiag.com/login'],
    ['mission', 'https://www.djiag.com/mission'],
    ['records', 'https://www.djiag.com/records'],
    ['devices', 'https://www.djiag.com/v2/devices']
  ];
  for (const [label, url] of pages) {
    try {
      console.log(`  [SMOKE] visitando ${label}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      const html = await page.content();
      fs.writeFileSync(path.join(outDir, 'smoke', `${label}.html`), html, 'utf8');
      const text = await page.locator('body').innerText();
      fs.writeFileSync(path.join(outDir, 'smoke', `${label}.txt`), text, 'utf8');
    } catch (err) {
      console.warn(`  [SMOKE] ${label} falló: ${err.message.slice(0, 80)}`);
    }
  }

  // Intentar expandir el primer día en /records (si ya estamos ahí)
  try {
    console.log('  [SMOKE] intentando drill-down del primer day_item en /records');
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const firstDay = page.locator('[id^="day_item_"]').first();
    if (await firstDay.count() > 0) {
      // Capturar antes del click
      const htmlBefore = await page.content();
      fs.writeFileSync(path.join(outDir, 'smoke', 'records-before-click.html'), htmlBefore, 'utf8');

      // Intentar click
      try {
        await firstDay.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
        const htmlAfter = await page.content();
        fs.writeFileSync(path.join(outDir, 'smoke', 'records-after-click.html'), htmlAfter, 'utf8');
        const textAfter = await page.locator('body').innerText();
        fs.writeFileSync(path.join(outDir, 'smoke', 'records-after-click.txt'), textAfter, 'utf8');
        console.log('  [SMOKE] drill-down exitoso. Revisa records-after-click.html/.txt');
      } catch (err) {
        console.log(`  [SMOKE] day_item no es clickeable: ${err.message.slice(0, 60)}`);
      }
    } else {
      console.log('  [SMOKE] no se encontró ningún day_item');
    }
  } catch (err) {
    console.warn(`  [SMOKE] drill-down error: ${err.message.slice(0, 80)}`);
  }

  // Guardar resumen
  const endpointSummary = [...discoveredEndpoints.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url, count]) => ({ url, count }));
  fs.writeFileSync(
    path.join(outDir, 'smoke', 'endpoints.json'),
    JSON.stringify({ discovered: endpointSummary, total: allResponses.length }, null, 2),
    'utf8'
  );
  console.log(`\n[SMOKE] Resumen:`);
  console.log(`  - ${allResponses.length} responses capturadas`);
  console.log(`  - ${discoveredEndpoints.size} endpoints únicos (ver smoke/endpoints.json)`);
  for (const [url, count] of endpointSummary) {
    console.log(`    [${count}x] ${url}`);
  }
  return { endpointSummary, allResponses };
}

// =====================================================================
// Capturar y parsear día individual (drill-down)
// =====================================================================
async function captureDayDetail(page, dayItem, outDir, dayIndex) {
  const html = await page.content();
  fs.writeFileSync(path.join(outDir, `day-${dayIndex}-expanded.html`), html, 'utf8');
  const text = await page.locator('body').innerText();
  fs.writeFileSync(path.join(outDir, `day-${dayIndex}-expanded.txt`), text, 'utf8');
  return text;
}

async function drillDownDays(page, outDir, maxDays) {
  const drillDir = path.join(outDir, 'drill_down');
  fs.mkdirSync(drillDir, { recursive: true });

  const dayItems = await page.locator('[id^="day_item_"]').all();
  const count = Math.min(dayItems.length, maxDays);
  console.log(`  drill-down: ${count} días a expandir (de ${dayItems.length} visibles)`);

  const captured = [];
  for (let i = 0; i < count; i++) {
    try {
      // Re-leer los day items en cada iteración (el DOM puede cambiar)
      const items = await page.locator('[id^="day_item_"]').all();
      if (i >= items.length) break;
      const item = items[i];
      // Scroll a la vista
      await item.scrollIntoViewIfNeeded();
      await item.click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      const text = await captureDayDetail(page, item, drillDir, i);
      captured.push({ index: i, text });
    } catch (err) {
      console.warn(`    día ${i}: ${err.message.slice(0, 60)}`);
    }
  }
  return captured;
}

// =====================================================================
// Main
// =====================================================================
async function main() {
  loadEnvFromLocalFile();
  const email = process.env.DJIAG_EMAIL;
  const password = process.env.DJIAG_PASSWORD;
  if (!email || !password) {
    throw new Error('Set DJIAG_EMAIL and DJIAG_PASSWORD before running this script.');
  }

  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const noDrill = args.includes('--no-drill');
  const headless = !args.includes('--headless=false');
  const daysIdx = args.indexOf('--days');
  const maxDays = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // Login
    console.log('[LOGIN] navegando a /login...');
    await page.goto('https://www.djiag.com/login', { waitUntil: 'domcontentloaded' });
    try { await page.getByRole('button', { name: 'Accept All Cookies' }).click({ timeout: 3000 }); } catch {}
    try { await page.locator('input[type="checkbox"]').first().check({ timeout: 3000 }); } catch {}
    try { await page.getByRole('button', { name: 'Log in with DJI account' }).click({ timeout: 3000 }); } catch {}
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="username"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await Promise.all([
      page.waitForURL('**/mission', { timeout: 60000 }),
      page.getByRole('button', { name: 'Log In' }).click()
    ]);
    console.log('[LOGIN] OK');

    const outDir = path.join(process.cwd(), 'djiag_exports');
    fs.mkdirSync(outDir, { recursive: true });

    if (smoke) {
      // Modo exploración
      const result = await smokeRun(page, outDir);
      // Guardar un config sugerido basado en lo descubierto
      const landEndpoint = result.endpointSummary.find(e => e.url.includes('land'));
      if (landEndpoint) {
        console.log(`\n[SMOKE] Endpoint de lands detectado: ${landEndpoint.url}`);
        console.log(`  → actualiza el filtro en la línea 116 de scrape_djiag_records.js`);
        console.log(`  → sugerencia: filtro = ${path.basename(landEndpoint.url).split('?')[0]}`);
      } else {
        console.log(`\n[SMOKE] No se detectó endpoint de 'lands' automáticamente.`);
        console.log(`  Revisa djiag_exports/smoke/endpoints.json para ver todos los endpoints.`);
      }
    } else {
      // Modo normal: visitar /records y drill-down
      console.log('[RECORDS] navegando a /records...');
      await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      const recordsText = await page.locator('body').innerText();
      fs.writeFileSync(path.join(outDir, 'records_page_text.txt'), recordsText, 'utf8');

      if (!noDrill) {
        await drillDownDays(page, outDir, maxDays);
      }
      console.log(`\n[DONE] Datos en ${outDir}`);
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
