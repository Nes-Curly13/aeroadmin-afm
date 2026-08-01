// scripts/verify-migration.js
// Verificación final post-migración: counts, FK, triggers, djiag_health
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Client, Pool } = require("pg");
const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await docker.connect();
  const dest = await sb.connect();

  console.log("Tabla".padEnd(40) + "docker".padStart(10) + "supabase".padStart(12) + "  status");
  console.log("-".repeat(72));
  for (const t of [
    "dji_parcels",
    "dji_flights",
    "dji_fumigations",
    "dji_fumigation_schedule",
    "dji_fumigation_schedule_history",
    "dji_daily_summaries",
    "dji_legacy_snapshot",
    "djiag_health",
  ]) {
    const r1 = await docker.query("SELECT count(*)::int AS n FROM " + t).catch((e) => ({ rows: [{ n: "-" }] }));
    const r2 = await dest.query("SELECT count(*)::int AS n FROM " + t).catch((e) => ({ rows: [{ n: "-" }] }));
    const n1 = r1.rows[0].n, n2 = r2.rows[0].n;
    const status = n1 === n2 ? "OK" : (n1 === "-" || n2 === "-" ? "N/A" : "MISMATCH");
    console.log(t.padEnd(40) + String(n1).padStart(10) + String(n2).padStart(12) + "  " + status);
  }

  // FK orphans
  const fk1 = await dest.query("SELECT count(*)::int AS n FROM dji_fumigations WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM dji_parcels)");
  const fk2 = await dest.query("SELECT count(*)::int AS n FROM dji_fumigation_schedule WHERE parcel_id NOT IN (SELECT id FROM dji_parcels)");
  const fk3 = await dest.query("SELECT count(*)::int AS n FROM dji_fumigation_schedule_history WHERE parcel_id NOT IN (SELECT id FROM dji_parcels)");
  const fk4 = await dest.query("SELECT count(*)::int AS n FROM dji_flights WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM dji_parcels)");
  console.log("\nFK orphans:");
  console.log("  fumigations -> parcels:   " + fk1.rows[0].n);
  console.log("  schedule -> parcels:      " + fk2.rows[0].n);
  console.log("  history -> parcels:       " + fk3.rows[0].n);
  console.log("  flights -> parcels:       " + fk4.rows[0].n);

  // Triggers
  const trg = await dest.query(`
    SELECT tgname, tgenabled
    FROM pg_trigger
    WHERE tgrelid = 'public.dji_fumigation_schedule'::regclass AND NOT tgisinternal
  `);
  console.log("\nTriggers en dji_fumigation_schedule:");
  trg.rows.forEach((x) => console.log("  " + x.tgname + ": " + (x.tgenabled === "O" ? "ENABLED" : "DISABLED")));

  // djiag_health
  const healthCols = await dest.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'djiag_health'
    ORDER BY ordinal_position
  `);
  console.log("\ndjiag_health schema: " + healthCols.rows.map((x) => x.column_name).join(", "));
  const health = await dest.query("SELECT * FROM djiag_health");
  console.log("djiag_health rows:");
  health.rows.forEach((x) => console.log("  " + JSON.stringify(x)));

  // Supabase sequences
  console.log("\nSequences de supabase (deben apuntar al max+1):");
  for (const t of [
    "dji_parcels",
    "dji_flights",
    "dji_fumigations",
    "dji_fumigation_schedule",
    "dji_fumigation_schedule_history",
    "dji_legacy_snapshot",
  ]) {
    const r = await dest.query("SELECT last_value FROM " + t + "_id_seq");
    console.log("  " + t + "_id_seq: " + r.rows[0].last_value);
  }

  await docker.end();
  dest.release();
  await sb.end();
})();
