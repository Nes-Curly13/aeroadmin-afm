// scripts/align-docker-step3b-fix-remainder.js
// Fix los 2 diffs restantes después de step 2:
//  1. dji_fumigation_schedule_history.parcel_id: revertir de bigint a int4
//     (Supabase lo tiene como int4, mi step2 lo cambió a bigint de más)
//  2. Drop el index dji_fumigation_schedule_parcel_id_key (Supabase no lo tiene)

const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();

  // 1. Revertir dji_fumigation_schedule_history.parcel_id a int4
  console.log("Revertir dji_fumigation_schedule_history.parcel_id int8 → int4...");
  await c.query("ALTER TABLE dji_fumigation_schedule_history ALTER COLUMN parcel_id TYPE int4 USING parcel_id::int4");
  console.log("  ✓ int4");

  // 2. Drop el UNIQUE constraint que Supabase no tiene
  console.log("\nDrop UNIQUE constraint dji_fumigation_schedule_parcel_id_key...");
  await c.query("ALTER TABLE dji_fumigation_schedule DROP CONSTRAINT IF EXISTS dji_fumigation_schedule_parcel_id_key");
  console.log("  ✓ Dropped");

  // Verificar
  const r1 = await c.query(
    "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'dji_fumigation_schedule_history' AND column_name = 'parcel_id'"
  );
  console.log("\nVerificación:", r1.rows[0]);

  const r2 = await c.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'dji_fumigation_schedule' AND indexname = 'dji_fumigation_schedule_parcel_id_key'"
  );
  console.log("Index dji_fumigation_schedule_parcel_id_key existe:", r2.rows.length > 0);

  await c.end();
})();
