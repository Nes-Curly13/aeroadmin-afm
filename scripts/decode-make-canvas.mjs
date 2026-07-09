import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync, gunzipSync, inflateSync } from "node:zlib";

const files = [
  ["C:\\Users\\agFab\\AppData\\Local\\Temp\\make-extracted4\\mission\\canvas.fig", "C:\\Users\\agFab\\AppData\\Local\\Temp\\decoded-mission.bin"],
  ["C:\\Users\\agFab\\AppData\\Local\\Temp\\make-extracted4\\records\\canvas.fig", "C:\\Users\\agFab\\AppData\\Local\\Temp\\decoded-records.bin"]
];

for (const [file, out] of files) {
  console.log(`\n=== ${file} ===`);
  const buf = readFileSync(file);

  // Intentar offset 16 (válido en prueba previa)
  const payload = buf.slice(16);
  try {
    const r = inflateRawSync(payload);
    console.log(`offset=16 inflateRaw: ${r.length} bytes`);
    writeFileSync(out, r);
    console.log(`  wrote ${out}`);
    console.log(`  head (latin1, 200 bytes): ${JSON.stringify(r.slice(0, 200).toString("latin1"))}`);
    console.log(`  tail (latin1, 100 bytes): ${JSON.stringify(r.slice(-100).toString("latin1"))}`);
  } catch (e) {
    console.log(`offset=16 fail: ${e.message}`);
  }
}
