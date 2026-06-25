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
//   node scrape_djiag_perflight.js --resume            # continuar desde exports existentes
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD — credenciales DJI
//
// Resiliencia:
//   - Cada click de paginación se reintenta hasta 3 veces con backoff exponencial
//     (1.5s, 3s, 6s). Un fallo aislado (button not found, network blip) no mata
//     la corrida.
//   - Después de cada página capturada, reescribimos djiag_exports/perflight_records.json
//     con el snapshot actual. Si el proceso muere (Ctrl-C, OOM, network drop),
//     el archivo en disco siempre refleja lo último capturado. Re-correr con
//     --resume retoma desde las páginas que ya tenemos.
//   - Click + save se hace dentro de un try/finally para que un crash en el
//     JSON.stringify no quede en disco corrupto.

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

/**
 * Click "Next Page" con retry/backoff. La paginación de DJI es frágil:
 * el botón puede no estar visible (scroll), o el click puede perder el
 * race con un re-render de Ant Design. Probamos hasta 3 veces con
 * backoff antes de reportar fallo al caller.
 *
 * Devuelve:
 *   { status: 'clicked' | 'disabled' | 'exhausted' | 'error', tries, error? }
 */
async function clickNextPageWithRetry(page, iter) {
  const MAX = 3;
  for (let tries = 1; tries <= MAX; tries++) {
    try {
      const btn = page.getByTitle('Next Page').first();
      if (await btn.count() === 0) throw new Error('Next Page button not found');
      // Scrollear al botón antes de clickear — Ant Design pagination está
      // al fondo de la tabla y si quedó fuera del viewport el click falla.
      await btn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      const disabled = await btn.evaluate((el) => el.classList.contains('ant-pagination-disabled'));
      if (disabled) return { status: 'disabled', tries };
      await btn.click({ timeout: 5000, force: true });
      return { status: 'clicked', tries };
    } catch (err) {
      const wait = 1500 * Math.pow(2, tries - 1);
      console.warn(`  [PERFLIGHT] click iter ${iter} intento ${tries}/${MAX} falló: ${err.message.slice(0, 60)} — esperando ${wait}ms`);
      if (tries < MAX) {
        await new Promise((r) => setTimeout(r, wait));
      } else {
        return { status: 'exhausted', tries, error: err.message };
      }
    }
  }
  // No deberíamos llegar acá, pero por las dudas.
  return { status: 'error', tries: MAX };
}

/**
 * Save incremental. Escribe al archivo destino vía temp+rename para que
 * un crash mid-write no deje el JSON corrupto en disco.
 *
 * El shape del archivo es estable: { flights, total_count, total_pages,
 * captured_at, days, pageSize, pages_captured }. --resume lee este mismo
 * shape.
 *
 * Acepta flights directamente (no requiere el Map de captura). Útil para
 * el save final en main() que ya tiene el array aplanado.
 */
function saveProgress(outDir, flights, totalPages, totalCount, days, pageSize, pagesCaptured) {
  const payload = {
    flights,
    total_count: totalCount,
    total_pages: totalPages,
    captured_at: new Date().toISOString(),
    days,
    pageSize,
    pages_captured: pagesCaptured ?? totalPages,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const finalPath = path.join(outDir, 'perflight_records.json');
  const tmpPath = finalPath + '.partial';
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, finalPath);
  return { flightsCount: flights.length, file: finalPath };
}

/**
 * Carga exports previos para --resume. Devuelve Map<pageNum, body> con las
 * páginas que ya teníamos, o un Map vacío si el archivo no existe / está
 * corrupto.
 *
 * Solo retomamos si el rango (days) coincide — si alguien cambió --days
 * entre corridas, mejor empezar de cero para no mezclar páginas.
 */
