// Tests del agregador dji_fumigations -> DjiAlertRecord (v1.6).
//
// Helpers puros — sin BD ni browser. Misma estructura que
// tests/dji-flights-aggregate.test.ts.

import { describe, expect, it } from "vitest";

import {
  aggregateFumigationsByParcelAndDay,
  buildAlertFromFumigation,
  buildAlertsFromFumigations,
  getAlertLevelFromFumigations,
  type FumigationRow
} from "@/lib/dji-fumigations-aggregate";

function makeFumigation(over: Partial<FumigationRow>): FumigationRow {
  return {
    id: 1,
    parcel_id: 100,
    fumigation_date: "2026-07-15",
    area_fumigated_m2: 5000,
    duration_minutes: 30,
    dose_l_per_ha: 1.5,
    parcel_name: "Lote Centro",
    ...over
  };
}

describe("getAlertLevelFromFumigations (v1.6)", () => {
  // Mismos thresholds que getAlertLevel en lib/alerts.ts. Si se cambian
  // los del viejo, hay que cambiar estos. v1.6 NO recalibra — solo cambia
  // la fuente.
  it("HIGH cuando area_mu >= 60", () => {
    expect(getAlertLevelFromFumigations(60, 1)).toBe("HIGH");
    expect(getAlertLevelFromFumigations(80, 1)).toBe("HIGH");
  });
  it("HIGH cuando times_count >= 80", () => {
    expect(getAlertLevelFromFumigations(1, 80)).toBe("HIGH");
    expect(getAlertLevelFromFumigations(1, 100)).toBe("HIGH");
  });
  it("MEDIUM cuando area_mu >= 30 y < 60", () => {
    expect(getAlertLevelFromFumigations(30, 1)).toBe("MEDIUM");
    expect(getAlertLevelFromFumigations(59, 1)).toBe("MEDIUM");
  });
  it("MEDIUM cuando times_count >= 40 y < 80", () => {
    expect(getAlertLevelFromFumigations(1, 40)).toBe("MEDIUM");
    expect(getAlertLevelFromFumigations(1, 79)).toBe("MEDIUM");
  });
  it("LOW cuando ambos están por debajo del threshold MEDIUM", () => {
    expect(getAlertLevelFromFumigations(29, 39)).toBe("LOW");
    expect(getAlertLevelFromFumigations(0, 0)).toBe("LOW");
  });
});

