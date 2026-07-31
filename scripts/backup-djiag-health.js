// scripts/backup-djiag-health.js
// Lee djiag_health de Supabase y la guarda en un archivo JSON.

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await p.connect();
  const r = await c.query("SELECT * FROM djiag_health");
  console.log(`djiag_health rows: ${r.rows.length}`);
  r.rows.forEach((row) => console.log(" ", JSON.stringify(row)));
  const out = path.resolve(__dirname, "..", "backups", `djiag_health-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify(r.rows, null, 2));
  console.log(`\nGuardado en: ${out}`);
  c.release();
  await p.end();
})();
