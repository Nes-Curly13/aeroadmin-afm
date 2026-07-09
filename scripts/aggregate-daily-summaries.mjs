#!/usr/bin/env node
// scripts/aggregate-daily-summaries.mjs
//
// Materializa `dji_daily_summaries` desde dji_flights con la misma
// estructura que muestra el Task History de DJI AG (vista Map / List
// del screen /records).
//
// Lo que calcula por día (en UTC):
//   - area_mu:        AVG(area_m2) / 666.67  ← avg, no sum, ver nota abajo
//   - times:          COUNT(*) de flights
//   - liters:         SUM(spray_usage_ml) / 1000
//   - duration_seconds: SUM(duration_seconds)
//
// Importante (revisión 2026-07-09):
//   `dji_flights.area_m2` representa el área fumigable del CAMPO, no la
//   fracción fumigada por ese vuelo. Si sumamos area_m2 de N vuelos del
//   mismo día sobre el mismo campo, multiplicamos el área por N (×30 en
//   la práctica). El UI de DJI muestra el área real fumigada en el día
//   (≈ campo entero ÷ vuelos del día). Usamos AVG(area_m2) como
//   aproximación. Cuando DJI exponga el área fumigada por vuelo
//   (probablemente desde el query de "aggr_by_day" histórico), cambiar.
//
// Tabla:  dji_daily_summaries (NO EXISTE — esta script la crea)
//   Columns: summary_date date PRIMARY KEY,
//            area_mu numeric(12,4), times integer, liters numeric(12,4),
//            duration_seconds integer, computed_at timestamptz default now()
//
// Uso:
//   node scripts/aggregate-daily-summaries.mjs                  # calcula todo
//   node scripts/aggregate-daily-summaries.mjs --from=2026-01-01 --to=2026-12-31
//
// Idempotente: UPSERT con ON CONFLICT sobre summary_date.
//
// Replica del blueprint Make.com `www_djiag_com_records_1920w_default.make`
// que agregaba por día desde la respuesta de DJI `aggr_by_day`. Ver
// docs/audit/figma-vs-bd.md.

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env.local");

// Cargar .env.local (pares KEY=VALUE) sin libs externas
function loadEnv() {
  try {
    const txt = readFileSync(ENV_PATH, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const args = process.argv.slice(2);
function arg(name, fallback) {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : fallback;
}

const fromDate = arg("from", null);
const toDate = arg("to", null);

const client = new pg.Client({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "afm_flights"
});

const M2_PER_MU = 666.67;
const ML_PER_L = 1000;

async function ensureTable() {
  // Crear la tabla dji_daily_summaries si no existe (idempotente).
  // Hacemos esto inline para no requerir una migration nueva solo
  // para este script. Si la migración se va a formalizar, mover
  // este SQL a supabase/migrations/<date>_add_dji_daily_summaries.sql.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.dji_daily_summaries (
      summary_date     date PRIMARY KEY,
      area_mu          numeric(12,4) NOT NULL DEFAULT 0,
      times            integer       NOT NULL DEFAULT 0,
      liters           numeric(12,4) NOT NULL DEFAULT 0,
      duration_seconds integer       NOT NULL DEFAULT 0,
      computed_at      timestamptz   NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS dji_daily_summaries_date_idx
      ON public.dji_daily_summaries (summary_date DESC);
  `);
}

async function aggregate() {
  const where = [];
  const params = [];
  if (fromDate) {
    params.push(fromDate);
    where.push(`start_at >= $${params.length}::date`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`start_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

  // Solo flights agrícolas (mode_name típico de fumigación, source = 'djiag')
  // Si en el futuro hay otros sources, agregar filtro.
  const sql = `
    INSERT INTO public.dji_daily_summaries
      (summary_date, area_mu, times, liters, duration_seconds, computed_at)
    SELECT
      start_at::date                                       AS summary_date,
      ROUND( (COALESCE(AVG(area_m2), 0) / ${M2_PER_MU})::numeric, 4) AS area_mu,
      COUNT(*)                                             AS times,
      ROUND( (COALESCE(SUM(spray_usage_ml), 0) / ${ML_PER_L}.0)::numeric, 4) AS liters,
      COALESCE(SUM(duration_seconds), 0)::int               AS duration_seconds,
      NOW()
    FROM public.dji_flights
    ${whereSql}
    GROUP BY start_at::date
    ON CONFLICT (summary_date) DO UPDATE SET
      area_mu          = EXCLUDED.area_mu,
      times            = EXCLUDED.times,
      liters           = EXCLUDED.liters,
      duration_seconds = EXCLUDED.duration_seconds,
      computed_at      = EXCLUDED.computed_at
    RETURNING summary_date, area_mu, times, liters, duration_seconds;
  `;

  const res = await client.query(sql, params);
  return res.rows;
}

async function main() {
  await client.connect();
  console.log("[aggregate-daily-summaries] connected to Postgres");
  await ensureTable();
  console.log("[aggregate-daily-summaries] table dji_daily_summaries ensured");

  const rows = await aggregate();
  console.log(`[aggregate-daily-summaries] upserted ${rows.length} days`);

  if (rows.length > 0) {
    const totalAreaMu = rows.reduce((s, r) => s + Number(r.area_mu), 0);
    const totalTimes = rows.reduce((s, r) => s + Number(r.times), 0);
    const totalLiters = rows.reduce((s, r) => s + Number(r.liters), 0);
    const totalSec = rows.reduce((s, r) => s + Number(r.duration_seconds), 0);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    console.log(
      `[aggregate-daily-summaries] totals: ${totalAreaMu.toFixed(2)}mu / ${totalTimes}times / ${totalLiters.toFixed(1)}L / ${h}Hour${m}min${s}s`
    );
    if (rows[0]) {
      console.log(`[aggregate-daily-summaries] earliest: ${rows[0].summary_date?.toISOString?.()?.slice(0, 10)}`);
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error("[aggregate-daily-summaries] ERROR:", e.message);
  process.exit(1);
});
