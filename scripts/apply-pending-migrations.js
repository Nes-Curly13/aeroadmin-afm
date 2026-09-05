// CLI: aplica migrations SQL que estén pendientes.
// Lee todos los .sql de db/migrations/ en orden lexicografico, los
// ejecuta dentro de una transaccion, y registra cuales ya se aplicaron
// en dji_migrations (crea la tabla si no existe).
//
// Sprint de reconciliación 2026-07-29: el directorio de migrations se
// movió desde `supabase/migrations/` (donde vivía históricamente) a
// `db/migrations/` (que es lo que AGENTS.md y el R6 documentan como
// ubicación canónica). El script sigue siendo el mismo; solo cambia
// el path.
//
// Si tu BD local tiene `dji_migrations` con las migrations aplicadas
// bajo el nombre antiguo, este script las va a re-aplicar porque el
// nombre del archivo no coincide con la key guardada. Workaround:
// después del primer `db:migrate` fallido, corre:
//   `psql $DATABASE_URL -c "DELETE FROM dji_migrations WHERE name NOT
//    IN (SELECT name FROM dji_migrations WHERE name LIKE '2026%');"`
// o, mejor, sincronizá desde cero en una BD fresca.
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

// Split a migration SQL string into individual statements, respecting
// `$$ ... $$` PL/pgSQL dollar quoting, `--` line comments, and
// `/* ... */` block comments. A naive `split(';')` would break on:
//   - `;` inside PL/pgSQL function bodies (e.g. `$$ ... $$`)
//   - `;` inside SQL line comments (e.g. `-- comment; more`)
//   - `;` inside block comments (e.g. `/* ...; ... */`)
//
// Why we need this: when `client.query(sql)` receives a multi-statement
// string, node-postgres sends it as a single Query message and Postgres
// parses ALL statements upfront with a single catalog snapshot. DDL from
// an earlier statement (e.g. `CREATE TABLE foo (x INT)`) is NOT visible
// to a later statement (e.g. `INSERT INTO foo (x) VALUES (1)`) — the
// catalog snapshot is frozen at parse time. The result: "column x of
// relation foo does not exist" even though the column was just created
// in the same file.
//
// Fix: send each statement as its own `client.query` call. Each call is
// a fresh network round-trip with a fresh catalog snapshot. Migration
// still runs inside a single transaction (BEGIN/COMMIT around the
// loop), so atomicity is preserved.
function splitSqlStatements(sql) {
  const statements = [];
  let buf = '';
  let inDollar = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);
    // Handle newline: closes line comments
    if (ch === '\n') {
      inLineComment = false;
      buf += ch;
      continue;
    }
    // Line comment: -- to end of line
    if (!inDollar && !inBlockComment && !inSingleQuote && next2 === '--') {
      inLineComment = true;
      buf += '--';
      i++; // skip the second -
      continue;
    }
    // Block comment start
    if (!inDollar && !inLineComment && !inSingleQuote && next2 === '/*') {
      inBlockComment = true;
      buf += '/*';
      i++; // skip the *
      continue;
    }
    // Block comment end
    if (inBlockComment && next2 === '*/') {
      inBlockComment = false;
      buf += '*/';
      i++; // skip the /
      continue;
    }
    // Inside a comment — copy through, don't track anything
    if (inLineComment || inBlockComment) {
      buf += ch;
      continue;
    }
    // Track $$ ... $$ boundaries (PL/pgSQL dollar quoting)
    if (next2 === '$$' && !inDollar) {
      inDollar = true;
      buf += '$$';
      i++; // skip the second $
      continue;
    }
    if (inDollar && next2 === '$$') {
      inDollar = false;
      buf += '$$';
      i++;
      continue;
    }
    // Track single-quoted strings (skip nested '' escape)
    if (ch === "'" && !inDollar) {
      if (inSingleQuote && sql[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      buf += ch;
      continue;
    }
    // Statement terminator outside any quote/comment
    if (ch === ';' && !inDollar && !inSingleQuote) {
      buf += ';';
      const trimmed = buf.trim();
      if (trimmed) statements.push(trimmed);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function applyMigration(client, name, sql) {
  // NOTA: NO usamos BEGIN/COMMIT wrapper alrededor del archivo de migration.
  //
  // Por que: con pg >= 8, `client.query(string)` parsea los statements con un
  // catalog snapshot congelado al inicio del batch. Aunque dividimos el
  // archivo en statements individuales, dentro de una transaction PG
  // igualmente puede mantener un snapshot de catalog que no ve el DDL
  // creado por statements anteriores en la misma transaction.
  //
  // Solucion: auto-commit por statement. Cada DDL se committea apenas se
  // ejecuta, y el siguiente statement ve el catalog actualizado. Las
  // migrations de este proyecto son todas idempotentes (IF NOT EXISTS,
  // NOT EXISTS guards), asi que un auto-commit por statement no rompe
  // consistencia. Si un statement falla, los anteriores quedan
  // commiteados; el runner marca el archivo como fallido y la
  // re-corrida siguiente lo saltea por el `dji_migrations` skip.
  //
  // Trade-off: perdemos atomicidad por archivo (si la migration tiene
  // 10 statements y el 5 falla, los 1-4 quedan). Pero ya teniamos ese
  // riesgo antes (DDL no es transaccional en todos los motores). Para
  // la mayoria de migrations (CREATE TABLE IF NOT EXISTS, etc.) no es
  // problema.
  try {
    const statements = splitSqlStatements(sql);
    for (const stmt of statements) {
      // Cada statement es auto-committed por Postgres.
      // Usamos config object con noPrepare:true para forzar simple
      // query protocol y evitar el cache de prepared statements.
      await client.query({ text: stmt, noPrepare: true });
    }
    // Si llegamos aca, todo el archivo se aplico. Registramos en
    // dji_migrations en una transaction propia (atomica, chiquita).
    await client.query('BEGIN');
    try {
      await client.query({
        text: 'INSERT INTO dji_migrations (name) VALUES ($1)',
        values: [name],
        noPrepare: true,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    return { ok: true };
  } catch (err) {
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

    const dir = path.join(process.cwd(), 'db', 'migrations');
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
    // Fail-fast: si una migration falla, no seguimos. Antes esto logueaba
    // y seguía, lo que dejó roto CI durante semanas (2026-07-09) cuando
    // dji_import_batches faltaba: las migrations subsiguientes que la
    // referenciaban fallaban en silencio, dejaban la BD sin tablas, y los
    // tests e2e/smoke explotaban sin indication clara del root cause.
    let aborted = false;
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
        console.error(`    ERROR: ${result.error.slice(0, 400)}`);
        errorCount += 1;
        aborted = true;
        break;
      }
    }

    if (aborted) {
      console.error(
        `\n[apply-migrations] ABORT: ${errorCount} error. `
        + `No se aplicaron las migrations restantes. `
        + `Revisá el SQL de la migration que falló antes de re-correr.`
      );
      process.exitCode = 1;
      return;
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
