// CLI: smoke test del estado de la DB. Verifica que los datos fluyen
// correctamente a través de las queries comunes del dashboard.
//
// Esta es la "historia de usuario" operativa:
//   1. ¿Cuántas fincas (parcels) tenemos cargadas?
//   2. ¿Cuántos vuelos per-flight tenemos? ¿Qué cobertura de parcela tienen?
//   3. ¿Cuántas fumigaciones aggregate vs per-parcel?
//   4. ¿Cuál es la última fumigación de cada parcela?
//   5. ¿Qué parcelas están overdue (>21 días)?
//   6. ¿Cuánto fumigó cada dron en los últimos 30 días?
//   7. ¿Qué piloto voló más recientemente?
//   8. ¿Los datos son consistentes? (no huérfanos, totales cuadran)
//
// Uso:
//   node scripts/smoke-test-db.js
//
// Exit codes:
//   0 = todas las aserciones pasan
//   1 = alguna aserción falla (con detalle)
//
// Variables de entorno (.env.local):
//   DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === 'true';
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
}

class Assert {
  constructor() {
    this.failures = [];
    this.passes = 0;
  }
  check(label, condition, detail = '') {
    if (condition) {
      this.passes++;
      console.log(`  ✓ ${label}`);
    } else {
      this.failures.push({ label, detail });
      console.log(`  ✗ ${label} ${detail ? `(${detail})` : ''}`);
    }
  }
  checkGte(label, actual, min) {
    this.check(label, actual >= min, `actual=${actual}, min=${min}`);
  }
  checkLte(label, actual, max) {
    this.check(label, actual <= max, `actual=${actual}, max=${max}`);
  }
  checkEq(label, actual, expected) {
    this.check(label, actual === expected, `actual=${actual}, expected=${expected}`);
  }
  summary() {
    console.log(`\n  ${this.passes} passed, ${this.failures.length} failed`);
    return this.failures.length;
  }
}

