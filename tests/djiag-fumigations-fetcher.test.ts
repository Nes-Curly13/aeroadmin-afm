// Tests para lib/djiag-fumigations-fetcher.js — parser puro de aggr_by_day.
//
// Usa el fixture REAL capturado el 2026-06-19 (11.7 KB, 30 dias).
// Casos cubiertos:
//   - parseAggrByDayResponse: shape completo, 30 dias, errores
//   - normalizeDay: campos derivados correctos (date, doseLPerHa, etc.)
//   - timestampToDateString: conversion UTC a YYYY-MM-DD
//   - computeDoseLPerHa: formula correcta, null safety, area=0
//   - dayToFumigationParams: mapeo a dji_fumigations, nulls para fields faltantes
//   - Iteracion sobre todos los 30 dias del fixture (regression: shape estable)

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseAggrByDayResponse,
  normalizeDay,
  dayToFumigationParams,
  timestampToDateString,
  computeDoseLPerHa,
  UPSERT_SQL,
  paramsToPgArray,
  ML_PER_L,
  M2_PER_HA
} from "@/lib/djiag-fumigations-fetcher";

function loadFixture(): { url: string; body: any } {
  const p = join(process.cwd(), "tests", "fixtures", "djiag-live", "flight-response-04-aggr_by_day-p1.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("djiag-fumigations-fetcher — timestampToDateString", () => {
  it("convierte segundos UTC a YYYY-MM-DD", () => {
    // 2026-06-19 00:00:00 UTC = 1781884800
    expect(timestampToDateString(1781884800)).toBe("2026-06-19");
    // 2026-01-01 00:00:00 UTC = 1767225600
    expect(timestampToDateString(1767225600)).toBe("2026-01-01");
  });

  it("ignora la hora del día (solo fecha)", () => {
    // Mismo día, distinta hora → misma fecha
    const morning = new Date("2026-06-19T08:30:00Z").getTime() / 1000;
    const evening = new Date("2026-06-19T22:30:00Z").getTime() / 1000;
    expect(timestampToDateString(morning)).toBe("2026-06-19");
    expect(timestampToDateString(evening)).toBe("2026-06-19");
  });
});

describe("djiag-fumigations-fetcher — computeDoseLPerHa", () => {
  it("caso del fixture: 54571 mL / 4668 m² ≈ 116.9 L/ha", () => {
    const result = computeDoseLPerHa(54571, 4668);
    // 54571 mL = 54.571 L, 4668 m² = 0.4668 ha
    // 54.571 / 0.4668 = 116.91
    expect(result).toBeCloseTo(116.91, 1);
  });

  it("formula: L/ha = (mL * 10) / m²", () => {
    // 1000 mL en 10000 m² = 1 L/ha
    expect(computeDoseLPerHa(1000, 10000)).toBeCloseTo(1.0, 2);
    // 10000 mL en 10000 m² = 10 L/ha
    expect(computeDoseLPerHa(10000, 10000)).toBeCloseTo(10.0, 2);
  });

  it("null safety: area=0, area=null, spray=null → null", () => {
    expect(computeDoseLPerHa(1000, 0)).toBeNull();
    expect(computeDoseLPerHa(1000, null)).toBeNull();
    expect(computeDoseLPerHa(null, 1000)).toBeNull();
    expect(computeDoseLPerHa(null, null)).toBeNull();
  });
});

