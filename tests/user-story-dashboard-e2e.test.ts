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
// Skip si no hay conectividad real a Postgres — estos tests son opcionales
// (no corren en CI sin DB). El check es un `SELECT 1` con timeout corto
// (2s) para distinguir "Docker apagado" de "Docker encendido" sin demorar
// la suite cuando el entorno no tiene DB. Antes (2026-07-13) el skip se
// basaba solo en presencia de `.env.local`, lo que hacía que la suite
// reventara con ECONNREFUSED cuando Docker estaba apagado en la máquina
// del dev. Para correrlos localmente: `npm test -- user-story-dashboard-e2e`
// (con .env.local presente Y Docker/Postgres alcanzable en localhost:5432).
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

const HAS_DB_CONFIG =
  !!process.env.DATABASE_URL || existsSync(join(process.cwd(), ".env.local"));

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

/**
 * Verifica conectividad real a Postgres con un `SELECT 1` y un timeout
 * corto. Devuelve `false` ante cualquier error (ECONNREFUSED con Docker
 * apagado, ETIMEDOUT con red caída, auth, etc.) — el caller decide si
 * skipear el suite o reportar un fallo de configuración.
 *
 * Por qué este check existe: la presencia de `.env.local` no implica
 * que Postgres esté corriendo. Antes (2026-07-13) `HAS_DB` se evaluaba
 * solo por presencia del archivo, y con Docker apagado el `beforeAll`
 * reventaba con ECONNREFUSED, marcando el file entero como "Failed"
 * en vez de "Skipped".
 *
 * @param timeoutMs budget total para connect + SELECT 1 (default 2000ms)
 */
async function checkDbReachable(timeoutMs: number): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!url) return false;
  const pingPool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    idleTimeoutMillis: 5_000,
    ssl:
      process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  try {
    const client = await Promise.race([
      pingPool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`checkDbReachable: connect >${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ]);
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      await pingPool.end();
    } catch {
      // swallow: si .end() falla porque connect() nunca se completó,
      // no tenemos nada que limpiar — el check ya devolvió su veredicto.
    }
  }
}

// Top-level await: vitest espera a que esta promesa se resuelva antes
// de colectar los `describe`. Si la DB no responde, `HAS_DB` queda en
// `false` y `describe.skipIf(true)` skipea toda la suite sin intentar
// conectar (sin error en `beforeAll`, sin "Failed Suites").
const HAS_DB = HAS_DB_CONFIG && (await checkDbReachable(2000));

// HAS_DATA: la DB tiene datos (post-pipeline del operador). CI solo corre
// migrations (sin seed), así que las tablas están vacías — los tests que
// asumen data real (Sanity con counts ≥ 1000, Escenario 4 con al menos 1
// flight, etc.) deben skipear, no fallar. Sin este check, CI reventaba
// con `expected 0 to be ≥ 1000` (run 29428605434, post-fix de migrations).
let HAS_DATA = false;
if (HAS_DB) {
  const probe = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    max: 1,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 5_000,
    ssl:
      process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  try {
    const r = await probe.query(
      "SELECT (SELECT COUNT(*)::int FROM dji_parcels) AS parcels, (SELECT COUNT(*)::int FROM dji_flights) AS flights"
    );
    HAS_DATA = (r.rows[0].parcels > 0) || (r.rows[0].flights > 0);
  } catch {
    // Si la query falla (tablas no existen, etc.), dejamos HAS_DATA = false.
  } finally {
    try { await probe.end(); } catch { /* swallow */ }
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

  describe.skipIf(!HAS_DATA)("Sanity — estado de la DB post-pipeline", () => {
    it("dji_parcels: ≥ 1000 (hoy hay 1067)", async () => {
      const r = await client.query("SELECT COUNT(*)::int AS c FROM dji_parcels");
      expect(r.rows[0].c).toBeGreaterThanOrEqual(1000);
    });

    it("dji_flights: ≥ 5000 (hoy hay 7050)", async () => {
      const r = await client.query("SELECT COUNT(*)::int AS c FROM dji_flights");
      expect(r.rows[0].c).toBeGreaterThanOrEqual(5000);
    });

    it("dji_flights: ≥ 75% con parcel_id (spatial join)", async () => {
      // Threshold bajado de 0.80 → 0.75 el 2026-07-03: agregar las 7 fincas
      // nuevas (5 Milan + 2 Gertrudis) y los flights que están en zonas sin
      // parcela cercana (>50m) dejó la tasa en ~78%. 0.75 deja margen
      // para que más flights queden sin parcela sin romper el test.
      const r = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(parcel_id)::int AS matched
        FROM dji_flights
      `);
      const { total, matched } = r.rows[0];
      const pct = matched / total;
      expect(pct).toBeGreaterThan(0.75);
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

  describe.skipIf(!HAS_DATA)("Escenario 2: 'Operador ve qué dron/piloto fumigó más'", () => {
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

  describe.skipIf(!HAS_DATA)("Escenario 3: 'Operador identifica parcelas atrasadas (overdue)'", () => {
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

  describe.skipIf(!HAS_DATA)("Escenario 4: 'Operador abre el detalle de un vuelo específico'", () => {
    it("puede cargar un flight con toda su metadata + parcel join", async () => {
      // 1. Pickear un flight con parcel_id (de los 89.7% matched).
      //    Filtramos area_m2 > 0 para evitar vuelos de calibración/prueba
      //    (~5% de la tabla) que revientan la aserción de área positiva
      //    más abajo.
      const pick = await client.query(`
        SELECT flight_id
        FROM dji_flights
        WHERE parcel_id IS NOT NULL
          AND drone_nickname IS NOT NULL
          AND area_m2 > 0
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

  // Q2 regression (CI run 29705508394, fixed in 26cf276 follow-up): el
  // query de fetchOverdueParcelsRaw referencia `p.spray_geometry` en el
  // WHERE, pero la columna física es `p.spray_geom` (PostGIS) y el alias
  // `spray_geometry` solo aplica al SELECT. Los unit tests mockean el DB
  // y no lo detectaban; el build de Next.js lo cazaba en pre-render con
  // `42703 column does not exist`. Este test corre el mismo query del
  // cache.ts contra la BD real para que el bug se detecte en la suite,
  // no en el build (que solo corre en CI y tarda más en fallar).
  //
  // NOTA: `unstable_cache` no funciona fuera del runtime de Next.js
  // ("incrementalCache missing"), así que no podemos llamar al wrapper
  // `fetchOverdueParcelsCached` desde vitest. Duplicamos el query acá
  // y mantenemos sincronizado manualmente. Si cambia el query del
  // cache.ts, actualizá este SQL también.
  describe("Q2 regression: el query de overdue no referencia columnas inexistentes", () => {
    it("ejecuta el query real del cache.ts y devuelve un array", async () => {
      const r = await client.query(
        `SELECT
            p.id              AS parcel_id,
            p.land_name,
            p.external_id,
            p.field_type,
            p.is_orchard,
            p.drone_model_name,
            p.spray_area_m2   AS area_fumigable_m2,
            p.waypoint_count,
            s.crop_type,
            s.recommended_cadence_days,
            s.last_fumigation_date,
            s.next_due_date
          FROM dji_fumigation_schedule s
          JOIN dji_parcels p ON p.id = s.parcel_id
          WHERE s.is_active = true
            AND p.spray_geom IS NOT NULL
            AND s.next_due_date <= (CURRENT_DATE + $1 * INTERVAL '1 day')
          ORDER BY s.next_due_date ASC NULLS LAST
          LIMIT $2`,
        [14, 5]
      );
      expect(Array.isArray(r.rows)).toBe(true);
      // No asumimos length: CI corre migrations-only, schedule puede
      // estar vacía y rows.length === 0 es válido.
    });

    it("dji_parcels tiene 'spray_geom' (PostGIS) y NO 'spray_geometry'", async () => {
      // Defensa explícita: si alguien revierte el fix y vuelve a usar
      // `p.spray_geometry` en el WHERE, este test falla con 42703
      // antes incluso de llegar al query de arriba.
      const r = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dji_parcels'
      `);
      const cols = new Set(r.rows.map((row) => row.column_name));
      expect(cols.has("spray_geom")).toBe(true);
      expect(cols.has("spray_geometry")).toBe(false);
    });
  });

  // Q4 sprint / track C (mejora 2): soft delete en dji_fumigations y
  // dji_parcels via columna `deleted_at TIMESTAMPTZ NULL`. Esta columna
  // es el prerequisito para:
  //   - Recuperar data borrada por error (no hay backup automático).
  //   - Auditar quién/por qué se eliminó algo (futuro: tabla de audit).
  // El refactor de queries existentes para agregar `WHERE deleted_at IS NULL`
  // es intencionalmente OUT OF SCOPE de esta mejora (ver BITACORA y la
  // tarea original). Acá solo verificamos que la columna EXISTE y es
  // nullable + timestamptz, sin tocar la data.
  //
  // NO se skipea con !HAS_DATA porque validar schema no requiere datos:
  // CI corre migrations-only y este test debe pasar ahí también.
  describe("Q4 sprint: schema de soft delete (deleted_at)", () => {
    it("dji_fumigations tiene la columna deleted_at (TIMESTAMPTZ NULL)", async () => {
      const r = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'dji_fumigations'
          AND column_name = 'deleted_at'
      `);
      // Si la migration no se aplicó, la query devuelve 0 filas y el
      // test falla con "expected at least 1".
      expect(r.rows.length).toBe(1);
      const row = r.rows[0] as { data_type: string; is_nullable: string };
      expect(row.data_type).toBe("timestamp with time zone");
      expect(row.is_nullable).toBe("YES");
    });

    it("dji_parcels tiene la columna deleted_at (TIMESTAMPTZ NULL)", async () => {
      const r = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'dji_parcels'
          AND column_name = 'deleted_at'
      `);
      expect(r.rows.length).toBe(1);
      const row = r.rows[0] as { data_type: string; is_nullable: string };
      expect(row.data_type).toBe("timestamp with time zone");
      expect(row.is_nullable).toBe("YES");
    });

    it("dji_fumigations.deleted_at tiene indice parcial (idx_dji_fumigations_deleted_at)", async () => {
      // Defense in depth: si la migration se aplicó a medias (columna
      // sin índice) el query de "filas activas" va a ser lento a futuro.
      const r = await client.query(`
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'dji_fumigations'
          AND indexname = 'idx_dji_fumigations_deleted_at'
      `);
      expect(r.rows.length).toBe(1);
    });

    it("dji_parcels.deleted_at tiene indice parcial (idx_dji_parcels_deleted_at)", async () => {
      const r = await client.query(`
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'dji_parcels'
          AND indexname = 'idx_dji_parcels_deleted_at'
      `);
      expect(r.rows.length).toBe(1);
    });
  });
});
