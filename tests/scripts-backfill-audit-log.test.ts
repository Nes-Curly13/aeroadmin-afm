/**
 * tests/scripts-backfill-audit-log.test.ts
 *
 * Tests para el script de backfill de fumigation_audit_log.
 * Sprint 2026-08-18.
 *
 * Estrategia:
 *   - `parseArgs` se testea directo con arrays de argv.
 *   - `backfillSnapshot` se testea directo con objetos fumigation.
 *   - `backfillAuditLog` se testea con un mock client (no `pg` mock
 *     porque el script es CJS y el `require("pg")` interno no se
 *     intercepta con vi.mock — ver memory Mavis).
 *
 * No testeamos `main()` directamente por la misma razón.
 * La validación de flags (--dry-run, --limit, etc.) y el path de
 * "falta DATABASE_URL" se pueden testear parseando args / creando
 * un helper que no toque pg. La función main() real es una thin
 * wrapper que orquesta load + backfill + cleanup.
 */

import { describe, expect, it } from "vitest";
import {
  parseArgs,
  backfillSnapshot,
  backfillAuditLog
} from "../scripts/backfill-audit-log.js";

describe("parseArgs", () => {
  /**
   * Helper: corre parseArgs y devuelve el `error` cuando ok=false.
   * Helper en lugar de repetir `if (!r.ok) {...}` en cada test.
   */
  const expectErr = (argv: string[]): string => {
    const r = parseArgs(argv);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected ok=false");
    return r.error;
  };

  it("default: dryRun false, limit null", () => {
    const r = parseArgs([]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.opts.dryRun).toBe(false);
      expect(r.opts.limit).toBe(null);
    }
  });

  it("acepta --dry-run", () => {
    const r = parseArgs(["--dry-run"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.opts.dryRun).toBe(true);
    }
  });

  it("acepta --limit=N positivo", () => {
    const r = parseArgs(["--dry-run", "--limit=100"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.opts.limit).toBe(100);
      expect(r.opts.dryRun).toBe(true);
    }
  });

  it("rechaza --limit=0", () => {
    expect(expectErr(["--limit=0"])).toMatch(/--limit/);
  });

  it("rechaza --limit=abc (no numérico)", () => {
    expect(expectErr(["--limit=abc"])).toMatch(/--limit/);
  });

  it("rechaza --limit=-5", () => {
    expect(expectErr(["--limit=-5"])).toMatch(/--limit/);
  });

  it("rechaza flag desconocido", () => {
    expect(expectErr(["--foo"])).toMatch(/foo/);
  });

  it("rechaza argumento posicional", () => {
    expect(expectErr(["fumigation-123"])).toMatch(/posicional/);
  });

  it("--help devuelve ok=false con error='HELP' (caller imprime HELP y exit 0)", () => {
    expect(expectErr(["--help"])).toBe("HELP");
  });
});

describe("backfillSnapshot", () => {
  it("marca el snapshot con _backfill=true y kind correcto (fields para created)", () => {
    const f = {
      parcel_id: 42,
      fumigation_date: "2026-08-15",
      product_used: "Glifosato 48%",
      dose_l_per_ha: 2.5,
      area_fumigated_m2: 12345,
      drone_code_used: 201,
      duration_minutes: 45,
      notes: null,
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345",
      category_id: 1
    };
    const snap = backfillSnapshot(f, "fields");
    expect(snap._backfill).toBe(true);
    expect(snap._note).toMatch(/Reconstruido/);
    const fields = snap.fields as Record<string, unknown>;
    expect(fields.parcel_id).toBe(42);
    expect(fields.fumigation_date).toBe("2026-08-15");
    expect(fields.product_used).toBe("Glifosato 48%");
    expect(fields.notes).toBe(null);
  });

  it("usa 'snapshot' en vez de 'fields' cuando kind es deleted", () => {
    const f = {
      parcel_id: 42,
      fumigation_date: "2026-08-15",
      product_used: null,
      dose_l_per_ha: null
    };
    const snap = backfillSnapshot(f, "snapshot");
    expect(snap.snapshot).toBeDefined();
    expect(snap.fields).toBeUndefined();
    const inner = snap.snapshot as Record<string, unknown>;
    expect(inner.parcel_id).toBe(42);
  });

  it("normaliza undefined a null (jsonb-friendly)", () => {
    const f = {
      parcel_id: 1,
      fumigation_date: "2026-08-15"
      // product_used, dose_l_per_ha etc son undefined
    };
    const snap = backfillSnapshot(f, "fields");
    const fields = snap.fields as Record<string, unknown>;
    expect(fields.product_used).toBe(null);
    expect(fields.dose_l_per_ha).toBe(null);
  });
});