describe("djiag-fumigations-fetcher — normalizeDay", () => {
  it("deriva date, workTimeMin, sprayUsageL, doseLPerHa", () => {
    const day = normalizeDay({
      create_timestamp: 1781884800,
      work_area: 4668,
      work_times: 4,
      work_time: 1180800,
      spray_usage: 54571,
      sow_usage: 0
    });

    expect(day.createTimestamp).toBe(1781884800);
    expect(day.date).toBe("2026-06-19");
    expect(day.workAreaM2).toBe(4668);
    expect(day.workTimeSec).toBe(1180800);
    expect(day.workTimeMin).toBe(19680);  // 1180800 / 60
    expect(day.sortieCount).toBe(4);
    expect(day.sprayUsageMl).toBe(54571);
    expect(day.sprayUsageL).toBeCloseTo(54.571, 3);
    expect(day.doseLPerHa).toBeCloseTo(116.91, 1);
    expect(day.hasAgriculture).toBe(true);
  });

  it("hasAgriculture = false si ag.sortie_count = 0", () => {
    const day = normalizeDay({
      create_timestamp: 1781884800,
      work_area: 0,
      work_times: 0,
      work_time: 0,
      spray_usage: 0,
      sow_usage: 0,
      ag: { sortie_count: 0 }
    });
    expect(day.hasAgriculture).toBe(false);
  });

  it("lanza si raw no es objeto", () => {
    expect(() => normalizeDay(null)).toThrow();
    expect(() => normalizeDay("string")).toThrow();
  });
});

describe("djiag-fumigations-fetcher — parseAggrByDayResponse (fixture real)", () => {
  it("parsea 30 días del fixture", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);

    expect(parsed.days).toHaveLength(30);
    expect(parsed.hasNextPage).toBe(true);  // 30 >= 30 → asumimos hay mas
  });

  it("los 30 días están ordenados DESC por timestamp", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);

    for (let i = 1; i < parsed.days.length; i++) {
      const prev = parsed.days[i - 1].createTimestamp!;
      const curr = parsed.days[i].createTimestamp!;
      expect(curr).toBeLessThan(prev);
    }
  });

  it("todos los días tienen data del bloque ag (no delivery)", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);

    for (const day of parsed.days) {
      expect(day.hasAgriculture).toBe(true);
      expect(day.sortieCount).toBeGreaterThan(0);
      expect(day.workAreaM2).toBeGreaterThan(0);
    }
  });

  it("el primer día es 2026-06-19 (fecha de la captura)", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);

    expect(parsed.days[0].date).toBe("2026-06-19");
  });

  it("los días consecutivos del fixture son 30 (con posibles gaps en data)", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);

    // El fixture tiene 30 entries, pero el span puede ser > 29 días si DJI
    // omitió días sin fumigación. Asumimos que el span es >= 28 y <= 35.
    const first = new Date(parsed.days[0].date!);
    const last = new Date(parsed.days[parsed.days.length - 1].date!);
    const diffDays = Math.round((first.getTime() - last.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(28);
    expect(diffDays).toBeLessThanOrEqual(35);
  });

  it("errores: response no es objeto, data.aggr_info no es array", () => {
    expect(() => parseAggrByDayResponse(null)).toThrow();
    expect(() => parseAggrByDayResponse({})).toThrow();
    expect(() => parseAggrByDayResponse({ data: {} })).toThrow(/aggr_info/);
  });
});

describe("djiag-fumigations-fetcher — dayToFumigationParams", () => {
  it("mapea un día normalizado a params para dji_fumigations", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);
    const day = parsed.days[0];
    const p = dayToFumigationParams(day);

    expect(p.fumigationDate).toBe("2026-06-19");
    expect(p.parcelId).toBeNull();            // limitación del aggregate
    expect(p.droneCodeUsed).toBeNull();       // limitación del aggregate
    expect(p.productUsed).toBeNull();         // DJI no expone
    expect(p.areaFumigatedM2).toBeGreaterThan(0);
    expect(p.durationMinutes).toBeGreaterThan(0);
    expect(p.doseLPerHa).toBeGreaterThan(0);
    expect(p.recordedBy).toBe("djiag-import");
    expect(p.source).toBe("import");
  });

  it("notes incluye metadata del aggregate (sortieCount, sprayUsageMl, etc.)", () => {
    const fixture = loadFixture();
    const parsed = parseAggrByDayResponse(fixture.body);
    const day = parsed.days[0];
    const p = dayToFumigationParams(day);

    const notes = JSON.parse(p.notes!);
    expect(notes.source).toBe("djiscraper-aggr-by-day");
    expect(notes.sortieCount).toBeGreaterThan(0);
    expect(notes.sprayUsageMl).toBeGreaterThan(0);
    expect(notes.createTimestamp).toBeGreaterThan(0);
  });
});

