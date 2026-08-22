// @vitest-environment node
//
// Tests para scripts/upsert-fumigations-from-djiag.js — focus en el
// audit log hook (sprint feat/pipeline-audit-integration, 2026-08-22).
//
// Estrategia:
//   - Mockear `pg` con `vi.mock` (factory) para inyectar un Pool + client
//     controlable. Los tests NO tocan una BD real.
//   - Tests directos de `upsertFumigations(client, days)` pasando un mock
//     client que simula el RETURNING del UPSERT (con `inserted: true`
//     o `inserted: false`) y captura el INSERT en `fumigation_audit_log`.
//   - Tests de las funciones puras `buildCreatedSnapshot` y los
//     exported SQL constants.
//
// Verificamos:
//   * Cuando el UPSERT INSERTA una fila nueva → llama
//     `recordFumigationCreate` con actor_email del row.recorded_by
//     y el snapshot correcto.
//   * Cuando el UPSERT solo ACTUALIZA (ON CONFLICT) → NO llama
//     `recordFumigationCreate` (idempotencia, no duplica audit).
//   * Si row.recorded_by es NULL → usa fallback 'system@dji-import'.
//   * Si el INSERT de audit falla → fire-and-forget (no rompe el
//     pipeline, sigue con el siguiente day).
//
// NO testeamos:
//   - Conexión real a Postgres (lo hace el smoke test en CI).
//   - `main()` (BEGIN/COMMIT) end-to-end: `vi.mock("pg")` no intercepta
//     el `require("pg")` interno del script CJS (ver nota en
//     tests/scripts-backfill-fumigations-from-flights.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

// ============================================================
// Mocks
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
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.end.mockResolvedValue(undefined);
  const PoolMock = vi.fn().mockImplementation(() => mockPool);
  return { mockClient, mockPool, PoolMock };
});

vi.mock("pg", () => ({
  Pool: PoolMock,
}));

const require_ = createRequire(import.meta.url);

type AnyClient = any;
type AnyRow = Record<string, any>;

const script = require_(
  "../scripts/upsert-fumigations-from-djiag.js"
) as unknown as {
  upsertFumigations: (client: AnyClient, days: AnyRow[]) => Promise<{
    upserted: number;
    inserted: number;
    updated: number;
    auditInserted: number;
    auditFailed: number;
    errors: number;
  }>;
  recordFumigationCreate: (client: AnyClient, row: AnyRow, actor: string) => Promise<void>;
  buildCreatedSnapshot: (row: AnyRow) => Record<string, unknown>;
  FUMIGATION_SNAPSHOT_FIELDS: readonly string[];
  ACTOR_SYSTEM_IMPORT: string;
  SQL_INSERT_AUDIT: string;
};

// ============================================================
// Helpers
// ============================================================

function resetMocks() {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
  mockPool.end.mockClear();
  PoolMock.mockClear();
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.end.mockResolvedValue(undefined);
}

/** Captura todas las queries y las clasifica por tipo. */
function getCallLog(): Array<{ sql: string; params: any[] }> {
  return mockClient.query.mock.calls.map(([sql, params]) => ({
    sql: typeof sql === "string" ? sql.trim() : "<non-string>",
    params: (params ?? []) as any[],
  }));
}

/** Devuelve la primera INSERT en fumigation_audit_log. */
function findAuditInsert(): { sql: string; params: any[] } | undefined {
  return getCallLog().find((c) =>
    c.sql.startsWith("INSERT INTO fumigation_audit_log")
  );
}

/** Devuelve todas las INSERTs en fumigation_audit_log. */
function findAllAuditInserts(): Array<{ sql: string; params: any[] }> {
  return getCallLog().filter((c) =>
    c.sql.startsWith("INSERT INTO fumigation_audit_log")
  );
}

/** Configura el mock para que el UPSERT devuelva `inserted` true/false. */
function setupUpsertMocks(opts: {
  inserted: boolean;
  row?: AnyRow;
} = { inserted: true }) {
  const row = opts.row ?? {
    id: 42,
    parcel_id: null,
    fumigation_date: "2026-08-22",
    product_used: null,
    dose_l_per_ha: 1.5,
    area_fumigated_m2: 1000,
    drone_code_used: null,
    duration_minutes: 30,
    notes: '{"source":"djiscraper"}',
    human_notes: null,
    recorded_by: "djiag-import",
    product_registered_ica: null,
    pilot_license: null,
    category_id: null,
    deleted_at: null,
    flight_ids: null,
    source: "import",
    inserted: opts.inserted,
  };
  mockClient.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
}

