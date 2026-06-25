// CLI: aplica migrations SQL que estén pendientes.
// Lee todos los .sql de supabase/migrations/ en orden lexicografico, los
// ejecuta dentro de una transaccion, y registra cuales ya se aplicaron
// en dji_migrations (crea la tabla si no existe).
//
// Uso:
//   node scripts/apply-pending-migrations.js
//   node scripts/apply-pending-migrations.js --file <path>     # solo uno
//
// Variables: DATABASE_URL

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

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dji_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getApplied(client) {
  const { rows } = await client.query('SELECT name FROM dji_migrations');
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(client, name, sql) {
  // DDL no siempre soporta transacciones (CREATE INDEX CONCURRENTLY, etc.),
  // pero para migrations de este proyecto todas son idempotentes (IF NOT EXISTS)
  // y se pueden correr en una sola transaccion.
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO dji_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: err.message };
  }
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const onlyFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    let files = [];
    if (onlyFile) {
      files = [path.resolve(onlyFile)];
    } else {
      files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => path.join(dir, f));
    }

    let appliedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    for (const file of files) {
      const name = path.basename(file);
      if (applied.has(name) && !onlyFile) {
        console.log(`  [skip] ${name} (ya aplicada)`);
        skippedCount += 1;
        continue;
      }
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`  [apply] ${name} (${sql.length} bytes)...`);
      const result = await applyMigration(client, name, sql);
      if (result.ok) {
        console.log(`    OK`);
        appliedCount += 1;
      } else {
        console.error(`    ERROR: ${result.error.slice(0, 200)}`);
        errorCount += 1;
      }
    }

    console.log(`\n[apply-migrations] done: ${appliedCount} aplicadas, ${skippedCount} skipped, ${errorCount} errors`);
  } catch (err) {
    console.error('[apply-migrations] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, applyMigration, ensureMigrationsTable, getApplied };
