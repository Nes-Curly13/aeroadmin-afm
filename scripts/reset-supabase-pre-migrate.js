// scripts/reset-supabase-pre-migrate.js
// Limpia Supabase para volver a un estado pre-migración conocido.
// NO toca djiag_health (se preserva automáticamente por no tener FKs).
// Ejecutar UNA vez antes de re-correr migrate-v2.

const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Pool } = require("pg");

(async () => {
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await sb.connect();

  console.log("Estado ANTES de reset:");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot", "djiag_health"]) {
    const r = await c.query(`SELECT count(*)::int AS n FROM "${t}"`).catch(() => ({ rows: [{ n: null }] }));
    console.log(`  supabase.${t}: ${r.rows[0].n}`);
  }

  await c.query("BEGIN");
  try {
    await c.query("TRUNCATE dji_parcels, dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history RESTART IDENTITY CASCADE");
    await c.query("DELETE FROM dji_flights");
    await c.query("DELETE FROM dji_legacy_snapshot");
    if (await c.query("SELECT to_regclass('public.dji_daily_summaries') AS t").then((r) => r.rows[0].t)) {
      await c.query("DELETE FROM dji_daily_summaries");
    }
    await c.query("COMMIT");
    console.log("\n✓ Reset hecho");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("✗ Error:", e.message);
    process.exit(1);
  }

  console.log("\nEstado DESPUÉS de reset:");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot", "djiag_health"]) {
    const r = await c.query(`SELECT count(*)::int AS n FROM "${t}"`).catch(() => ({ rows: [{ n: null }] }));
    console.log(`  supabase.${t}: ${r.rows[0].n}`);
  }

  c.release();
  await sb.end();
})();
