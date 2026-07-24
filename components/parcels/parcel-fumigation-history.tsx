"use client";

// components/parcels/parcel-fumigation-history.tsx
//
// Sprint G2 — Hoja de vida completa.
//
// Sección debajo de ParcelFumigations en /parcels/[id]. Muestra:
//   1. Resumen anual (selector de año + 4 KPIs + 12 mini-cards mensuales)
//   2. Trazabilidad flight→fumigación (al click en una fumigación del
//      import con flight_ids, muestra los flights)
//   3. Historial de cambios de cadencia (diff antes/después)
//
// Es client component porque tiene state local:
//   - selectedYear: para el selector de año
//   - expandedFumigationId: qué fumigación tiene los flights expandidos
//   - El refetch al cambiar de año se hace via un endpoint API
//
// El server component padre (app/parcels/[id]/page.tsx) le pasa los
// datos del año default. El componente pide los otros años via
// /api/parcels/[id]/fumigation-history?year=YYYY.

import { useState, useTransition } from "react";

import { toDateString } from "@/lib/format";

import type { DjiFumigationEvent, DjiParcelRecord } from "@/lib/types";

interface MonthlySummary {
  month: number;
  count: number;
  area_total_m2: number;
  litros_total: number;
}

interface YearTotals {
  year: number;
  count: number;
  area_total_m2: number;
  litros_total: number;
  productos_unicos: number;
}

interface FlightTraceRow {
  id: number;
  start_at: string | null;
  end_at: string | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  area_m2: number | null;
  duration_seconds: number | null;
}

interface ScheduleHistoryEntry {
  id: number;
  parcel_id: number;
  old_cadence_days: number | null;
  new_cadence_days: number | null;
  old_crop_type: string | null;
  new_crop_type: string | null;
  changed_by: string | null;
  reason: string | null;
  commit_sha: string | null;
  changed_at: string;
}

interface FumigationWithTrace extends DjiFumigationEvent {
  flight_ids?: number[] | null;
}

interface ParcelFumigationHistoryProps {
  parcel: DjiParcelRecord;
  initialYear: number;
  initialSummary: MonthlySummary[];
  initialTotals: YearTotals;
  events: FumigationWithTrace[];
  initialFlightTraces: Record<number, FlightTraceRow[]>;
  scheduleHistory: ScheduleHistoryEntry[];
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

export function ParcelFumigationHistory({
  parcel,
  initialYear,
  initialSummary,
  initialTotals,
  events,
  initialFlightTraces,
  scheduleHistory
}: ParcelFumigationHistoryProps) {
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [summary, setSummary] = useState<MonthlySummary[]>(initialSummary);
  const [totals, setTotals] = useState<YearTotals>(initialTotals);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFumigationId, setExpandedFumigationId] = useState<number | null>(null);
  const [flightCache, setFlightCache] = useState<Record<number, FlightTraceRow[]>>(initialFlightTraces);
  const [, startTransition] = useTransition();

  async function handleYearChange(newYear: number) {
    setSelectedYear(newYear);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/parcels/${parcel.id}/fumigation-history?year=${newYear}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setSummary(body.summary);
      setTotals(body.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cambiar de año");
    } finally {
      setLoading(false);
    }
  }

