// CLI: fetch de fumigaciones (aggr_by_day) desde DJI AG, paginando.
//
// Estrategia de paginacion:
//   - DJI NO expone totalCount ni hasNextPage en aggr_by_day
//   - El response siempre trae hasta 30 dias (page_size)
//   - Si trae < 30, asumimos ultima pagina
//   - Para la siguiente pagina, movemos el rango de timestamps hacia adelante
//     (lteq del response anterior - 86400 segundos = un dia antes)
//
// Output: djiag_exports/fumigations.json con TODOS los dias (no por parcela)
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD, DJIAG_DAYS_BACK (opcional, default 365)

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');
const { parseAggrByDayResponse } = require('../lib/djiag-fumigations-fetcher');

const PAGE_SIZE = 30;
const SEC_PER_DAY = 86400;

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'fumigations.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const daysBack = Number(process.env.DJIAG_DAYS_BACK ?? 365);
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - daysBack * SEC_PER_DAY;

  const client = new DjiagKoreanClient();
  try {
    console.log(`[fetch-fumigations] login + navegando a /records...`);
    await client.launch();
    await client.login();
    const page = client.page;

    // Navegar a /records para que el frontend tenga sesion + contexto
    // (el endpoint se puede llamar via fetch directo, pero por seguridad
    // dejamos que el browser firme los requests).
    await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    const allDays = [];
    let cursor = endTs;
    let pageNum = 0;
    const maxPages = Math.ceil(daysBack / PAGE_SIZE) + 2;  // safety cap

    while (pageNum < maxPages) {
      pageNum += 1;
      const url = buildUrl(startTs, cursor);
      console.log(`[fetch-fumigations] page ${pageNum}: ${url.slice(0, 100)}...`);

      // Llamar via page.evaluate para que el fetch monkey-patcheado firme el request.
      // Si eso falla por el signer, fallback a waitForResponse (el frontend hace
      // esta misma llamada al cargar /records con el date range del UI).
      const result = await fetchInPageContext(page, url);
      if (!result) {
        console.warn(`  [warn] page ${pageNum} no response, parando`);
        break;
      }
      if (result.status !== 200) {
        console.warn(`  [warn] page ${pageNum} status ${result.status}: ${result.body?.msg ?? ''}`);
        break;
      }

      const parsed = parseAggrByDayResponse(result.body, PAGE_SIZE);
      console.log(`  → ${parsed.days.length} dias`);
      allDays.push(...parsed.days);

      if (!parsed.hasNextPage || parsed.days.length < PAGE_SIZE) {
        console.log(`  [stop] ultima pagina (${parsed.days.length} < ${PAGE_SIZE})`);
        break;
      }

      // Avanzar el cursor al dia anterior al mas antiguo de esta pagina
      const oldestTs = parsed.days[parsed.days.length - 1].createTimestamp;
      cursor = oldestTs - SEC_PER_DAY;
      if (cursor < startTs) {
        console.log(`  [stop] llegamos al inicio del rango (${startTs})`);
        break;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    const out = {
      days: allDays,
      totalDays: allDays.length,
      fetchedAt: new Date().toISOString(),
      source: 'kr-ag2-api.dji.com/api/web/v1/flight_records/aggr_by_day',
      dateRange: { startTs, endTs }
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(
      `\n[fetch-fumigations] OK: ${allDays.length} dias → ${path.relative(process.cwd(), outPath)}`
    );
  } catch (err) {
    console.error('[fetch-fumigations] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

function buildUrl(fromTs, toTs) {
  return `https://kr-ag2-api.dji.com/api/web/v1/flight_records/aggr_by_day` +
    `?filters%5Btimestamp_gteq%5D=${fromTs * 1000}` +
    `&filters%5Btimestamp_lteq%5D=${toTs * 1000}` +
    `&page=1&page_size=${PAGE_SIZE}`;
}

async function fetchInPageContext(page, url) {
  // El signer de DJI no esta en window.fetch global (lo vimos con 408).
  // Alternativa: capturar la response que el frontend hace al cambiar el date
  // range. Pero aca el rango puede no existir. Solucion robusta: hacer
  // page.reload() para que el frontend dispare con los params default, y
  // capturar la primera response de aggr_by_day. NO sirve para paginacion
  // custom, pero es lo que tenemos sin reimplementar el HMAC.
  //
  // Por ahora: intentar page.evaluate y si falla, loguear.
  try {
    const result = await page.evaluate(async (u) => {
      // Hook para evitar que el request falle por CORS si se hace desde aqui
      const r = await fetch(u, { method: 'GET', credentials: 'include' });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 500) }; }
      return { status: r.status, body };
    }, url);
    return result;
  } catch (err) {
    console.warn(`  [warn] page.evaluate fetch fallo: ${err.message.slice(0, 80)}`);
    return null;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, buildUrl, fetchInPageContext, SEC_PER_DAY };
