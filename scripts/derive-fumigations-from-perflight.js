#!/usr/bin/env node
// CLI: deriva fumigaciones aggregate desde djiag_exports/perflight_records.json.
//
// Por que existe:
//   scripts/fetch-fumigations-from-djiag.js se rompio contra la UI actual de
//   DJI (el query flight_records/aggr_by_day ya no se captura al cargar
//   /records, el Filter/RangePicker tampoco se encontro). En lugar de pelear
//   con el UI, derivamos el agregado desde los 10k+ vuelos per-flight que
//   scrape_djiag_records.js ya capturo. Data es la misma (mismos timestamps
//   y mismas metricas por vuelo) — solo difiere en el source label.
//
// Uso:
//   node scripts/derive-fumigations-from-perflight.js
//   node scripts/derive-fumigations-from-perflight.js --in <perflight.json> --out <fumigations.json>
//
// Output: djiag_exports/fumigations.json con shape compatible con
//   scripts/upsert-fumigations-from-djiag.js (Array o { days: [...] }).

const fs = require('fs');
const path = require('path');

const MS_PER_SEC = 1000;
const ML_PER_L = 1000;
const M2_PER_HA = 10000;
const BOGOTA_OFFSET_SEC = 5 * 3600; // UTC-5

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in' && argv[i + 1]) args.in = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

function parseCreateDate(v) {
  // DJI exporta el create_date como numero (ej. 20260909). Aceptamos tambien
  // string por si la exportacion cambia a formato YYYYMMDD entrecomillado.
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (s.length !== 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d, iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

// create_timestamp (epoch sec) que al pasar por toISOString().slice(0,10)
// da el mismo `date` ISO. Bogota = UTC-5, asi que el inicio del dia Bogota
// es 05:00 UTC. Usamos Date.UTC(y, m-1, d) + 5h.
function dateToCreateTimestamp({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_SEC) + BOGOTA_OFFSET_SEC;
}

function isFumigation(flight) {
  // usage_type: 0=agriculture, 1=delivery. El export del cliente no usa delivery.
  // Tambien filtramos vuelos sin spray_usage (puede haber registros de "solo vuelo").
  if (flight.usage_type !== 0) return false;
  const spray = Number(flight.spray_usage || 0);
  if (!(spray > 0)) return false;
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const inPath = args.in ? path.resolve(args.in) : path.join(cwd, 'djiag_exports', 'perflight_records.json');
  const outPath = args.out ? path.resolve(args.out) : path.join(cwd, 'djiag_exports', 'fumigations.json');

  if (!fs.existsSync(inPath)) {
    throw new Error(`No existe ${inPath}. Corré primero scrape_djiag_records.js.`);
  }

  console.log(`[derive-fumigations] leyendo ${path.relative(cwd, inPath)}...`);
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const flights = Array.isArray(raw?.flights) ? raw.flights : [];
  console.log(`  total flights: ${flights.length}`);

  // Agrupar por create_date (Bogota local).
  const byDate = new Map();
  let skippedNonFumigation = 0;
  let skippedNoDate = 0;

  for (const f of flights) {
    if (!isFumigation(f)) {
      skippedNonFumigation += 1;
      continue;
    }
    const parsed = parseCreateDate(f.create_date);
    if (!parsed) {
      skippedNoDate += 1;
      continue;
    }
    const bucket = byDate.get(parsed.iso) || {
      date: parsed.iso,
      createTimestamp: dateToCreateTimestamp(parsed),
      workAreaM2: 0,
      workTimeSec: 0,
      sortieCount: 0,
      sprayUsageMl: 0,
      serialNumbers: new Set(),
    };
    bucket.workAreaM2 += Number(f.new_work_area || 0);
    bucket.workTimeSec += Number(f.work_time_seconds || 0);
    bucket.sprayUsageMl += Number(f.spray_usage || 0);
    bucket.sortieCount += 1;
    if (f.serial_number) bucket.serialNumbers.add(f.serial_number);
    byDate.set(parsed.iso, bucket);
  }

  const days = [...byDate.values()]
    .map((b) => {
      const sprayL = b.sprayUsageMl / ML_PER_L;
      const areaHa = b.workAreaM2 / M2_PER_HA;
      const doseLPerHa = areaHa > 0 ? Number(((b.sprayUsageMl * 10) / b.workAreaM2).toFixed(2)) : null;
      return {
        date: b.date,
        createTimestamp: b.createTimestamp,
        workAreaM2: Math.round(b.workAreaM2),
        workTimeSec: Math.round(b.workTimeSec),
        workTimeMin: Math.round(b.workTimeSec / 60),
        sortieCount: b.sortieCount,
        sprayUsageMl: Math.round(b.sprayUsageMl),
        sprayUsageL: Number(sprayL.toFixed(2)),
        doseLPerHa,
        hasAgriculture: true,
        // Auxiliares no usados por dayToFumigationParams, utiles para debug.
        droneCount: b.serialNumbers.size,
      };
    })
    .sort((a, b) => (b.createTimestamp || 0) - (a.createTimestamp || 0));

  const totalFlightsConsidered = days.reduce((acc, d) => acc + d.sortieCount, 0);
  const oldest = days[days.length - 1]?.date;
  const newest = days[0]?.date;

  const out = {
    days,
    totalDays: days.length,
    totalFlights: totalFlightsConsidered,
    skippedNonFumigation,
    skippedNoDate,
    fetchedAt: new Date().toISOString(),
    source: 'derived-from-perflight-records',
    originFile: path.relative(cwd, inPath),
    dateRange: { from: oldest, to: newest },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n[derive-fumigations] OK:`);
  console.log(`  días únicos:  ${days.length}`);
  console.log(`  vuelos:       ${totalFlightsConsidered} (de ${flights.length} totales)`);
  console.log(`  skipped:      ${skippedNonFumigation} no-fumigacion + ${skippedNoDate} sin-fecha`);
  console.log(`  rango:        ${oldest} → ${newest}`);
  console.log(`  output:       ${path.relative(cwd, outPath)}`);

  // Preview de los primeros 3 días.
  console.log(`\n  preview (top 3):`);
  for (const d of days.slice(0, 3)) {
    console.log(`    ${d.date}: ${d.sortieCount} sorties, ${d.workAreaM2} m², ${d.workTimeMin} min, ${d.sprayUsageMl} mL, ${d.doseLPerHa ?? '-'} L/ha`);
  }
}

main().catch((err) => {
  console.error('[derive-fumigations] ERROR:', err.message);
  process.exit(1);
});
