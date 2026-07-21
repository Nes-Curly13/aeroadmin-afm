// CLI: check-fumigations-coverage.js
//
// v1.6 (auditoria #2 doble modelo fumigaciones):
//   Cuenta la cobertura de `dji_fumigations` (per-parcela) vs `dji_flights`
//   (log diario) para los ultimos N dias. Detecta gaps grandes que harian
//   que las alertas se pierdan cuando migremos de fuente.
//
// Por que existe:
//   - El swap v1.6 hace que `getAlerts()` derive de fumigations, no de
//     flights. Si fumigations tiene gaps (backfill incompleto, dias sin
//     importar), las alertas BAJAN en numero — eso es correcto pero
//     confunde al operador. Mejor detectar ANTES del swap.
//   - El backfill `backfill-fumigations-from-flights.js` es idempotente:
//     se puede re-correr para llenar gaps. Este script reporta los gaps
//     para guiar esa operacion.
//
// Uso:
//   node scripts/check-fumigations-coverage.js
//   node scripts/check-fumigations-coverage.js --days 60
//   node scripts/check-fumigations-coverage.js --threshold 0.9  # exit 1 si <90%
//
// Variables (.env.local): DATABASE_URL
//
// Exit codes:
//   0 = cobertura >= threshold (default 0.95 = 95%)
//   1 = cobertura < threshold O error de BD

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

function parseArgs(argv) {
  const args = { days: 30, threshold: 0.95 };
  const daysIdx = argv.indexOf('--days');
  if (daysIdx >= 0) args.days = parseInt(argv[daysIdx + 1], 10);
  const thIdx = argv.indexOf('--threshold');
  if (thIdx >= 0) args.threshold = parseFloat(argv[thIdx + 1]);
  if (!Number.isFinite(args.days) || args.days < 1) args.days = 30;
  if (!Number.isFinite(args.threshold) || args.threshold < 0 || args.threshold > 1) {
    args.threshold = 0.95;
  }
  return args;
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    console.error('DATABASE_URL is not configured.');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();

  try {
    // Query 1: dias con al menos 1 vuelo.
    // Query 2: dias con al menos 1 fumigacion per-parcela (parcel_id NOT NULL).
    // Comparamos los dos sets para calcular la cobertura.
    const flightsRes = await client.query(
      `SELECT to_char(start_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS day,
              COUNT(*) AS count
         FROM dji_flights
        WHERE start_at >= NOW() - ($1 || ' days')::interval
          AND start_at IS NOT NULL
        GROUP BY day
        ORDER BY day DESC`,
      [args.days]
    );
    const fumRes = await client.query(
      `SELECT to_char(fumigation_date, 'YYYY-MM-DD') AS day,
              COUNT(*) AS count
         FROM dji_fumigations
        WHERE fumigation_date >= CURRENT_DATE - $1::int
          AND parcel_id IS NOT NULL
          AND deleted_at IS NULL
        GROUP BY day
        ORDER BY day DESC`,
      [args.days]
    );

    const flightDays = new Map(flightsRes.rows.map((r) => [r.day, Number(r.count)]));
    const fumDays = new Map(fumRes.rows.map((r) => [r.day, Number(r.count)]));

    const allDays = [...new Set([...flightDays.keys(), ...fumDays.keys()])].sort().reverse();
    const totalFlights = [...flightDays.values()].reduce((s, n) => s + n, 0);
    const totalFums = [...fumDays.values()].reduce((s, n) => s + n, 0);

    // Cobertura por dia: dias con flights que tambien tienen fumigations per-parcela.
    const daysWithFlights = allDays.filter((d) => flightDays.has(d));
    const daysCovered = daysWithFlights.filter((d) => fumDays.has(d) && fumDays.get(d) > 0).length;
    const dayCoverage = daysWithFlights.length > 0
      ? daysCovered / daysWithFlights.length
      : 1;

    // Cobertura por evento: cuantos flights estan representados en fumigations.
    // Aproximacion: para cada dia con flights, ver si fumDays tiene >0 entries.
    // (No podemos hacer un match 1:1 sin spatial join — solo nos importa el ratio).
    console.log(`\n[coverage check] ultimos ${args.days} dias\n`);
    console.log(`  flights totales:  ${totalFlights}`);
    console.log(`  fumigations per-parcela: ${totalFums}`);
    console.log(`  dias con flights: ${daysWithFlights.length}`);
    console.log(`  dias cubiertos (flights + fumigations): ${daysCovered}`);
    console.log(`  cobertura por dia: ${(dayCoverage * 100).toFixed(1)}%`);
    console.log(`  threshold:         ${(args.threshold * 100).toFixed(1)}%`);
    console.log('');

    // Detalle por dia (top 10 gaps, los mas recientes primero)
    const gaps = daysWithFlights
      .filter((d) => !fumDays.has(d) || fumDays.get(d) === 0)
      .slice(0, 10);
    if (gaps.length > 0) {
      console.log(`  gaps detectados (${gaps.length} dias sin fumigations per-parcela):`);
      for (const d of gaps) {
        const fc = flightDays.get(d) ?? 0;
        const fmc = fumDays.get(d) ?? 0;
        console.log(`    ${d}  flights=${fc}  fumigations=${fmc}`);
      }
      console.log('');
    } else {
      console.log(`  ningun gap detectado — todos los dias con flights tienen fumigations per-parcela.`);
      console.log('');
    }

    if (dayCoverage < args.threshold) {
      console.error(
        `[coverage check] FAIL: cobertura ${(dayCoverage * 100).toFixed(1)}% < threshold ${(args.threshold * 100).toFixed(1)}%`
      );
      console.error(`  accion: re-correr scripts/backfill-fumigations-from-flights.js para llenar gaps.`);
      process.exitCode = 1;
    } else {
      console.log(`[coverage check] OK: cobertura ${(dayCoverage * 100).toFixed(1)}% >= threshold.`);
    }
  } catch (err) {
    console.error('[coverage check] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
