#!/usr/bin/env node
// CLI: backfill cycles (Fase 4.3) — versión SQL directo.
//
// Por qué este script existe:
//   La función api/repositories.ts → backfillCyclesFromFumigations() referencia
//   columnas que NO existen en dji_fumigations: usa `parcela_id` y
//   `applied_at`, pero la tabla real tiene `parcel_id` y `fumigation_date`.
//   El endpoint POST /api/admin/cycles/backfill llama esa función, así que
//   está roto. Hasta que se arregle (cambiar 2 column names en repositories.ts
//   + redeploy), corremos el backfill directo con SQL.
//
// Idempotencia: NO. Solo corre una vez. Después de la primera corrida,
//   la tabla cycles tiene los registros dji_inferred y un re-run duplica.
//
// Uso:
//   node scripts/backfill-cycles-direct.js [--gap-days 120]
//   node scripts/backfill-cycles-direct.js --dry-run

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
  const args = { gapDays: 120, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gap-days' && argv[i + 1]) args.gapDays = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
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
    // 0) Pre-check: ¿ya corrimos?
    const existing = await client.query(
      `SELECT COUNT(*)::int AS n FROM cycles WHERE source = 'dji_inferred'`
    );
    if (existing.rows[0].n > 0 && !args.dryRun) {
      console.warn(`[backfill-cycles] ADVERTENCIA: ya hay ${existing.rows[0].n} cycles dji_inferred en la tabla.`);
      console.warn(`  Este script NO es idempotente. Re-correr puede duplicar.`);
      console.warn(`  Si querés safe-re-run, pasá --dry-run primero.`);
      console.warn(`  Continuando en 3s (Ctrl+C para abortar)...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // 1) Preview de los ciclos que se crearían (sin --dry-run muestra igual).
    const preview = await client.query(
      `WITH ordered AS (
         SELECT
           f.parcel_id,
           f.fumigation_date AS fdate,
           LAG(f.fumigation_date) OVER (
             PARTITION BY f.parcel_id ORDER BY f.fumigation_date
           ) AS prev_fdate
         FROM dji_fumigations f
         WHERE f.deleted_at IS NULL AND f.parcel_id IS NOT NULL
       ),
       gaps AS (
         SELECT
           parcel_id,
           fdate,
           prev_fdate,
           (fdate - prev_fdate) AS days_since_prev
         FROM ordered
       )
       SELECT parcel_id, fdate AS start_date
       FROM gaps
       WHERE prev_fdate IS NULL OR days_since_prev > $1
       ORDER BY parcel_id, start_date`,
      [args.gapDays]
    );
    console.log(`[backfill-cycles] ciclos a crear: ${preview.rows.length}`);
    if (preview.rows.length === 0) {
      console.log('  (nada que crear con gap_days=' + args.gapDays + ')');
      return;
    }
    console.log('  preview (primeros 5):');
    for (const r of preview.rows.slice(0, 5)) {
      console.log(`    parcel_id=${r.parcel_id} start=${r.start_date.toISOString().slice(0, 10)}`);
    }
    const distinctParcels = new Set(preview.rows.map(r => r.parcel_id)).size;
    console.log(`  parcelas afectadas: ${distinctParcels}`);

    if (args.dryRun) {
      console.log('\n[backfill-cycles] DRY-RUN: no se insertó nada.');
      return;
    }

    // 2) Insert.
    const result = await client.query(
      `WITH ordered AS (
         SELECT
           f.parcel_id,
           f.fumigation_date AS fdate,
           LAG(f.fumigation_date) OVER (
             PARTITION BY f.parcel_id ORDER BY f.fumigation_date
           ) AS prev_fdate
         FROM dji_fumigations f
         WHERE f.deleted_at IS NULL AND f.parcel_id IS NOT NULL
       ),
       gaps AS (
         SELECT
           parcel_id,
           fdate,
           prev_fdate,
           (fdate - prev_fdate) AS days_since_prev
         FROM ordered
       ),
       new_cycle_starts AS (
         SELECT parcel_id, fdate AS start_date
         FROM gaps
         WHERE prev_fdate IS NULL OR days_since_prev > $1
       )
       INSERT INTO cycles (parcela_id, crop_type, variety, start_date,
                            end_date, source, data_validity, notes)
       SELECT parcel_id, NULL, NULL, start_date, NULL, 'dji_inferred',
              'needs_review',
              'Auto-backfilled desde fumigaciones (gap > ' || $1::text || ' dias). Operador debe revisar.'
         FROM new_cycle_starts
       RETURNING 1 AS inserted`,
      [args.gapDays]
    );

    console.log(`\n[backfill-cycles] OK: ${result.rows.length} ciclos insertados`);
    console.log(`  parcelas: ${distinctParcels}`);
    console.log(`  Operator debe ir a /admin/parcels y revisar los needs_review.`);
  } catch (err) {
    console.error('[backfill-cycles] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
