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
  for (const cn of [docker, sb]) {
    const r = await cn.query(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'dji_fumigation_schedule_history' AND column_name = 'parcel_id'"
    );
    console.log("parcel_id nullability:", r.rows[0]);
  }
  // Estado actual
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot", "djiag_health"]) {
    try {
      const r = await c.query(`SELECT count(*)::int AS n FROM "${t}"`);
      console.log(`Supabase.${t}: ${r.rows[0].n}`);
    } catch (e) {
      console.log(`Supabase.${t}: (error)`);
    }
  }
  await docker.end();
  c.release();
  await sb.end();
})();