describe("djiag-fumigations-fetcher — constantes de unidades", () => {
  it("1 L = 1000 mL, 1 ha = 10000 m²", () => {
    expect(ML_PER_L).toBe(1000);
    expect(M2_PER_HA).toBe(10000);
  });
});

describe("djiag-fumigations-fetcher — UPSERT_SQL", () => {
  it("tiene 10 placeholders ($1..$10)", () => {
    const matches = UPSERT_SQL.match(/\$\d+/g) ?? [];
    expect(matches.length).toBe(10);
    for (let i = 1; i <= 10; i++) {
      expect(matches).toContain(`$${i}`);
    }
  });

  it("usa ON CONFLICT con partial index predicate (parcel_id IS NULL)", () => {
    expect(UPSERT_SQL).toMatch(/ON CONFLICT \(fumigation_date, source\) WHERE parcel_id IS NULL/);
  });

  it("el DO UPDATE no pisa campos de identidad ni los nulls intencionales", () => {
    // fumigation_date y source son el conflict target, no se actualizan
    expect(UPSERT_SQL).not.toMatch(/fumigation_date\s*=\s*EXCLUDED/);
    expect(UPSERT_SQL).not.toMatch(/\bsource\s*=\s*EXCLUDED/);
    // parcel_id sigue null (no lo pisamos con EXCLUDED.parcel_id)
    expect(UPSERT_SQL).not.toMatch(/parcel_id\s*=\s*EXCLUDED/);
  });

  it("el DO UPDATE sí actualiza los stats (area, duration, dose, notes)", () => {
    expect(UPSERT_SQL).toMatch(/area_fumigated_m2\s*=\s*EXCLUDED\.area_fumigated_m2/);
    expect(UPSERT_SQL).toMatch(/duration_minutes\s*=\s*EXCLUDED\.duration_minutes/);
    expect(UPSERT_SQL).toMatch(/dose_l_per_ha\s*=\s*EXCLUDED\.dose_l_per_ha/);
    expect(UPSERT_SQL).toMatch(/notes\s*=\s*EXCLUDED\.notes/);
  });
});

describe("djiag-fumigations-fetcher — paramsToPgArray", () => {
  it("orden exacto de 10 valores", () => {
    const p = {
      fumigationDate: "2026-06-19",
      parcelId: null,
      droneCodeUsed: null,
      productUsed: null,
      areaFumigatedM2: 4668,
      durationMinutes: 19680,
      doseLPerHa: 116.91,
      notes: '{"foo":"bar"}',
      recordedBy: "djiag-import",
      source: "import"
    };
    const arr = paramsToPgArray(p);
    expect(arr).toHaveLength(10);
    expect(arr[0]).toBe("2026-06-19");   // $1 fumigation_date
    expect(arr[1]).toBeNull();           // $2 parcel_id (null para aggregate)
    expect(arr[2]).toBeNull();           // $3 drone_code_used (null por ahora)
    expect(arr[3]).toBeNull();           // $4 product_used (null por ahora)
    expect(arr[4]).toBe(4668);           // $5 area_fumigated_m2
    expect(arr[5]).toBe(19680);          // $6 duration_minutes
    expect(arr[6]).toBe(116.91);         // $7 dose_l_per_ha
    expect(arr[7]).toBe('{"foo":"bar"}'); // $8 notes
    expect(arr[8]).toBe("djiag-import"); // $9 recorded_by
    expect(arr[9]).toBe("import");       // $10 source
  });
});
