// scripts/add-supabase-extra-tables-constraints.js
// Agrega PK + index a dji_daily_summaries en Supabase (equivalente a docker)
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await p.connect();
  try {
    await c.query(`
      ALTER TABLE dji_daily_summaries
      ADD CONSTRAINT dji_daily_summaries_pkey PRIMARY KEY (summary_date)
    `);
    console.log("✓ PK agregada");
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log("PK ya existe");
    } else {
      throw e;
    }
  }
  try {
    await c.query(`
      CREATE INDEX dji_daily_summaries_date_idx ON dji_daily_summaries USING btree (summary_date DESC)
    `);
    console.log("✓ Index creado");
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log("Index ya existe");
    } else {
      throw e;
    }
  }
  c.release();
  await p.end();
})();
