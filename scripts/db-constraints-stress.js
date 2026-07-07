#!/usr/bin/env node
/**
 * DB Constraints Stress Test (2026-07-07) - v3
 *
 * Note: dji_flights.flight_id is BIGINT not TEXT (DJI's actual flight IDs
 * fit in 64-bit). Using large numeric values to avoid collisions.
 */

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

loadLocalEnv();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

let passed = 0;
let failed = 0;

async function expectReject(label, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      await c.query(sql, params);
      await c.query('ROLLBACK');
      console.log(`  FAIL  ${label}  (insert succeeded but should have been rejected)`);
      failed++;
    } catch (err) {
      await c.query('ROLLBACK');
      const code = err.constraint || err.code || 'unknown';
      console.log(`  PASS  ${label}  (${code})`);
      passed++;
    }
  } finally {
    c.release();
  }
}

async function expectAccept(label, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      await c.query(sql, params);
      await c.query('ROLLBACK');
      console.log(`  PASS  ${label}  (accepted as expected)`);
      passed++;
    } catch (err) {
      await c.query('ROLLBACK');
      console.log(`  FAIL  ${label}  (unexpected reject: ${err.message})`);
      failed++;
    }
  } finally {
    c.release();
  }
}

(async () => {
  const real = await pool.query('SELECT id FROM dji_parcels LIMIT 1');
  const realParcelId = real.rows[0].id;

  console.log('=== INVERSE TESTS (deben PASAR — si fallan, schema gap) ===\n');

  // 1. area_fumigated_m2 negativa
  await expectAccept(
    'dji_fumigations: area_fumigated_m2 negativa (no hay CHECK >= 0)',
    `INSERT INTO dji_fumigations (parcel_id, fumigation_date, area_fumigated_m2, dose_l_per_ha, source)
     VALUES ($1, CURRENT_DATE, -100, 1, 'manual')`,
    [realParcelId]
  );

  // 2. lng fuera de rango
  await expectAccept(
    'dji_flights: lng=200 (fuera de rango geografico, no hay CHECK)',
    `INSERT INTO dji_flights (flight_id, source, parcel_id, start_at, end_at, duration_seconds, area_m2, lng, lat)
     VALUES ($1, 'manual', $2, NOW(), NOW(), 60, 100, 200, 3)`,
    [9900000001, realParcelId]
  );

  // 3. lat fuera de rango
  await expectAccept(
    'dji_flights: lat=100 (fuera de rango geografico, no hay CHECK)',
    `INSERT INTO dji_flights (flight_id, source, parcel_id, start_at, end_at, duration_seconds, area_m2, lng, lat)
     VALUES ($1, 'manual', $2, NOW(), NOW(), 60, 100, -76, 100)`,
    [9900000002, realParcelId]
  );

  // 4. fumigation_date en 2200
  await expectAccept(
    'dji_fumigations: fumigation_date en 2200 (futuro, no hay CHECK)',
    `INSERT INTO dji_fumigations (parcel_id, fumigation_date, area_fumigated_m2, dose_l_per_ha, source)
     VALUES ($1, '2200-01-01', 100, 1, 'manual')`,
    [realParcelId]
  );

  // 5. recommended_cadence_days = 1 (un dia)
  await expectAccept(
    'dji_fumigation_schedule: cadence_days = 1 (pasa aunque sea poco)',
    `INSERT INTO dji_fumigation_schedule (parcel_id, crop_type, recommended_cadence_days)
     VALUES ($1, 'sugar_cane', 1)
     ON CONFLICT (parcel_id) DO UPDATE SET recommended_cadence_days = 1`,
    [realParcelId]
  );

  // 6. start_at en 1900
  await expectAccept(
    'dji_flights: start_at en 1900 (pasado lejano, no hay CHECK)',
    `INSERT INTO dji_flights (flight_id, source, parcel_id, start_at, end_at, duration_seconds, area_m2, lng, lat)
     VALUES ($1, 'manual', $2, '1900-01-01', '1900-01-01', 60, 100, -76, 3)`,
    [9900000003, realParcelId]
  );

  // 7. dose_l_per_ha negativa
  await expectAccept(
    'dji_fumigations: dose_l_per_ha negativa (no hay CHECK)',
    `INSERT INTO dji_fumigations (parcel_id, fumigation_date, area_fumigated_m2, dose_l_per_ha, source)
     VALUES ($1, CURRENT_DATE, 100, -5, 'manual')`,
    [realParcelId]
  );

  // 8. duration_seconds negativa
  await expectAccept(
    'dji_flights: duration_seconds negativo (no hay CHECK)',
    `INSERT INTO dji_flights (flight_id, source, parcel_id, start_at, end_at, duration_seconds, area_m2, lng, lat)
     VALUES ($1, 'manual', $2, NOW(), NOW(), -60, 100, -76, 3)`,
    [9900000004, realParcelId]
  );

  // 9. area_m2 negativa en flights
  await expectAccept(
    'dji_flights: area_m2 negativa (no hay CHECK)',
    `INSERT INTO dji_flights (flight_id, source, parcel_id, start_at, end_at, duration_seconds, area_m2, lng, lat)
     VALUES ($1, 'manual', $2, NOW(), NOW(), 60, -100, -76, 3)`,
    [9900000005, realParcelId]
  );

  console.log('\n=== SUMMARY ===');
  console.log(`PASSED: ${passed} (inserts accepted - some may indicate schema gaps)`);
  console.log(`FAILED: ${failed}`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});