describe("aggregateFumigationsByParcelAndDay (v1.6)", () => {
  it("agrupa 2 eventos del mismo (parcela, dia) en 1 row con times_count=2", () => {
    const rows = [
      makeFumigation({ id: 1, area_fumigated_m2: 5000, duration_minutes: 20 }),
      makeFumigation({ id: 2, area_fumigated_m2: 3000, duration_minutes: 15 })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      parcel_id: 100,
      parcel_name: "Lote Centro",
      fumigation_date: "2026-07-15",
      times_count: 2,
      // 8000 m² ≈ 12 mu (8000 / 666.67)
      area_mu: expect.closeTo(12, 1),
      duration_minutes: 35
    });
  });

  it("separa eventos de la misma parcela en dias distintos", () => {
    const rows = [
      makeFumigation({ id: 1, fumigation_date: "2026-07-15", area_fumigated_m2: 5000 }),
      makeFumigation({ id: 2, fumigation_date: "2026-07-16", area_fumigated_m2: 7000 })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.fumigation_date).sort()).toEqual([
      "2026-07-15",
      "2026-07-16"
    ]);
  });

  it("separa eventos del mismo dia en parcelas distintas", () => {
    const rows = [
      makeFumigation({ id: 1, parcel_id: 100, parcel_name: "Lote A" }),
      makeFumigation({ id: 2, parcel_id: 200, parcel_name: "Lote B" })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries).toHaveLength(2);
    const names = summaries.map((s) => s.parcel_name).sort();
    expect(names).toEqual(["Lote A", "Lote B"]);
  });

  it("ignora fumigaciones con parcel_id NULL (aggregate imports)", () => {
    const rows = [
      makeFumigation({ id: 1, parcel_id: 100, area_fumigated_m2: 5000 }),
      // Aggregate import — sin parcela específica
      makeFumigation({ id: 2, parcel_id: null as unknown as number, area_fumigated_m2: 99999 })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    // Solo 1 row (la per-parcela). La aggregate queda fuera.
    expect(summaries).toHaveLength(1);
    expect(summaries[0].parcel_id).toBe(100);
  });

  it("ordena los summaries por area_mu DESC (eventos más grandes primero)", () => {
    const rows = [
      makeFumigation({ id: 1, parcel_id: 100, area_fumigated_m2: 2000 }),
      makeFumigation({ id: 2, parcel_id: 200, area_fumigated_m2: 8000 }),
      makeFumigation({ id: 3, parcel_id: 300, area_fumigated_m2: 5000 })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries[0].parcel_id).toBe(200); // 12 mu
    expect(summaries[1].parcel_id).toBe(300); // 7.5 mu
    expect(summaries[2].parcel_id).toBe(100); // 3 mu
  });

  it("usa 'Parcela #<id>' como fallback si parcel_name viene vacio", () => {
    const rows = [
      makeFumigation({ id: 1, parcel_id: 999, parcel_name: "" }),
      makeFumigation({ id: 2, parcel_id: 999, parcel_name: undefined })
    ];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries[0].parcel_name).toBe("Parcela #999");
  });

  it("tolera area_fumigated_m2 null sin romper (cuenta como 0)", () => {
    const rows = [makeFumigation({ area_fumigated_m2: null, duration_minutes: 30 })];
    const summaries = aggregateFumigationsByParcelAndDay(rows);
    expect(summaries[0].area_mu).toBe(0);
    expect(summaries[0].duration_minutes).toBe(30);
    expect(summaries[0].times_count).toBe(1);
  });
});

describe("buildAlertFromFumigation (v1.6)", () => {
  it("produce un DjiAlertRecord con parcel_id y parcel_name REALES", () => {
    // Antes (v1.5): parcel_id era el id sintetico del dia, parcel_name era
    // la fecha. Eso era el bug visible de la auditoria #2.
    const summary = {
      parcel_id: 904,
      parcel_name: "Lote Centro",
      fumigation_date: "2026-07-15",
      area_mu: 12.5,
      duration_minutes: 35,
      times_count: 2
    };
    const alert = buildAlertFromFumigation(summary);
    expect(alert.parcel_id).toBe(904);
    expect(alert.parcel_name).toBe("Lote Centro");
    expect(alert.level).toBe("LOW"); // 12.5 mu, 2 events
    expect(alert.message).toMatch(/Lote Centro/);
    expect(alert.message).toMatch(/2026-07-15/);
    expect(alert.message).toMatch(/12\.50 mu/);
    expect(alert.message).toMatch(/2 evento\(s\)/);
  });

  it("marca HIGH cuando area_mu cruza el threshold de 60", () => {
    const alert = buildAlertFromFumigation({
      parcel_id: 1,
      parcel_name: "P",
      fumigation_date: "2026-07-15",
      area_mu: 62,
      duration_minutes: 100,
      times_count: 1
    });
    expect(alert.level).toBe("HIGH");
  });
});

describe("buildAlertsFromFumigations (helper one-shot)", () => {
  it("compone aggregation + build en un solo call", () => {
    const rows = [
      makeFumigation({ id: 1, parcel_id: 100, area_fumigated_m2: 50_000 }),
      makeFumigation({ id: 2, parcel_id: 200, area_fumigated_m2: 5000 })
    ];
    const alerts = buildAlertsFromFumigations(rows);
    expect(alerts).toHaveLength(2);
    // 50_000 m² ≈ 75 mu → HIGH. 5_000 m² ≈ 7.5 mu → LOW.
    expect(alerts.find((a) => a.parcel_id === 100)?.level).toBe("HIGH");
    expect(alerts.find((a) => a.parcel_id === 200)?.level).toBe("LOW");
  });

  it("devuelve [] para input vacio", () => {
    expect(buildAlertsFromFumigations([])).toEqual([]);
  });
});
