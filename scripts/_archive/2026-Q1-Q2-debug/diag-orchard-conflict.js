#!/usr/bin/env node
// scripts/diag-orchard-conflict.js
//
// Cuenta cuántas parcelas tienen is_orchard inconsistente entre BD y DJI.
// BD.is_orchard viene del legacy import (parameter.json).
// DJI.landType viene del ?name=lands GraphQL query.
// Mapeo DJI: "Orchards" → true, todo lo demás → false.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LANDS_NORMALIZED = path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json");

const landsNorm = JSON.parse(fs.readFileSync(LANDS_NORMALIZED, "utf-8"));
const landsByExtId = new Map();
for (const l of landsNorm.lands || []) {
  if (l.externalId) landsByExtId.set(l.externalId, l);
}

const c = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
});

(async () => {
  await c.connect();

  const all = await c.query(`
    SELECT id, external_id, is_orchard, field_type
    FROM dji_parcels
  `);

  let bothOrchard = 0;
  let bothNotOrchard = 0;
  let bdOrchardDjiNot = 0;
  let bdNotOrchardDjiOrchard = 0;
  let noDjiData = 0;
  const examples = [];

  for (const row of all.rows) {
    const dji = landsByExtId.get(row.external_id);
    if (!dji) {
      noDjiData++;
      continue;
    }
    const djiIsOrchard = dji.landType === "Orchards";
    if (row.is_orchard && djiIsOrchard) bothOrchard++;
    else if (!row.is_orchard && !djiIsOrchard) bothNotOrchard++;
    else if (row.is_orchard && !djiIsOrchard) {
      bdOrchardDjiNot++;
      if (examples.length < 8) {
        examples.push({
          id: row.id,
          name: dji.name,
          ext: row.external_id,
          bd: row.is_orchard,
          djiLandType: dji.landType,
          bdFieldType: row.field_type,
        });
      }
    } else if (!row.is_orchard && djiIsOrchard) {
      bdNotOrchardDjiOrchard++;
    }
  }

  const total = all.rows.length;
  console.log(`Total parcelas en BD: ${total}`);
  console.log(`Sin match en DJI:     ${noDjiData}`);
  console.log(``);
  console.log(`Casos consistentes:`);
  console.log(`  BD=true  AND DJI=Orchard:    ${bothOrchard}`);
  console.log(`  BD=false AND DJI=PLANT_LAND: ${bothNotOrchard}`);
  console.log(``);
  console.log(`Casos INCONSISTENTES (necesitan decisión):`);
  console.log(`  BD=true  AND DJI=PLANT_LAND: ${bdOrchardDjiNot}  ← BD dice orchard, DJI dice farmland`);
  console.log(`  BD=false AND DJI=Orchard:    ${bdNotOrchardDjiOrchard}  ← BD dice farmland, DJI dice orchard`);
  console.log(``);
  console.log(`Ejemplos de "BD dice orchard, DJI dice farmland":`);
  examples.forEach((e) =>
    console.log(`  id=${e.id} "${e.name}": BD.is_orchard=${e.bd}, DJI.landType="${e.djiLandType}", BD.field_type="${e.bdFieldType}"`)
  );

  await c.end();
})();
