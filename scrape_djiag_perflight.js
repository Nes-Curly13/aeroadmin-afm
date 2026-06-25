// Scraper DJI AG v3 — captura per-flight data (drone serial, pilot, area, etc.).
//
// Mejora sobre scrape_djiag_records.js:
//   - fumigations.json tiene datos agregados por día (workArea, dose, etc.) sin
//     parcel_id ni drone_code_used.
//   - El endpoint per-flight es:
//       GET https://kr-ag2-api.dji.com/api/web/v1/flight_records
//         ?filters[timestamp_gteq]=<ms>
//         &filters[timestamp_lteq]=<ms>
//         &page_size=50
//         &page=N
//     Devuelve 50 flights por página con: id, serial_number (drone SN), nickname,
//     team_name (pilot), new_work_area, spray_usage, lng, lat, location, district,
//     start_timestamp, end_timestamp, work_time_seconds, mode_name, etc.
//
// Auth: el browser de Playwright ya carga la firma WASM y el x-auth-token en
// localStorage. La UI hace fetch con el interceptor de DJI (Axios, no fetch
// nativo — por eso fetch() desde page.evaluate da 408). Solo tenemos que
// navegar la UI (click "Next Page" en /records/list) y capturar las responses.
//
// Reusa DjiagKoreanClient (lib/) para login + la trampa del routing zh-CN.
//
// Uso:
//   node scrape_djiag_perflight.js                       # últimos 30 días
//   node scrape_djiag_perflight.js --days 7             # últimos 7 días
//   node scrape_djiag_perflight.js --days 90            # últimos 90 días
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD — credenciales DJI

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('./lib/djiag-korean-client');

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

