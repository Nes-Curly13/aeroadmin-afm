#!/usr/bin/env node
// CLI: linkea fumigaciones al cycle activo de su parcela.
//
// Por que existe:
//   Despues del backfill de cycles (scripts/backfill-cycles-direct.js), la
//   tabla cycles tiene 1+ registros por parcela. Pero las fumigaciones en
//   dji_fumigations.cycle_id estan todas NULL — falta el link.
//
//   Este script UPDATE cada fumigacion al cycle que estaba activo en su
//   fecha (fumigation_date entre cycle.start_date y cycle.end_date).
//
// Idempotente: re-correr no hace nada (solo actualiza fumigaciones con
//   cycle_id IS NULL). Safe.
//
// Uso:
//   node scripts/link-fumigations-to-cycles.js
//   node scripts/link-fumigations-to-cycles.js --dry-run

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

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const pool = new Pool({ connectionString, max: 3, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    // 0) Conteo previo.
    const before = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(cycle_id)::int AS linked,
        COUNT(*) FILTER (WHERE parcel_id IS NOT NULL)::int AS with_parcel
      FROM dji_fumigations WHERE deleted_at IS NULL
    `);
    console.log('[link-fumigation-cycles] antes:', before.rows[0]);

    // 1) Preview: cuantas fumigaciones se linkearan, cuantos parcels sin cycle match.
    const preview = await client.query(`
      SELECT
        COUNT(*)::int AS to_link,
        COUNT(DISTINCT f.parcel_id)::int AS distinct_parcels
      FROM dji_fumigations f
      JOIN cycles c
        ON c.parcela_id = f.parcel_id
       AND f.fumigation_date >= c.start_date
       AND (c.end_date IS NULL OR f.fumigation_date <= c.end_date)
      WHERE f.deleted_at IS NULL
        AND f.parcel_id IS NOT NULL
        AND f.cycle_id IS NULL
    `);
    console.log('  a linkear:', preview.rows[0]);

    if (preview.rows[0].to_link === 0) {
      console.log('  (nada que linkear — todas las fumigaciones con parcel_id ya tienen cycle_id)');
      return;
    }

    if (args.dryRun) {
      console.log('\n[link-fumigation-cycles] DRY-RUN: no se actualizo nada.');
      return;
    }

    // 2) UPDATE: linkear fumigaciones al cycle activo.
    //    Si hay multiples cycles que matchean, elegimos el de mayor start_date
    //    (el "más nuevo abierto" — el más reciente, que es el más probable).
    const upd = await client.query(`
      WITH candidates AS (
        SELECT
          f.id AS fumigation_id,
          c.id AS cycle_id,
          ROW_NUMBER() OVER (
            PARTITION BY f.id ORDER BY c.start_date DESC
          ) AS rn
        FROM dji_fumigations f
        JOIN cycles c
          ON c.parcela_id = f.parcel_id
         AND f.fumigation_date >= c.start_date
         AND (c.end_date IS NULL OR f.fumigation_date <= c.end_date)
        WHERE f.deleted_at IS NULL
          AND f.parcel_id IS NOT NULL
          AND f.cycle_id IS NULL
      )
      UPDATE dji_fumigations f
      SET cycle_id = cand.cycle_id
      FROM candidates cand
      WHERE f.id = cand.fumigation_id
        AND cand.rn = 1
      RETURNING 1 AS updated
    `);
    const linked = upd.rows.length;
    console.log(`\n[link-fumigation-cycles] OK: ${linked} fumigaciones linkeadas a cycles`);

    // 3) Conteo posterior.
    const after = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(cycle_id)::int AS linked
      FROM dji_fumigations WHERE deleted_at IS NULL
    `);
    console.log('  despues:', after.rows[0]);
  } catch (err) {
    console.error('[link-fumigation-cycles] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
