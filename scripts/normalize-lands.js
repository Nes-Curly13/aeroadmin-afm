// Normaliza lands-clean.json: aplanar geometry.storage.signedURL → geometryUrl, etc.
const fs = require('fs');
const path = require('path');
const { normalizeLand } = require('../lib/djiag-lands-fetcher');

const inFile = path.join(__dirname, '..', 'djiag_exports', 'lands-clean.json');
const outFile = path.join(__dirname, '..', 'djiag_exports', 'lands-normalized.json');

const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const normalized = data.lands.map((node) => normalizeLand(node)).filter(Boolean);
const out = {
  lands: normalized,
  totalCount: data.totalCount,
  fetchedAt: data.fetchedAt,
  source: data.source,
  bbox: data.bbox,
  pagination: data.pagination,
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
console.log(`OK: ${normalized.length}/${data.totalCount} lands normalizadas → ${outFile}`);
