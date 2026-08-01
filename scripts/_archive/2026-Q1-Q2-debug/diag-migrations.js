const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const r1 = await docker.query("SELECT name FROM dji_migrations ORDER BY name");
  console.log("Docker migrations:", r1.rows.length);
  r1.rows.forEach((r) => console.log("  ", r.name));
  await docker.end();

  const sb = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: { rejectUnauthorized: false },
  });
  const c = await sb.connect();
  const r2 = await c.query("SELECT name FROM dji_migrations ORDER BY name");
  console.log("\nSupabase migrations:", r2.rows.length);
  r2.rows.forEach((r) => console.log("  ", r.name));
  c.release();
  await sb.end();
})();
