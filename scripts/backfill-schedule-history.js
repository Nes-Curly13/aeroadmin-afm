// scripts/backfill-schedule-history.js
//
// Sprint G2 — backfill retroactivo del schedule history.
//
// El trigger `trg_dji_fumigation_schedule_change` (creado en la
// migration 20260725000000) solo registra cambios a partir de hoy.
// Para tener un "punto cero" histórico, este script inserta un row
// por cada `dji_fumigation_schedule` actual, con old=NULL (no
// teníamos el valor anterior) y new=current.
//
// Fecha del "punto cero": 2026-06-18 (commit 03461ea "Add fumigation
// traceability: schedule + events + UI + API" — el primer commit que
// introdujo dji_fumigation_schedule).
//
// El script desactiva el trigger temporalmente para no generar filas
// duplicadas. Si se corre dos veces, no duplica (ON CONFLICT no
// aplica porque la tabla no tiene UNIQUE; en su lugar usamos un
// check de "ya hay un row con old_*=NULL para esta parcela").
//
// Uso:
//   node scripts/backfill-schedule-history.js
//   node scripts/backfill-schedule-history.js --dry-run   # no escribe
//
// Requiere pg (npm install --no-save pg).

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
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnv();

const SEED_COMMIT_SHA = '03461ea';
const SEED_DATE = '2026-06-18 10:50:09-05:00';
const TRIGGER_NAME = 'trg_dji_fumigation_schedule_change';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    // 1) Listar todos los schedules actuales
    const schedules = await c.query(
      `SELECT parcel_id, crop_type, recommended_cadence_days
         FROM dji_fumigation_schedule
        WHERE is_active = true`
    );
    console.log(`[backfill] ${schedules.rows.length} schedules activos encontrados`);

    // 2) Cuáles ya tienen un row de "punto cero" (old_*=NULL) en history
    const existing = await c.query(
      `SELECT DISTINCT parcel_id
         FROM dji_fumigation_schedule_history
        WHERE old_cadence_days IS NULL AND old_crop_type IS NULL`
    );
    const existingSet = new Set(existing.rows.map((r) => r.parcel_id));
    console.log(`[backfill] ${existingSet.size} parcelas ya tienen row de punto cero`);

    // 3) Filtrar las que faltan
    const pending = schedules.rows.filter((r) => !existingSet.has(r.parcel_id));
    console.log(`[backfill] ${pending.length} parcelas pendientes de backfill`);

    if (pending.length === 0) {
      console.log('[backfill] nada que hacer. Exit.');
      return;
    }

    if (dryRun) {
      console.log(`[backfill] DRY RUN: insertaría ${pending.length} rows.`);
      pending.slice(0, 5).forEach((p) =>
        console.log(`  parcel=${p.parcel_id} crop=${p.crop_type} cadence=${p.recommended_cadence_days}d`)
      );
      if (pending.length > 5) console.log(`  ... y ${pending.length - 5} más`);
      return;
    }

    // 4) Desactivar el trigger para no generar rows duplicados
    await c.query(`ALTER TABLE dji_fumigation_schedule DISABLE TRIGGER ${TRIGGER_NAME}`);

    // 5) Insertar en batch
    let inserted = 0;
    for (const row of pending) {
      await c.query(
        `INSERT INTO dji_fumigation_schedule_history (
           parcel_id, old_cadence_days, new_cadence_days,
           old_crop_type, new_crop_type,
           changed_by, reason, commit_sha, changed_at
         ) VALUES ($1, NULL, $2, NULL, $3, 'backfill', $4, $5, $6)`,
        [
          row.parcel_id,
          row.recommended_cadence_days,
          row.crop_type,
          `backfill retrospectivo Sprint G2: estado inicial del schedule al commit ${SEED_COMMIT_SHA}`,
          SEED_COMMIT_SHA,
          SEED_DATE
        ]
      );
      inserted += 1;
    }

    // 6) Reactivar el trigger
    await c.query(`ALTER TABLE dji_fumigation_schedule ENABLE TRIGGER ${TRIGGER_NAME}`);

    console.log(`[backfill] ${inserted} rows insertados. Trigger reactivado.`);
  } catch (e) {
    console.error('[backfill] ERROR:', e.message);
    // Asegurar que el trigger quede activo incluso si falló a mitad
    try {
      await c.query(`ALTER TABLE dji_fumigation_schedule ENABLE TRIGGER ${TRIGGER_NAME}`);
    } catch (e2) {
      console.error('[backfill] no pude reactivar el trigger:', e2.message);
    }
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main();
