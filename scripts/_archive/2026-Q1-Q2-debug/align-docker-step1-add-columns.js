// scripts/align-docker-step1-add-columns.js
//
// Aplica a docker las migrations de columnas faltantes para alinear con
// Supabase. Son idempotentes (ADD COLUMN IF NOT EXISTS).
//
// Migraciones aplicadas:
//   - 20260721010000_add_fumigation_human_notes.sql
//   - 20260722000000_add_parcel_supervisor_metadata.sql  (verificación)
//   - 20260723000000_add_ica_metadata.sql
//   - 20260728000000_add_v0_fields_to_dji_parcels.sql
//
// No modifica dji_migrations. No toca tipos (eso es el paso 2).

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "supabase", "migrations");
const V0_MIGRATION = path.resolve(__dirname, "..", "db", "migrations", "20260728000000_add_v0_fields_to_dji_parcels.sql");

const TO_APPLY = [
  { file: "20260721010000_add_fumigation_human_notes.sql", table: "dji_fumigations" },
  { file: "20260722000000_add_parcel_supervisor_metadata.sql", table: "dji_parcels" },
  { file: "20260723000000_add_ica_metadata.sql", table: "dji_fumigations" },
  { file: "20260728000000_add_v0_fields_to_dji_parcels.sql", table: "dji_parcels", custom: V0_MIGRATION },
];

(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await c.connect();

  for (const m of TO_APPLY) {
    const file = m.custom ?? path.join(MIGRATIONS_DIR, m.file);
    if (!fs.existsSync(file)) {
      console.log(`✗ ${m.file}: archivo no encontrado`);
      continue;
    }
    const sql = fs.readFileSync(file, "utf-8");
    console.log(`→ Aplicando ${m.file}...`);
    try {
      await c.query(sql);
      console.log(`  ✓ OK`);
    } catch (e) {
      console.log(`  ✗ ERROR: ${e.message}`);
      throw e;
    }
  }

  // Verificación
  console.log("\n=== Verificación post-aplicación ===");
  const r = await c.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name IN ('dji_parcels', 'dji_fumigations', 'dji_drone_models')
      AND column_name IN (
        'client_name', 'farm_name', 'municipality', 'variety',
        'human_notes', 'product_registered_ica', 'pilot_license',
        'registration_number'
      )
    ORDER BY table_name, column_name
  `);
  console.log(`Columnas agregadas: ${r.rows.length} / 8`);
  r.rows.forEach((row) => console.log(`  ${row.column_name}`));

  await c.end();
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
