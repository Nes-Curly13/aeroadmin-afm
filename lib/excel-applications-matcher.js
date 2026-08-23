/**
 * lib/excel-applications-matcher.js
 *
 * Matcher entre filas del Excel y flights de DJI. CJS para que el script
 * `scripts/import-applications-from-excel.js` lo pueda importar
 * directamente (mismo patron que `lib/djiag-fumigations-fetcher.js`).
 *
 * Nivel 1: matching exacto por (fecha, drone_nickname, pilot_name).
 * Nivel 2: agregar fuzzy con Levenshtein o similar.
 *
 * @typedef {Object} DjiFlightForMatching
 * @property {number} flight_id
 * @property {string | null} drone_nickname
 * @property {string | null} pilot_name
 * @property {Date | null} start_at
 *
 * @typedef {Object} MatchResult
 * @property {number | null} flight_id
 * @property {number} score
 * @property {"exact" | "fuzzy" | "no_match"} method
 * @property {string | null} drone_nickname
 * @property {string | null} pilot_name
 */

function normalizeStr(s) {
  if (s == null) return '';
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

function sameDay(a, b) {
  if (a == null || b == null) return false;
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Matchea una fila del Excel contra una lista de flights candidatos.
 * @param {Object} row - ExcelApplicationRow
 * @param {DjiFlightForMatching[]} candidates
 * @returns {MatchResult}
 */
function matchRow(row, candidates) {
  if (row.fecha == null || row.drone == null || row.piloto == null) {
    return { flight_id: null, score: 0, method: 'no_match', drone_nickname: null, pilot_name: null };
  }

  const rowDrone = normalizeStr(row.drone);
  const rowPilot = normalizeStr(row.piloto);

  for (const cand of candidates) {
    if (!sameDay(row.fecha, cand.start_at)) continue;
    const candDrone = normalizeStr(cand.drone_nickname);
    if (candDrone !== rowDrone) continue;
    const candPilot = normalizeStr(cand.pilot_name);
    if (candPilot === rowPilot) {
      return {
        flight_id: cand.flight_id,
        score: 1.0,
        method: 'exact',
        drone_nickname: cand.drone_nickname,
        pilot_name: cand.pilot_name
      };
    }
    return {
      flight_id: cand.flight_id,
      score: 0.5,
      method: 'fuzzy',
      drone_nickname: cand.drone_nickname,
      pilot_name: cand.pilot_name
    };
  }

  return { flight_id: null, score: 0, method: 'no_match', drone_nickname: null, pilot_name: null };
}

module.exports = { matchRow };
