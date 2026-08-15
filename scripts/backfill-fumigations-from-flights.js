// scripts/backfill-fumigations-from-flights.js
//
// CLI: asigna `parcel_id` a fumigaciones aggregate (las que vienen
// del scraper DJI en `lib/djiag-fumigations-fetcher.js` y se insertan
// con `parcel_id = NULL`) basándose en la MODA de los flights asociados
// en `dji_fumigations.flight_ids`.
//
// Por qué existe:
//   El aggregate de DJI (por día) NO sabe a qué parcela corresponde
//   cada fumigación — es un agregado de TODA la cuenta, no por parcela
//   (ver `lib/djiag-fumigations-fetcher.js:130-131`). El script
//   asigna `parcel_id = NULL` al insertar. Después, el spatial join
//   (`scripts/spatial-join-flights-parcels.js`) asigna `parcel_id` a
//   los `dji_flights` via ST_Within/ST_DWithin. Este script cierra
//   el loop: toma la moda de `dji_flights.parcel_id` y la asigna a
//   las fumigaciones aggregate.
//
// Algoritmo:
//   1. Para cada fumigación con `parcel_id IS NULL` y `flight_ids NOT NULL`:
//      a. JOIN con `dji_flights` via `flight_id = ANY(f.flight_ids)`
//      b. Cuenta cuántos flights matchearon y cuántos tenían `parcel_id`
//      c. Si el consenso (`n_with_parcel / n_total`) supera el threshold
//         (default 50%), asigna la MODA (`mode() WITHIN GROUP (ORDER BY parcel_id)`)
//      d. Guarda metadata del backfill en `notes->parcel_backfill`
//   2. UPDATE atomico via CTE
//   3. Stats: matched / no_consensus / no_flights / already_assigned
//
// Uso:
//   node scripts/backfill-fumigations-from-flights.js
//   node scripts/backfill-fumigations-from-flights.js --dry-run
//   node scripts/backfill-fumigations-from-flights.js --consensus 0.7
//   node scripts/backfill-fumigations-from-flights.js --parcel 3107
//
// Variables de entorno (.env.local):
//   DATABASE_URL o DATABASE_URL_DIRECT
//   DATABASE_SSL (default "false" para docker local)

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) {
      process.env[k] = t.slice(i + 1).trim();
    }
  }
}