function loadResume(outDir, days) {
  const file = path.join(outDir, 'perflight_records.json');
  if (!fs.existsSync(file)) return { captured: new Map(), resumeFrom: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.days !== days) {
      console.log(`[PERFLIGHT] --resume ignorado: archivo previo es de ${parsed.days} días, actual es ${days}`);
      return { captured: new Map(), resumeFrom: 1 };
    }
    const captured = new Map();
    // Re-derivar pageNum por posición: flights están en orden de página,
    // pageSize = parsed.pageSize, así que flight index i → page floor(i/pageSize)+1.
    const ps = parsed.pageSize || 50;
    for (let i = 0; i < parsed.flights.length; i++) {
      const pn = Math.floor(i / ps) + 1;
      // Solo reconstruimos el marker mínimo (pageNum, data); meta_data puede
      // venir de la primera página que re-fetcheemos.
      const flight = parsed.flights[i];
      if (!captured.has(pn)) {
        captured.set(pn, { data: [], meta_data: parsed.total_pages ? { total_pages: parsed.total_pages, total_count: parsed.total_count } : undefined });
      }
      captured.get(pn).data.push(flight);
    }
    console.log(`[PERFLIGHT] --resume: ${captured.size}/${parsed.total_pages} páginas ya en disco`);
    return { captured, resumeFrom: captured.size + 1 };
  } catch (err) {
    console.warn(`[PERFLIGHT] --resume: archivo previo corrupto (${err.message.slice(0, 60)}), empezando de cero`);
    return { captured: new Map(), resumeFrom: 1 };
  }
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
async function captureAllFlights(page, days, pageSize, opts = {}) {
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

  // 2b. --resume: si hay exports previos con el mismo days, pre-populamos.
  //     La estrategia: navegar de todas formas a /records/list (necesitamos
  //     un browser vivo para fetchear las páginas faltantes), pero dejamos
  //     la response handler sobreescribir solo las páginas que aún no
  //     teníamos.
  const resumeState = opts.resume
    ? loadResume(opts.outDir, days)
    : { captured: new Map(), resumeFrom: 1 };
  if (opts.resume && resumeState.captured.size > 0) {
    for (const [pn, body] of resumeState.captured.entries()) {
      captured.set(pn, body);
    }
    console.log(`[PERFLIGHT] resuming desde página ${resumeState.resumeFrom} (${captured.size} ya en disco)`);
  }

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
  let hardFailures = 0;
  const MAX_HARD_FAILURES = 5; // 5 clicks seguidos reventando = algo gordo pasó
  // Iteramos con "Next Page" (single) en vez de "Next 5 Pages" porque
  // saltar 5 omite 4 páginas intermedias. Con ~800ms por click,
  // 235 clicks = ~3 min. Para 7059 flights, vale la pena.
  // --resume: salteamos las páginas que ya teníamos en disco.
  const startFromPage = Math.max(resumeState.resumeFrom, 2); // page 1 ya capturada
  const totalClicksNeeded = totalPages - 1; // -1 porque page 1 ya está capturada
  const remainingClicks = Math.max(0, totalPages - (startFromPage - 1));
  console.log(`[PERFLIGHT] necesito ${remainingClicks} clicks "Next Page" (de página ${startFromPage} a ${totalPages}, totalClicksNeeded=${totalClicksNeeded})`);

  for (let i = startFromPage - 2; i < totalClicksNeeded; i++) {
    const targetPage = i + 2; // 1-based
    const r = await clickNextPageWithRetry(page, i);
    if (r.status === 'disabled') {
      console.log(`  [PERFLIGHT] "Next Page" deshabilitado en iter ${i} (target page ${targetPage}), fin del paginado`);
      break;
    }
    if (r.status === 'exhausted') {
      hardFailures++;
      console.error(`  [PERFLIGHT] iter ${i} target page ${targetPage}: click agotó ${r.tries} reintentos (${r.error?.slice(0, 60)})`);
      if (hardFailures >= MAX_HARD_FAILURES) {
        console.error(`  [PERFLIGHT] ${MAX_HARD_FAILURES} clicks hard-fail seguidos, abortando corrida`);
        break;
      }
      continue; // seguimos intentando con el próximo click
    }
    if (r.status === 'clicked') {
      hardFailures = 0; // reset counter en éxito
    }
    clicked++;
    await page.waitForTimeout(700);

    // Save incremental: si capturamos una página nueva y el outDir está
    // definido, reescribimos el JSON con el snapshot actual. Si el proceso
    // muere (Ctrl-C, OOM), el archivo en disco tiene lo último.
    if (opts.outDir) {
      try {
        const flightsSoFar = [];
        for (let p = 1; p <= totalPages; p++) {
          const body = captured.get(p);
          if (body?.data) flightsSoFar.push(...body.data);
        }
        const saved = saveProgress(opts.outDir, flightsSoFar, totalPages, totalCount, days, pageSize, captured.size);
        if (i % 20 === 0 || i < 3) {
          console.log(`  [SAVE] wrote ${saved.flightsCount} flights (page ${targetPage}/${totalPages})`);
        }
      } catch (saveErr) {
        console.warn(`  [PERFLIGHT] save incremental falló: ${saveErr.message.slice(0, 60)}`);
      }
    }

    if (i < 5 || (i + 1) % 20 === 0 || i === totalClicksNeeded - 1) {
      console.log(`  [PERFLIGHT] click ${clicked}/${remainingClicks} (target page ${targetPage}) → capturadas ${captured.size}/${totalPages}`);
    }
  }

  // 7. Safety net por si alguna página quedó sin capturar (race condition
  //    entre click y response). Mismo retry helper, pero sin save incremental
  //    (el loop anterior ya guarda en cada éxito).
  let safetyClicks = 0;
  while (captured.size < totalPages && safetyClicks < 10) {
    const r = await clickNextPageWithRetry(page, `safety-${safetyClicks}`);
    if (r.status !== 'clicked') break;
    safetyClicks++;
    clicked++;
    await page.waitForTimeout(800);
    if (opts.outDir) {
      try {
        const flightsSoFar = [];
        for (let p = 1; p <= totalPages; p++) {
          const body = captured.get(p);
          if (body?.data) flightsSoFar.push(...body.data);
        }
        saveProgress(opts.outDir, flightsSoFar, totalPages, totalCount, days, pageSize, captured.size);
      } catch (saveErr) { console.warn(`  [PERFLIGHT] save safety falló: ${saveErr.message.slice(0, 60)}`); }
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
  const resume = args.includes('--resume');

  const client = new DjiagKoreanClient({ headless });
  try {
    console.log('[LOGIN] navegando a /login...');
    await withRetry(() => client.login(), 3, 2000);
    console.log('[LOGIN] OK');
    const page = client.page;

    const outDir = path.join(process.cwd(), 'djiag_exports');
    fs.mkdirSync(outDir, { recursive: true });

    // Capturar (con --resume si está seteado y hay exports previos).
    const result = await captureAllFlights(page, days, pageSize, { resume, outDir });

    // Save final limpio (saveProgress ya escribió durante el loop,
    // esto garantiza el último snapshot consistente).
    const finalSave = saveProgress(outDir, result.flights, result.total_pages, result.total_count, days, pageSize, result.pages_captured);
    const outFile = finalSave.file;

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
