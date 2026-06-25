// CLI: queries de dashboard para dji_flights + dji_fumigations + dji_parcels.
//
// Idempotente y read-only. Imprime tablas útiles para el dashboard:
//
//   1. Per-parcel last fumigation (con days_since_last + status)
//   2. Per-drone stats (flights, ha, L, parcelas distintas)
//   3. Per-pilot stats
//   4. Daily summary últimos 14 días
//   5. Parcels sin fumigación reciente (alerta)
//
// Uso:
//   node scripts/dashboard-queries.js
//   node scripts/dashboard-queries.js --top 20   # top N parcelas
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

async function queryLastFumigationPerParcel(client, topN) {
  // days_since_last = current_date - last fumigation
  // status: 'overdue' (>2x cadence), 'due_soon' (>1x cadence), 'recent', 'never'
  const sql = `
    WITH last_fum AS (
      SELECT parcel_id,
             MAX(fumigation_date) AS last_date,
             SUM(area_fumigated_m2)::numeric(14, 2) AS total_area_m2,
             COUNT(*)::int AS fum_events,
             ROUND(AVG(dose_l_per_ha)::numeric, 1) AS avg_dose
      FROM dji_fumigations
      WHERE parcel_id IS NOT NULL
        AND source IN ('import', 'manual', 'djiscraper')
      GROUP BY parcel_id
    )
    SELECT
      p.id AS parcel_id,
      p.land_name,
      p.field_type,
      lf.last_date AS last_fumigation_date,
      CURRENT_DATE - lf.last_date AS days_since_last,
      lf.fum_events,
      ROUND(lf.total_area_m2 / 10000, 2) AS total_ha,
      lf.avg_dose AS avg_dose_l_per_ha,
      CASE
        WHEN lf.last_date IS NULL THEN 'never'
        WHEN lf.last_date < CURRENT_DATE - INTERVAL '60 days' THEN 'overdue'
        WHEN lf.last_date < CURRENT_DATE - INTERVAL '21 days' THEN 'due_soon'
        ELSE 'recent'
      END AS status
    FROM dji_parcels p
    LEFT JOIN last_fum lf ON lf.parcel_id = p.id
    ORDER BY days_since_last DESC NULLS FIRST
    LIMIT $1
  `;
  const r = await client.query(sql, [topN]);
  return r.rows;
}

async function queryPerDrone(client) {
  const sql = `
    SELECT drone_nickname,
           COUNT(*)::int AS flights,
           COUNT(DISTINCT parcel_id) AS distinct_parcels,
           ROUND(SUM(area_m2)::numeric / 10000, 2) AS total_ha,
           ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS total_l,
           ROUND(AVG(area_m2)::numeric, 0) AS avg_area_m2_per_flight
    FROM dji_flights
    GROUP BY drone_nickname
    ORDER BY flights DESC
  `;
  const r = await client.query(sql);
  return r.rows;
}

async function queryPerPilot(client) {
  const sql = `
    SELECT pilot_name,
           COUNT(*)::int AS flights,
           COUNT(DISTINCT parcel_id) AS distinct_parcels,
           ROUND(SUM(area_m2)::numeric / 10000, 2) AS total_ha,
           ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS total_l
    FROM dji_flights
    WHERE pilot_name IS NOT NULL
    GROUP BY pilot_name
    ORDER BY flights DESC
  `;
  const r = await client.query(sql);
  return r.rows;
}

