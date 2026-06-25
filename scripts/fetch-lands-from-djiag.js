// CLI: fetch de fincas desde DJI AG (endpoint coreano) y persistencia a JSON.
//
// Uso:
//   node scripts/fetch-lands-from-djiag.js
//   node scripts/fetch-lands-from-djiag.js --out djiag_exports/lands.json
//   node scripts/fetch-lands-from-djiag.js --save-fixtures
//
// Output:
//   djiag_exports/lands.json — { lands: [...], totalCount, fetchedAt, source }
//
// Si --save-fixtures está presente, también guarda las responses crudas
// en tests/fixtures/djiag-live/lands-page-N.json para que sirvan como
// fixtures de regresión (ver tests/djiag-lands-fetcher.test.ts).
//
// Variables de entorno (.env.local):
//   DJIAG_EMAIL, DJIAG_PASSWORD

const fs = require('fs');
const path = require('path');
const { DjiagKoreanClient } = require('../lib/djiag-korean-client');
const { parseLandsResponse } = require('../lib/djiag-lands-fetcher');

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'lands.json');
  const saveFixtures = args.includes('--save-fixtures');
  const mpIdx = args.indexOf('--max-pages');
  const maxPages = mpIdx >= 0 ? Number(args[mpIdx + 1]) || 100 : 100;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const client = new DjiagKoreanClient();
  try {
    console.log(`[fetch-lands] login + navegando a Field Management (maxPages=${maxPages})...`);
    const rawPages = await client.fetchAllLandsPages({ maxPages });
    console.log(`[fetch-lands] ${rawPages.length} pages crudas capturadas`);

    // Normalizar y consolidar
    const allLands = [];
    let totalCount = 0;
    for (const [i, page] of rawPages.entries()) {
      const parsed = parseLandsResponse(page);
      allLands.push(...parsed.lands);
      totalCount = parsed.totalCount || totalCount;

      if (saveFixtures) {
        const fixDir = path.join(process.cwd(), 'tests', 'fixtures', 'djiag-live');
        fs.mkdirSync(fixDir, { recursive: true });
        const fixFile = path.join(fixDir, `lands-page-${String(i + 1).padStart(2, '0')}.json`);
        fs.writeFileSync(fixFile, JSON.stringify(page, null, 2), 'utf8');
        console.log(`  [fixture] page ${i + 1} → ${path.relative(process.cwd(), fixFile)}`);
      }
    }

    const out = {
      lands: allLands,
      totalCount,
      fetchedAt: new Date().toISOString(),
      source: 'kr-ag2-api.dji.com/ag-plot/api/graphql?name=lands'
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(
      `[fetch-lands] OK: ${allLands.length}/${totalCount} lands → ${path.relative(process.cwd(), outPath)}`
    );
  } catch (err) {
    console.error('[fetch-lands] ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
