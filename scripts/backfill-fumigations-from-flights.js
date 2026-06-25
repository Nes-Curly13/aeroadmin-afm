// CLI: backfill dji_fumigations con datos per-parcel desde dji_flights.
//
// Agrupa los vuelos por (parcel_id, fecha local Colombia) y agrega:
//   - area_fumigated_m2 = sum(area_m2)
//   - duration_minutes = sum(duration_seconds) / 60
//   - spray_usage_ml = sum(spray_usage_ml)
//   - dose_l_per_ha = (spray_ml / 1000) / (area_m2 / 10000)
//   - drone_code_used = mapeo desde drone_nickname (T40/T50 → 201)
//   - recorded_by = pilot_name (si hay)
//
// Idempotente: borra filas con source='import-flights' antes de re-insertar.
// NO toca filas con parcel_id NULL (que son las aggregate imports previas).
//
// Por qué este approach es mejor que las aggregate imports:
//   - Las aggregate imports (dji_fumigations con parcel_id NULL) son totales
//     diarios para TODA la cuenta — no sabemos qué parcela específica.
//   - Ahora que dji_flights tiene parcel_id (vía spatial join), podemos
//     derivar eventos per-parcel con el desglose por dron/piloto.
//
// Uso:
//   node scripts/backfill-fumigations-from-flights.js
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
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

/**
 * Mapea drone_nickname (humano) a dji_drone_models.code.
 * Ver dji_drone_models en migration 20260617170000:
 *   0=Sin asignar, 72=T16/T20, 201=T40/T50, 210=T70
 */
function droneCodeFromNickname(nickname) {
  if (!nickname) return null;
  const n = nickname.toLowerCase();
  if (n.includes('t40') || n.includes('t50')) return 201;
  if (n.includes('t16') || n.includes('t20')) return 72;
  if (n.includes('t70')) return 210;
  return 0;  // Sin asignar
}

/**
 * Backfill desde dji_flights. Devuelve stats.
 *
 * Estrategia:
 *   1. DELETE rows con source='import-flights' (idempotente)
 *   2. INSERT nuevos rows agrupados por (parcel_id, local_date)
 *   3. Solo flights con parcel_id IS NOT NULL (los unmatched quedan fuera)
 */
async function backfillFumigationsFromFlights(client) {
  // 1. Borrar filas previas del backfill. Solo rows con source='import' y
  //    parcel_id NOT NULL son de este script (los aggregate tienen parcel_id NULL,
  //    y los manuales tienen source='manual'). Idempotente.
  const del = await client.query(
    `DELETE FROM dji_fumigations
     WHERE source = 'import'
       AND parcel_id IS NOT NULL`
  );
  console.log(`  [backfill] deleted ${del.rowCount} previous backfilled rows`);

  // 2. Insertar nuevas filas agrupadas
  //
  // DATE(start_at AT TIME ZONE 'America/Bogota') = fecha local del vuelo
  // (importante: Colombia UTC-5, no UTC). DJI también usa local time.
  //
  // drone_code_used: usamos un CASE en SQL para mapear drone_nickname →
  // dji_drone_models.code (T40/T50 → 201, T16/T20 → 72, etc.).
  // Si no matchea ninguno, queda 0 (Sin asignar).
  const ins = await client.query(`
    WITH agg AS (
      SELECT
        DATE(f.start_at AT TIME ZONE 'America/Bogota') AS fumigation_date,
        f.parcel_id,
        -- drone_nickname más frecuente del día
        (MODE() WITHIN GROUP (ORDER BY f.drone_nickname)) AS primary_drone_nickname,
        -- drone_code mapeado
        CASE
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t40%' THEN 201
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t50%' THEN 201
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t16%' THEN 72
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t20%' THEN 72
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t70%' THEN 210
          ELSE 0
        END AS drone_code_used,
        SUM(f.area_m2)::numeric(12, 2) AS area_fumigated_m2,
        ROUND(SUM(f.duration_seconds) / 60.0)::int AS duration_minutes,
        CASE
          WHEN SUM(f.area_m2) > 0 THEN
            ROUND(((SUM(f.spray_usage_ml) / 1000.0) / (SUM(f.area_m2) / 10000.0))::numeric, 2)
          ELSE NULL
        END AS dose_l_per_ha,
        COUNT(*)::int AS flights_count,
        SUM(f.spray_usage_ml)::int AS total_spray_ml,
        array_agg(DISTINCT f.drone_nickname) AS drones,
        array_agg(DISTINCT f.pilot_name) FILTER (WHERE f.pilot_name IS NOT NULL) AS pilots,
        (MODE() WITHIN GROUP (ORDER BY f.pilot_name)) AS primary_pilot
      FROM dji_flights f
      WHERE f.parcel_id IS NOT NULL
        AND f.start_at IS NOT NULL
      GROUP BY f.parcel_id, DATE(f.start_at AT TIME ZONE 'America/Bogota')
    )
    INSERT INTO dji_fumigations (
      fumigation_date, parcel_id, drone_code_used,
      area_fumigated_m2, duration_minutes, dose_l_per_ha,
      notes, recorded_by, source
    )
    SELECT
      fumigation_date, parcel_id, drone_code_used,
      area_fumigated_m2, duration_minutes, dose_l_per_ha,
      jsonb_build_object(
        'backfilled_from', 'dji_flights',
        'flights_count', flights_count,
        'spray_usage_ml', total_spray_ml,
        'drones', drones,
        'pilots', pilots,
        'primary_drone_nickname', primary_drone_nickname
      ),
      primary_pilot,
      'import'
    FROM agg
    RETURNING id, fumigation_date, parcel_id
  `);

  return {
    inserted: ins.rowCount,
  };
}

async function main() {
  loadLocalEnv();
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[backfill] aggregating dji_flights → dji_fumigations...');
    const stats = await backfillFumigationsFromFlights(client);
    await client.query('COMMIT');
    console.log(
      `[backfill] OK: ${stats.inserted} fumigations backfilled, ${stats.droneMapped} con drone_code mapeado`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[backfill] ERROR:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, backfillFumigationsFromFlights, droneCodeFromNickname };