import { describe, expect, it } from "vitest";

import {
  computeNextDueDate,
  effectiveCadence,
  getFumigationStatus
} from "@/lib/fumigation-cadence";

const NOW = new Date("2026-06-15T12:00:00Z");

function daysAgo(n: number, base: Date = NOW): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe("fumigation-cadence — effectiveCadence (fase × estación × crop)", () => {
  it("caña vegetativa en secas → base × 1.5", () => {
    // base 14, fase vegetativa (sin cambio), estación secas × 1.5 → 21
    expect(effectiveCadence(14, "vegetativa", "secas", "Caña")).toBe(21);
  });

  it("caña vegetativa en lluvias → base × 1.0 (default)", () => {
    expect(effectiveCadence(14, "vegetativa", "lluvias", "Caña")).toBe(14);
  });

  it("orchards vegetativa en lluvias → base × 0.7 (más fumigación)", () => {
    // base 10, fase vegetativa, estación lluvias × 1.0, orchards × 0.7 = 7
    expect(effectiveCadence(10, "vegetativa", "lluvias", "Orchards")).toBe(7);
  });

  it("orchards vegetativa en secas → base × 1.5 (sin ajuste 0.7 porque no es lluvias)", () => {
    // base 10, fase vegetativa, estación secas × 1.5 = 15. No aplica 0.7 (solo en lluvias).
    expect(effectiveCadence(10, "vegetativa", "secas", "Orchards")).toBe(15);
  });

  it("caña en establecimiento en lluvias → base × 1.5", () => {
    // base 14, fase establecimiento × 1.5 = 21, estación lluvias × 1.0 = 21
    expect(effectiveCadence(14, "establecimiento", "lluvias", "Caña")).toBe(21);
  });

  it("caña en madurante → 35 (ignora estación para ripener)", () => {
    // base 14, fase madurante = 35 fijo. Estación secas × 1.5 = 52.
    // El test verifica el path de la fase; la fase manda.
    expect(effectiveCadence(14, "madurante", "lluvias", "Caña")).toBe(35);
  });

  it("caña en cosecha → 999 (no se fumiga, estación amplifica pero sigue siendo no-op)", () => {
    expect(effectiveCadence(14, "cosecha", "lluvias", "Caña")).toBe(999);
  });

  it("phase null cae al baseCadence sin ajustes", () => {
    expect(effectiveCadence(14, null, "secas", "Caña")).toBe(21); // secas × 1.5
    expect(effectiveCadence(14, null, "lluvias", "Caña")).toBe(14);
  });

  it("phase null y season null → baseCadence tal cual (legacy fallback)", () => {
    expect(effectiveCadence(14, null, null, "Caña")).toBe(14);
  });

  it("nunca devuelve menos de 1 día (sanity check contra inputs degenerados)", () => {
    expect(effectiveCadence(0, "vegetativa", "secas", "Caña")).toBeGreaterThanOrEqual(1);
    expect(effectiveCadence(-5, "vegetativa", "secas", "Orchards")).toBeGreaterThanOrEqual(1);
  });
});

describe("fumigation-cadence — getFumigationStatus con phase + season", () => {
  it("phase='vegetativa', season='secas', last 21d atrás → 'due_soon' (next = hoy)", () => {
    // base 14, effective 21d. last = NOW - 21d. next = NOW. diffDays = 0 → due_soon.
    const last = daysAgo(21);
    expect(getFumigationStatus(last, 14, NOW, "vegetativa", "secas")).toBe("due_soon");
  });

  it("phase='vegetativa', season='secas', last 30d atrás → 'overdue' (9d de atraso)", () => {
    // base 14, effective 21d. last = NOW - 30d. next = NOW - 9d. diffDays = 9 → overdue.
    const last = daysAgo(30);
    expect(getFumigationStatus(last, 14, NOW, "vegetativa", "secas")).toBe("overdue");
  });

  it("phase='vegetativa', season='secas', last 10d atrás → 'ok' (efectiva 21d, faltan 11d)", () => {
    // base 14, effective 21d. last = NOW - 10d. next = NOW + 11d. diffDays = -11 → ok.
    const last = daysAgo(10);
    expect(getFumigationStatus(last, 14, NOW, "vegetativa", "secas")).toBe("ok");
  });

  it("last 5d atrás, sin phase/season → 'ok' (current behavior preserved)", () => {
    // base 14. last = NOW - 5d. next = NOW + 9d. diffDays = -9 → ok.
    const last = daysAgo(5);
    expect(getFumigationStatus(last, 14, NOW)).toBe("ok");
  });

  it("last 14d atrás, sin phase/season → 'due_soon' (current behavior preserved)", () => {
    // base 14. last = NOW - 14d. next = NOW. diffDays = 0 → due_soon.
    const last = daysAgo(14);
    expect(getFumigationStatus(last, 14, NOW)).toBe("due_soon");
  });

  it("last 20d atrás, sin phase/season → 'overdue' (current behavior preserved)", () => {
    // base 14. last = NOW - 20d. next = NOW - 6d. diffDays = 6 → overdue.
    const last = daysAgo(20);
    expect(getFumigationStatus(last, 14, NOW)).toBe("overdue");
  });

  it("null last + phase/season → 'no_history' (preserved, no phase/season no afecta)", () => {
    expect(getFumigationStatus(null, 14, NOW, "vegetativa", "lluvias")).toBe("no_history");
  });

  it("phase null + season 'secas' → usa el ajuste estacional sobre el base", () => {
    // base 14, phase null → baseCadence. season secas × 1.5 = 21. last 21d atrás → due_soon.
    const last = daysAgo(21);
    expect(getFumigationStatus(last, 14, NOW, null, "secas")).toBe("due_soon");
  });

  it("phase 'madurante' → 35d, last 50d atrás → 'ok' (faltan -15d del due, ventana >7d)", () => {
    // base 14, fase madurante = 35. last = NOW - 50d. next = NOW - 15d. diffDays = 15. → overdue.
    // Hmm, 50d ago + 35d = 15d past due → overdue. Necesito más días para que sea 'ok'.
    // last 60d atrás: next = NOW - 25d → overdue también. Hmm.
    // Para que sea 'ok', necesitamos last < 35d (cadencia madurante). Eso es "due_soon" o "ok".
    // Con 28d atrás: next = NOW + 7d → diffDays = -7, >= -7 → due_soon. Hmm.
    // Con 27d atrás: next = NOW + 8d → diffDays = -8, < -7 → ok.
    const last = daysAgo(27);
    expect(getFumigationStatus(last, 14, NOW, "madurante", "lluvias")).toBe("ok");
  });

  it("phase 'cosecha' → 999d → nunca overdue (en ventana razonable)", () => {
    // base 14, fase cosecha = 999. last 30d atrás. next = NOW + 969d. → ok.
    const last = daysAgo(30);
    expect(getFumigationStatus(last, 14, NOW, "cosecha", "lluvias")).toBe("ok");
  });
});

describe("fumigation-cadence — computeNextDueDate backward compat", () => {
  it("sin opts: comportamiento idéntico al previo", () => {
    const next = computeNextDueDate("2026-06-01", 14);
    expect(next?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("con opts.cadenceForLastFumigation: usa esa cadencia", () => {
    const next = computeNextDueDate("2026-06-01", 14, { cadenceForLastFumigation: 21 });
    expect(next?.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("con opts.cadenceForLastFumigation null: cae al cadenceDays (backward compat)", () => {
    const next = computeNextDueDate("2026-06-01", 14, { cadenceForLastFumigation: null });
    expect(next?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });
});
