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

function geoJsonToKml(name, geojson) {
  const features = geojson?.features || [];
  const placemarks = features
    .map((feature, idx) => {
      const geom = feature?.geometry || {};
      const props = feature?.properties || {};
      const placemarkName = escapeXml(props.name || `${name}-${idx + 1}`);

      if (geom.type === 'Polygon') {
        const outer = geom.coordinates?.[0] || [];
        const coords = outer.map(([lng, lat, alt]) => `${lng},${lat},${alt ?? 0}`).join(' ');
        return `<Placemark><name>${placemarkName}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
      }

      if (geom.type === 'Point') {
        const [lng, lat, alt] = geom.coordinates || [];
        return `<Placemark><name>${placemarkName}</name><Point><coordinates>${lng},${lat},${alt ?? 0}</coordinates></Point></Placemark>`;
      }

      return `<Placemark><name>${placemarkName}</name><description>${escapeXml(JSON.stringify(geom))}</description></Placemark>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(name)}</name>${placemarks}</Document></kml>\n`;
}

function loadEnvFromLocalFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function parseHistoryRecord(text) {
  const lines = String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const raw = lines.join('\n');
  const dateLine = lines[0] || '';
  const dateMatch = dateLine.match(/^(\d{4}\/\d{2}\/\d{2})([A-Za-z]+)?/);
  if (!dateMatch) return { raw };
  return {
    date: dateMatch[1],
    weekday: dateMatch[2] || '',
    category: lines[1] || '',
    area: lines[2] || '',
    times: lines[3] || '',
    usage: lines[4] || '',
    workTime: lines[6] || '',
    raw
  };
}

function parseFieldCardsFromText(text) {
  const lines = String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cards = [];
  for (let i = 0; i < lines.length - 4; i += 1) {
    const typeLabel = lines[i];
    if (typeLabel !== "Farmland" && typeLabel !== "Orchards") continue;
    const name = lines[i + 1];
    const area = lines[i + 2];
    const location = lines[i + 3];
    const date = lines[i + 4];
    if (!name || !area || !location || !date || !/^\d{4}\/\d{2}\/\d{2}$/.test(date)) continue;
    cards.push({ typeLabel, name, area, location, date, raw: [typeLabel, name, area, location, date].join("\n") });
  }
  return cards;
}

async function main() {
  loadEnvFromLocalFile();
  const email = process.env.DJIAG_EMAIL;
  const password = process.env.DJIAG_PASSWORD;
  if (!email || !password) {
    throw new Error('Set DJIAG_EMAIL and DJIAG_PASSWORD before running this script.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const responses = [];
  const assetIndex = new Map();
  const pageSnapshots = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('djiag.com')) return;
    responses.push({ status: response.status(), url });

    if (url.includes('ag-plot/api/graphql?name=lands')) {
      try {
        const json = await response.json();
        const edges = json?.data?.lands?.edges || [];
        for (const edge of edges) {
          const node = edge?.node;
          if (!node) continue;
          const add = (kind, value) => {
            if (!value || assetIndex.has(value)) return;
            assetIndex.set(value, {
              kind,
              landName: node.name || '',
              uuid: node.uuid || '',
              externalId: node.externalId || '',
              url: value
            });
          };
          add('geometry', node.geometry?.storage?.signedURL);
          add('waypoint', node.waypoint?.storage?.signedURL);
          add('parameter', node.parameter?.storage?.signedURL);
        }
      } catch {
        // ignore non-JSON or auth failures
      }
    }
  });

  async function snapshotPage(label, url) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    pageSnapshots.push({
      label,
      url,
      title: await page.title(),
      text: await page.locator('body').innerText(),
      links: await page.locator('a').evaluateAll((els) => els.map((a) => ({ text: a.textContent?.trim(), href: a.href })).filter((x) => x.href))
    });
  }

  await page.goto('https://www.djiag.com/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Accept All Cookies' }).click().catch(() => {});
  await page.locator('input[type="checkbox"]').first().check().catch(() => {});
  await page.getByRole('button', { name: 'Log in with DJI account' }).click();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL('**/mission', { timeout: 60000 }),
    page.getByRole('button', { name: 'Log In' }).click()
  ]);

  const visited = [];
  const sections = [
    ['mission', 'https://www.djiag.com/mission'],
    ['records', 'https://www.djiag.com/records'],
    ['devices', 'https://www.djiag.com/devices']
  ];

  for (const [label, url] of sections) {
    await snapshotPage(label, url);
    visited.push(url);
  }

  const recordsPage = pageSnapshots.find((entry) => entry.label === 'records');
  const historyRows = [];
  await page.goto('https://www.djiag.com/records', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const dayItems = await page.locator('[id^="day_item_"]').evaluateAll((els) => els.map((el) => el.textContent.trim()));
  for (const text of dayItems.slice(1)) {
    historyRows.push(parseHistoryRecord(text));
  }

  await page.goto('https://www.djiag.com/mission', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const missionText = await page.locator('body').innerText();
  const missionItems = parseFieldCardsFromText(missionText);
  const navStates = [];
  for (const label of ['Field Management', 'Data Analysis']) {
    const loc = page.getByText(label, { exact: true });
    if (await loc.count()) {
      await loc.click().catch(() => {});
      await page.waitForTimeout(2000);
      navStates.push({
        label,
        url: page.url(),
        text: await page.locator('body').innerText(),
        links: await page.locator('a').evaluateAll((els) => els.map((a) => ({ text: a.textContent?.trim(), href: a.href })).filter((x) => x.href))
      });
    }
  }

  const outDir = path.join(process.cwd(), 'djiag_exports');
  const filesDir = path.join(outDir, 'land_files');
  fs.mkdirSync(filesDir, { recursive: true });

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  for (const item of assetIndex.values()) {
    const fileBase = `${item.externalId}_${item.kind}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const rawPath = path.join(filesDir, `${fileBase}.json`);
    const res = await fetch(item.url);
    const bodyText = await res.text();
    fs.writeFileSync(rawPath, bodyText, 'utf8');

    if (item.kind === 'geometry') {
      try {
        const geojson = JSON.parse(bodyText);
        fs.writeFileSync(path.join(filesDir, `${fileBase}.kml`), geoJsonToKml(item.landName || fileBase, geojson), 'utf8');
      } catch {
        // keep raw file only
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'records_page_text.txt'), recordsPage?.text || '', 'utf8');
  fs.writeFileSync(path.join(outDir, 'records_history.json'), JSON.stringify(historyRows, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'land_file_urls.json'), JSON.stringify([...assetIndex.values()], null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'flight_record_responses.json'), JSON.stringify(responses, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'page_snapshots.json'), JSON.stringify(pageSnapshots, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'nav_states.json'), JSON.stringify(navStates, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'mission_fields.json'), JSON.stringify(missionItems, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'crawl_manifest.json'), JSON.stringify({ visited, count: visited.length, generatedAt: new Date().toISOString() }, null, 2), 'utf8');

  await browser.close();
  console.log(`Captured ${historyRows.length} history rows, ${missionItems.length} field cards, ${assetIndex.size} asset URLs, and ${pageSnapshots.length} page snapshots.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
