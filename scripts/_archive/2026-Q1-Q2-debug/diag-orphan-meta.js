// Diagnóstico: schema y metadata de las 30 huérfanas
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnv();

const c = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await c.connect();
  try {
    // 1) Schema completo de dji_fumigations
    const fumCols = await c.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dji_fumigations'
      ORDER BY ordinal_position
    `);
    console.log('=== dji_fumigations schema ===');
    fumCols.rows.forEach((r) =>
      console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} ${r.is_nullable}`)
    );

    // 2) Schema completo de dji_flights
    const flCols = await c.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dji_flights'
      ORDER BY ordinal_position
    `);
    console.log('\n=== dji_flights schema ===');
    flCols.rows.forEach((r) =>
      console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} ${r.is_nullable}`)
    );

    // 3) Tablas con "fumigation" o "flight" en el nombre
    const tables = await c.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ILIKE '%fumigat%'
      ORDER BY table_name
    `);
    console.log('\n=== Tablas fumigat* ===');
    tables.rows.forEach((r) => console.log(' ', r.table_name));

    const tables2 = await c.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ILIKE '%flight%'
      ORDER BY table_name
    `);
    console.log('\n=== Tablas flight* ===');
    tables2.rows.forEach((r) => console.log(' ', r.table_name));

    // 4) Las 30 huérfanas — columnas con datos no triviales
    const orphans = await c.query(`
      SELECT *
      FROM dji_fumigations
      WHERE parcel_id IS NULL AND deleted_at IS NULL
      ORDER BY fumigation_date DESC
      LIMIT 5
    `);
    console.log('\n=== 5 huérfanas (muestra) ===');
    orphans.rows.forEach((r) => {
      console.log('\n  id=' + r.id, 'date=' + r.fumigation_date?.toISOString().slice(0, 10));
      Object.entries(r).forEach(([k, v]) => {
        if (v === null || v === undefined) return;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (s.length > 80) console.log(`    ${k}: ${s.slice(0, 80)}...`);
        else console.log(`    ${k}: ${s}`);
      });
    });

    // 5) Para huérfanas, ¿hay flights en la MISMA fecha + mismo drone_serial?
    //    Eso podría ser un match heurístico.
    const candidates = await c.query(`
      WITH orphan_dates AS (
        SELECT id AS fumigation_id, fumigation_date, drone_serial, pilot_name
        FROM dji_fumigations
        WHERE parcel_id IS NULL AND deleted_at IS NULL
      )
      SELECT
        od.fumigation_id,
        od.fumigation_date::date AS date,
        od.drone_serial,
        od.pilot_name,
        f.id AS flight_id,
        f.parcel_id AS flight_parcel_id,
        p.land_name,
        f.lat, f.lng,
        f.created_at
      FROM orphan_dates od
      JOIN dji_flights f
        ON f.created_at::date = od.fumigation_date::date
        AND (f.drone_serial = od.drone_serial OR (f.drone_serial IS NULL AND od.drone_serial IS NULL))
      LEFT JOIN dji_parcels p ON p.id = f.parcel_id
      ORDER BY od.fumigation_date DESC, od.fumigation_id
      LIMIT 30
    `);
    console.log('\n=== Match heurístico: huérfanas ↔ flights misma fecha + mismo drone ===');
    if (candidates.rows.length === 0) {
      console.log('  (sin candidatos)');
    } else {
      const byFum = {};
      candidates.rows.forEach((r) => {
        if (!byFum[r.fumigation_id]) byFum[r.fumigation_id] = [];
        byFum[r.fumigation_id].push(r);
      });
      Object.entries(byFum).slice(0, 10).forEach(([fid, rows]) => {
        console.log(`\n  fumigation_id=${fid} (${rows[0].date?.toISOString().slice(0,10)} drone=${rows[0].drone_serial}):`);
        rows.slice(0, 5).forEach((r) =>
          console.log(`    flight ${r.flight_id} parcel=${r.flight_parcel_id} ${r.land_name ?? 'NULL'} (${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)})`)
        );
        if (rows.length > 5) console.log(`    ... +${rows.length - 5} más`);
      });
    }

    // 6) Cuántas huérfanas tienen match 1-a-1 con un flight de la misma fecha
    const stats = await c.query(`
      WITH orphan_dates AS (
        SELECT id, fumigation_date, drone_serial
        FROM dji_fumigations
        WHERE parcel_id IS NULL AND deleted_at IS NULL
      )
      SELECT
        count(DISTINCT od.id) AS n_orphans,
        count(DISTINCT f.id) AS n_matched_flights
      FROM orphan_dates od
      JOIN dji_flights f
        ON f.created_at::date = od.fumigation_date::date
        AND (f.drone_serial = od.drone_serial OR (f.drone_serial IS NULL AND od.drone_serial IS NULL))
    `);
    console.log('\n=== Stats heurística misma-fecha+mismo-drone ===');
    console.log(' ', stats.rows[0]);
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await c.end();
  }
})();
