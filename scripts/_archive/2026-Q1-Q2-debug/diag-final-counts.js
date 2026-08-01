// scripts/diag-final-counts.js
// Counts actualizados docker vs Supabase para decidir estrategia de flights.

const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await sb.connect();

  const tables = [
    "dji_parcels",
    "dji_flights",
    "dji_fumigations",
    "dji_fumigation_schedule",
    "dji_fumigation_schedule_history",
    "dji_daily_summaries",
    "dji_legacy_snapshot",
  ];
  console.log("Tabla".padEnd(35) + "docker".padStart(10) + "Supabase".padStart(12) + "Diff".padStart(10));
  console.log("=".repeat(70));
  for (const t of tables) {
    let dCount, sCount;
    try { dCount = (await docker.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n; } catch (e) { dCount = "—"; }
    try { sCount = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n; } catch (e) { sCount = "—"; }
    const diff = (typeof dCount === "number" && typeof sCount === "number") ? dCount - sCount : "—";
    console.log(t.padEnd(35) + String(dCount).padStart(10) + String(sCount).padStart(12) + String(diff).padStart(10));
  }

  // Schema de dji_daily_summaries y dji_legacy_snapshot (de docker) para crearlas en Supabase después
  console.log("\n=== Schema de tablas a migrar (de docker) ===");
  for (const t of ["dji_daily_summaries", "dji_legacy_snapshot"]) {
    const r = await docker.query(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    console.log(`\n${t}:`);
    r.rows.forEach((row) => console.log(`  ${row.column_name} ${row.data_type} ${row.is_nullable}`));
  }

  await docker.end();
  c.release();
  await sb.end();
})();