function createPool() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error("DATABASE_URL (or DATABASE_URL_DIRECT) is not configured.");
  }
  const useSsl =
    (process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * Cuenta cuántas fumigaciones son candidatas al backfill y cómo se
 * distribuyen. Útil para el dry-run y para reportar al operador.
 */
async function inspectCandidates(client, parcelFilter) {
  const params = [];
  let parcelClause = "";
  if (parcelFilter) {
    // Solo fumigaciones con flight_ids que incluyan al menos un flight
    // cuyo parcel_id matchea el filtro. Útil para debug por parcela.
    parcelClause = `EXISTS (
      SELECT 1 FROM dji_flights fl
       WHERE fl.flight_id = ANY(f.flight_ids)
         AND fl.parcel_id = $${params.push(parcelFilter)}
    )`;
  }
  const sql = `
    SELECT
      COUNT(*)::int AS total_candidates,
      COUNT(*) FILTER (WHERE flight_ids IS NOT NULL AND array_length(flight_ids, 1) > 0)::int AS with_flight_ids,
      COUNT(*) FILTER (
        WHERE flight_ids IS NOT NULL
          AND array_length(flight_ids, 1) > 0
          AND EXISTS (
            SELECT 1 FROM dji_flights fl
             WHERE fl.flight_id = ANY(f.flight_ids)
               AND fl.parcel_id IS NOT NULL
          )
      )::int AS with_flights_having_parcel
    FROM dji_fumigations f
    WHERE f.deleted_at IS NULL
      AND f.parcel_id IS NULL
      ${parcelClause ? `AND ${parcelClause}` : ""}
  `;
  const result = await client.query(sql, params);
  return result.rows[0];
}

/**
 * Aplica el backfill. Devuelve stats detalladas.
 *
 * @param {import("pg").PoolClient} client
 * @param {{ consensus: number; dryRun: boolean; parcelFilter?: number }} opts
 * @returns {Promise<{ matched: number, no_consensus: number, no_flights: number, no_parcel_in_flight: number, sample: any[] }>}
 */
async function backfill(client, opts) {
  const { consensus, dryRun, parcelFilter } = opts;
  const params = [consensus];
  let parcelJoinClause = "";
  if (parcelFilter) {
    parcelJoinClause = `AND fl.parcel_id = $${params.push(parcelFilter)}`;
  }

  // CTE principal:
  //   1) candidates: fumigaciones con parcel_id NULL + flight_ids no vacío
  //   2) flight_stats: para cada fumigacion, cuenta flights totales, con parcela, y moda
  //   3) update_filtered: HAVING consenso >= threshold Y moda es válida
  //
  // Usamos `mode() WITHIN GROUP (ORDER BY fl.parcel_id)` para elegir la
  // parcela más frecuente entre los flights asociados. Si hay empate
  // (misma cantidad para 2+ parcelas), Postgres devuelve NULL (esto
  // es el comportamiento default de `mode()` sin WITHIN GROUP variante
  // — para forzar desempate agregaríamos `ORDER BY fl.parcel_id DESC`
  // pero preferimos NULL = "ambiguo" antes que asumir).
  //
  // Notas: el `HAVING count(fl.parcel_id) > 0` filtra fumigaciones
  // donde todos los flights tienen parcel_id NULL (no se puede inferir).
  // El `count(fl.parcel_id)::float / count(*) >= $1` es el threshold
  // de consenso (ratio with_parcel / total).
  const updateSql = `
    WITH flight_stats AS (
      SELECT
        f.id AS fumigation_id,
        mode() WITHIN GROUP (ORDER BY fl.parcel_id) AS modal_parcel_id,
        count(*)::int AS n_flights_total,
        count(fl.parcel_id)::int AS n_flights_with_parcel,
        round((count(fl.parcel_id)::numeric / NULLIF(count(*), 0))::numeric, 3)
          AS parcel_consensus_ratio,
        array_agg(DISTINCT fl.parcel_id) FILTER (WHERE fl.parcel_id IS NOT NULL)
          AS distinct_parcels
      FROM dji_fumigations f
      JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
      WHERE f.deleted_at IS NULL
        AND f.parcel_id IS NULL
        AND f.flight_ids IS NOT NULL
        AND array_length(f.flight_ids, 1) > 0
        ${parcelJoinClause}
      GROUP BY f.id
    )
    ${
      dryRun
        ? `-- DRY RUN: skip the UPDATE
         SELECT
           fs.fumigation_id,
           fs.modal_parcel_id,
           fs.n_flights_total,
           fs.n_flights_with_parcel,
           fs.parcel_consensus_ratio,
           fs.distinct_parcels
         FROM flight_stats fs
         WHERE fs.n_flights_with_parcel > 0
           AND fs.parcel_consensus_ratio >= $1
         ORDER BY fs.fumigation_id
         LIMIT 20`
        : `UPDATE dji_fumigations f
            SET parcel_id = fs.modal_parcel_id,
                notes = f.notes || jsonb_build_object(
                  'parcel_backfill', jsonb_build_object(
                    'parcel_id', fs.modal_parcel_id,
                    'n_flights_total', fs.n_flights_total,
                    'n_flights_with_parcel', fs.n_flights_with_parcel,
                    'parcel_consensus_ratio', fs.parcel_consensus_ratio,
                    'distinct_parcels', fs.distinct_parcels,
                    'consensus_threshold', $1::numeric,
                    'backfilled_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                  )
                )
            FROM flight_stats fs
            WHERE f.id = fs.fumigation_id
              AND fs.modal_parcel_id IS NOT NULL
              AND fs.n_flights_with_parcel > 0
              AND fs.parcel_consensus_ratio >= $1
            RETURNING f.id, f.parcel_id`
    }
  `;

  // Stats independientes para "no_consensus" y "no_parcel_in_flight"
  // — son fumigaciones que tienen flights pero no llegan al threshold
  // o cuyos flights no tienen parcel_id. Útil para el reporte.
  const statsSql = `
    WITH flight_stats AS (
      SELECT
        f.id AS fumigation_id,
        count(*)::int AS n_flights_total,
        count(fl.parcel_id)::int AS n_flights_with_parcel,
        round((count(fl.parcel_id)::numeric / NULLIF(count(*), 0))::numeric, 3)
          AS parcel_consensus_ratio
      FROM dji_fumigations f
      JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
      WHERE f.deleted_at IS NULL
        AND f.parcel_id IS NULL
        AND f.flight_ids IS NOT NULL
        AND array_length(f.flight_ids, 1) > 0
        ${parcelJoinClause}
      GROUP BY f.id
    )
    SELECT
      COUNT(*)::int AS total_candidates,
      COUNT(*) FILTER (WHERE n_flights_with_parcel = 0)::int AS no_parcel_in_flight,
      COUNT(*) FILTER (
        WHERE n_flights_with_parcel > 0
          AND parcel_consensus_ratio < $1
      )::int AS no_consensus,
      COUNT(*) FILTER (
        WHERE n_flights_with_parcel > 0
          AND parcel_consensus_ratio >= $1
      )::int AS matched
    FROM flight_stats
  `;
  const statsResult = await client.query(statsSql, [consensus]);

  // Ejecutar update (o dry-run select)
  const updateResult = await client.query(updateSql, params);

  // "no_flights" = fumigaciones con flight_ids vacío o NULL
  const noFlightsResult = await client.query(
    `
    SELECT COUNT(*)::int AS c
    FROM dji_fumigations f
    WHERE f.deleted_at IS NULL
      AND f.parcel_id IS NULL
      AND (f.flight_ids IS NULL OR array_length(f.flight_ids, 1) = 0)
      ${parcelFilter ? `AND f.parcel_id = $1` : ""}
    `,
    parcelFilter ? [parcelFilter] : []
  );
  const noFlights = noFlightsResult.rows[0].c;

  return {
    matched: statsResult.rows[0].matched,
    no_consensus: statsResult.rows[0].no_consensus,
    no_parcel_in_flight: statsResult.rows[0].no_parcel_in_flight,
    no_flights: noFlights,
    sample: dryRun ? updateResult.rows : [],
  };
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const consensusIdx = args.indexOf("--consensus");
  const consensus =
    consensusIdx >= 0 ? Number(args[consensusIdx + 1]) : 0.5;
  const parcelIdx = args.indexOf("--parcel");
  const parcelFilter =
    parcelIdx >= 0 ? Number(args[parcelIdx + 1]) : undefined;

  if (!Number.isFinite(consensus) || consensus < 0 || consensus > 1) {
    throw new Error(`--consensus debe estar entre 0 y 1, recibí: ${consensus}`);
  }
  if (parcelFilter !== undefined && !Number.isInteger(parcelFilter)) {
    throw new Error(`--parcel debe ser entero, recibí: ${parcelFilter}`);
  }

  console.log(
    `[backfill-fumigations] dry-run=${dryRun} consensus=${consensus}` +
      (parcelFilter ? ` parcel=${parcelFilter}` : "")
  );

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 1: inspect (counts)
    const inspect = await inspectCandidates(client, parcelFilter);
    console.log(
      `[backfill-fumigations] candidates: total=${inspect.total_candidates} ` +
        `with_flight_ids=${inspect.with_flight_ids} ` +
        `with_flights_having_parcel=${inspect.with_flights_having_parcel}`
    );

    if (inspect.with_flight_ids === 0) {
      console.log(
        "[backfill-fumigations] no hay fumigaciones con flight_ids. Nada que hacer."
      );
      await client.query("ROLLBACK");
      return;
    }

    // Step 2: backfill (o dry-run)
    const stats = await backfill(client, {
      consensus,
      dryRun,
      parcelFilter,
    });
    await client.query("COMMIT");

    console.log(`[backfill-fumigations] stats:`);
    console.log(`  matched (UPDATE aplicado):       ${stats.matched}`);
    console.log(`  no_consensus (<${consensus * 100}%):         ${stats.no_consensus}`);
    console.log(
      `  no_parcel_in_flight (flights sin): ${stats.no_parcel_in_flight}`
    );
    console.log(
      `  no_flights (flight_ids vacío):     ${stats.no_flights}`
    );

    if (dryRun) {
      console.log("[backfill-fumigations] DRY RUN — sample (top 20):");
      for (const r of stats.sample) {
        console.log(
          `  fumigation #${r.fumigation_id} → parcel_id=${r.modal_parcel_id} ` +
            `(consensus=${r.parcel_consensus_ratio}, n=${r.n_flights_with_parcel}/${r.n_flights_total})`
        );
      }
    } else {
      console.log("[backfill-fumigations] OK");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill-fumigations] ERROR:", err.message);
    process.exit(1);
  });
}

module.exports = { main, backfill, inspectCandidates };
