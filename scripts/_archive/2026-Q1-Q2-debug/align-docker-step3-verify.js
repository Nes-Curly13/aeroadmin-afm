// scripts/align-docker-step3-verify.js
// Registra la V0 migration en dji_migrations y verifica que el schema
// de docker ahora match el de Supabase (diff = 0).

const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

async function colsOf(c, table) {
  const r = await c.query(
    "SELECT column_name, udt_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [table]
  );
  return r.rows;
}

async function indexesOf(c, table) {
  const r = await c.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname",
    [table]
  );
  return r.rows;
}

const TABLES = [
  "dji_parcels",
  "dji_flights",
  "dji_fumigations",
  "dji_fumigation_schedule",
  "dji_fumigation_schedule_history",
  "dji_drone_models",
  "dji_import_batches",
];

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await sb.connect();

  // Paso 1: registrar V0 en dji_migrations (si no está)
  console.log("[3/3] Registrar V0 en dji_migrations...");
  const exists = await docker.query("SELECT 1 FROM dji_migrations WHERE name = '20260728000000_add_v0_fields_to_dji_parcels.sql'");
  if (exists.rows.length === 0) {
    await docker.query("INSERT INTO dji_migrations (name) VALUES ('20260728000000_add_v0_fields_to_dji_parcels.sql')");
    console.log("  ✓ Inserted");
  } else {
    console.log("  ⊘ Ya estaba registrada");
  }

  // Paso 2: schema diff
  console.log("\n[3/3] Schema diff docker vs Supabase...");
  let totalDiffs = 0;
  for (const t of TABLES) {
    const dc = await colsOf(docker, t);
    const sc = await colsOf(c, t);
    const dMap = new Map(dc.map((r) => [r.column_name, r]));
    const sMap = new Map(sc.map((r) => [r.column_name, r]));

    const onlyD = [...dMap.keys()].filter((k) => !sMap.has(k));
    const onlyS = [...sMap.keys()].filter((k) => !dMap.has(k));
    const typeDiffs = [];
    for (const [k, d] of dMap) {
      const s = sMap.get(k);
      if (s && (d.udt_name !== s.udt_name)) {
        typeDiffs.push({ col: k, docker: d.udt_name, supabase: s.udt_name });
      }
    }

    if (onlyD.length || onlyS.length || typeDiffs.length) {
      console.log(`  ✗ ${t}:`);
      if (onlyD.length) { console.log(`    only in docker:   ${onlyD.join(", ")}`); totalDiffs += onlyD.length; }
      if (onlyS.length) { console.log(`    only in supabase: ${onlyS.join(", ")}`); totalDiffs += onlyS.length; }
      typeDiffs.forEach((d) => { console.log(`    type diff ${d.col}: docker=${d.docker} supabase=${d.supabase}`); totalDiffs += 1; });
    } else {
      console.log(`  ✓ ${t} (${dMap.size} cols idénticos)`);
    }
  }

  // Paso 3: índices diff
  console.log("\n[3/3] Índices diff...");
  for (const t of TABLES) {
    const di = await indexesOf(docker, t);
    const si = await indexesOf(c, t);
    const dMap = new Map(di.map((r) => [r.indexname, r.indexdef]));
    const sMap = new Map(si.map((r) => [r.indexname, r.indexdef]));
    const onlyD = [...dMap.keys()].filter((k) => !sMap.has(k));
    const onlyS = [...sMap.keys()].filter((k) => !dMap.has(k));
    if (onlyD.length || onlyS.length) {
      console.log(`  ✗ ${t}:`);
      onlyD.forEach((k) => console.log(`    only in docker:   ${k}`));
      onlyS.forEach((k) => console.log(`    only in supabase: ${k}`));
      totalDiffs += onlyD.length + onlyS.length;
    } else {
      console.log(`  ✓ ${t} (${dMap.size} índices idénticos)`);
    }
  }

  console.log(`\n[3/3] Total diffs: ${totalDiffs}`);
  if (totalDiffs === 0) {
    console.log("✓ Schema 100% alineado docker ↔ Supabase");
  } else {
    console.log("✗ Hay diffs — revisar arriba");
  }

  await docker.end();
  c.release();
  await sb.end();
})();
