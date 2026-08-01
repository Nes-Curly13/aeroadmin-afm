// Verifica los schemas detallados de las tablas que difieren
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

  for (const t of ["dji_drone_models", "dji_fumigation_schedule"]) {
    const dc = await docker.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position", [t]);
    const sc = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position", [t]);
    console.log(`\n=== ${t} ===`);
    console.log(`Docker (${dc.rows.length}):`);
    dc.rows.forEach((r) => console.log(`  ${r.column_name} (${r.data_type})`));
    console.log(`Supabase (${sc.rows.length}):`);
    sc.rows.forEach((r) => console.log(`  ${r.column_name} (${r.data_type})`));
  }

  await docker.end();
  c.release();
  await sb.end();
})();
