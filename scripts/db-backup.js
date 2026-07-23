// CLI: pg_dump semanal de la base de datos con rotación de 7 días.
//
// Por qué existe (Sprint C — H3a, audit ops-2026-07 §H3):
//   - Hasta este sprint, la BD de AeroAdmin AFM NO tenía backup
//     automatizado. El riesgo de perder data (catastrófico: la
//     metadata humana de las parcelas está en `dji_parcels` y NO
//     se puede re-derivar de DJI) justificaba priorizar este
//     hallazgo.
//   - El plan completo (docs/review/SYNTHESIS.md) propuso backups
//     semanales como compromiso entre costo (espacio) y cobertura
//     (RPO <= 7 días). Si en el futuro se necesita más fino, se
//     cambia el cron / la frecuencia.
//
// Uso:
//   node scripts/db-backup.js
//   BACKUP_RETENTION_DAYS=14 node scripts/db-backup.js
//
// Variables (.env.local):
//   DATABASE_URL (o DATABASE_URL_DIRECT) — connection string de Supabase.
//   BACKUP_RETENTION_DAYS (opcional) — días a mantener. Default 7.
//
// Exit codes:
//   0 = OK
//   1 = error de configuración, pg_dump ausente, o fallo de ejecución
//
// Requisitos:
//   - `pg_dump` debe estar en PATH (Postgres client tools).
//     Windows: instalar desde https://www.postgresql.org/download/windows/
//     y agregar `C:\Program Files\PostgreSQL\<ver>\bin` a PATH.
//   - El directorio `backups/` se crea si no existe. NO se commitea
//     (ver .gitignore). Para offsite, copiar a S3/Supabase storage
//     / disco externo en un segundo paso (out of scope para este sprint).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampForFilename(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}`
  );
}

/**
 * Devuelve true si el binario `pg_dump` está disponible en PATH.
 * Usa `where` (Windows) o `which` (Unix). Nunca throwea.
 *
 * Acepta una función `exec` inyectable para tests (vi.mock no intercepta
 * `createRequire()` de módulos CJS, así que la DI es la forma portable
 * de testear esto en vitest).
 */
async function pgDumpAvailable(exec = execFileP) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await exec(cmd, ['pg_dump'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Core: corre `pg_dump` con flags seguros y devuelve el SQL como Buffer.
 * Usa execFile (no exec) para evitar command injection — los args van como
 * array y NO se interpretan por el shell.
 *
 * Flags:
 *   --no-owner         : no incluye ALTER OWNER (importable a otra DB sin
 *                        matchear roles del origen)
 *   --no-privileges    : no incluye GRANT/REVOKE
 *   --clean --if-exists: emite DROP ... IF EXISTS antes de CREATE — el
 *                        dump es restaurable directamente con `psql < dump.sql`
 *                        sin tocar nada de antemano.
 *
 * Acepta una función `exec` inyectable para tests (mismo motivo que
 * `pgDumpAvailable`).
 */
async function runPgDump(databaseUrl, exec = execFileP) {
  return exec(
    'pg_dump',
    [
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '-d',
      databaseUrl
    ],
    { maxBuffer: 1024 * 1024 * 256 } // 256MB cap; el dump de Supabase raramente excede 50MB
  ).then((r) => Buffer.from(r.stdout, 'utf8'));
}

/**
 * Borra archivos de `backups/` con mtime > `retentionDays` días.
 * Best-effort: si un archivo no se puede borrar, se loguea y se sigue.
 *
 * @param {string} dir
 * @param {number} retentionDays
 * @returns {Promise<{ removed: string[]; kept: number; failed: string[] }>}
 */
async function rotateBackups(dir, retentionDays) {
  const removed = [];
  const failed = [];
  let kept = 0;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  if (!fs.existsSync(dir)) {
    return { removed, kept, failed };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('dump-') && f.endsWith('.sql.gz'));

  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) {
        kept += 1;
        continue;
      }
      if (st.mtimeMs < cutoffMs) {
        fs.unlinkSync(full);
        removed.push(f);
      } else {
        kept += 1;
      }
    } catch (err) {
      failed.push(`${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { removed, kept, failed };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  loadLocalEnv();

  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    console.error(
      '[backup] ERROR: DATABASE_URL (o DATABASE_URL_DIRECT) no está configurada. ' +
        'Definila en .env.local o en las variables de entorno del sistema.'
    );
    process.exit(1);
  }

  if (!(await pgDumpAvailable())) {
    console.error(
      '[backup] ERROR: pg_dump no está en PATH. ' +
        'Instalá Postgres client tools y agregá el directorio bin/ a PATH.\n' +
        '  Windows: https://www.postgresql.org/download/windows/\n' +
        '  Linux (Debian/Ubuntu): sudo apt-get install postgresql-client\n' +
        '  macOS: brew install libpq && echo \'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\' >> ~/.zshrc'
    );
    process.exit(1);
  }

  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? '7');
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    console.error(
      `[backup] ERROR: BACKUP_RETENTION_DAYS inválido ("${process.env.BACKUP_RETENTION_DAYS}"); debe ser un entero >= 1.`
    );
    process.exit(1);
  }

  const stamp = timestampForFilename();
  const fileName = `dump-${stamp}.sql.gz`;
  const filePath = path.join(backupDir, fileName);

  let dumpBuffer;
  try {
    dumpBuffer = await runPgDump(connectionString, execFileP);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // execFile rechaza con un objeto Error que tiene `.stderr` cuando el
    // binario corre pero falla. Logueamos stderr para diagnóstico.
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr) : '';
    console.error(
      `[backup] ERROR: pg_dump falló: ${msg}` + (stderr ? `\n--- stderr ---\n${stderr.slice(0, 800)}` : '')
    );
    process.exit(1);
  }

  if (dumpBuffer.length === 0) {
    console.error('[backup] ERROR: pg_dump devolvió 0 bytes. La BD está vacía o pg_dump falló silenciosamente.');
    process.exit(1);
  }

  const gzipped = zlib.gzipSync(dumpBuffer, { level: 9 });
  fs.writeFileSync(filePath, gzipped);

  console.log(
    `[backup] OK: ${fileName} (${formatBytes(gzipped.length)} ` +
      `gzip, ${formatBytes(dumpBuffer.length)} raw) -> ${path.relative(process.cwd(), filePath)}`
  );

  const rotation = await rotateBackups(backupDir, retentionDays);
  if (rotation.removed.length > 0) {
    console.log(
      `[backup] rotated: removidos ${rotation.removed.length} archivo(s) con > ${retentionDays} días ` +
        `(${rotation.removed.join(', ')}); quedan ${rotation.kept}.`
    );
  } else {
    console.log(`[backup] rotated: nada que borrar (retención ${retentionDays} días, ${rotation.kept} archivo(s) retenidos).`);
  }
  if (rotation.failed.length > 0) {
    console.error(`[backup] WARN: ${rotation.failed.length} archivo(s) no pudieron borrarse:`);
    for (const f of rotation.failed) console.error(`  - ${f}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backup] ERROR inesperado:', err);
    process.exit(1);
  });
}

// Exports para tests (vitest). El script es CJS y los tests lo importan
// con createRequire (mismo patrón que tests/djiag-asset-downloader.test.ts).
module.exports = {
  loadLocalEnv,
  timestampForFilename,
  runPgDump,
  rotateBackups,
  pgDumpAvailable,
  formatBytes
};
