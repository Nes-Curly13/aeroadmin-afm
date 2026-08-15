// @vitest-environment node
//
// Tests para scripts/backfill-fumigations-from-flights.js
//
// Sprint: feature/backfill-fumigation-parcel (2026-08-15)
//
// Estrategia:
//   - Mockear `pg` con `vi.mock` (factory) para inyectar un Pool + client
//     controlable. Los tests NO tocan una BD real (no hay docker en CI
//     ni garantías de schema sembrado).
//   - Tests directos de `inspectCandidates(client, parcelFilter)` y
//     `backfill(client, opts)` pasando el mock client directamente.
//   - Tests de validación de `main()` mockeando process.argv + env vars.
//   - Verificamos:
//     * SQL emitido (presencia de WHERE, JOIN, mode(), jsonb_build_object, etc.)
//     * Stats devueltas (matched, no_consensus, no_parcel_in_flight, no_flights)
//     * Dry-run vs UPDATE en el SQL
//     * Validación de flags CLI
//     * Error claro si falta DATABASE_URL
//
// NO testeamos:
//   - Conexión real a Postgres (lo hace el smoke test en CI).
//   - Transacciones BEGIN/COMMIT/ROLLBACK end-to-end con BD real.
//   - El helper `loadLocalEnv()` no se exporta → se testea indirectamente
//     vía `main()` (chdir a tmpdir sin .env.local).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks — vi.hoisted garantiza que las refs estén inicializadas
// ANTES de que `vi.mock` ejecute la factory (que corre en el
// momento del import del módulo bajo test).
// ============================================================

const { mockClient, mockPool, PoolMock } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn(),
    end: vi.fn(),
  };
  // Default behavior: connect() devuelve el client compartido, end() resuelve.
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.end.mockResolvedValue(undefined);
  const PoolMock = vi.fn().mockImplementation(() => mockPool);
  return { mockClient, mockPool, PoolMock };
});

vi.mock("pg", () => ({
  Pool: PoolMock,
}));

// Importar el script DESPUÉS de declarar los mocks (vi.mock se eleva).
// El .js es CJS — usamos createRequire(import.meta.url) para que el
// `require("pg")` interno del script pase por el loader de Node que
// vitest intercepta con `vi.mock("pg", ...)`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);

const script = require_(
  "../scripts/backfill-fumigations-from-flights.js"
) as unknown as {
  main: () => Promise<void>;
  backfill: (
    client: AnyClient,
    opts: { consensus: number; dryRun: boolean; parcelFilter?: number }
  ) => Promise<{
    matched: number;
    no_consensus: number;
    no_parcel_in_flight: number;
    no_flights: number;
    sample: AnyRow[];
  }>;
  inspectCandidates: (
    client: AnyClient,
    parcelFilter?: number
  ) => Promise<{
    total_candidates: number;
    with_flight_ids: number;
    with_flights_having_parcel: number;
  }>;
};

// ============================================================
// Helpers
// ============================================================

/** Reset completo de los mocks entre tests. */
function resetMocks() {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
  mockPool.end.mockClear();
  PoolMock.mockClear();
  // Re-aplicar comportamiento por defecto.
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.end.mockResolvedValue(undefined);
}

/** Encuentra la primera query que matchee el predicado. */
function findQuery(
  predicate: (sql: string) => boolean
): { sql: string; params: unknown[] } {
  const call = mockClient.query.mock.calls.find(
    ([sql]) => typeof sql === "string" && predicate(sql)
  );
  if (!call) {
    const allQueries = mockClient.query.mock.calls
      .map(([s]) =>
        typeof s === "string" ? s.slice(0, 80).replace(/\s+/g, " ") : "<non-string>"
      )
      .join("\n  - ");
    throw new Error(`No matching query. All queries:\n  - ${allQueries}`);
  }
  return { sql: call[0] as string, params: (call[1] ?? []) as unknown[] };
}

/** La query del UPDATE (o el SELECT del dry-run) — usa WITH flight_stats
 *  seguido de `UPDATE dji_fumigations` o `-- DRY RUN`. */
function getUpdateCall() {
  return findQuery((sql) => {
    if (!sql.includes("WITH flight_stats")) return false;
    return /UPDATE\s+dji_fumigations/.test(sql) || sql.includes("-- DRY RUN");
  });
}

/** La query de stats — termina con `FROM flight_stats` (no el UPDATE). */
function getStatsCall() {
  return findQuery(
    (sql) =>
      sql.includes("no_parcel_in_flight") && /FROM\s+flight_stats\s*$/.test(sql.trim())
  );
}

