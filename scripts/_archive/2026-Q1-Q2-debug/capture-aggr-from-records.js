// Convert captured aggr_by_day responses (from debug-records-responses.json)
// to djiag_exports/fumigations.json in the format expected by
// upsert-fumigations-from-djiag.js.
//
// Why: scripts/fetch-fumigations-from-djiag.js uses page.evaluate(fetch()) which
// DJI rejects with 408 (no signer in window.fetch). But when we navigate
// /records with the browser's signed session, DJI returns proper data with
// data.aggr_info[]. So we capture responses and convert here.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'djiag_exports', 'debug-records-responses.json');
const OUT = path.join(__dirname, '..', 'djiag_exports', 'fumigations.json');

const MS_PER_SEC = 1000;
const ML_PER_L = 1000;
const M2_PER_HA = 10000;

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timestampToDateString(sec) {
  return new Date(sec * MS_PER_SEC).toISOString().slice(0, 10);
}

function computeDoseLPerHa(sprayMl, areaM2) {
  if (sprayMl === null || areaM2 === null || areaM2 === 0) return null;
  return Number(((sprayMl * 10) / areaM2).toFixed(2));
}

function normalizeDay(raw) {
  const ts = numOrNull(raw.create_timestamp);
  const areaM2 = numOrNull(raw.work_area);
  const workTimeSec = numOrNull(raw.work_time);
  const sprayUsageMl = numOrNull(raw.spray_usage);
  const sortieCount = numOrNull(raw.work_times);
  return {
    createTimestamp: ts,
    date: ts !== null ? timestampToDateString(ts) : null,
    workAreaM2: areaM2,
    workTimeSec,
    workTimeMin: workTimeSec !== null ? Math.round(workTimeSec / 60) : null,
    sortieCount,
    sprayUsageMl,
    sprayUsageL: sprayUsageMl !== null ? sprayUsageMl / ML_PER_L : null,
    doseLPerHa: computeDoseLPerHa(sprayUsageMl, areaM2),
    hasAgriculture: numOrNull(raw.ag?.sortie_count) > 0 || numOrNull(raw.work_times) > 0
  };
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing ${SRC}. Run: node scripts/debug-records-responses.js`);
    process.exit(1);
  }
  const captured = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const aggrResponses = captured.filter(c =>
    c.url.includes('aggr_by_day') && c.status === 200 && c.fullBody?.data?.aggr_info
  );

  console.log(`Found ${aggrResponses.length} aggr_by_day responses in ${SRC}`);

  const allDays = [];
  for (const r of aggrResponses) {
    const days = r.fullBody.data.aggr_info.map(normalizeDay);
    allDays.push(...days);
  }

  // Dedup by date (in case multiple pages overlap)
  const byDate = new Map();
  for (const d of allDays) {
    if (d.date) byDate.set(d.date, d);
  }
  const uniqueDays = [...byDate.values()].sort((a, b) => (b.createTimestamp || 0) - (a.createTimestamp || 0));

  console.log(`Total days captured: ${allDays.length}, unique: ${uniqueDays.length}`);

  const oldestTs = uniqueDays.length > 0 ? uniqueDays[uniqueDays.length - 1].createTimestamp : null;
  const newestTs = uniqueDays.length > 0 ? uniqueDays[0].createTimestamp : null;
  const startTs = oldestTs ? oldestTs : Math.floor(Date.now() / 1000) - 30 * 86400;
  const endTs = newestTs ? newestTs + 86399 : Math.floor(Date.now() / 1000);

  const out = {
    days: uniqueDays,
    totalDays: uniqueDays.length,
    fetchedAt: new Date().toISOString(),
    source: 'kr-ag2-api.dji.com/api/web/v1/flight_records/aggr_by_day',
    dateRange: { startTs, endTs }
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nWrote ${uniqueDays.length} days → ${OUT}`);
  console.log(`Date range: ${uniqueDays[uniqueDays.length - 1]?.date} → ${uniqueDays[0]?.date}`);
  if (uniqueDays.length > 0) {
    const totalHa = uniqueDays.reduce((s, d) => s + (d.workAreaM2 || 0) / M2_PER_HA, 0);
    const totalL = uniqueDays.reduce((s, d) => s + (d.sprayUsageL || 0), 0);
    console.log(`Total area: ${totalHa.toFixed(2)} ha, total spray: ${totalL.toFixed(2)} L`);
  }
})();