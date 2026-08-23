#!/usr/bin/env node
/**
 * scripts/import-applications-from-excel.js
 *
 * Importa aplicaciones del Excel del operador fumigador a dji_fumigations
 * con source='import_excel'. Matching contra dji_flights por
 * (fecha, drone_nickname, pilot_name). Nivel 1 del sprint
 * feature/excel-applications-import.
 *
 * Uso:
 *   node scripts/import-applications-from-excel.js <path-al-xlsx> [opciones]
 *
 * Opciones:
 *   --dry-run                No hace INSERT, solo loguea lo que haría
 *   --area-unit=ha|m2        Forzar unidad de area (default: auto-detect)
 *   --min-score=0.5          Score minimo para aceptar un match (default: 0.5)
 *   --actor-email=foo@bar    Email del actor para audit log (default: excel-import@afm.local)
 *   --limit=N                Solo procesar N filas (para testing)
 *
 * El script es idempotente: si lo corres 2 veces con el mismo Excel, los
 * INSERTs no se duplican porque la UNIQUE key de dji_fumigations
 * (parcel_id, fumigation_date, source) WHERE parcel_id IS NULL impide
 * duplicados para fumigaciones sin parcela. Las fumigaciones con parcela
 * se identifican via flight_id en notes->excel_source->match->flight_id.
 *
 * Stats de salida (siempre):
 *   - total: filas parseadas del Excel
 *   - matched: insertadas en dji_fumigations
 *   - huérfanos: matcheo parcial (< threshold) o sin match
 *   - elapsed: segundos
 *
 * Exit code:
 *   - 0: success (puede tener 0 inserts si dry-run o si no hay matches)
 *   - 1: error de conexion o de SQL
 *   - 2: argumentos invalidos
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const { parseExcelApplications } = require('../lib/excel-applications-parser.js');
const { matchRow } = require('../lib/excel-applications-matcher.js');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) {
      process.env[k] = t.slice(i + 1).trim();
    }
  }
}

function parseArgs(argv) {
  const opts = {
    xlsxPath: '',
    dryRun: false,
    areaUnit: null,
    minScore: 0.5,
    actorEmail: 'excel-import@afm.local',
    limit: null
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--area-unit=')) opts.areaUnit = arg.split('=')[1];
    else if (arg.startsWith('--min-score=')) opts.minScore = Number(arg.split('=')[1]);
    else if (arg.startsWith('--actor-email=')) opts.actorEmail = arg.split('=')[1];
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.split('=')[1]);
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 40).join('\n'));
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    console.error('Uso: node scripts/import-applications-from-excel.js <path-al-xlsx> [opciones]');
    console.error('  Usa --help para ver las opciones');
    process.exit(2);
  }
  opts.xlsxPath = positional[0];
  return opts;
}

/**
 * Carga los flights candidatos de dji_flights en un rango de fechas
 * para reducir el query set. Si el Excel tiene fechas en 2025-2026,
 * cargamos 1 ano de flights por vez.
 */
async function loadCandidateFlights(client, parsed) {
  // Encontrar rango de fechas
  const dates = parsed.map(r => r.fecha).filter(d => d != null);
  if (dates.length === 0) return [];
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
  // Padding de 1 dia
  minDate.setUTCDate(minDate.getUTCDate() - 1);
  maxDate.setUTCDate(maxDate.getUTCDate() + 1);

  const result = await client.query(
    `SELECT flight_id, drone_nickname, pilot_name, start_at
       FROM dji_flights
      WHERE start_at >= $1 AND start_at <= $2
      ORDER BY start_at`,
    [minDate.toISOString(), maxDate.toISOString()]
  );
  return result.rows;
}

async function importApplications(opts) {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL no configurada');

  console.log(`[import-applications-from-excel] Parseando Excel: ${opts.xlsxPath}`);
  const t0 = Date.now();
  const parsed = parseExcelApplications(opts.xlsxPath, {
    areaUnit: opts.areaUnit ?? undefined
  });
  const total = parsed.length;
  const limited = opts.limit != null ? parsed.slice(0, opts.limit) : parsed;
  console.log(`  ${total} filas parseadas${opts.limit != null ? ` (limit: ${opts.limit})` : ''}`);

  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  try {
    const candidates = await loadCandidateFlights(client, limited);
    console.log(`  ${candidates.length} flights candidatos cargados`);

    let matched = 0, orphan = 0, errors = 0;
    for (const row of limited) {
      const match = matchRow(row, candidates);
      if (match.score < opts.minScore || match.flight_id == null) {
        orphan++;
        if (opts.dryRun) {
          console.log(`  [orphan] ${row.source.sheet}!${row.source.row_idx} ${row.hacienda}/${row.suerte} ${row.drone} ${row.fecha?.toISOString().slice(0, 10)} score=${match.score}`);
        }
        continue;
      }

      if (opts.dryRun) {
        console.log(`  [match]  ${row.source.sheet}!${row.source.row_idx} ${row.hacienda}/${row.suerte} → flight ${match.flight_id} score=${match.score}`);
        matched++;
        continue;
      }

      try {
        // Insertar fumigacion con source='import_excel' y notes con el match
        const areaM2 = row.unidad_area === 'ha' ? row.area_aplicada * 10000 : row.area_aplicada;
        const result = await client.query(
          `INSERT INTO dji_fumigations (
              fumigation_date, drone_code_used, duration_minutes,
              product_used, dose_l_per_ha, area_fumigated_m2,
              recorded_by, source, notes, flight_ids
            ) VALUES ($1, NULL, NULL, $2, $3, $4, $5, 'import_excel', $6, ARRAY[$7]::bigint[])
            ON CONFLICT DO NOTHING
            RETURNING id`,
          [
            row.fecha?.toISOString().slice(0, 10),
            row.tipo_aplicacion,
            row.dosis_l_ha,
            areaM2,
            opts.actorEmail,
            JSON.stringify({
              _excel_source: true,
              match: { flight_id: match.flight_id, score: match.score, method: match.method },
              source: row.source,
              application: {
                type: row.tipo_aplicacion,
                area_applied: row.area_aplicada,
                area_unit: row.unidad_area,
                area_ot: row.area_ot,
                volume_l: row.volumen_l,
                hacienda: row.hacienda,
                suerte: row.suerte,
                cliente: row.cliente,
                zona: row.zona
              },
              invoice: {
                numero: row.numero_factura,
                fecha: row.fecha_facturacion?.toISOString().slice(0, 10),
                valor_cop: row.valor_factura_cop,
                cancelada: row.cancelada
              },
              transport: {
                plate: row.transporte
              }
            }),
            match.flight_id
          ]
        );
        if (result.rowCount > 0) {
          matched++;
        } else {
          // Conflict: ya existia, contar como matched pero no incrementar
          matched++;
        }
      } catch (err) {
        errors++;
        console.error(`  [error] ${row.source.sheet}!${row.source.row_idx}: ${err.message}`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n[import-applications-from-excel] Stats:`);
    console.log(`  total parseados: ${limited.length}`);
    console.log(`  matched: ${matched}`);
    console.log(`  huerfanos: ${orphan}`);
    console.log(`  errors: ${errors}`);
    console.log(`  elapsed: ${elapsed}s`);
    if (opts.dryRun) console.log('  (DRY RUN - no se insertó nada)');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  importApplications(opts).catch(err => {
    console.error('[import-applications-from-excel] ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { importApplications, parseArgs };
