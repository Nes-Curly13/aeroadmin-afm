// fetch-lands-clean: paginacion robusta sin confiar en hasNextPage
// Reusa la sesion de Playwright (login + JWT) y luego hace fetch directo
// con el cursor correcto. Loop hasta que edges.length < pageSize.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');

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

const LANDS_QUERY = (bbox, cursor) => `query {
  lands(first: 200, after: "${cursor}", filter: {
    enableFreeZone: true,
    bbox: {
      upperRight: { lat: ${bbox.latMax}, lng: ${bbox.lngMax} }
      downLeft: { lat: ${bbox.latMin}, lng: ${bbox.lngMin} }
    }
  }) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node {
        uuid externalId name address updatedAt createdAt
        totalArea(unit:MU) workArea(unit:MU) totalObstacleArea(unit:MU)
        sourceType landType precision precisionType maxGeometryParameterOffset
        position { lng lat }
        geometry { storage { signedURL uuid contentMd5 } }
        waypoint { storage { signedURL } }
        parameter { storage { signedURL } }
        serialNumber
        bbox { upperRight { lat lng } downLeft { lat lng } }
        tags
      }
    }
  }
}`;

function postGraphQL(url, token, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables: {} });
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-auth-token': token,
          'accept-language': 'zh-CN,zh',
          'x-new-version': 'true',
          'device-id': 'web-clean-12345',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: { _raw: data.slice(0, 1000) } });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'lands.json');

  const bbox = { latMin: -4, latMax: 13, lngMin: -79, lngMax: -66 };
  const URL = 'https://kr-ag2-api.dji.com/ag-plot/api/graphql?name=lands';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const client = new DjiagKoreanClient();
  try {
    console.log('[fetch-lands-clean] login...');
    await client.login();
    const page = client.page;
    const token = await page.evaluate(() => localStorage.getItem('x-auth-token'));
    if (!token) throw new Error('No JWT');
    console.log(`[fetch-lands-clean] JWT obtained (${token.length} chars)`);

    const allNodes = new Map(); // dedupe por uuid
    let totalCount = 0;
    let cursor = '0';
    let pageIdx = 0;
    let sameCursorStreak = 0;
    let lastCursor = '';
    const startMs = Date.now();

    while (true) {
      pageIdx++;
      const query = LANDS_QUERY(bbox, cursor);
      const r = await postGraphQL(URL, token, query);
      if (r.status !== 200) {
        throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
      }
      const lands = r.body?.data?.lands;
      if (!lands) throw new Error('No data.lands: ' + JSON.stringify(r.body).slice(0, 300));

      totalCount = lands.totalCount || totalCount;
      const edges = lands.edges || [];
      let newInPage = 0;
      for (const e of edges) {
        const n = e?.node;
        if (!n?.uuid) continue;
        if (!allNodes.has(n.uuid)) {
          allNodes.set(n.uuid, n);
          newInPage++;
        }
      }
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`  page ${pageIdx}: ${edges.length} edges (${newInPage} new, dedup total=${allNodes.size}/${totalCount}, ${elapsed}s)`);

      // Salida robusta: si no hay edges nuevos O cursor no avanza
      if (newInPage === 0) {
        console.log('[fetch-lands-clean] sin edges nuevos, fin del loop');
        break;
      }
      if (cursor === lastCursor) {
        sameCursorStreak++;
        if (sameCursorStreak >= 2) {
          console.log('[fetch-lands-clean] cursor no avanza, fin del loop');
          break;
        }
      } else {
        sameCursorStreak = 0;
      }
      lastCursor = cursor;

      const next = lands.pageInfo?.endCursor;
      if (!next) {
        console.log('[fetch-lands-clean] endCursor vacio, fin del loop');
        break;
      }
      cursor = next;
      if (pageIdx > 50) {
        console.log('[fetch-lands-clean] safety break: >50 paginas');
        break;
      }
    }

    const out = {
      lands: Array.from(allNodes.values()),
      totalCount,
      fetchedAt: new Date().toISOString(),
      source: 'kr-ag2-api.dji.com/ag-plot/api/graphql?name=lands',
      bbox,
      pagination: { pages: pageIdx, durationSec: ((Date.now() - startMs) / 1000).toFixed(1) },
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`[fetch-lands-clean] OK: ${allNodes.size}/${totalCount} lands unicas → ${path.relative(process.cwd(), outPath)}`);
  } catch (err) {
    console.error('[fetch-lands-clean] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) main();
module.exports = { main };
