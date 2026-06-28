// CLI: crear / resetear un usuario admin en `app_users`.
// Uso:
//   AUTH_SEED_EMAIL=breiner@afm.co AUTH_SEED_PASSWORD='Algo!Segur0' npm run auth:seed
//   node scripts/seed-admin-user.js --email=foo@bar.co --password=Secreto123!
//   (Si no se pasan args, toma de env AUTH_SEED_EMAIL / AUTH_SEED_PASSWORD)
//
// Genera el hash bcrypt (cost 10) y hace UPSERT por email. Si el user ya
// existe, actualiza password + role=admin + is_active=true (idempotente).
//
// Decisiones:
//   - UPSERT (no INSERT) para que el script sea idempotente. Útil para
//     re-seedear después de un restore de BD o si el operator perdió el
//     password.
//   - No logueamos el password en stdout (ni siquiera hasheado). Solo
//     "OK" / "error".
//   - Si la BD no está disponible, fallamos rápido con exit 1.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
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

function parseArg(name) {
  const pref = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg ? arg.slice(pref.length) : null;
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const email = (parseArg('email') ?? process.env.AUTH_SEED_EMAIL ?? '').trim().toLowerCase();
  const password = parseArg('password') ?? process.env.AUTH_SEED_PASSWORD ?? '';
  const role = (parseArg('role') ?? process.env.AUTH_SEED_ROLE ?? 'admin').toLowerCase();

  if (!email) {
    throw new Error('Email requerido: --email=foo@bar.co o AUTH_SEED_EMAIL env');
  }
  if (!password) {
    throw new Error('Password requerido: --password=Secreto123! o AUTH_SEED_PASSWORD env');
  }
  if (password.length < 10) {
    throw new Error('Password debe tener al menos 10 caracteres.');
  }
  if (!['admin', 'viewer'].includes(role)) {
    throw new Error(`Role debe ser 'admin' o 'viewer' (recibido: '${role}').`);
  }

  const hash = await bcrypt.hash(password, 10);

  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 30_000 });
  try {
    const result = await pool.query(
      `
        INSERT INTO app_users (email, password_hash, role, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (email) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role,
              is_active = true,
              updated_at = NOW()
        RETURNING id, email, role, created_at
      `,
      [email, hash, role]
    );
    const row = result.rows[0];
    console.log(`[seed-admin-user] OK — user upserted:`);
    console.log(`  id:    ${row.id}`);
    console.log(`  email: ${row.email}`);
    console.log(`  role:  ${row.role}`);
    console.log(`  since: ${row.created_at.toISOString ? row.created_at.toISOString() : row.created_at}`);
    console.log(`\nLogin con email='${email}' en http://localhost:3000/login`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-admin-user] ERROR:', err.message);
    process.exit(1);
  });
}
