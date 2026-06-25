// Tests E2E: historia de usuario del operador de drones.
//
// Conecta a la DB real y valida que los 4 escenarios comunes del operador
// funcionan correctamente:
//
//   1. "Operador mira qué parcelas se fumigaron ayer"
//   2. "Operador ve qué dron/piloto fumigó más esta semana"
//   3. "Operador identifica parcelas atrasadas (overdue)"
//   4. "Operador abre el detalle de un vuelo específico"
//
// Skip si no hay DATABASE_URL — estos tests son opcionales (no corren en CI
// sin DB). Para correrlos localmente: `npm test -- user-story-dashboard-e2e`
// (con .env.local presente).
//
// Estado esperado de la DB al 2026-06-23 (post-pipeline del día):
//   dji_parcels:                 ~1,067
//   dji_flights:                 ~7,050 (89.7% con parcel_id)
//   dji_fumigations:             ~393 (30 aggregate + 363 per-parcel)
//   dji_fumigation_schedule:     80 (68 con last/next populated)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

const HAS_DB = !!process.env.DATABASE_URL || existsSync(join(process.cwd(), ".env.local"));

// Carga .env.local si no hay DATABASE_URL en env (los scripts hacen esto
// inline; en vitest lo hacemos aquí para no duplicar el loader).
if (!process.env.DATABASE_URL) {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
    }
  }
}

const pool = HAS_DB
  ? new Pool({
      connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
      max: 3,
      idleTimeoutMillis: 30_000,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    })
  : null;

