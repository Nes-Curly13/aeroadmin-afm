// CLI: fetch de TODAS las fincas via direct GraphQL API call (no UI navigation).
//
// Por qué este approach es mejor que el original (fetch-lands-from-djiag.js):
//   - El approach original navega a /mission → click "Field Management" →
//     captura la response. Eso:
//     a) Requiere que el frontend dispare el query (frágil — DJI cambia el flow)
//     b) El cursor del GraphQL query está hardcoded en LANDS_QUERY (after: "0"),
//        así que siempre devuelve la misma página 1 de 20 lands, no importa
//        cuántas veces llamemos
//   - Este approach:
//     a) Hace login via Playwright (igual que el original)
//     b) Lee el JWT de localStorage.x-auth-token
//     c) Hace POST directo a /ag-plot/api/graphql?name=lands con x-auth-token
//        header (sin signature WASM, sin content-md5) — funciona porque el
//        server acepta el JWT solo para este endpoint
//     d) Pagina con after: <endCursor> hasta hasNextPage=false
//
// Auth descubierto (2026-06-23):
//   - El endpoint `/ag-plot/api/graphql?name=lands` acepta el JWT via
//     `x-auth-token` header (NO necesita signature ni x-ag-date).
//   - El endpoint REST `/api/web/v1/flight_records` SÍ necesita signature
//     WASM (no se puede llamar directamente via fetch — da 408 请求时间无效).
//   - Los endpoints son diferentes pero comparten el mismo JWT de localStorage.
//
// Uso:
//   node scripts/fetch-lands-direct.js
//   node scripts/fetch-lands-direct.js --out djiag_exports/lands.json
//   node scripts/fetch-lands-direct.js --page-size 200        # default 200
//   node scripts/fetch-lands-direct.js --bbox "lat_min,lat_max,lng_min,lng_max"
//        # default: colombia -4..13 lat, -79..-66 lng
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');
const { normalizeLand } = require('../lib/djiag-lands-fetcher');

// DJI's lands GraphQL endpoint accepts just the x-auth-token (no signature).
// The query has bbox-filtered viewport (Filter by visible map area).
// For fetching ALL lands, use a wide bbox covering the user's operating region.
const LANDS_QUERY = (bbox) => `query {
      lands(first: 200, after: "0", filter: {
        enableFreeZone: true,
        bbox: {
  upperRight: {
    lat: ${bbox.latMax}
    lng: ${bbox.lngMax}
  }
  downLeft: {
    lat: ${bbox.latMin}
    lng: ${bbox.lngMin}
  }
}
      }) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node{
            uuid
externalId
name
address
updatedAt
createdAt
totalArea(unit:MU)
workArea(unit:MU)
totalObstacleArea(unit:MU)
sourceType
landType
precision
precisionType
maxGeometryParameterOffset
position {
  lng
  lat
}
geometry {
  storage {
    signedURL
    uuid
    contentMd5
  }
}
waypoint {
  storage {
    signedURL
  }
}
parameter {
  storage {
    signedURL
  }
}
serialNumber
bbox {
  upperRight{
    lat
    lng
  }
  downLeft {
    lat
    lng
  }
}
tags
          }
        }
      }
    }
    `;

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

function parseBbox(s) {
  // "lat_min,lat_max,lng_min,lng_max"
  const parts = s.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--bbox must be "lat_min,lat_max,lng_min,lng_max", got: ${s}`);
  }
  return { latMin: parts[0], latMax: parts[1], lngMin: parts[2], lngMax: parts[3] };
}

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'lands.json');
  const psIdx = args.indexOf('--page-size');
  // DJI's hardcoded response cap is 200 per request (we set first: 200 above).
  // The --page-size flag is here for future-proofing if DJI raises the cap.
  const pageSize = psIdx >= 0 ? Math.min(Number(args[psIdx + 1]) || 200, 200) : 200;
  const bboxIdx = args.indexOf('--bbox');
  const bbox = bboxIdx >= 0
    ? parseBbox(args[bboxIdx + 1])
    : { latMin: -4, latMax: 13, lngMin: -79, lngMax: -66 };  // Colombia bbox

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const client = new DjiagKoreanClient();
  try {
    console.log('[fetch-lands-direct] login...');
    await client.login();
    const page = client.page;
    const token = await page.evaluate(() => localStorage.getItem('x-auth-token'));
    if (!token) throw new Error('No JWT found in localStorage.x-auth-token after login');
    console.log(`[fetch-lands-direct] JWT obtained (${token.length} chars)`);

    const url = 'https://kr-ag2-api.dji.com/ag-plot/api/graphql?name=lands';
    const allEdges = [];
    let cursor = '0';
    let totalCount = 0;
    let pageIdx = 0;
    const startMs = Date.now();

    while (true) {
      pageIdx++;
      const query = LANDS_QUERY(bbox).replace('after: "0"', `after: "${cursor}"`);
      // Use the page context to make the fetch (it includes credentials/cookies).
      // Headers are added via page.evaluate's second-arg spread.
      const response = await page.evaluate(async ({ url, token, query, pageSize: ps }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-auth-token': token,
            'accept-language': 'zh-CN,zh',
            'x-new-version': 'true',
            'device-id': 'web-12345',
          },
          body: JSON.stringify({ query, variables: {} }),
          credentials: 'include',
        });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 1000) }; }
        return { status: r.status, body };
      }, { url, token, query, pageSize });

      if (response.status !== 200) {
        console.error(`[fetch-lands-direct] page ${pageIdx} failed: ${response.status}`);
        console.error('  body:', JSON.stringify(response.body).slice(0, 300));
        throw new Error(`HTTP ${response.status}`);
      }
      const lands = response.body?.data?.lands;
      if (!lands) {
        console.error(`[fetch-lands-direct] page ${pageIdx} missing data.lands`);
        console.error('  body:', JSON.stringify(response.body).slice(0, 500));
        throw new Error('No data.lands in response');
      }

      const edges = lands.edges ?? [];
      totalCount = lands.totalCount ?? totalCount;
      allEdges.push(...edges);

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`  page ${pageIdx}: ${edges.length} edges (total captured: ${allEdges.length}/${totalCount}, ${elapsed}s)`);

      if (!lands.pageInfo?.hasNextPage) break;
      const next = lands.pageInfo.endCursor;
      if (!next || next === cursor) break;
      cursor = next;
    }

    const out = {
      // Normalize raw DJI node → NormalizedLand (lo que espera
      // djiag-lands-to-parcels.js).
      lands: allEdges.map((e) => normalizeLand(e?.node)).filter(Boolean),
      totalCount,
      fetchedAt: new Date().toISOString(),
      source: 'kr-ag2-api.dji.com/ag-plot/api/graphql?name=lands',
      bbox,
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(
      `[fetch-lands-direct] OK: ${allEdges.length}/${totalCount} lands → ${path.relative(process.cwd(), outPath)}`
    );
  } catch (err) {
    console.error('[fetch-lands-direct] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseBbox };