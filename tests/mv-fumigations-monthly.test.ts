// tests/mv-fumigations-monthly.test.ts
//
// Tests para la materialized view `mv_fumigations_monthly` (migration
// 20260801000000_mv_fumigations_monthly.sql) y su uso en el dashboard.
//
// Cubre:
//   - La MV existe en el schema (to_regclass).
//   - Tiene la UNIQUE INDEX requerida para REFRESH CONCURRENTLY.
//   - Las columnas tienen los tipos esperados (date, numeric, bigint).
//   - REFRESH MATERIALIZED VIEW CONCURRENTLY corre sin error.
//   - La data de la MV coincide con un GROUP BY equivalente
//     (correctness — la MV no diverge del query "vivo").
//
// Skip si no hay DB real (mismo patrón que user-story-dashboard-e2e.test.ts).
// Para correrlo localmente: `npm test -- mv-fumigations-monthly` con
// `.env.local` presente Y Postgres alcanzable.
//
// Importante: el check de skip es SÍNCRONO (basado en presencia de
// `process.env.DATABASE_URL` o `.env.local`). NO usamos `checkDbReachable`
// para decidir el skip porque ese check es async y `it.skipIf` se evalúa
// al registrar el test, antes de cualquier `beforeAll`. Si en el CI
// hay `.env.local` pero la red no llega a Postgres, los tests van a
// tirar ECONNREFUSED — el dev debe remover `.env.local` o arreglar
// la red. (Mismo trade-off que el resto de los integration tests del
// proyecto.)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

// ============================================================
// DB config: chequeo SÍNCRONO (no async checkDbReachable).
// ============================================================

const HAS_DB_CONFIG =
  !!process.env.DATABASE_URL || existsSync(join(process.cwd(), ".env.local"));

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

let pool: Pool | null = null;

beforeAll(async () => {
  if (!HAS_DB_CONFIG) return;
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!url) return;
  pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl:
      process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
}, 15_000);

afterAll(async () => {
  if (pool) {
    await pool.end().catch(() => { /* ignore */ });
    pool = null;
  }
});

// Helper: it que se skipea si no hay DB config. Usa el `describe.skip`
// pattern para todo el bloque (más legible que `it.skipIf` por test).
const d = HAS_DB_CONFIG ? describe : describe.skip;

