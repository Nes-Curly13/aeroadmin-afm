// scripts/align-docker-step2-alter-types.js
// Cambia columnas integer → bigint en docker para alinear con Supabase.

const { Client } = require("pg");

const CHANGES = [
  // FK columns (no sequence) — primero
  { table: "dji_fumigation_schedule", column: "parcel_id", isPK: false },
  { table: "dji_fumigation_schedule_history", column: "parcel_id", isPK: false },
  { table: "dji_fumigations", column: "parcel_id", isPK: false },
  { table: "dji_parcels", column: "batch_id", isPK: false },
  // PKs (with sequence)
  { table: "dji_import_batches", column: "id", isPK: true },
  { table: "dji_fumigation_schedule", column: "id", isPK: true },
  { table: "dji_fumigations", column: "id", isPK: true },
  { table: "dji_parcels", column: "id", isPK: true },
];

const FKS_TO_DROP = [
  { table: "dji_fumigation_schedule", name: "dji_fumigation_schedule_parcel_id_fkey" },
  { table: "dji_fumigation_schedule_history", name: "dji_fumigation_schedule_history_parcel_id_fkey" },
  { table: "dji_fumigations", name: "dji_fumigations_parcel_id_fkey" },
  { table: "dji_parcels", name: "dji_parcels_batch_id_fkey" },
];

const FKS_TO_RECREATE = [
  {
    table: "dji_fumigation_schedule",
    name: "dji_fumigation_schedule_parcel_id_fkey",
    col: "parcel_id",
    ref: "dji_parcels(id)",
    onDelete: "CASCADE",
  },
  {
    table: "dji_fumigation_schedule_history",
    name: "dji_fumigation_schedule_history_parcel_id_fkey",
    col: "parcel_id",
    ref: "dji_parcels(id)",
    onDelete: "CASCADE",
  },
  {
    table: "dji_fumigations",
    name: "dji_fumigations_parcel_id_fkey",
    col: "parcel_id",
    ref: "dji_parcels(id)",
    onDelete: "CASCADE",
  },
  {
    table: "dji_parcels",
    name: "dji_parcels_batch_id_fkey",
    col: "batch_id",
    ref: "dji_import_batches(id)",
    onDelete: "NO ACTION",
  },
];

async function dropFk(c, fk) {
  console.log(`  ${fk.name}`);
  await c.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.name}`);
}

async function recreateFk(c, fk) {
  console.log(`  ${fk.name}`);
  const onDelete = fk.onDelete === "NO ACTION" ? "" : ` ON DELETE ${fk.onDelete}`;
  await c.query(
    `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.col}) REFERENCES ${fk.ref}${onDelete}`
  );
}

async function main() {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await c.connect();

  console.log("[2/3] DROP FKs...");
  for (const fk of FKS_TO_DROP) {
    await dropFk(c, fk);
  }

  console.log("\n[2/3] Cambios de tipo...");
  for (const ch of CHANGES) {
    process.stdout.write(`  ${ch.table}.${ch.column} (${ch.isPK ? "PK" : "FK"}): `);
    try {
      if (ch.isPK) {
        const seqName = `${ch.table}_${ch.column}_seq`;
        await c.query(`ALTER TABLE ${ch.table} ALTER COLUMN ${ch.column} DROP DEFAULT`);
        await c.query(`DROP SEQUENCE IF EXISTS ${seqName}`);
        await c.query(`ALTER TABLE ${ch.table} ALTER COLUMN ${ch.column} TYPE bigint USING ${ch.column}::bigint`);
        await c.query(`CREATE SEQUENCE ${seqName} AS bigint START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1`);
        await c.query(`ALTER SEQUENCE ${seqName} OWNED BY ${ch.table}.${ch.column}`);
        const maxRes = await c.query(`SELECT COALESCE(max(${ch.column}), 0) AS m FROM ${ch.table}`);
        const newStart = Math.max(Number(maxRes.rows[0].m) + 1, 1);
        await c.query(`SELECT setval('${seqName}', ${newStart - 1}, false)`);
        await c.query(`ALTER TABLE ${ch.table} ALTER COLUMN ${ch.column} SET DEFAULT nextval('${seqName}')`);
        console.log(`bigint, sequence=${seqName} @ ${newStart - 1}`);
      } else {
        await c.query(`ALTER TABLE ${ch.table} ALTER COLUMN ${ch.column} TYPE bigint USING ${ch.column}::bigint`);
        console.log("bigint");
      }
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
      throw e;
    }
  }

  console.log("\n[2/3] Recrear FKs...");
  for (const fk of FKS_TO_RECREATE) {
    await recreateFk(c, fk);
  }

  console.log("\n[2/3] ✓ Paso 2 completo");
  await c.end();
}

main().catch((e) => { console.error("ERR:", e.message); console.error(e.stack); process.exit(1); });
