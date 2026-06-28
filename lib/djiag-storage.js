// Funciones puras para el cache de storage state del cliente DJI (S1 §2.5).
//
// Separadas de djiag-korean-client.js para poder testear sin browser.
// Importante: este archivo NO debe tener comentarios JSDoc con dobles
// asteriscos (vite/esbuild los confunde con globs al importarlo en tests).

const fs = require('node:fs');

const DEFAULT_STORAGE_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function isStorageStateFresh(filePath, maxAgeMs = DEFAULT_STORAGE_STATE_MAX_AGE_MS) {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

module.exports = {
  isStorageStateFresh,
  DEFAULT_STORAGE_STATE_MAX_AGE_MS
};