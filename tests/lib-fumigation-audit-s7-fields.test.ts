/**
 * tests/lib-fumigation-audit-s7-fields.test.ts
 *
 * Tests de la extensión S7 (feature/s7-schema-extension / Fase 0) sobre
 * los helpers de audit en lib/fumigation-audit.ts:
 *   - FUMIGATION_EDITABLE_FIELDS incluye "application_type_id"
 *   - FUMIGATION_SNAPSHOT_FIELDS incluye "application_type_id"
 *   - fumigationAuditSnapshot incluye application_type_id
 *   - fumigationAuditDiff captura cambios de application_type_id
 *
 * El check de inclusion en los arrays es importante porque el caller
 * (`recordFumigationEdit` y `recordFumigationDelete`) itera sobre esos
 * arrays para armar el payload. Si "application_type_id" no esta, las
 * ediciones al campo NO quedan en el audit log.
 *
 * Sprint: feature/s7-schema-extension (2026-08-24) / Fase 0.
 */

import { describe, expect, it } from "vitest";
import {
  FUMIGATION_EDITABLE_FIELDS,
  FUMIGATION_SNAPSHOT_FIELDS,
  fumigationAuditDiff,
  fumigationAuditSnapshot
} from "@/lib/fumigation-audit";
import type { DjiFumigationEvent } from "@/lib/types";

describe("FUMIGATION_EDITABLE_FIELDS extension S7", () => {
  it('incluye "application_type_id"', () => {
    expect(FUMIGATION_EDITABLE_FIELDS).toContain("application_type_id");
  });

  it("NO incluye campos inmutables (parcel_id, source, deleted_at)", () => {
    expect(FUMIGATION_EDITABLE_FIELDS).not.toContain("parcel_id");
    expect(FUMIGATION_EDITABLE_FIELDS).not.toContain("source");
    expect(FUMIGATION_EDITABLE_FIELDS).not.toContain("deleted_at");
    expect(FUMIGATION_EDITABLE_FIELDS).not.toContain("deleted_by");
  });
});

describe("FUMIGATION_SNAPSHOT_FIELDS extension S7", () => {
  it('incluye "application_type_id"', () => {
    expect(FUMIGATION_SNAPSHOT_FIELDS).toContain("application_type_id");
  });

  it("incluye parcel_id (para que el snapshot de delete muestre la parcela)", () => {
    expect(FUMIGATION_SNAPSHOT_FIELDS).toContain("parcel_id");
  });
});

describe("fumigationAuditSnapshot con application_type_id", () => {
  it("incluye application_type_id en el snapshot", () => {
    const fum = {
      id: 1,
      parcel_id: 100,
      fumigation_date: "2026-07-15",
      application_type_id: 2, // post_emergente
      product_used: "Glifosato",
      category_id: 1
    } as unknown as DjiFumigationEvent;

    const snap = fumigationAuditSnapshot(fum);

    expect(snap.application_type_id).toBe(2);
  });

  it("devuelve null (no undefined) si application_type_id no esta seteado", () => {
    const fum = {
      id: 1,
      parcel_id: 100,
      fumigation_date: "2026-07-15",
      application_type_id: null
    } as unknown as DjiFumigationEvent;

    const snap = fumigationAuditSnapshot(fum);

    expect(snap).toHaveProperty("application_type_id");
    expect(snap.application_type_id).toBeNull();
  });
});

describe("fumigationAuditDiff con application_type_id", () => {
  it("captura cambio null → 2 (post_emergente) en application_type_id", () => {
    const before = {
      id: 1,
      application_type_id: null
    } as unknown as DjiFumigationEvent;
    const after = {
      id: 1,
      application_type_id: 2
    } as unknown as DjiFumigationEvent;

    const d = fumigationAuditDiff(before, after);

    expect(d).toHaveProperty("application_type_id");
    expect(d.application_type_id).toEqual({ from: null, to: 2 });
  });

  it("captura cambio 1 → 3 (pre_emergente → bioestimulante)", () => {
    const before = {
      id: 1,
      application_type_id: 1
    } as unknown as DjiFumigationEvent;
    const after = {
      id: 1,
      application_type_id: 3
    } as unknown as DjiFumigationEvent;

    const d = fumigationAuditDiff(before, after);

    expect(d.application_type_id).toEqual({ from: 1, to: 3 });
  });

  it("NO incluye application_type_id en la diff si no cambió", () => {
    const before = {
      id: 1,
      application_type_id: 1
    } as unknown as DjiFumigationEvent;
    const after = {
      id: 1,
      application_type_id: 1
    } as unknown as DjiFumigationEvent;

    const d = fumigationAuditDiff(before, after);

    expect(d).not.toHaveProperty("application_type_id");
  });
});