const sampleDay = {
  createTimestamp: 1781884800,
  date: "2026-08-22",
  workAreaM2: 1000,
  workTimeSec: 1800,
  workTimeMin: 30,
  sortieCount: 2,
  sprayUsageMl: 100,
  sprayUsageL: 0.1,
  doseLPerHa: 1.5,
  hasAgriculture: true,
};

// ============================================================
// Tests: buildCreatedSnapshot (pure function)
// ============================================================

describe("scripts/upsert-fumigations-from-djiag — buildCreatedSnapshot", () => {
  it("incluye los 11 campos snapshot con valores del row", () => {
    const row = {
      parcel_id: 7,
      fumigation_date: "2026-08-22",
      product_used: "Glifosato",
      dose_l_per_ha: 2.0,
      area_fumigated_m2: 1234,
      drone_code_used: 201,
      duration_minutes: 45,
      notes: "test",
      product_registered_ica: "ICA-1",
      pilot_license: "PCA-1",
      category_id: 3,
    };
    const snap = script.buildCreatedSnapshot(row);
    expect(snap.fields).toBeDefined();
    const fields = snap.fields as Record<string, unknown>;
    expect(fields.parcel_id).toBe(7);
    expect(fields.fumigation_date).toBe("2026-08-22");
    expect(fields.product_used).toBe("Glifosato");
    expect(fields.dose_l_per_ha).toBe(2.0);
    expect(fields.area_fumigated_m2).toBe(1234);
    expect(fields.drone_code_used).toBe(201);
    expect(fields.duration_minutes).toBe(45);
    expect(fields.notes).toBe("test");
    expect(fields.product_registered_ica).toBe("ICA-1");
    expect(fields.pilot_license).toBe("PCA-1");
    expect(fields.category_id).toBe(3);
  });

  it("normaliza nulls a null (jsonb-friendly)", () => {
    const row = { parcel_id: 1, fumigation_date: "2026-08-22" };
    const snap = script.buildCreatedSnapshot(row);
    const fields = snap.fields as Record<string, unknown>;
    expect(fields.product_used).toBe(null);
    expect(fields.dose_l_per_ha).toBe(null);
    expect(fields.area_fumigated_m2).toBe(null);
  });

  it("FUMIGATION_SNAPSHOT_FIELDS contiene los 11 campos esperados", () => {
    expect(script.FUMIGATION_SNAPSHOT_FIELDS).toEqual([
      "parcel_id",
      "fumigation_date",
      "product_used",
      "dose_l_per_ha",
      "area_fumigated_m2",
      "drone_code_used",
      "duration_minutes",
      "notes",
      "product_registered_ica",
      "pilot_license",
      "category_id",
    ]);
  });

  it("ACTOR_SYSTEM_IMPORT es 'system@dji-import'", () => {
    expect(script.ACTOR_SYSTEM_IMPORT).toBe("system@dji-import");
  });
});

// ============================================================
// Tests: recordFumigationCreate (la parte del hook)
// ============================================================

