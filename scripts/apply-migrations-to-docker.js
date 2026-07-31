// scripts/apply-migrations-to-docker.js
// Aplica migrations a docker (no supabase). Para cuando se quiere
// estabilizar docker antes de migrar a supabase.
//
// Lee supabase/migrations/*.sql en orden lexicografico, las aplica a
// docker, y registra en dji_migrations (la misma tabla que usa
// apply-pending-migrations.js para supabase).
//
// Uso: node scripts/apply-migrations-to-docker.js
//      node scripts/apply-migrations-to-docker.js --from 20260731   # solo desde esa fecha
//      node scripts/apply-migrations-to-docker.js --only 20260731000000_dji_flights_point_trigger.sql

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DOCKER_URL = "postgresql://postgres:postgres@localhost:5432/afm_flights";
const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function listMigrations(filter) {
  const all = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!filter) return all;
  if (filter.only) return all.filter((f) => f === filter.only);
  if (filter.from) return all.filter((f) => f >= filter.from);
  return all;
}

async function ensureMigrationsTable(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS dji_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getApplied(c) {
  const { rows } = await c.query("SELECT name FROM dji_migrations");
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(c, name, sql) {
  await c.query("BEGIN");
  try {
    await c.query(sql);
    await c.query("INSERT INTO dji_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    await c.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await c.query("ROLLBACK");
    return { ok: false, error: err.message };
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from") out.from = args[++i];
    else if (args[i] === "--only") out.only = args[++i];
  }
  return out;
}

async function main() {
  const filter = parseArgs();
  const c = new Client({ connectionString: DOCKER_URL });
  await c.connect();
  await ensureMigrationsTable(c);
  const applied = await getApplied(c);

  const migrations = listMigrations(filter);
  console.log(`[apply-to-docker] ${migrations.length} migrations a evaluar (${applied.size} ya aplicadas)\n`);

  let nOk = 0, nSkip = 0, nErr = 0;
  for (const name of migrations) {
    if (applied.has(name)) {
      console.log(`  [skip] ${name} (ya aplicada)`);
      nSkip++;
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    const result = await applyMigration(c, name, sql);
    if (result.ok) {
      console.log(`  [apply] ${name}`);
      nOk++;
    } else {
      console.log(`  [ERROR] ${name}: ${result.error}`);
      nErr++;
    }
  }
  console.log(`\n[apply-to-docker] done: ${nOk} aplicadas, ${nSkip} skipped, ${nErr} errors`);
  await c.end();
  process.exit(nErr > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