// ---------------------------------------------------------------------
// Captura de flight_records: navega el list view y junta todas las páginas.
// ---------------------------------------------------------------------
//
// Estrategia: navegar a /records/list → la UI carga página 1 automáticamente
// (con 30/page por default). Cambiar a 50/page → cargar 1 página. Después
// clickear "Next 5 Pages" repetidamente (más rápido que "Next Page").
//
// Devuelve: { flights: [...], total_count, total_pages, captured_at }
async function captureAllFlights(page, days, pageSize) {
  // 1. Calcular rango de timestamps (ms) para los últimos N días.
  //    Importante: el server espera ms epoch (no s). Para alinear con el
  //    rango que ya usa fumigations.json (que usa s epoch), multiplicamos
  //    por 1000.
  const now = new Date();
  const endMs = now.getTime();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const gteq = String(startMs);
  const lteq = String(endMs);

  console.log(`[PERFLIGHT] rango: ${gteq} → ${lteq} (${days} días)`);

  // 2. Set up response capture ANTES de navegar.
  const captured = new Map(); // pageNum → {meta, data}
  const responseHandler = async (resp) => {
    const url = resp.url();
    if (!url.includes('kr-ag2-api.dji.com/api/web/v1/flight_records?')) return;
    // Ignorar variants (aggr, overview, only_all_ids) — match exacto al endpoint paginado.
    if (url.includes('aggr') || url.includes('overview') || url.includes('only_all_ids')) return;
    try {
      const body = await resp.json();
      const pageMatch = url.match(/[?&]page=(\d+)/);
      const pageNum = pageMatch ? Number(pageMatch[1]) : 0;
      captured.set(pageNum, body);
      const n = body.data?.length || 0;
      const tp = body.meta_data?.total_pages || '?';
      console.log(`  [CAPTURE] page ${pageNum} → ${n} flights (total_pages=${tp})`);
    } catch (err) {
      console.warn(`  [CAPTURE] fallo parseando ${url}: ${err.message.slice(0, 60)}`);
    }
  };
  page.on('response', responseHandler);

  // 3. Navegar a /records/list (carga la página 1 automáticamente).
  console.log('[PERFLIGHT] navegando a /records/list...');
  await page.goto('https://www.djiag.com/records/list', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // 4. Esperar a que la primera response llegue. La list view monta async
  //    y la primera request es parte del mount. Damos 10s y si no llegó,
  //    reintentar con un reload.
  const t0 = Date.now();
  while (captured.size === 0 && Date.now() - t0 < 15000) {
    await page.waitForTimeout(500);
  }
  if (captured.size === 0) {
    console.warn('[PERFLIGHT] primera response no llegó en 15s, reintentando...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
  }
  if (captured.size === 0) {
    throw new Error('No se capturó la primera response. La página no cargó /records/list');
  }

  // 5. Cambiar page size a 50 (max). El control es un `.ant-pagination-options`
  //    con un dropdown que muestra "30 / page" o similar. La opción "50 / page"
  //    se selecciona por texto.
  console.log('[PERFLIGHT] cambiando page size a 50...');
  try {
    // El trigger del dropdown tiene `.ant-select-selector` dentro de options
    const trigger = page.locator('.ant-pagination-options .ant-select-selector').first();
    const trigCount = await trigger.count();
    if (trigCount > 0) {
      await trigger.click({ timeout: 5000, force: true });
      await page.waitForTimeout(800);
      // Opción 50/page (se monta en un portal fuera de la tabla)
      const opt50 = page.locator('.ant-select-item-option-content', { hasText: /^50 \/ page$/ }).first();
      const opt50Count = await opt50.count();
      if (opt50Count > 0) {
        await opt50.click({ timeout: 3000, force: true });
        await page.waitForTimeout(2500);
        console.log('  [PERFLIGHT] page size cambiado a 50');
      } else {
        console.log('  [PERFLIGHT] opción "50 / page" no encontrada en el dropdown');
      }
    } else {
      console.log('  [PERFLIGHT] page size trigger no encontrado');
    }
  } catch (err) {
    console.warn(`  [PERFLIGHT] no se pudo cambiar page size: ${err.message.slice(0, 80)}`);
  }

  // 6. Click "Next 5 Pages" hasta agotar todas las páginas.
  //    Estrategia: leer total_pages de la ÚLTIMA response capturada (que
  //    refleja el page_size actual, ya cambiado a 50). Si no se pudo
  //    cambiar page_size, usar la primera response (que será 30/page).
  if (captured.size === 0) {
    throw new Error('No se capturó ninguna response. La página no cargó /records/list');
  }
  // Tomar la response con el pageNum más alto como referencia
  let latestResp = null;
  let latestPage = 0;
  for (const [pn, body] of captured.entries()) {
    if (pn > latestPage) {
      latestPage = pn;
      latestResp = body;
    }
  }
  const totalPages = latestResp?.meta_data?.total_pages || 1;
  const totalCount = latestResp?.meta_data?.total_count || 0;
  console.log(`[PERFLIGHT] total_pages=${totalPages}, total_count=${totalCount}`);

  let clicked = 0;
  // Iteramos con "Next Page" (single) en vez de "Next 5 Pages" porque
  // saltar 5 omite 4 páginas intermedias. Con ~800ms por click,
  // 235 clicks = ~3 min. Para 7059 flights, vale la pena.
  const totalClicksNeeded = totalPages - 1; // -1 porque page 1 ya está capturada
  console.log(`[PERFLIGHT] necesito ${totalClicksNeeded} clicks "Next Page" (1 por página)`);

  for (let i = 0; i < totalClicksNeeded; i++) {
    try {
      const btn = page.getByTitle('Next Page').first();
      const btnCount = await btn.count();
      if (btnCount === 0) {
        console.warn(`  [PERFLIGHT] iter ${i}: "Next Page" no encontrado, rompo loop`);
        break;
      }
      const disabled = await btn.evaluate((el) => el.classList.contains('ant-pagination-disabled'));
      if (disabled) {
        console.log(`  [PERFLIGHT] "Next Page" deshabilitado en iter ${i}, fin del paginado`);
        break;
      }
      await btn.click({ timeout: 5000, force: true });
      clicked++;
      await page.waitForTimeout(700);
      if (i < 5 || (i + 1) % 20 === 0 || i === totalClicksNeeded - 1) {
        console.log(`  [PERFLIGHT] click ${clicked}/${totalClicksNeeded} → capturadas ${captured.size}/${totalPages}`);
      }
    } catch (err) {
      console.warn(`  [PERFLIGHT] click ${clicked} falló: ${err.message.slice(0, 80)}`);
      break;
    }
  }

  // 7. (Ya no se necesita — el loop anterior itera single-page)
  //    Mantenemos este bloque como safety net por si alguna página quedó
  //    sin capturar (p.ej. respuesta perdida por race condition).
  while (captured.size < totalPages) {
    try {
      const npBtn = page.getByTitle('Next Page').first();
      if (await npBtn.count() === 0) break;
      const disabled = await npBtn.evaluate((el) => el.classList.contains('ant-pagination-disabled'));
      if (disabled) break;
      await npBtn.click({ timeout: 5000, force: true });
      clicked++;
      await page.waitForTimeout(800);
    } catch (err) {
      console.warn(`  [PERFLIGHT] Next Page #${clicked} falló: ${err.message.slice(0, 60)}`);
      break;
    }
  }

  page.off('response', responseHandler);

  // 8. Aplanar todas las páginas en una lista de flights.
  const allFlights = [];
  for (let p = 1; p <= totalPages; p++) {
    const body = captured.get(p);
    if (body?.data) allFlights.push(...body.data);
  }

  return {
    flights: allFlights,
    total_count: totalCount,
    total_pages: totalPages,
    captured_at: new Date().toISOString(),
    days,
    pageSize,
    pages_captured: captured.size,
  };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;
  const psIdx = args.indexOf('--page-size');
  const pageSize = psIdx >= 0 ? Number(args[psIdx + 1]) || 50 : 50;
  const headless = !args.includes('--headless=false');

  const client = new DjiagKoreanClient({ headless });
  try {
    console.log('[LOGIN] navegando a /login...');
    await withRetry(() => client.login(), 3, 2000);
    console.log('[LOGIN] OK');
    const page = client.page;

    const outDir = path.join(process.cwd(), 'djiag_exports');
    fs.mkdirSync(outDir, { recursive: true });

    // Capturar
    const result = await captureAllFlights(page, days, pageSize);

    // Guardar
    const outFile = path.join(outDir, 'perflight_records.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

    // Stats
    const byDrone = {};
    const byPilot = {};
    let totalArea = 0;
    let totalSpray = 0;
    for (const f of result.flights) {
      const drone = f.nickname || f.serial_number || 'unknown';
      byDrone[drone] = (byDrone[drone] || 0) + 1;
      const pilot = f.team_name || 'unknown';
      byPilot[pilot] = (byPilot[pilot] || 0) + 1;
      totalArea += f.new_work_area || 0;
      totalSpray += f.spray_usage || 0;
    }

    console.log(`\n[DONE] ${result.flights.length} flights capturados`);
    console.log(`  Páginas: ${result.pages_captured}/${result.total_pages}`);
    console.log(`  Días: ${days}, page_size: ${pageSize}`);
    console.log(`  Total area: ${(totalArea / 10000).toFixed(2)} ha`);
    console.log(`  Total spray: ${(totalSpray / 1000).toFixed(2)} L`);
    console.log(`\n  Por drone (${Object.keys(byDrone).length}):`);
    for (const [k, n] of Object.entries(byDrone).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}: ${n} flights`);
    }
    console.log(`\n  Por pilot (${Object.keys(byPilot).length}):`);
    for (const [k, n] of Object.entries(byPilot).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}: ${n} flights`);
    }
    console.log(`\n  → ${outFile}`);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
