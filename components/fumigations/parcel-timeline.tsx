/**
 * ParcelTimeline — server component.
 *
 * M7 (roadmap mediano plazo) — vista de timeline de fumigaciones por parcela.
 * Renderiza el `FumigationTimelineResult` (que produce
 * `buildFumigationTimeline()` en lib/fumigation-timeline.ts) en 3 vistas:
 *   - 'detail' (default): summary + gaps + byMonth + lista de eventos
 *   - 'summary': summary + byMonth (sin lista de eventos)
 *   - 'compact': todo en un solo bloque denso
 *
 * Convenciones aplicadas (ver docs/guia/03_MEJORES_PRACTICAS_AGENTES.md):
 *   - Server component (no `"use client"`).
 *   - Named export.
 *   - Tokens de `lib/ui-tokens.ts` referenciados semánticamente; el hex
 *     aparece inline en Tailwind por consistencia con el resto del repo.
 *   - Sin `any`. Props tipadas.
 *   - A11y: role="list"/"listitem" en el contenedor, aria-labels
 *     descriptivos, headings jerárquicos, fecha con día de semana
 *     (formato operador fumigador).
 *
 * No hace I/O. El page server component que lo usa llama al repository
 * (o a la API, si el caller lo prefiere) y pasa el resultado como prop.
 */

import type { ReactNode } from "react";

import { formatDateWithWeekday, formatNumber } from "@/lib/format";
import type { FumigationTimelineResult } from "@/lib/types";

export type ParcelTimelineMode = "detail" | "summary" | "compact";

export interface ParcelTimelineProps {
  /** Nombre visible de la parcela (para aria-label y mensajes). */
  parcelName: string;
  /** Output de `buildFumigationTimeline()`. */
  timeline: FumigationTimelineResult;
  /** Modo de visualización. Default: 'detail'. */
  mode?: ParcelTimelineMode;
  /** Slot opcional para controles extra (ej. date range picker). */
  controls?: ReactNode;
}

const DEFAULT_ARIA_LIST_LABEL = "Fumigaciones de la parcela";

export function ParcelTimeline({
  parcelName,
  timeline,
  mode = "detail",
  controls
}: ParcelTimelineProps) {
  const { events, summary } = timeline;

  return (
    <div
      className="space-y-5"
      data-mode={mode}
      data-testid="parcel-timeline"
    >
      {controls ? <div data-testid="parcel-timeline-controls">{controls}</div> : null}

      <SummarySection parcelName={parcelName} summary={summary} />

      {summary.gaps.length > 0 && mode !== "summary" ? (
        <GapsSection gaps={summary.gaps} />
      ) : null}

      {mode !== "summary" ? (
        <ByMonthSection byMonth={summary.byMonth} />
      ) : null}

      {mode === "detail" ? (
        <EventsListSection
          events={events}
          parcelName={parcelName}
        />
      ) : null}

      {events.length === 0 ? (
        <EmptyState />
      ) : null}
    </div>
  );
}

// ============================================================
// Sub-secciones
// ============================================================

