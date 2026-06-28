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
const { scrollUntilStagnant } = require('./lib/playwright-scroll');

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
async function smokeRun(page, outDir, discoveredEndpoints, allResponses) {
  console.log('[SMOKE] Solo navegación. No se descargan assets.');
  fs.mkdirSync(path.join(outDir, 'smoke'), { recursive: true });

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

      // (2026-06-19) §2.1 lands: después de /mission, click en el menu item
      // "Field Management" del sidebar. page.goto a /mission no re-renderiza
      // cuando ya estamos ahí (React Router cache), entonces la query
      // ?name=lands no se dispara sin click explícito.
      if (label === 'mission') {
        try {
          await page.locator('aside li[title="Field Management"]').first().click({ timeout: 5000 });
          await page.waitForTimeout(4000);
          console.log('  [SMOKE] clickeó "Field Management" en sidebar (debería disparar ?name=lands)');
        } catch (clickErr) {
          console.warn(`  [SMOKE] no se pudo clickear Field Management: ${clickErr.message.slice(0, 60)}`);
        }
      }

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
  console.log(`  - ${opCounters.size} operaciones GraphQL únicas capturadas`);
  for (const [op, n] of opCounters.entries()) {
    console.log(`    [${n}x] ${op}`);
  }
  try {
    for (const [url, count] of endpointSummary) {
      console.log(`    [${count}x] ${url}`);
    }
  } catch (err) {
    console.warn(`  [SMOKE] no se pudo iterar endpointSummary: ${err.message}`);
  }
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
  // (2026-06-19) §2.1: locale='zh-CN' y accept-language='zh-CN,zh' hacen que
  // DJI rutee al backend coreano (kr-ag2-api.dji.com) en vez del regional
  // (agro-vg.djiag.com). Sin esto, el query ?name=lands viene vacío.
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: 'zh-CN',
    extraHTTPHeaders: {
      'accept-language': 'zh-CN,zh'
    }
  });
  const page = await context.newPage();

  // Endpoint discovery: corre en AMBOS modos (smoke + normal) para que
  // djiag_exports/smoke/endpoints.json siempre tenga data de la corrida.
  const discoveredEndpoints = new Map(); // url → count
  const allResponses = [];
  const opCounters = new Map(); // operationName → count
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('djiag.com')) return; // agro-vg.djiag.com es subset
    const rec = { status: res.status(), url, method: res.request().method() };
    allResponses.push(rec);
    if (url.includes('/graphql') || url.includes('api/')) {
      const key = url.split('?')[0];
      discoveredEndpoints.set(key, (discoveredEndpoints.get(key) ?? 0) + 1);
    }

    // Capturar bodies de TODAS las responses a /api/graphql para entender el
    // schema. (2026-06-19: ampliado para §2.1 — el frontend de DJI tiene dos
    // code paths:
    //   - regional: POST /api/graphql con operationName en el body
    //   - coreano:  POST /ag-plot/api/graphql?name=lands con la operación en URL
    // Capturamos ambos. operationName sale del request body; si no está, del
    // ?name=... de la URL; si tampoco, 'unknown'.)
    try {
      if (!url.includes('/api/graphql')) return;
      if (res.status() !== 200) return;
      const req = res.request();
      const reqBody = req.postDataJSON();
      let op = reqBody?.operationName;
      if (!op) {
        const nameMatch = url.match(/[?&]name=([\w-]+)/);
        if (nameMatch) op = nameMatch[1];
      }
      op = op || 'unknown';
      const resBody = await res.json();
      const n = (opCounters.get(op) || 0) + 1;
      opCounters.set(op, n);
      const dir = path.join(process.cwd(), 'djiag_exports', 'smoke');
      fs.mkdirSync(dir, { recursive: true });
      const fname = `graphql_${op}_${String(n).padStart(2, '0')}.json`;
      const file = path.join(dir, fname);
      fs.writeFileSync(file, JSON.stringify({
        url: res.url(),
        method: req.method(),
        request: reqBody,
        response: resBody,
      }, null, 2), 'utf8');
      console.log(`  [CAPTURE] ${op} → ${fname}`);
    } catch (err) {
      // Log con detalle para ver las 2 calls que se estaban perdiendo
      console.warn(`  [CAPTURE] falló al leer body de ${url}: ${err.message.slice(0, 80)}`);
    }
  });

  try {
    // Login (con retry: a veces DJI pone CAPTCHA o rate-limit al primer hit)
    console.log('[LOGIN] navegando a /login...');
    await withRetry(async () => {
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
    }, 3, 2000);
    console.log('[LOGIN] OK');

    const outDir = path.join(process.cwd(), 'djiag_exports');
    fs.mkdirSync(outDir, { recursive: true });

    if (smoke) {
      // Modo exploración
      await smokeRun(page, outDir, discoveredEndpoints, allResponses);
      // Sugerir el endpoint de 'lands' (match específico, no substring 'land')
      const landsEndpoint = [...discoveredEndpoints.entries()]
        .map(([url, count]) => ({ url, count }))
        .find((e) => e.url.includes('graphql?name=lands'));
      if (landsEndpoint) {
        console.log(`\n[SMOKE] Endpoint de lands detectado: ${landsEndpoint.url}`);
        console.log(`  → ${landsEndpoint.count} hits durante la corrida`);
      } else {
        console.log(`\n[SMOKE] No se detectó endpoint 'graphql?name=lands' automáticamente.`);
        console.log(`  Revisa djiag_exports/smoke/endpoints.json para ver todos los endpoints.`);
      }
    } else {
      // Modo normal: visitar /records y drill-down
      console.log('[RECORDS] navegando a /records...');
      await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      const recordsText = await page.locator('body').innerText();
      fs.writeFileSync(path.join(outDir, 'records_page_text.txt'), recordsText, 'utf8');

      // (S1 §2.3) DJI usa scroll virtualizado en /records — solo ~30 días
      // están en el DOM al inicio. Scrollear hasta que el contador de
      // day_items no crezca más para que drillDownDays vea TODOS los días,
      // no solo los primeros 30.
      console.log('[RECORDS] scroll virtualizado — cargando todos los day_items...');
      const recordsScroll = await scrollUntilStagnant(page, {
        countSelector: '[id^="day_item_"]',
        maxCycles: 80,        // 80 ciclos × 600ms = ~48s tope
        settleMs: 2000,
        waitBetweenScrollsMs: 600
      });
      console.log(`  scroll: ${recordsScroll.totalCount} day_items cargados en ${recordsScroll.cycles} ciclos`);

      if (!noDrill) {
        await withRetry(() => drillDownDays(page, outDir, maxDays), 2, 2000);
      }

      // Persistir endpoints descubiertos en modo normal también
      const endpointSummary = [...discoveredEndpoints.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([url, count]) => ({ url, count }));
      fs.writeFileSync(
        path.join(outDir, 'endpoints.json'),
        JSON.stringify({ discovered: endpointSummary, total: allResponses.length }, null, 2),
        'utf8'
      );
      console.log(`\n[DONE] Datos en ${outDir}`);
      console.log(`  ${endpointSummary.length} endpoints únicos (ver endpoints.json)`);
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
