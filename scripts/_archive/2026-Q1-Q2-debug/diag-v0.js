const { Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await p.connect();
  const r = await c.query("SELECT name FROM dji_migrations WHERE name LIKE '%v0%' OR name LIKE '%20260728%'");
  console.log("Migrations V0 en Supabase:", r.rows);
  const r2 = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'dji_parcels' AND column_name IN ('client_name', 'farm_name', 'municipality', 'variety')"
  );
  console.log("Columnas V0 presentes:", r2.rows.map((r) => r.column_name));
  const r3 = await c.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'dji_parcels' AND indexname LIKE 'idx_dji_parcels_%'"
  );
  console.log("Índices custom en dji_parcels:", r3.rows.map((r) => r.indexname));
  c.release();
  await p.end();
})();