describe("scripts/upsert-fumigations-from-djiag — recordFumigationCreate", () => {
  beforeEach(() => resetMocks());

  it("inserta evento 'created' con actor y snapshot del row", async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const row = {
      id: 99,
      parcel_id: 7,
      fumigation_date: "2026-08-22",
      product_used: null,
      dose_l_per_ha: 1.5,
      area_fumigated_m2: 500,
      drone_code_used: null,
      duration_minutes: 15,
      notes: null,
      product_registered_ica: null,
      pilot_license: null,
      category_id: null,
    };
    await script.recordFumigationCreate(mockClient, row, "djiag-import");

    const audit = findAuditInsert();
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(audit.sql).toMatch(/INSERT INTO fumigation_audit_log/);
    expect(audit.params[0]).toBe(99);                 // fumigation_id
    expect(audit.params[1]).toBe("created");          // action
    expect(audit.params[2]).toBe("djiag-import");     // actor_email
    const changes = JSON.parse(audit.params[3]);
    expect(changes.fields.parcel_id).toBe(7);
    expect(changes.fields.fumigation_date).toBe("2026-08-22");
    expect(changes.fields.area_fumigated_m2).toBe(500);
  });

  it("cae al fallback 'system@dji-import' cuando actorEmail es vacío", async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const row = { id: 100, parcel_id: null, fumigation_date: "2026-08-22" };
    await script.recordFumigationCreate(mockClient, row, "");

    const audit = findAuditInsert();
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(audit.params[2]).toBe("system@dji-import");
  });

  it("fire-and-forget: NO rompe si el INSERT de audit falla (devuelve false)", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("audit table missing"));
    // Silenciar console.warn durante este test
    const origWarn = console.warn;
    console.warn = vi.fn();

    const row = { id: 101, parcel_id: null, fumigation_date: "2026-08-22" };
    // No debe tirar — el error se loguea, se swallowea, y devuelve false
    // para que el caller (upsertFumigations) pueda contar el fallo.
    const result = await script.recordFumigationCreate(
      mockClient,
      row,
      "djiag-import"
    );
    expect(result).toBe(false);

    console.warn = origWarn;
  });

  it("devuelve true cuando el INSERT de audit tiene éxito", async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const row = { id: 102, parcel_id: null, fumigation_date: "2026-08-22" };
    const result = await script.recordFumigationCreate(
      mockClient,
      row,
      "djiag-import"
    );
    expect(result).toBe(true);
  });

  it("SQL_INSERT_AUDIT tiene 4 placeholders ($1..$4) en el orden correcto", () => {
    const matches = script.SQL_INSERT_AUDIT.match(/\$\d+/g) ?? [];
    expect(matches.length).toBe(4);
    for (let i = 1; i <= 4; i++) {
      expect(matches).toContain(`$${i}`);
    }
    // Orden: fumigation_id, action, actor_email, changes
    expect(script.SQL_INSERT_AUDIT).toMatch(
      /\(fumigation_id, action, actor_email, changes\)\s+VALUES\s+\(\$1, \$2, \$3, \$4::jsonb\)/
    );
  });
});

// ============================================================
// Tests: upsertFumigations (flujo completo)
// ============================================================

describe("scripts/upsert-fumigations-from-djiag — upsertFumigations (INSERT case)", () => {
  beforeEach(() => resetMocks());

  it("registra audit 'created' cuando UPSERT inserta fila nueva (inserted=true)", async () => {
    setupUpsertMocks({ inserted: true });

    const stats = await script.upsertFumigations(mockClient, [sampleDay]);

    // Stats
    expect(stats.upserted).toBe(1);
    expect(stats.inserted).toBe(1);
    expect(stats.updated).toBe(0);
    expect(stats.auditInserted).toBe(1);
    expect(stats.auditFailed).toBe(0);
    expect(stats.errors).toBe(0);

    // Verificar el INSERT de audit
    const audit = findAuditInsert();
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(audit.params[0]).toBe(42);              // fumigation_id del row
    expect(audit.params[1]).toBe("created");
    expect(audit.params[2]).toBe("djiag-import");  // row.recorded_by
  });

  it("usa 'system@dji-import' si row.recorded_by es NULL", async () => {
    setupUpsertMocks({
      inserted: true,
      row: {
        id: 50,
        parcel_id: null,
        fumigation_date: "2026-08-22",
        product_used: null,
        dose_l_per_ha: 1.0,
        area_fumigated_m2: 100,
        drone_code_used: null,
        duration_minutes: 10,
        notes: null,
        human_notes: null,
        recorded_by: null,  // ← clave
        product_registered_ica: null,
        pilot_license: null,
        category_id: null,
        deleted_at: null,
        flight_ids: null,
        source: "import",
        inserted: true,
      },
    });

    const stats = await script.upsertFumigations(mockClient, [sampleDay]);
    expect(stats.auditInserted).toBe(1);

    const audit = findAuditInsert();
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(audit.params[2]).toBe("system@dji-import");
  });
});

