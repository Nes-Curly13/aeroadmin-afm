import { describe, expect, it } from "vitest";

import { buildAlert, getAlertLevel } from "@/lib/alerts";
import type { DjiDailySummaryRecord } from "@/lib/types";

describe("alert logic", () => {
  it("maps summary thresholds to the expected alert levels", () => {
    expect(getAlertLevel(29, 39)).toBe("LOW");
    expect(getAlertLevel(30, 39)).toBe("MEDIUM");
    expect(getAlertLevel(59, 79)).toBe("MEDIUM");
    expect(getAlertLevel(60, 10)).toBe("HIGH");
    expect(getAlertLevel(10, 80)).toBe("HIGH");
  });

  it("builds alerts from DJI summaries", () => {
    const summary: DjiDailySummaryRecord = {
      id: 7,
      record_date: "2026-06-02",
      weekday: "Tuesday",
      category: "Agriculture",
      area_mu: 62.5,
      times_count: 94,
      usage_liters: 983.6,
      work_time_text: "7Hour14min51s",
      raw_text: "2026/06/02TuesdayAgriculture62.5mu94times983.6L-7Hour14min51s"
    };

    expect(buildAlert(summary)).toMatchObject({
      parcel_id: 7,
      parcel_name: "2026-06-02 Agriculture",
      level: "HIGH",
      age_days: 31
    });
  });
});