describe("backfillAuditLog", () => {
  /**
   * Construye un mock client que trackea las queries ejecutadas.
   * Usa 2 maps: `fumigations` (input data) y `audit` (output data,
   * para verificar idempotencia).
   */
  function makeMockClient({
    fumigations,
    auditBefore = []
  }: {
    fumigations: Array<Record<string, unknown>>;
    auditBefore?: Array<{ fumigation_id: number; action: string; actor_email: string; changes: unknown; created_at: string }>;
  }) {
    type AuditRow = {
      id: number;
      fumigation_id: number;
      action: string;
      actor_email: string;
      changes: unknown;
      created_at: string;
    };
    const audit = new Map<string, AuditRow>();
    for (const r of auditBefore) {
      audit.set(`${r.fumigation_id}-${r.action}`, { ...r, id: 0 });
    }
    const callLog: Array<{ sql: string; params: unknown[] }> = [];
    return {
      callLog,
      client: {
        async query(sql: string, params: unknown[]) {
          callLog.push({ sql: sql.trim(), params });
          // SELECT todas las fumigaciones (con o sin LIMIT)
          if (sql.trimStart().startsWith("SELECT") && sql.includes("dji_fumigations") && !sql.includes("fumigation_audit_log")) {
            // Respetar LIMIT si viene en params (mock del SQL behavior)
            if (params.length === 1 && Number.isInteger(params[0])) {
              return { rows: fumigations.slice(0, params[0] as number) };
            }
            return { rows: fumigations };
          }
          // SELECT EXISTS check
          if (sql.includes("FROM fumigation_audit_log") && sql.includes("LIMIT 1")) {
            const [fumigationId, action] = params;
            const exists = audit.has(`${fumigationId}-${action}`);
            return { rows: exists ? [{ "?column?": 1 }] : [] };
          }
          // INSERT
          if (sql.trimStart().startsWith("INSERT INTO fumigation_audit_log")) {
            const [fumigationId, action, actorEmail, changes, createdAt] = params as [number, string, string, string, string];
            const id = audit.size + 1;
            const row: AuditRow = {
              id,
              fumigation_id: fumigationId,
              action,
              actor_email: actorEmail,
              changes: JSON.parse(changes),
              created_at: createdAt
            };
            audit.set(`${fumigationId}-${action}`, row);
            return { rows: [row] };
          }
          throw new Error(`Mock client: SQL no manejada: ${sql.slice(0, 80)}`);
        }
      }
    };
  }

  it("happy path: 3 fumigaciones (1 activa, 1 soft-deleted, 1 con created previo)", async () => {
    const { client, callLog } = makeMockClient({
      fumigations: [
        {
          id: 1, recorded_at: "2026-01-01T10:00:00Z", recorded_by: "pilo@afm.local",
          deleted_at: null, deleted_by: null,
          parcel_id: 42, fumigation_date: "2026-01-01", product_used: "X",
          dose_l_per_ha: 2.0, area_fumigated_m2: 100, drone_code_used: 201,
          duration_minutes: 30, notes: null, product_registered_ica: null,
          pilot_license: null, category_id: 1
        },
        {
          id: 2, recorded_at: "2026-02-01T10:00:00Z", recorded_by: null,
          deleted_at: "2026-03-01T10:00:00Z", deleted_by: "admin@afm.local",
          parcel_id: 43, fumigation_date: "2026-02-01", product_used: "Y",
          dose_l_per_ha: 3.0, area_fumigated_m2: 200, drone_code_used: 201,
          duration_minutes: 40, notes: "test", product_registered_ica: "ICA-X",
          pilot_license: "PCA-X", category_id: null
        },
        {
          id: 3, recorded_at: "2026-03-01T10:00:00Z", recorded_by: "pilo@afm.local",
          deleted_at: null, deleted_by: null,
          parcel_id: 44, fumigation_date: "2026-03-01", product_used: "Z",
          dose_l_per_ha: 4.0, area_fumigated_m2: 300, drone_code_used: 201,
          duration_minutes: 50, notes: null, product_registered_ica: null,
          pilot_license: null, category_id: 2
        }
      ],
      auditBefore: [
        { fumigation_id: 3, action: "created", actor_email: "x", changes: {}, created_at: "2026-03-01" }
      ]
    });

    const stats = await backfillAuditLog(client, { dryRun: false });

    // Stats
    expect(stats.total).toBe(3);
    expect(stats.created_inserted).toBe(2);  // 1 y 2
    expect(stats.created_skipped).toBe(1);   // 3 ya existe
    expect(stats.deleted_inserted).toBe(1);  // 2 (soft-deleted)
    expect(stats.deleted_skipped).toBe(0);
    expect(stats.deleted_skipped_not_soft_deleted).toBe(2); // 1 y 3

    // 3 inserts (1+1+1) ejecutados
    const insertCalls = callLog.filter((c) => c.sql.startsWith("INSERT INTO fumigation_audit_log"));
    expect(insertCalls).toHaveLength(3);

    // Fumigation 1: created con actor "pilo@afm.local"
    const ins1 = insertCalls.find((c) => c.params[0] === 1 && c.params[1] === "created");
    expect(ins1).toBeDefined();
    if (!ins1) return;
    expect(ins1.params[2]).toBe("pilo@afm.local");
    expect(ins1.params[4]).toBe("2026-01-01T10:00:00Z");
    const changes1 = JSON.parse(ins1.params[3] as string) as Record<string, any>;
    expect(changes1._backfill).toBe(true);
    expect(changes1.fields.parcel_id).toBe(42);
    expect(changes1.fields.product_used).toBe("X");

    // Fumigation 2: created con actor "system@dji-import" (recorded_by NULL)
    const ins2 = insertCalls.find((c) => c.params[0] === 2 && c.params[1] === "created");
    expect(ins2).toBeDefined();
    if (!ins2) return;
    expect(ins2.params[2]).toBe("system@dji-import");
    expect(ins2.params[4]).toBe("2026-02-01T10:00:00Z");

    // Fumigation 2: deleted con actor "admin@afm.local" + deleted_at
    const ins2d = insertCalls.find((c) => c.params[0] === 2 && c.params[1] === "deleted");
    expect(ins2d).toBeDefined();
    if (!ins2d) return;
    expect(ins2d.params[2]).toBe("admin@afm.local");
    expect(ins2d.params[4]).toBe("2026-03-01T10:00:00Z");
    const changes2d = JSON.parse(ins2d.params[3] as string) as Record<string, any>;
    expect(changes2d.snapshot.parcel_id).toBe(43);

    // Fumigation 3: NO inserta created (ya existe) ni deleted (no soft-deleted)
    const ins3 = insertCalls.filter((c) => c.params[0] === 3);
    expect(ins3).toHaveLength(0);
  });

  it("idempotencia: segunda ejecución con mismos datos no inserta nada", async () => {
    const f = {
      id: 1, recorded_at: "2026-01-01T10:00:00Z", recorded_by: "pilo@afm.local",
      deleted_at: null, deleted_by: null,
      parcel_id: 42, fumigation_date: "2026-01-01", product_used: "X",
      dose_l_per_ha: 2.0, area_fumigated_m2: 100, drone_code_used: 201,
      duration_minutes: 30, notes: null, product_registered_ica: null,
      pilot_license: null, category_id: 1
    };
    const { client, callLog } = makeMockClient({ fumigations: [f] });

    // Primera corrida
    const stats1 = await backfillAuditLog(client, { dryRun: false });
    expect(stats1.created_inserted).toBe(1);
    expect(stats1.created_skipped).toBe(0);

    // Segunda corrida (mismo client, mismo Map)
    const stats2 = await backfillAuditLog(client, { dryRun: false });
    expect(stats2.created_inserted).toBe(0);
    expect(stats2.created_skipped).toBe(1);

    // Solo 1 INSERT ejecutado en total
    const inserts = callLog.filter((c) => c.sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(1);
  });

  it("--dry-run NO ejecuta INSERT (solo queries de lectura)", async () => {
    const f = {
      id: 1, recorded_at: "2026-01-01T10:00:00Z", recorded_by: "pilo@afm.local",
      deleted_at: null, deleted_by: null,
      parcel_id: 42, fumigation_date: "2026-01-01", product_used: "X",
      dose_l_per_ha: 2.0, area_fumigated_m2: 100, drone_code_used: 201,
      duration_minutes: 30, notes: null, product_registered_ica: null,
      pilot_license: null, category_id: 1
    };
    const { client, callLog } = makeMockClient({ fumigations: [f] });

    const stats = await backfillAuditLog(client, { dryRun: true });

    // Stats reportan el conteo pero sin tocar BD
    expect(stats.created_inserted).toBe(1);
    const inserts = callLog.filter((c) => c.sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(0);
  });

  it("--limit N solo procesa N fumigaciones (vía LIMIT en SQL)", async () => {
    const f = (id: number) => ({
      id, recorded_at: "2026-01-01T10:00:00Z", recorded_by: "pilo@afm.local",
      deleted_at: null, deleted_by: null,
      parcel_id: id, fumigation_date: "2026-01-01", product_used: "X",
      dose_l_per_ha: 2.0, area_fumigated_m2: 100, drone_code_used: 201,
      duration_minutes: 30, notes: null, product_registered_ica: null,
      pilot_license: null, category_id: 1
    });
    const fumigations = [f(1), f(2), f(3), f(4), f(5)];

    const { client, callLog } = makeMockClient({ fumigations });

    const stats = await backfillAuditLog(client, { dryRun: false, limit: 2 });

    expect(stats.total).toBe(2);
    // El LIMIT se pasa como $1 a la query
    const selectCall = callLog.find((c) => c.sql.includes("FROM dji_fumigations"));
    expect(selectCall).toBeDefined();
    if (!selectCall) return;
    expect(selectCall.params).toEqual([2]);
  });

  it("fumigación con deleted_by NULL usa fallback 'unknown@aeroadmin.local'", async () => {
    const f = {
      id: 1, recorded_at: "2026-01-01T10:00:00Z", recorded_by: "pilo@afm.local",
      deleted_at: "2026-03-01T10:00:00Z", deleted_by: null,
      parcel_id: 42, fumigation_date: "2026-01-01", product_used: "X",
      dose_l_per_ha: 2.0, area_fumigated_m2: 100, drone_code_used: 201,
      duration_minutes: 30, notes: null, product_registered_ica: null,
      pilot_license: null, category_id: 1
    };
    const { client, callLog } = makeMockClient({ fumigations: [f] });

    await backfillAuditLog(client, { dryRun: false });

    const ins = callLog.find(
      (c) => c.sql.startsWith("INSERT") && c.params[1] === "deleted"
    );
    expect(ins).toBeDefined();
    if (!ins) return;
    expect(ins.params[2]).toBe("unknown@aeroadmin.local");
  });
});