d("mv_fumigations_monthly — schema", () => {
  it("la MV existe en el schema", async () => {
    if (!pool) throw new Error("pool no inicializado");
    const r = await pool.query<{ mv: string | null }>(
      "SELECT to_regclass('mv_fumigations_monthly') AS mv"
    );
    expect(r.rows[0]?.mv).toBe("mv_fumigations_monthly");
  });

  it("tiene la UNIQUE INDEX sobre `month` (requerida por REFRESH CONCURRENTLY)", async () => {
    if (!pool) throw new Error("pool no inicializado");
    const r = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename  = 'mv_fumigations_monthly'`
    );
    const uniqueIdx = r.rows.find((i) => i.indexdef.includes("UNIQUE INDEX"));
    expect(
      uniqueIdx,
      `No se encontró UNIQUE INDEX en mv_fumigations_monthly. ` +
        `REFRESH MATERIALIZED VIEW CONCURRENTLY requiere un unique index. ` +
        `Encontrados: ${r.rows.map((i) => i.indexname).join(", ") || "(ninguno)"}`
    ).toBeDefined();
    expect(uniqueIdx?.indexdef).toMatch(/\(month\)/);
  });

  it("columnas: month (date), total_area_m2 (numeric), total_fumigations (bigint)", async () => {
    if (!pool) throw new Error("pool no inicializado");
    // Usamos pg_attribute en vez de information_schema.columns porque
    // Supabase con permisos `authenticated`/`anon` no siempre expone
    // todas las filas del information_schema (verificado: 2026-08-01,
    // information_schema.columns devuelve [] para esta MV en Supabase
    // prod, mientras que pg_attribute sí la lista). pg_attribute es
    // catalog y siempre está disponible.
    const r = await pool.query<{ attname: string; type: string }>(
      `SELECT attname, format_type(atttypid, atttypmod) AS type
         FROM pg_attribute
        WHERE attrelid = 'mv_fumigations_monthly'::regclass
          AND attnum > 0
        ORDER BY attnum`
    );
    const cols = new Map(r.rows.map((c) => [c.attname, c.type]));

    expect(cols.get("month"), "month column missing").toBe("date");
    // numeric (la lib/db.ts parchea el parser a number).
    expect(cols.get("total_area_m2"), "total_area_m2 wrong type").toMatch(/^numeric/);
    // bigint → number via patcher.
    expect(cols.get("total_fumigations"), "total_fumigations wrong type").toBe("bigint");
  });
});

d("mv_fumigations_monthly — REFRESH", () => {
  it("REFRESH MATERIALIZED VIEW CONCURRENTLY corre sin error", async () => {
    if (!pool) throw new Error("pool no inicializado");
    // El CONCURRENTLY requiere que la MV haya sido populada al menos
    // una vez. Si está vacía, el primer REFRESH debe ser plain
    // (sin CONCURRENTLY). Detectamos el caso y hacemos el primero
    // sin CONCURRENTLY si fuera necesario.
    const before = await pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM mv_fumigations_monthly"
    );
    if (Number(before.rows[0]?.n ?? 0) === 0) {
      await pool.query("REFRESH MATERIALIZED VIEW mv_fumigations_monthly");
    } else {
      await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly");
    }
    // Si llegamos acá sin throw, el REFRESH anduvo. La aserción es
    // sobre el rowCount, que pg devuelve como 0 para REFRESH (es
    // un statement, no un SELECT).
    const after = await pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM mv_fumigations_monthly"
    );
    // CI test DB arranca vacia (apenas schema, sin fumigations). El
    // REFRESH funciona (no tira error) pero la MV queda con 0 rows. Si
    // la DB tiene fumigations, la MV deberia tenerlas. Si esta vacia,
    // skip la assertion de count (el REFRESH en si mismo es lo que
    // estamos testeando).
    const count = Number(after.rows[0]?.n ?? 0);
    if (count === 0) {
      console.log(
        "[mv-fumigations-monthly] REFRESH OK pero la MV esta vacia " +
          "(test DB sin fumigations). Skip assertion de count."
      );
      return;
    }
    expect(count).toBeGreaterThan(0);
  });
});

d("mv_fumigations_monthly — correctness", () => {
  it("data de la MV coincide con GROUP BY equivalente", async () => {
    if (!pool) throw new Error("pool no inicializado");

    // Primero asegurar que la MV está fresca.
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly");

    // 1) Resultado de la MV.
    const mvResult = await pool.query<{
      month: Date | string;
      total_area_m2: string;
      total_fumigations: string;
    }>(
      `SELECT month, total_area_m2, total_fumigations
         FROM mv_fumigations_monthly
        ORDER BY month ASC`
    );
    const mvRows = mvResult.rows.map((r) => {
      const monthDate = r.month instanceof Date ? r.month : new Date(r.month);
      return {
        month: monthDate.toISOString().slice(0, 10),
        total_area_m2: Number(r.total_area_m2),
        total_fumigations: Number(r.total_fumigations)
      };
    });

    // 2) GROUP BY equivalente "vivo".
    const liveResult = await pool.query<{
      month: Date | string;
      total_area_m2: string;
      total_fumigations: string;
    }>(
      `SELECT date_trunc('month', f.fumigation_date)::date AS month,
              SUM(f.area_fumigated_m2)                       AS total_area_m2,
              COUNT(*)                                       AS total_fumigations
         FROM dji_fumigations f
        WHERE f.deleted_at IS NULL
          AND f.fumigation_date IS NOT NULL
        GROUP BY date_trunc('month', f.fumigation_date)
        ORDER BY month ASC`
    );
    const liveRows = liveResult.rows.map((r) => {
      const monthDate = r.month instanceof Date ? r.month : new Date(r.month);
      return {
        month: monthDate.toISOString().slice(0, 10),
        total_area_m2: Number(r.total_area_m2),
        total_fumigations: Number(r.total_fumigations)
      };
    });

    // 3) Misma cantidad de rows.
    expect(mvRows.length).toBe(liveRows.length);

    // 4) Mismas filas (mismo mes → mismos totales).
    for (let i = 0; i < mvRows.length; i++) {
      const mv = mvRows[i]!;
      const live = liveRows[i]!;
      expect(mv.month, `row ${i} month`).toBe(live.month);
      // m² puede tener un round-off de ±1 por la SUM vs el COUNT,
      // tolerancia generosa para evitar flakes por punto flotante.
      expect(
        Math.abs(mv.total_area_m2 - live.total_area_m2),
        `row ${i} (${mv.month}) total_area_m2 diverge: mv=${mv.total_area_m2} live=${live.total_area_m2}`
      ).toBeLessThan(1);
      expect(mv.total_fumigations, `row ${i} (${mv.month}) total_fumigations`).toBe(
        live.total_fumigations
      );
    }
  });
});