  async function toggleFumigationFlights(fumigationId: number) {
    if (expandedFumigationId === fumigationId) {
      setExpandedFumigationId(null);
      return;
    }
    setExpandedFumigationId(fumigationId);
    if (flightCache[fumigationId] !== undefined) return; // cached
    try {
      const res = await fetch(`/api/fumigations/${fumigationId}/flights`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      startTransition(() => {
        setFlightCache((prev) => ({ ...prev, [fumigationId]: body.flights }));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar flights");
    }
  }

  return (
    <section
      aria-label="Hoja de vida de la parcela"
      className="space-y-5"
      data-testid="parcel-fumigation-history"
    >
      {/* ================================================================
          SECCIÓN 1: Resumen anual
          ================================================================ */}
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
              Resumen anual
            </h2>
            <p className="mt-1 text-sm text-[#4a5b50]">
              {loading ? "cargando…" : `${totals.count} fumigaciones · ${formatNumber(totals.area_total_m2)} m² · ${formatNumber(totals.litros_total, 1)} L · ${totals.productos_unicos} productos distintos`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#4a5b50]">
            <span>Año</span>
            <select
              aria-label="Año del resumen"
              className="rounded border border-[#cfd8d3] px-2 py-1 text-xs"
              data-testid="history-year-select"
              disabled={loading}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              value={selectedYear}
            >
              {AVAILABLE_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </header>
        {error ? (
          <p className="mb-3 rounded bg-[#fff5f3] px-3 py-2 text-xs text-[#a93232]" data-testid="history-error" role="alert">
            {error}
          </p>
        ) : null}
        <ol
          aria-label={`Fumigaciones por mes en ${selectedYear}`}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
          data-testid="history-month-grid"
        >
          {summary.map((m) => {
            const active = m.count > 0;
            return (
              <li
                className={`rounded-lg border p-2 ${
                  active
                    ? "border-[#0b5f2d]/30 bg-[#0b5f2d]/5"
                    : "border-[#eef2ee] bg-[#fafbfa]"
                }`}
                data-testid={`history-month-${m.month}`}
                key={m.month}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
                  {MONTH_NAMES[m.month - 1]}
                </p>
                <p className={`mt-1 text-xl font-bold ${active ? "text-[#0b5f2d]" : "text-[#9aa8a1]"}`}>
                  {m.count}
                </p>
                {active ? (
                  <p className="text-[10px] text-[#4a5b50]">
                    {formatNumber(m.area_total_m2, 0)} m²
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ================================================================
          SECCIÓN 2: Trazabilidad flight → fumigación
          Solo fumigaciones del import con flight_ids
          ================================================================ */}
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <header className="mb-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
            Trazabilidad de fumigaciones del import
          </h2>
          <p className="mt-1 text-sm text-[#4a5b50]">
            Click en una fumigación para ver qué flights la originaron
          </p>
        </header>
        {events.filter((e) => e.flight_ids && e.flight_ids.length > 0).length === 0 ? (
          <p className="text-sm text-[#587064]" data-testid="history-no-traceable">
            Esta parcela no tiene fumigaciones del import con flights asociados.
          </p>
        ) : (
          <ol className="space-y-2" data-testid="history-traceable-list">
            {events
              .filter((e) => e.flight_ids && e.flight_ids.length > 0)
              .map((e) => {
                const date = toDateString(e.fumigation_date) ?? "";
                const fidCount = e.flight_ids?.length ?? 0;
                const isExpanded = expandedFumigationId === e.id;
                const flights = flightCache[e.id];
                return (
                  <li className="rounded-lg border border-[#eef2ee] bg-white" key={e.id}>
                    <button
                      className="flex w-full items-center justify-between gap-3 p-3 text-left"
                      data-testid={`history-traceable-toggle-${e.id}`}
                      onClick={() => toggleFumigationFlights(e.id)}
                      type="button"
                    >
                      <div>
                        <strong className="text-[#121815]">{date}</strong>
                        {e.product_used ? (
                          <span className="ml-2 text-[#4a5b50]">— {e.product_used}</span>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-[#0b5f2d]/10 px-2 py-0.5 text-[10px] font-bold text-[#0b5f2d]">
                        {fidCount} flight{fidCount === 1 ? "" : "s"}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="border-t border-[#eef2ee] px-3 py-2" data-testid={`history-traceable-flights-${e.id}`}>
                        {flights === undefined ? (
                          <p className="text-[11px] text-[#587064]">Cargando flights…</p>
                        ) : flights.length === 0 ? (
                          <p className="text-[11px] text-[#587064]">Sin flights asociados.</p>
                        ) : (
                          <ul className="space-y-1 text-[11px] text-[#4a5b50]">
                            {flights.map((f) => (
                              <li
                                className="flex items-center justify-between border-b border-[#f4f7f4] py-1 last:border-b-0"
                                data-testid={`history-flight-${f.id}`}
                                key={f.id}
                              >
                                <span>
                                  <span className="font-mono">#{f.id}</span>
                                  {" · "}
                                  {f.drone_nickname ?? "(drone?)"}
                                  {f.pilot_name ? ` · ${f.pilot_name}` : ""}
                                </span>
                                <span className="font-mono text-[#587064]">
                                  {f.start_at ? new Date(f.start_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
          </ol>
        )}
      </div>

      {/* ================================================================
          SECCIÓN 3: Historial de cambios de cadencia/cultivo
          ================================================================ */}
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <header className="mb-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
            Cambios de cadencia
          </h2>
          <p className="mt-1 text-sm text-[#4a5b50]">
            {scheduleHistory.length} cambio{scheduleHistory.length === 1 ? "" : "s"} registrado{scheduleHistory.length === 1 ? "" : "s"}
          </p>
        </header>
        {scheduleHistory.length === 0 ? (
          <p className="text-sm text-[#587064]" data-testid="history-no-changes">
            Esta parcela no tiene cambios de cadencia registrados aún.
          </p>
        ) : (
          <ol className="space-y-2" data-testid="history-changes-list">
            {scheduleHistory.map((h) => (
              <li
                className="rounded-lg border border-[#eef2ee] bg-white p-3"
                data-testid={`history-change-${h.id}`}
                key={h.id}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    {h.old_cadence_days !== null ? (
                      <span className="text-[#4a5b50]">
                        <span className="font-mono text-[#9aa8a1] line-through">{h.old_cadence_days}d</span>
                        {" → "}
                        <span className="font-mono font-bold text-[#0b5f2d]">{h.new_cadence_days}d</span>
                      </span>
                    ) : (
                      <span className="text-[#0b5f2d]">
                        cadencia inicial: <span className="font-mono font-bold">{h.new_cadence_days}d</span>
                      </span>
                    )}
                    {h.old_crop_type && h.new_crop_type && h.old_crop_type !== h.new_crop_type ? (
                      <span className="text-[#4a5b50]">
                        · <span className="text-[#9aa8a1] line-through">{h.old_crop_type}</span>
                        {" → "}
                        <span className="font-bold text-[#0b5f2d]">{h.new_crop_type}</span>
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-[#587064]">
                    {new Date(h.changed_at).toISOString().slice(0, 10)}
                    {h.commit_sha ? ` · commit ${h.commit_sha.slice(0, 7)}` : ""}
                  </span>
                </div>
                {h.reason ? (
                  <p className="mt-1 text-[11px] italic text-[#587064]">{h.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// Años disponibles para el selector. Default al año actual del server.
// Como el backfill solo tiene fumigaciones desde 2026, mostramos
// 2024-2027 (rango razonable para una app que está empezando).
const AVAILABLE_YEARS = [2024, 2025, 2026, 2027];

function formatNumber(n: number, decimals: number = 0): string {
  return n.toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}