function SummarySection({
  parcelName,
  summary
}: {
  parcelName: string;
  summary: FumigationTimelineResult["summary"];
}) {
  const countLabel = summary.count === 1 ? "1 fumigación" : `${formatNumber(summary.count)} fumigaciones`;
  const totalAreaLabel = summary.totalAreaHa > 0 ? `${summary.totalAreaHa.toFixed(2)} ha` : "—";
  const totalDurationLabel =
    summary.totalDurationSeconds > 0
      ? formatDurationHuman(summary.totalDurationSeconds)
      : "—";
  const observedLabel =
    summary.observedCadenceDays !== null
      ? `cada ${summary.observedCadenceDays} días`
      : "No calculable";
  const expectedLabel =
    summary.expectedCadenceDays !== null
      ? `cada ${summary.expectedCadenceDays} días`
      : "No definida";

  return (
    <section
      aria-label={`Resumen de fumigaciones de ${parcelName}`}
      className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="parcel-timeline-summary"
    >
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
        Resumen
      </h2>
      <p className="mb-4 text-sm text-[#4a5b50]">
        Métricas agregadas del rango seleccionado.
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <SummaryStat
          aria-label="Cantidad de fumigaciones en el rango"
          label="Fumigaciones"
          testId="parcel-timeline-summary-count"
          value={countLabel}
        />
        <SummaryStat
          aria-label="Área total fumigada en hectáreas"
          label="Área total"
          testId="parcel-timeline-summary-area"
          value={totalAreaLabel}
        />
        <SummaryStat
          aria-label="Duración total de fumigación en horas y minutos"
          label="Duración total"
          testId="parcel-timeline-summary-duration"
          value={totalDurationLabel}
        />
        <SummaryStat
          aria-label="Cadencia observada, promedio de días entre fumigaciones consecutivas"
          label="Cadencia observada"
          testId="parcel-timeline-summary-observed"
          value={observedLabel}
        />
        <SummaryStat
          aria-label="Cadencia esperada según el schedule de la parcela"
          label="Cadencia esperada"
          testId="parcel-timeline-summary-expected"
          value={expectedLabel}
        />
      </dl>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  testId,
  ...rest
}: {
  label: string;
  value: string;
  testId: string;
  "aria-label"?: string;
}) {
  return (
    <div
      className="rounded-lg bg-[#f4f7f4] p-3"
      data-testid={testId}
      {...rest}
    >
      <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold text-[#121815]">{value}</dd>
    </div>
  );
}

function GapsSection({
  gaps
}: {
  gaps: FumigationTimelineResult["summary"]["gaps"];
}) {
  return (
    <section
      aria-label="Gaps anormales entre fumigaciones"
      className="rounded-2xl border border-[#f1c0c0] bg-[#fff0ee] p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="parcel-timeline-gaps"
    >
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#a93232]">
        Gaps &gt; 60 días
      </h2>
      <p className="mb-3 text-sm text-[#7a1d1d]">
        Intervalos anormales entre fumigaciones consecutivas — revisar con el operador.
      </p>
      <ul className="space-y-2" data-testid="parcel-timeline-gaps-list">
        {gaps.map((g) => (
          <li
            className="flex items-baseline justify-between gap-3 rounded-lg border border-[#f1c0c0] bg-white p-3 text-sm"
            data-gap-days={g.days}
            key={`${g.from}-${g.to}`}
          >
            <span className="text-[#121815]">
              {g.from} → {g.to}
            </span>
            <strong className="text-[#a93232]">{g.days} días</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ByMonthSection({
  byMonth
}: {
  byMonth: FumigationTimelineResult["summary"]["byMonth"];
}) {
  if (byMonth.length === 0) return null;
  return (
    <section
      aria-label="Fumigaciones agrupadas por mes"
      className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="parcel-timeline-bymonth"
    >
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
        Por mes
      </h2>
      <p className="mb-4 text-sm text-[#4a5b50]">
        Distribución de fumigaciones a lo largo del rango.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {byMonth.map((m) => (
          <article
            className="rounded-lg border border-[#cfd8d3] bg-[#f7f9fb] p-3"
            data-month={m.yyyymm}
            data-testid="parcel-timeline-bymonth-item"
            key={m.yyyymm}
          >
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
              {formatMonthYear(m.yyyymm)}
            </h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#4a5b50]">Cantidad</dt>
                <dd className="font-semibold text-[#121815]">{m.count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#4a5b50]" title="Hectáreas fumigadas">
                  Área
                </dt>
                <dd className="font-semibold text-[#121815]">{m.areaHa.toFixed(2)} ha</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#4a5b50]" title="Duración total de fumigación">
                  Duración
                </dt>
                <dd className="font-semibold text-[#121815]">
                  {formatDurationHuman(m.durationSeconds)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function EventsListSection({
  events,
  parcelName
}: {
  events: FumigationTimelineResult["events"];
  parcelName: string;
}) {
  if (events.length === 0) return null;
  return (
    <section
      aria-label="Detalle de cada fumigación"
      className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="parcel-timeline-events"
    >
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
        Detalle ({events.length})
      </h2>
      <p className="mb-4 text-sm text-[#4a5b50]">
        Una entrada por fumigación, en orden cronológico ascendente.
      </p>
      <ol
        aria-label={DEFAULT_ARIA_LIST_LABEL}
        className="space-y-2"
        data-testid="parcel-timeline-events-list"
        role="list"
      >
        {events.map((e) => (
          <li
            aria-label={`Fumigación del ${formatDateWithWeekday(e.date)} en ${parcelName}`}
            className="flex items-start gap-3 rounded-lg border border-[#eef2ee] bg-white p-3"
            data-date={e.date}
            data-event-id={e.id}
            key={e.id}
            role="listitem"
          >
            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full bg-[#0b5f2d]/10 text-[10px] font-bold text-[#0b5f2d]">
              <span className="text-[10px] uppercase">{e.month.slice(5, 7)}</span>
              <span className="text-[12px] leading-none">{e.date.slice(8, 10)}</span>
            </div>
            <div className="flex-1 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="text-[#121815]">{formatDateWithWeekday(e.date)}</strong>
                {e.productUsed ? (
                  <span className="text-[#4a5b50]">— {e.productUsed}</span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#4a5b50]">
                {e.areaHa !== null ? (
                  <span title="Área fumigada en hectáreas">
                    {e.areaHa.toFixed(2)} ha
                  </span>
                ) : (
                  <span className="text-[#587064]">— ha</span>
                )}
                <span title="Duración de la fumigación">{e.durationDjiFormat}</span>
                {e.droneNickname ? (
                  <span title="Dron usado">
                    Dron: <strong className="text-[#121815]">{e.droneNickname}</strong>
                  </span>
                ) : null}
                {e.pilotName ? (
                  <span title="Piloto">
                    Piloto: <strong className="text-[#121815]">{e.pilotName}</strong>
                  </span>
                ) : null}
                {e.recordedBy ? <span>Por: {e.recordedBy}</span> : null}
              </div>
              {e.notes ? (
                <p className="mt-1 text-[11px] italic text-[#4a5b50]">{e.notes}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EmptyState() {
  return (
    <div
      aria-label="Sin fumigaciones en este rango"
      className="rounded-2xl border border-[#d2ddd6] bg-white p-8 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="parcel-timeline-empty"
    >
      <p className="text-sm font-semibold text-[#4a5b50]">
        Sin fumigaciones en este rango
      </p>
      <p className="mt-2 text-xs text-[#587064]">
        Probá ampliar el rango de fechas o verificar el schedule de la parcela.
      </p>
    </div>
  );
}

// ============================================================
// Formatters locales (no ameritan estar en lib/format.ts todavía)
// ============================================================

/** "2026-03" → "Marzo 2026" (es-CO). */
function formatMonthYear(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  // El día 15 evita drift de TZ con Intl + UTC (mismo patrón que daysBetween).
  const d = new Date(`${y}-${m}-15T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyymm;
  const monthName = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(d);
  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
}

/** 14400 s → "4h 0min". Usado en summary (no en eventos — ahí va formatDjiDuration). */
function formatDurationHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