/** La query de no_flights — usa `= 0` (no `> 0`) y filtra flight_ids NULL. */
function getNoFlightsCall() {
  return findQuery(
    (sql) =>
      sql.includes("flight_ids IS NULL") &&
      sql.includes("array_length(f.flight_ids, 1) = 0")
  );
}

/** Configura las 3 queries que ejecuta backfill() en secuencia. */
function setupBackfillQueries(
  opts: {
    stats?: { matched: number; no_consensus: number; no_parcel_in_flight: number };
    updateRows?: AnyRow[];
    noFlights?: number;
  } = {}
) {
  const stats = opts.stats ?? { matched: 50, no_consensus: 30, no_parcel_in_flight: 20 };
  const noFlights = opts.noFlights ?? 5;
  const updateRows = opts.updateRows ?? [];

  mockClient.query
    // 1. statsSql
    .mockResolvedValueOnce({ rows: [stats], rowCount: 1 })
    // 2. updateSql (o dry-run SELECT)
    .mockResolvedValueOnce({ rows: updateRows, rowCount: updateRows.length })
    // 3. noFlightsSql
    .mockResolvedValueOnce({ rows: [{ c: noFlights }], rowCount: 1 });
}

/** Silencia console.log durante un test (la CLI loggea verbose). */
function withSuppressedLogs<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  console.log = vi.fn();
  return fn().finally(() => {
    console.log = origLog;
  });
}

// ============================================================
// inspectCandidates
// ============================================================

describe("scripts/backfill-fumigations-from-flights — inspectCandidates", () => {
  beforeEach(() => resetMocks());

  it("devuelve counts correctos cuando hay fumigaciones con flight_ids", async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          total_candidates: 100,
          with_flight_ids: 75,
          with_flights_having_parcel: 60,
        },
      ],
      rowCount: 1,
    });

    const result = await script.inspectCandidates(mockClient, undefined);

    expect(result.total_candidates).toBe(100);
    expect(result.with_flight_ids).toBe(75);
    expect(result.with_flights_having_parcel).toBe(60);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });

  it("devuelve counts en 0 cuando no hay fumigaciones", async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          total_candidates: 0,
          with_flight_ids: 0,
          with_flights_having_parcel: 0,
        },
      ],
      rowCount: 1,
    });

    const result = await script.inspectCandidates(mockClient, undefined);

    expect(result.total_candidates).toBe(0);
    expect(result.with_flight_ids).toBe(0);
    expect(result.with_flights_having_parcel).toBe(0);
  });

  it("filtra por parcel cuando se pasa parcelFilter", async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          total_candidates: 5,
          with_flight_ids: 5,
          with_flights_having_parcel: 5,
        },
      ],
      rowCount: 1,
    });

    await script.inspectCandidates(mockClient, 3107);

    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("fl.parcel_id = $1");
    expect(params).toEqual([3107]);
  });

  it("SQL usa los placeholders correctos y filtra por deleted_at + parcel_id NULL", async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          total_candidates: 0,
          with_flight_ids: 0,
          with_flights_having_parcel: 0,
        },
      ],
      rowCount: 1,
    });

    await script.inspectCandidates(mockClient, 123);

    const [sql, params] = mockClient.query.mock.calls[0];
    expect(sql).toMatch(/COUNT\(\*\)::int/);
    expect(sql).toContain("FROM dji_fumigations f");
    expect(sql).toContain("f.deleted_at IS NULL");
    expect(sql).toContain("f.parcel_id IS NULL");
    expect(sql).toContain("flight_ids IS NOT NULL");
    expect(params).toEqual([123]);
  });
});

// ============================================================
// backfill — SQL emitido (dry-run + UPDATE)
// ============================================================