async function smokeTest(client) {
  const a = new Assert();

  console.log('\n── 1. Parcels ────────────────────────────────────────────────');
  const parcels = await client.query('SELECT COUNT(*)::int AS n FROM dji_parcels');
  a.checkGte('parcels cargados', parcels.rows[0].n, 100); // Esperamos 1000+
  a.checkGte('parcels con geometría',
    (await client.query('SELECT COUNT(*)::int AS n FROM dji_parcels WHERE spray_geom IS NOT NULL')).rows[0].n,
    parcels.rows[0].n
  );

  console.log('\n── 2. Flights ────────────────────────────────────────────────');
  const flights = await client.query('SELECT COUNT(*)::int AS n FROM dji_flights');
  a.checkGte('flights cargados', flights.rows[0].n, 1000);
  const flightsWithParcel = await client.query('SELECT COUNT(*)::int AS n FROM dji_flights WHERE parcel_id IS NOT NULL');
  a.checkGte('flights con parcela', flightsWithParcel.rows[0].n, 1);
  // Cobertura: al menos 50% deben tener parcela asignada
  const coverage = flightsWithParcel.rows[0].n / flights.rows[0].n;
  a.check('cobertura flights→parcel ≥ 50%', coverage >= 0.5, `actual=${(coverage * 100).toFixed(1)}%`);

  // Sanity: ningún flight sin start_at o flight_id
  const orphanFlights = await client.query(`
    SELECT COUNT(*)::int AS n FROM dji_flights
    WHERE flight_id IS NULL OR start_at IS NULL OR end_at IS NULL
  `);
  a.checkEq('flights huérfanos (sin flight_id o timestamps)', orphanFlights.rows[0].n, 0);

  // flight_id debe ser único
  const dupFlightIds = await client.query(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT flight_id FROM dji_flights GROUP BY flight_id, source HAVING COUNT(*) > 1
    ) d
  `);
  a.checkEq('flight_id únicos (sin duplicados por source)', dupFlightIds.rows[0].n, 0);

  console.log('\n── 3. Fumigations ──────────────────────────────────────────');
  const fums = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE parcel_id IS NULL) AS aggregate,
      COUNT(*) FILTER (WHERE parcel_id IS NOT NULL) AS per_parcel
    FROM dji_fumigations
  `);
  a.checkGte('fumigations aggregate (parcel_id NULL)', fums.rows[0].aggregate, 0);
  a.checkGte('fumigations per-parcel', fums.rows[0].per_parcel, 1);

  // No debería haber fumigations per-parcel sin parcel_id válido
  const orphanFums = await client.query(`
    SELECT COUNT(*)::int AS n FROM dji_fumigations
    WHERE parcel_id IS NOT NULL
      AND parcel_id NOT IN (SELECT id FROM dji_parcels)
  `);
  a.checkEq('fumigations per-parcel sin parcela válida', orphanFums.rows[0].n, 0);

  // Dose no debería ser null para fumigations con area > 0
  const fumsNoDose = await client.query(`
    SELECT COUNT(*)::int AS n FROM dji_fumigations
    WHERE parcel_id IS NOT NULL
      AND area_fumigated_m2 > 0
      AND dose_l_per_ha IS NULL
  `);
  a.checkEq('fumigations con area>0 pero sin dose', fumsNoDose.rows[0].n, 0);

  console.log('\n── 4. Última fumigación por parcela ─────────────────────────');
  // Cada parcela active debe tener last_fumigation_date en schedule
  const schedule = await client.query(`
    SELECT
      COUNT(*)::int AS total_active,
      COUNT(last_fumigation_date)::int AS with_last_fum,
      COUNT(next_due_date)::int AS with_next_due
    FROM dji_fumigation_schedule
    WHERE is_active = true
  `);
  console.log(`  schedule: ${schedule.rows[0].total_active} activas, ${schedule.rows[0].with_last_fum} con last_fum, ${schedule.rows[0].with_next_due} con next_due`);
  // No assertion dura — solo info

  console.log('\n── 5. Parcels overdue (>21 días sin fumigar) ────────────────');
  const overdue = await client.query(`
    WITH last_fum AS (
      SELECT parcel_id, MAX(fumigation_date) AS last_date
      FROM dji_fumigations WHERE parcel_id IS NOT NULL GROUP BY parcel_id
    )
    SELECT COUNT(*)::int AS n FROM dji_parcels p
    LEFT JOIN last_fum lf ON lf.parcel_id = p.id
    WHERE lf.last_date IS NULL OR lf.last_date < CURRENT_DATE - INTERVAL '21 days'
  `);
  console.log(`  parcels overdue (incluyendo never-fumigated): ${overdue.rows[0].n}`);
  // No assertion — depende del estado operacional

  console.log('\n── 6. Por dron (top 5) ─────────────────────────────────────');
  const byDrone = await client.query(`
    SELECT drone_nickname,
           COUNT(*)::int AS flights,
           ROUND(SUM(area_m2)::numeric / 10000, 2) AS ha,
           ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS liters,
           COUNT(DISTINCT parcel_id) AS distinct_parcels
    FROM dji_flights
    WHERE drone_nickname IS NOT NULL
    GROUP BY drone_nickname
    ORDER BY flights DESC
    LIMIT 5
  `);
  console.log('  drone              | flights |   ha    |   L    | parcels');
  for (const r of byDrone.rows) {
    console.log(`  ${(r.drone_nickname || '—').padEnd(20)}| ${String(r.flights).padStart(7)} | ${String(r.ha).padStart(6)} | ${String(r.liters).padStart(6)} | ${r.distinct_parcels}`);
  }
  // Debe haber al menos 1 drone
  a.checkGte('drones distintos', byDrone.rows.length, 1);

  console.log('\n── 7. Por pilot ───────────────────────────────────────────');
  const byPilot = await client.query(`
    SELECT pilot_name, COUNT(*)::int AS flights, ROUND(SUM(area_m2)::numeric / 10000, 2) AS ha
    FROM dji_flights
    WHERE pilot_name IS NOT NULL
    GROUP BY pilot_name
    ORDER BY flights DESC
    LIMIT 5
  `);
  console.log('  pilot                | flights |   ha');
  for (const r of byPilot.rows) {
    console.log(`  ${(r.pilot_name || '—').padEnd(20)} | ${String(r.flights).padStart(7)} | ${String(r.ha).padStart(6)}`);
  }
  a.checkGte('pilotos distintos', byPilot.rows.length, 1);

  console.log('\n── 8. Consistencia de totales ─────────────────────────────');
  // Suma de area_fumigated_m2 de fumigations per-parcel <= suma de area_m2 de flights
  // (cada fumigation agrupa flights del día, así que la suma debería <= la suma raw de flights).
  // Esta es una sanity check, no una igualdad estricta.
  const totalAreaFlights = await client.query(`
    SELECT COALESCE(SUM(area_m2), 0)::numeric AS s
    FROM dji_flights WHERE parcel_id IS NOT NULL
  `);
  const totalAreaFums = await client.query(`
    SELECT COALESCE(SUM(area_fumigated_m2), 0)::numeric AS s
    FROM dji_fumigations WHERE parcel_id IS NOT NULL
  `);
  const f = Number(totalAreaFlights.rows[0].s);
  const u = Number(totalAreaFums.rows[0].s);
  console.log(`  Σ flights area_m2: ${f.toFixed(0)} m² (${(f / 10000).toFixed(2)} ha)`);
  console.log(`  Σ fumigations area_fumigated_m2: ${u.toFixed(0)} m² (${(u / 10000).toFixed(2)} ha)`);
  a.check('Σ fumigations ≈ Σ flights (mismo dominio, redondeo de tiempo)', Math.abs(f - u) / f < 0.05,
    `diff=${Math.abs(f - u).toFixed(0)} m² (${(Math.abs(f - u) / f * 100).toFixed(2)}%)`);

  console.log('\n── 9. Schedule actualizado ──────────────────────────────────');
  // El schedule debe tener next_due_date coherente con last + cadence
  const sched = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM dji_fumigation_schedule s
    WHERE last_fumigation_date IS NOT NULL
      AND next_due_date IS NOT NULL
      AND next_due_date < last_fumigation_date
  `);
  a.checkEq('schedules con next_due_date < last_fumigation_date (inconsistencia)', sched.rows[0].n, 0);

  return a.summary();
}

async function main() {
  loadLocalEnv();
  const pool = createPool();
  const client = await pool.connect();
  try {
    console.log('================================================================');
    console.log('🧪 SMOKE TEST — DB state validation');
    console.log('================================================================');
    const failures = await smokeTest(client);
    console.log('================================================================');
    if (failures > 0) {
      console.log(`❌ ${failures} assertion(s) failed`);
      process.exit(1);
    }
    console.log('✅ All assertions passed');
  } catch (err) {
    console.error('[smoke] ERROR:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, smokeTest };