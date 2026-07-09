import { readFileSync } from "node:fs";
const buf = readFileSync("C:\\Users\\agFab\\AppData\\Local\\Temp\\decoded-mission.bin");
console.log(`Size: ${buf.length}`);

// Buscar strings legibles (>= 8 chars ASCII contiguos) para entender la estructura
let i = 0;
let chunks = [];
while (i < buf.length) {
  let start = i;
  while (i < buf.length && buf[i] >= 0x20 && buf[i] <= 0x7e) i++;
  if (i - start >= 12) {
    chunks.push({ offset: start, len: i - start, text: buf.slice(start, i).toString("latin1").slice(0, 60) });
  } else {
    i++;
  }
}
console.log(`Encontré ${chunks.length} strings legibles:`);
for (const c of chunks.slice(0, 40)) {
  console.log(`  [off=${c.offset}, len=${c.len}] ${c.text}`);
}
console.log("\n--- primeros 32 bytes hex ---");
console.log(buf.slice(0, 32).toString("hex"));
console.log("\n--- bytes 100..200 ---");
console.log(buf.slice(100, 200).toString("latin1").replace(/[^\x20-\x7e]/g, "."));