describe("scripts/backfill-fumigations-from-flights — backfill (SQL emitido)", () => {
  beforeEach(() => resetMocks());

  it("dry-run NO ejecuta UPDATE (el SQL contiene '-- DRY RUN' y no 'UPDATE dji_fumigations')", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: true });

    const update = getUpdateCall();
    expect(update.sql).toContain("-- DRY RUN");
    expect(update.sql).not.toMatch(/UPDATE\s+dji_fumigations/);
    // El dry-run emite un SELECT con LIMIT 20
    expect(update.sql).toMatch(/LIMIT\s+20/);
  });

  it("UPDATE filtra por parcel_id IS NULL y deleted_at IS NULL", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: false });

    const update = getUpdateCall();
    expect(update.sql).toMatch(/f\.deleted_at\s+IS\s+NULL/);
    expect(update.sql).toMatch(/f\.parcel_id\s+IS\s+NULL/);
  });

  it("SQL usa mode() WITHIN GROUP (ORDER BY fl.parcel_id) para elegir la moda", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: false });

    const update = getUpdateCall();
    expect(update.sql).toMatch(
      /mode\(\)\s+WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\s+fl\.parcel_id\s*\)/i
    );
  });

  it("SQL incluye flight_ids IS NOT NULL AND array_length(flight_ids, 1) > 0", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: false });

    const update = getUpdateCall();
    expect(update.sql).toContain("f.flight_ids IS NOT NULL");
    expect(update.sql).toMatch(
      /array_length\(f\.flight_ids\s*,\s*1\)\s*>\s*0/
    );
  });

  it("UPDATE incluye metadata en notes->parcel_backfill con timestamp UTC", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: false });

    const update = getUpdateCall();
    // jsonb_build_object anidado para parcel_backfill
    expect(update.sql).toContain("jsonb_build_object");
    expect(update.sql).toContain("'parcel_backfill'");
    expect(update.sql).toContain("'backfilled_at'");
    expect(update.sql).toContain("AT TIME ZONE 'UTC'");
    // Campos clave del consenso persistidos
    expect(update.sql).toContain("'parcel_id'");
    expect(update.sql).toContain("'n_flights_total'");
    expect(update.sql).toContain("'n_flights_with_parcel'");
    expect(update.sql).toContain("'parcel_consensus_ratio'");
    expect(update.sql).toContain("'distinct_parcels'");
    expect(update.sql).toContain("'consensus_threshold'");
  });

  it("el threshold de consenso se pasa como $1 y se aplica a matched/no_consensus", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.7, dryRun: false });

    const update = getUpdateCall();
    const stats = getStatsCall();

    // El consensus threshold se pasa como $1 a ambas queries
    expect(update.params[0]).toBe(0.7);
    expect(stats.params[0]).toBe(0.7);

    // El UPDATE filtra por consenso >= threshold (matched)
    expect(update.sql).toMatch(/parcel_consensus_ratio\s*>=\s*\$1/);
    // El stats query cuenta no_consensus con < $1
    expect(stats.sql).toMatch(/parcel_consensus_ratio\s*<\s*\$1/);
  });

  it("no matchea fumigaciones con todos los flights sin parcel_id (no_parcel_in_flight)", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, { consensus: 0.5, dryRun: false });

    const stats = getStatsCall();
    const update = getUpdateCall();
    // La stats query cuenta por separado las fumigaciones con 0 flights con parcel
    expect(stats.sql).toMatch(/n_flights_with_parcel\s*=\s*0/);
    // El UPDATE excluye esas fumigaciones (solo matched tienen n_flights_with_parcel > 0)
    expect(update.sql).toMatch(/n_flights_with_parcel\s*>\s*0/);
  });

  it("parcelFilter agrega AND al CTE y al no_flights query (params correctos)", async () => {
    setupBackfillQueries();

    await script.backfill(mockClient, {
      consensus: 0.5,
      dryRun: false,
      parcelFilter: 3107,
    });

    const update = getUpdateCall();
    const noFlights = getNoFlightsCall();
    // El update recibe el parcel como $2 (después de consensus=$1)
    expect(update.params).toEqual([0.5, 3107]);
    expect(update.sql).toMatch(/fl\.parcel_id\s*=\s*\$2/);
    // El no_flights query usa $1 directamente (consensus no aplica)
    expect(noFlights.params).toEqual([3107]);
    expect(noFlights.sql).toContain("f.parcel_id = $1");
  });
});

// ============================================================
// backfill — resultado y manejo de errores
// ============================================================

describe("scripts/backfill-fumigations-from-flights — backfill (resultado)", () => {
  beforeEach(() => resetMocks());

  it("devuelve matched, no_consensus, no_parcel_in_flight y no_flights", async () => {
    setupBackfillQueries({
      stats: { matched: 80, no_consensus: 15, no_parcel_in_flight: 5 },
      updateRows: [{ id: 1, parcel_id: 3107 }],
      noFlights: 12,
    });

    const result = await script.backfill(mockClient, {
      consensus: 0.5,
      dryRun: false,
    });

    expect(result).toEqual({
      matched: 80,
      no_consensus: 15,
      no_parcel_in_flight: 5,
      no_flights: 12,
      sample: [], // sin dry-run → sample vacío
    });
  });

  it("dry-run incluye las rows del SELECT en `sample` (top 20)", async () => {
    const sample = [
      {
        fumigation_id: 1,
        modal_parcel_id: 3107,
        n_flights_total: 10,
        n_flights_with_parcel: 9,
        parcel_consensus_ratio: 0.9,
      },
      {
        fumigation_id: 2,
        modal_parcel_id: 4100,
        n_flights_total: 5,
        n_flights_with_parcel: 4,
        parcel_consensus_ratio: 0.8,
      },
    ];
    setupBackfillQueries({
      stats: { matched: 2, no_consensus: 0, no_parcel_in_flight: 0 },
      updateRows: sample,
      noFlights: 0,
    });

    const result = await script.backfill(mockClient, {
      consensus: 0.5,
      dryRun: true,
    });

    expect(result.sample).toEqual(sample);
    expect(result.matched).toBe(2);
  });

  it("propaga errores del client (rechazo de query)", async () => {
    mockClient.query.mockReset();
    mockClient.query.mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      script.backfill(mockClient, { consensus: 0.5, dryRun: false })
    ).rejects.toThrow("connection lost");
  });
});