describe("scripts/upsert-fumigations-from-djiag — upsertFumigations (UPDATE case / idempotencia)", () => {
  beforeEach(() => resetMocks());

  it("NO registra audit cuando UPSERT solo actualiza (inserted=false)", async () => {
    setupUpsertMocks({ inserted: false });

    const stats = await script.upsertFumigations(mockClient, [sampleDay]);

    // Stats
    expect(stats.upserted).toBe(1);
    expect(stats.inserted).toBe(0);
    expect(stats.updated).toBe(1);
    expect(stats.auditInserted).toBe(0);

    // No debe haber INSERT en fumigation_audit_log
    const audit = findAuditInsert();
    expect(audit).toBeUndefined();
    expect(findAllAuditInserts()).toHaveLength(0);
  });

  it("idempotencia: 2 corridas con mismos datos → 1 audit event total", async () => {
    // Primera corrida: INSERT
    setupUpsertMocks({ inserted: true });
    const stats1 = await script.upsertFumigations(mockClient, [sampleDay]);
    expect(stats1.auditInserted).toBe(1);

    // Segunda corrida: UPDATE (mismo day, ya existe en BD)
    setupUpsertMocks({ inserted: false });
    const stats2 = await script.upsertFumigations(mockClient, [sampleDay]);
    expect(stats2.auditInserted).toBe(0);
    expect(stats2.updated).toBe(1);

    // Solo 1 INSERT en fumigation_audit_log en total
    expect(findAllAuditInserts()).toHaveLength(1);
  });

  it("mezcla INSERT + UPDATE en una sola corrida: solo INSERTs van al audit", async () => {
    // Day 1: INSERT (UPSERT + audit INSERT)
    // Day 2: UPDATE (solo UPSERT, no audit)
    let upsertCallCount = 0;
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO fumigation_audit_log")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      upsertCallCount += 1;
      // Primera llamada UPSERT → INSERT, segunda → UPDATE
      const inserted = upsertCallCount === 1;
      return Promise.resolve({
        rows: [
          {
            id: 42,
            parcel_id: null,
            fumigation_date: "2026-08-22",
            product_used: null,
            dose_l_per_ha: 1.5,
            area_fumigated_m2: 1000,
            drone_code_used: null,
            duration_minutes: 30,
            notes: '{"source":"djiscraper"}',
            human_notes: null,
            recorded_by: "djiag-import",
            product_registered_ica: null,
            pilot_license: null,
            category_id: null,
            deleted_at: null,
            flight_ids: null,
            source: "import",
            inserted,
          },
        ],
        rowCount: 1,
      });
    });

    const stats = await script.upsertFumigations(mockClient, [
      { ...sampleDay, date: "2026-08-22" },
      { ...sampleDay, date: "2026-08-23" },
    ]);

    expect(stats.upserted).toBe(2);
    expect(stats.inserted).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.auditInserted).toBe(1);
    expect(findAllAuditInserts()).toHaveLength(1);
  });
});

describe("scripts/upsert-fumigations-from-djiag — upsertFumigations (errores)", () => {
  beforeEach(() => resetMocks());

  it("cuenta el day como error si no tiene date (skip silencioso)", async () => {
    const stats = await script.upsertFumigations(mockClient, [
      { createTimestamp: 12345 },  // sin date
    ]);
    expect(stats.errors).toBe(1);
    expect(stats.upserted).toBe(0);
    expect(findAllAuditInserts()).toHaveLength(0);
  });

  it("continúa con el siguiente day si el UPSERT falla", async () => {
    mockClient.query
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1, parcel_id: null, fumigation_date: "2026-08-22",
            product_used: null, dose_l_per_ha: 1, area_fumigated_m2: 100,
            drone_code_used: null, duration_minutes: 10, notes: null,
            human_notes: null, recorded_by: "djiag-import",
            product_registered_ica: null, pilot_license: null, category_id: null,
            deleted_at: null, flight_ids: null, source: "import",
            inserted: true,
          },
        ],
        rowCount: 1,
      });

    // Silenciar console.error durante este test
    const origError = console.error;
    console.error = vi.fn();

    const stats = await script.upsertFumigations(mockClient, [
      { ...sampleDay, date: "2026-08-21" },
      { ...sampleDay, date: "2026-08-22" },
    ]);

    expect(stats.errors).toBe(1);     // primer day falló
    expect(stats.upserted).toBe(1);   // segundo day OK
    expect(stats.auditInserted).toBe(1);  // y se registró audit

    console.error = origError;
  });

  it("fire-and-forget: si el INSERT de audit falla, el día cuenta como OK (auditFailed++)", async () => {
    // UPSERT OK con inserted=true
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1, parcel_id: null, fumigation_date: "2026-08-22",
          product_used: null, dose_l_per_ha: 1, area_fumigated_m2: 100,
          drone_code_used: null, duration_minutes: 10, notes: null,
          human_notes: null, recorded_by: "djiag-import",
          product_registered_ica: null, pilot_license: null, category_id: null,
          deleted_at: null, flight_ids: null, source: "import",
          inserted: true,
        },
      ],
      rowCount: 1,
    });
    // INSERT audit falla
    mockClient.query.mockRejectedValueOnce(new Error("audit table missing"));

    const origWarn = console.warn;
    console.warn = vi.fn();

    const stats = await script.upsertFumigations(mockClient, [sampleDay]);
    expect(stats.upserted).toBe(1);
    expect(stats.auditInserted).toBe(0);
    expect(stats.auditFailed).toBe(1);

    console.warn = origWarn;
  });
});