async function queryDailyLast14(client) {
  const sql = `
    SELECT
      DATE(start_at AT TIME ZONE 'America/Bogota') AS local_date,
      COUNT(*)::int AS flights,
      COUNT(DISTINCT parcel_id) AS parcels,
      ROUND(SUM(area_m2)::numeric / 10000, 2) AS ha,
      ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS liters
    FROM dji_flights
    WHERE start_at > NOW() - INTERVAL '14 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  const r = await client.query(sql);
  return r.rows;
}

async function queryParcelsNeedingAttention(client, topN) {
  // Parcels que NO han sido fumigados en los últimos 30 días y tienen
  // vuelos recientes (señal de que están activas pero con cadencia rota).
  const sql = `
    WITH recent_flights AS (
      SELECT DISTINCT parcel_id
      FROM dji_flights
      WHERE start_at > NOW() - INTERVAL '60 days'
    ),
    last_fum AS (
      SELECT parcel_id, MAX(fumigation_date) AS last_date
      FROM dji_fumigations
      WHERE parcel_id IS NOT NULL
      GROUP BY parcel_id
    )
    SELECT
      p.id AS parcel_id,
      p.land_name,
      p.field_type,
      lf.last_date AS last_fumigation_date,
      CURRENT_DATE - lf.last_date AS days_since_last
    FROM dji_parcels p
    JOIN recent_flights rf ON rf.parcel_id = p.id
    LEFT JOIN last_fum lf ON lf.parcel_id = p.id
    WHERE lf.last_date IS NULL OR lf.last_date < CURRENT_DATE - INTERVAL '21 days'
    ORDER BY days_since_last DESC NULLS FIRST
    LIMIT $1
  `;
  const r = await client.query(sql, [topN]);
  return r.rows;
}

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const topIdx = args.indexOf('--top');
  const topN = topIdx >= 0 ? Number(args[topIdx + 1]) || 20 : 20;

  const pool = createPool();
  const client = await pool.connect();
  try {
    console.log('================================================================');
    console.log(`📊 Dashboard queries — top ${topN}`);
    console.log('================================================================\n');

    console.log('── 1. Last fumigation per parcel ────────────────────────────');
    const lastFum = await queryLastFumigationPerParcel(client, topN);
    console.log(`  parcel_id | land_name           | last_fum  | days | status    | events | ha    | dose_L/ha`);
    for (const r of lastFum) {
      const last = r.last_fumigation_date ? r.last_fumigation_date.toISOString().slice(0, 10) : '—';
      console.log(
        `  ${String(r.parcel_id).padStart(9)} | ${(r.land_name || '').slice(0, 20).padEnd(20)} | ${last} | ${String(r.days_since_last ?? '—').padStart(4)} | ${(r.status || '').padEnd(9)} | ${String(r.fum_events ?? '—').padStart(6)} | ${String(r.total_ha ?? '—').padStart(5)} | ${r.avg_dose_l_per_ha ?? '—'}`
      );
    }

    console.log('\n── 2. Per-drone stats ────────────────────────────────────────');
    const drones = await queryPerDrone(client);
    console.log('  nickname   | flights | parcels | total_ha | total_L | avg_area_m2');
    for (const r of drones) {
      console.log(
        `  ${(r.drone_nickname || '—').padEnd(11)} | ${String(r.flights).padStart(7)} | ${String(r.distinct_parcels).padStart(7)} | ${String(r.total_ha).padStart(8)} | ${String(r.total_l).padStart(7)} | ${r.avg_area_m2_per_flight ?? '—'}`
      );
    }

    console.log('\n── 3. Per-pilot stats ───────────────────────────────────────');
    const pilots = await queryPerPilot(client);
    console.log('  pilot                | flights | parcels | total_ha | total_L');
    for (const r of pilots) {
      console.log(
        `  ${(r.pilot_name || '—').padEnd(20)} | ${String(r.flights).padStart(7)} | ${String(r.distinct_parcels).padStart(7)} | ${String(r.total_ha).padStart(8)} | ${String(r.total_l).padStart(7)}`
      );
    }

    console.log('\n── 4. Daily summary (últimos 14 días) ────────────────────────');
    const daily = await queryDailyLast14(client);
    console.log('  date       | flights | parcels | ha    | L');
    for (const r of daily) {
      const d = r.local_date?.toISOString().slice(0, 10);
      console.log(`  ${d} | ${String(r.flights).padStart(7)} | ${String(r.parcels).padStart(7)} | ${String(r.ha).padStart(5)} | ${String(r.liters).padStart(5)}`);
    }

    console.log('\n── 5. Parcels needing attention (overdue) ──────────────────');
    const need = await queryParcelsNeedingAttention(client, topN);
    if (need.length === 0) {
      console.log('  (none — all recent parcels have current fumigations)');
    } else {
      console.log(`  parcel_id | land_name           | last_fum  | days_since`);
      for (const r of need) {
        const last = r.last_fumigation_date ? r.last_fumigation_date.toISOString().slice(0, 10) : '—';
        console.log(
          `  ${String(r.parcel_id).padStart(9)} | ${(r.land_name || '').slice(0, 20).padEnd(20)} | ${last} | ${String(r.days_since_last ?? '—').padStart(4)}`
        );
      }
    }

    console.log('\n================================================================');
  } catch (err) {
    console.error('[dashboard] ERROR:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  queryLastFumigationPerParcel,
  queryPerDrone,
  queryPerPilot,
  queryDailyLast14,
  queryParcelsNeedingAttention,
};