// ============================================================
// main() — validación CLI y flujo happy path
// ============================================================

describe("scripts/backfill-fumigations-from-flights — main() (CLI)", () => {
  let tmpDir: string;
  let origCwd: string;
  let origArgv: string[];
  let origDbUrl: string | undefined;
  let origDbUrlDirect: string | undefined;

  beforeEach(() => {
    resetMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-cli-"));
    origCwd = process.cwd();
    origArgv = process.argv;
    origDbUrl = process.env.DATABASE_URL;
    origDbUrlDirect = process.env.DATABASE_URL_DIRECT;
    // chdir a un dir sin .env.local → loadLocalEnv() no hace nada
    process.chdir(tmpDir);
    // Limpiar env vars para que ningún test herede estado
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_DIRECT;
    // Setup base de argv
    process.argv = ["node", "backfill-fumigations-from-flights.js"];
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.argv = origArgv;
    if (origDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = origDbUrl;
    if (origDbUrlDirect === undefined) delete process.env.DATABASE_URL_DIRECT;
    else process.env.DATABASE_URL_DIRECT = origDbUrlDirect;
  });

  it("rechaza --consensus > 1", async () => {
    process.argv = [
      "node",
      "backfill-fumigations-from-flights.js",
      "--consensus",
      "1.5",
    ];

    await expect(script.main()).rejects.toThrow(
      /--consensus debe estar entre 0 y 1/
    );
  });

  it("rechaza --consensus < 0", async () => {
    process.argv = [
      "node",
      "backfill-fumigations-from-flights.js",
      "--consensus",
      "-0.1",
    ];

    await expect(script.main()).rejects.toThrow(
      /--consensus debe estar entre 0 y 1/
    );
  });

  it("rechaza --consensus no numérico", async () => {
    process.argv = [
      "node",
      "backfill-fumigations-from-flights.js",
      "--consensus",
      "abc",
    ];

    await expect(script.main()).rejects.toThrow(
      /--consensus debe estar entre 0 y 1/
    );
  });

  it("rechaza --parcel si no es integer", async () => {
    process.argv = [
      "node",
      "backfill-fumigations-from-flights.js",
      "--parcel",
      "abc",
    ];

    await expect(script.main()).rejects.toThrow(/--parcel debe ser entero/);
  });

  it("rechaza --parcel si es float", async () => {
    process.argv = [
      "node",
      "backfill-fumigations-from-flights.js",
      "--parcel",
      "3.14",
    ];

    await expect(script.main()).rejects.toThrow(/--parcel debe ser entero/);
  });

  it("tira con mensaje claro si no hay DATABASE_URL ni DATABASE_URL_DIRECT", async () => {
    // Env vars ya borradas en beforeEach
    await withSuppressedLogs(() => script.main()).then(
      () => {
        throw new Error("main() debería haber tirado");
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toMatch(/DATABASE_URL.*is not configured/);
      }
    );
  });

  // NOTA sobre cobertura de main():
  //   Los 3 tests de arriba cubren la validación de flags y la falla
  //   temprana por falta de DATABASE_URL — que es lo que la spec del
  //   ticket pide. El flujo happy-path completo (BEGIN → inspect →
  //   backfill → COMMIT → release → end) NO se testea acá porque
  //   `vi.mock("pg")` no intercepta el `require("pg")` interno del
  //   script CJS: el `new Pool({...})` adentro de `createPool()` usa
  //   el módulo real e intenta conectar a Postgres. Esos paths están
  //   cubiertos indirectamente por los tests directos de
  //   `inspectCandidates()` y `backfill()` arriba, que ejercitan las
  //   mismas queries con un mock client controlado. Para un smoke
  //   end-to-end con BD real, ver el job `npm run smoke` o el
  //   `pipeline:djiag` en CI.
});