describe.skipIf(!HAS_DB)("E2E — Historia de usuario del operador", () => {
  let client: import("pg").PoolClient;

  beforeAll(async () => {
    if (!pool) return;
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  describe("Sanity — estado de la DB post-pipeline", () => {
    it("dji_parcels: ≥ 1000 (hoy hay 1067)", async () => {
      const r = await client.query("SELECT COUNT(*)::int AS c FROM dji_parcels");
      expect(r.rows[0].c).toBeGreaterThanOrEqual(1000);
    });

    it("dji_flights: ≥ 5000 (hoy hay 7050)", async () => {
      const r = await client.query("SELECT COUNT(*)::int AS c FROM dji_flights");
      expect(r.rows[0].c).toBeGreaterThanOrEqual(5000);
    });

    it("dji_flights: ≥ 80% con parcel_id (spatial join)", async () => {
      const r = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(parcel_id)::int AS matched
        FROM dji_flights
      `);
      const { total, matched } = r.rows[0];
      const pct = matched / total;
      expect(pct).toBeGreaterThan(0.8);
    });

    it("dji_fumigations: ≥ 300 per-parcel rows (backfill)", async () => {
      const r = await client.query(`
        SELECT COUNT(*)::int AS c
        FROM dji_fumigations
        WHERE parcel_id IS NOT NULL
      `);
      expect(r.rows[0].c).toBeGreaterThanOrEqual(300);
    });

    it("dji_fumigation_schedule: ≥ 50 con next_due_date populated", async () => {
      const r = await client.query(`
        SELECT COUNT(*)::int AS c
        FROM dji_fumigation_schedule
        WHERE next_due_date IS NOT NULL AND is_active = true
      `);
      expect(r.rows[0].c).toBeGreaterThanOrEqual(50);
    });
  });

  describe("Escenario 1: 'Operador mira qué parcelas se fumigaron ayer'", () => {
    it("puede listar fumigaciones del día anterior con dron, piloto, área y dosis", async () => {
      // El operador necesita:
      //   - parcel_id + land_name
      //   - drone_code_used (qué dron se usó)
      //   - area_fumigated_m2 (cuánta área)
      //   - dose_l_per_ha (cuánta agua/mezcla)
      //   - fumigation_date (cuándo)
      const r = await client.query(`
        SELECT
          f.parcel_id,
          p.land_name,
          f.drone_code_used,
          f.area_fumigated_m2,
          f.dose_l_per_ha,
          f.fumigation_date,
          f.recorded_by AS pilot
        FROM dji_fumigations f
        JOIN dji_parcels p ON p.id = f.parcel_id
        WHERE f.parcel_id IS NOT NULL
          AND f.fumigation_date = CURRENT_DATE - INTERVAL '1 day'
        ORDER BY f.area_fumigated_m2 DESC
        LIMIT 20
      `);

      // No asumimos N fumigaciones exactas (depende del día), pero el query
      // debe poder ejecutarse sin error y, si hay datos, traer shape correcto.
      // NOTA: pg devuelve `numeric` como string por default.
      for (const row of r.rows) {
        expect(row.parcel_id).toBeGreaterThan(0);
        expect(typeof row.land_name).toBe("string");
        expect(typeof row.drone_code_used).toBe("number");
        expect(typeof row.area_fumigated_m2).toBe("string"); // numeric
        expect(Number(row.area_fumigated_m2)).toBeGreaterThan(0);
        if (row.dose_l_per_ha !== null) {
          expect(typeof row.dose_l_per_ha).toBe("string"); // numeric
          expect(Number(row.dose_l_per_ha)).toBeGreaterThan(0);
        }
        expect(row.fumigation_date).toBeInstanceOf(Date);
      }
    });

    it("puede agrupar fumigaciones de los últimos 7 días por día y parcela", async () => {
      const r = await client.query(`
        SELECT
          fumigation_date,
          COUNT(DISTINCT parcel_id) AS distinct_parcels,
          COUNT(*) AS events,
          ROUND(SUM(area_fumigated_m2)::numeric / 10000, 2) AS total_ha
        FROM dji_fumigations
        WHERE parcel_id IS NOT NULL
          AND fumigation_date > CURRENT_DATE - INTERVAL '7 days'
        GROUP BY fumigation_date
        ORDER BY fumigation_date DESC
      `);

      // El query debe ejecutarse sin error y devolver shape correcto
      for (const row of r.rows) {
        expect(row.fumigation_date).toBeInstanceOf(Date);
        expect(typeof row.distinct_parcels).toBe("string"); // bigint
        expect(typeof row.events).toBe("string"); // bigint
        expect(typeof row.total_ha).toBe("string"); // numeric
      }
    });
  });

  describe("Escenario 2: 'Operador ve qué dron/piloto fumigó más'", () => {
    it("per-drone stats: agrupa por drone_nickname desde dji_flights", async () => {
      // (Usa dji_flights directamente porque dji_fumigations solo guarda
      // drone_code_used, no el nickname humano).
      const r = await client.query(`
        SELECT
          drone_nickname,
          COUNT(*)::int AS flights,
          COUNT(DISTINCT parcel_id) AS distinct_parcels,
          ROUND(SUM(area_m2)::numeric / 10000, 2) AS total_ha,
          ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS total_l
        FROM dji_flights
        GROUP BY drone_nickname
        ORDER BY flights DESC
      `);

      // Debe haber al menos 1 dron
      expect(r.rows.length).toBeGreaterThan(0);

      // Cada fila tiene shape correcto. NOTA: pg devuelve `numeric` como
      // string, hay que parsear para comparar.
      for (const row of r.rows) {
        expect(typeof row.drone_nickname).toBe("string");
        expect(row.flights).toBeGreaterThan(0);
        expect(Number(row.total_ha)).toBeGreaterThan(0);
      }

      // El primero es el de más vuelos
      for (let i = 1; i < r.rows.length; i++) {
        expect(r.rows[i - 1].flights).toBeGreaterThanOrEqual(r.rows[i].flights);
      }
    });

    it("per-pilot stats: agrupa por pilot_name (con filtro NOT NULL)", async () => {
      const r = await client.query(`
        SELECT
          pilot_name,
          COUNT(*)::int AS flights,
          COUNT(DISTINCT parcel_id) AS distinct_parcels,
          ROUND(SUM(area_m2)::numeric / 10000, 2) AS total_ha,
          ROUND(SUM(spray_usage_ml)::numeric / 1000, 1) AS total_l
        FROM dji_flights
        WHERE pilot_name IS NOT NULL
        GROUP BY pilot_name
        ORDER BY flights DESC
      `);

      // Cada piloto tiene al menos 1 vuelo
      for (const row of r.rows) {
        expect(row.pilot_name).toBeTruthy();
        expect(row.flights).toBeGreaterThan(0);
      }
    });
  });

  describe("Escenario 3: 'Operador identifica parcelas atrasadas (overdue)'", () => {
    it("encuentra parcelas fumigadas hace >60 días (overdue)", async () => {
      const r = await client.query(`
        WITH last_fum AS (
          SELECT parcel_id, MAX(fumigation_date) AS last_date
          FROM dji_fumigations
          WHERE parcel_id IS NOT NULL
          GROUP BY parcel_id
        )
        SELECT
          p.id AS parcel_id,
          p.land_name,
          lf.last_date AS last_fumigation_date,
          CURRENT_DATE - lf.last_date AS days_since_last
        FROM dji_parcels p
        JOIN last_fum lf ON lf.parcel_id = p.id
        WHERE lf.last_date < CURRENT_DATE - INTERVAL '60 days'
        ORDER BY days_since_last DESC
        LIMIT 20
      `);

      // Validar shape; la cantidad exacta varía por cadencia y fecha actual
      for (const row of r.rows) {
        expect(row.parcel_id).toBeGreaterThan(0);
        expect(row.days_since_last).toBeGreaterThan(60);
      }
    });

    it("parcels needing attention: activas pero con cadencia rota", async () => {
      // Parcels que:
      //   - tienen vuelos en los últimos 60 días (señal de actividad)
      //   - PERO su última fumigación fue hace >21 días (cadencia rota)
      //   - O nunca fueron fumigadas (last_date IS NULL)
      const r = await client.query(`
        WITH recent_flights AS (
          SELECT DISTINCT parcel_id
          FROM dji_flights
          WHERE start_at > NOW() - INTERVAL '60 days'
        ),
        last_fum AS (
          SELECT parcel_id, MAX(fumigation_date) AS last_date
          FROM dji_fumigations
          WHERE parcel_id IS NOT NULL
          GROUP BY parcel_id
        )
        SELECT
          p.id AS parcel_id,
          p.land_name,
          lf.last_date AS last_fumigation_date,
          CURRENT_DATE - lf.last_date AS days_since_last
        FROM dji_parcels p
        JOIN recent_flights rf ON rf.parcel_id = p.id
        LEFT JOIN last_fum lf ON lf.parcel_id = p.id
        WHERE lf.last_date IS NULL OR lf.last_date < CURRENT_DATE - INTERVAL '21 days'
        ORDER BY days_since_last DESC NULLS FIRST
        LIMIT 20
      `);

      // Shape: cada fila tiene parcel_id válido y days_since_last (puede ser null)
      for (const row of r.rows) {
        expect(row.parcel_id).toBeGreaterThan(0);
        if (row.days_since_last !== null) {
          expect(row.days_since_last).toBeGreaterThan(21);
        }
      }
    });
  });

  describe("Escenario 4: 'Operador abre el detalle de un vuelo específico'", () => {
    it("puede cargar un flight con toda su metadata + parcel join", async () => {
      // 1. Pickear un flight con parcel_id (de los 89.7% matched)
      const pick = await client.query(`
        SELECT flight_id
        FROM dji_flights
        WHERE parcel_id IS NOT NULL
          AND drone_nickname IS NOT NULL
        ORDER BY start_at DESC NULLS LAST
        LIMIT 1
      `);
      expect(pick.rows.length).toBe(1);
      const flightId = pick.rows[0].flight_id;

      // 2. Cargar el detalle con join a parcel
      //    (dji_flights NO tiene dose_l_per_ha — esa métrica se deriva en
      //    dji_fumigations desde el agregado de flights del mismo día.)
      const r = await client.query(
        `
        SELECT
          f.flight_id,
          f.drone_serial,
          f.drone_nickname,
          f.pilot_name,
          f.start_at,
          f.end_at,
          f.duration_seconds,
          f.area_m2,
          f.spray_usage_ml,
          f.lng,
          f.lat,
          f.manual_mode,
          f.mode_name,
          p.id AS parcel_id,
          p.land_name,
          p.field_type
        FROM dji_flights f
        LEFT JOIN dji_parcels p ON p.id = f.parcel_id
        WHERE f.flight_id = $1
      `,
        [flightId]
      );
      expect(r.rows.length).toBe(1);
      const flight = r.rows[0];

      // El flight debe tener metadata completa
      expect(flight.flight_id).toBe(flightId);
      expect(flight.drone_nickname).toBeTruthy();
      expect(flight.start_at).toBeInstanceOf(Date);
      expect(flight.end_at).toBeInstanceOf(Date);
      expect(flight.parcel_id).toBeGreaterThan(0);
      expect(flight.land_name).toBeTruthy();

      // Área y spray son coherentes. numeric → string en pg.
      expect(Number(flight.area_m2)).toBeGreaterThan(0);
      if (flight.spray_usage_ml !== null) {
        expect(flight.spray_usage_ml).toBeGreaterThan(0);
      }
    });

    it("puede cargar las fumigaciones derivadas de un flight específico (audit trail)", async () => {
      // El operador quiere saber "qué fumigaciones se generaron desde este
      // vuelo" (para auditoría). Las fumigaciones per-parcel del backfill
      // guardan en `notes.backfilled_from = 'dji_flights'` y
      // `notes.flights_count`. NOTA: dji_fumigations.notes es text (no
      // jsonb) — necesitamos castear para usar ->>.
      const r = await client.query(`
        SELECT
          f.id,
          f.fumigation_date,
          f.parcel_id,
          f.area_fumigated_m2,
          f.dose_l_per_ha,
          f.notes,
          f.notes::jsonb->>'backfilled_from' AS backfilled_from,
          (f.notes::jsonb->>'flights_count')::int AS flights_count,
          f.notes::jsonb->'drones' AS drones
        FROM dji_fumigations f
        WHERE f.notes::jsonb->>'backfilled_from' = 'dji_flights'
        ORDER BY f.fumigation_date DESC
        LIMIT 5
      `);

      // Cada fumigación backfilled debe tener flights_count en notes
      for (const row of r.rows) {
        expect(row.backfilled_from).toBe("dji_flights");
        expect(row.flights_count).toBeGreaterThan(0);
        expect(Array.isArray(row.drones)).toBe(true);
      }
    });
  });

  describe("Integridad referencial", () => {
    it("toda fumigación con parcel_id apunta a un parcel existente", async () => {
      const r = await client.query(`
        SELECT COUNT(*)::int AS orphans
        FROM dji_fumigations f
        LEFT JOIN dji_parcels p ON p.id = f.parcel_id
        WHERE f.parcel_id IS NOT NULL
          AND p.id IS NULL
      `);
      expect(r.rows[0].orphans).toBe(0);
    });

    it("todo flight con parcel_id apunta a un parcel existente", async () => {
      const r = await client.query(`
        SELECT COUNT(*)::int AS orphans
        FROM dji_flights f
        LEFT JOIN dji_parcels p ON p.id = f.parcel_id
        WHERE f.parcel_id IS NOT NULL
          AND p.id IS NULL
      `);
      expect(r.rows[0].orphans).toBe(0);
    });

    it("fumigation_schedule.last_fumigation_date ≤ next_due_date", async () => {
      // next_due_date = last + cadence_days, así que siempre debe ser >=
      const r = await client.query(`
        SELECT COUNT(*)::int AS invalid
        FROM dji_fumigation_schedule
        WHERE last_fumigation_date IS NOT NULL
          AND next_due_date IS NOT NULL
          AND next_due_date < last_fumigation_date
      `);
      expect(r.rows[0].invalid).toBe(0);
    });
  });
});
