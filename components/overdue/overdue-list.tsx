"use client";

// components/overdue/overdue-list.tsx
//
// M3-M5 Q2 — Client island para la página /parcels/overdue.
// Recibe la lista de parcelas (ya ordenada por prioridad en el
// server) y los filtros del URL. Renderiza summary chips + tabla
// con filtros client-side y drill-down al detalle.
//
// Decisiones de diseño:
//   - El filter de severidad es client-side (es 1 valor enum, no
//     necesita round-trip al server). El resto de filtros
//     (cropType, isOrchard, maxDaysAhead) se setean via URL en el
//     server porque pueden cambiar el query SQL.
//   - El click en una fila navega a /parcels/[id] (server route).
//   - Los chips de summary muestran counts clickeables que setean
//     el filtro de severidad via URL (mantener el filter client-side
//     pero syncronizar con URL para shareability).

import Link from "next/link";
import { useMemo, useState } from "react";

import { severityChipClass, severityLabel } from "@/lib/overdue-parcels";
import type { OverdueParcel } from "@/lib/types";

type Severity = "overdue" | "due_soon" | "ok" | "no_history";

export interface OverdueSummary {
  total: number;
  overdue: number;
  due_soon: number;
  ok: number;
  no_history: number;
  max_days_ahead: number;
}

export interface OverdueListProps {
  parcels: OverdueParcel[];
  summary: OverdueSummary;
  totalHa: number;
}

function SummaryChip({
  label,
  count,
  active,
  onClick,
  tone
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: "danger" | "warning" | "success" | "neutral";
}) {
  // Tokens para que se distingan del fondo (no son los chips de
  // severity per-se; son contadores agregados).
  const toneClasses: Record<typeof tone, string> = {
    danger: "border-[#a93232]/30 text-[#a93232]",
    warning: "border-[#d4b23c]/40 text-[#7a5f0d]",
    success: "border-[#0b5f2d]/30 text-[#0b5f2d]",
    neutral: "border-[#cfd8d3] text-[#4a5b50]"
  };
  const activeClasses = active
    ? "bg-[#f4f7f4] ring-2 ring-[#0b5f2d]/30"
    : "bg-white hover:bg-[#f7f9fb]";
  return (
    <button
      aria-label={`${label}: ${count} parcelas`}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition ${toneClasses[tone]} ${activeClasses}`}
      onClick={onClick}
      type="button"
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
        {label}
      </span>
      <span className="text-2xl font-black">{count}</span>
    </button>
  );
}

/**
 * M7/F1.5 — Indicador pasivo (no clickeable).
 *
 * El chip "En fecha" no es un filtro de acción: el supervisor no
 * necesita ver "solo las que están bien" porque no va a actuar sobre
 * ellas. Mostrarlo como botón es un click que consume atención sin
 * valor. Se mantiene el count como contexto pero se renderiza como
 * <div> sin onClick ni aria-pressed.
 */
function SummaryIndicator({
  label,
  count,
  tone
}: {
  label: string;
  count: number;
  tone: "danger" | "warning" | "success" | "neutral";
}) {
  const toneClasses: Record<typeof tone, string> = {
    danger: "border-[#a93232]/30 text-[#a93232]",
    warning: "border-[#d4b23c]/40 text-[#7a5f0d]",
    success: "border-[#0b5f2d]/30 text-[#0b5f2d]",
    neutral: "border-[#cfd8d3] text-[#4a5b50]"
  };
  return (
    <div
      aria-label={`${label}: ${count} parcelas (indicador, no filtrable)`}
      className={`flex flex-col items-start gap-1 rounded-2xl border bg-white px-4 py-3 ${toneClasses[tone]}`}
      data-testid="overdue-summary-indicator"
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
        {label}
      </span>
      <span className="text-2xl font-black">{count}</span>
    </div>
  );
}

export function OverdueList({ parcels, summary, totalHa }: OverdueListProps) {
  const [activeSeverity, setActiveSeverity] = useState<Severity | null>(null);

  const filtered = useMemo(() => {
    if (!activeSeverity) return parcels;
    return parcels.filter((p) => p.severity === activeSeverity);
  }, [parcels, activeSeverity]);

  return (
    <div className="space-y-5">
      {/* Summary chips: 3 filtros clickeables + 1 indicador pasivo (M7).
          "En fecha" ya no es botón (no requiere acción del supervisor). */}
      <section
        aria-label="Resumen de cadencia"
        className="grid gap-3 md:grid-cols-4"
      >
        <SummaryChip
          active={activeSeverity === "overdue"}
          count={summary.overdue}
          label="Vencidas"
          onClick={() =>
            setActiveSeverity((prev) => (prev === "overdue" ? null : "overdue"))
          }
          tone="danger"
        />
        <SummaryChip
          active={activeSeverity === "due_soon"}
          count={summary.due_soon}
          // M7/F1.4: copy dinámica al `maxDaysAhead` del URL param.
          // Si el supervisor cambia la URL a ?maxDaysAhead=7, el label
          // pasa a "Vence pronto (≤7d)" automáticamente (la server page
          // re-deriva `summary.max_days_ahead` y lo pasa via props).
          label={`Vence pronto (≤${summary.max_days_ahead}d)`}
          onClick={() =>
            setActiveSeverity((prev) =>
              prev === "due_soon" ? null : "due_soon"
            )
          }
          tone="warning"
        />
        <SummaryIndicator
          count={summary.ok}
          label="En fecha"
          tone="success"
        />
        <SummaryChip
          active={activeSeverity === "no_history"}
          count={summary.no_history}
          label="Sin historial"
          onClick={() =>
            setActiveSeverity((prev) =>
              prev === "no_history" ? null : "no_history"
            )
          }
          tone="neutral"
        />
      </section>

      {/* Contexto: total hectáreas fumigables */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-[#4a5b50]">
        <span>
          <strong className="text-[#121815]">{filtered.length}</strong>{" "}
          {filtered.length === 1 ? "parcela" : "parcelas"} mostradas
          {activeSeverity && (
            <button
              className="ml-2 text-[#0b5f2d] underline"
              onClick={() => setActiveSeverity(null)}
              type="button"
            >
              Limpiar filtro
            </button>
          )}
        </span>
        <span>
          {totalHa.toFixed(2)} ha fumigables en el set
        </span>
      </div>

      {/* Lista de parcelas */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-8 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">
            Sin pendientes
          </p>
          <p className="mt-2 text-sm text-[#4a5b50]">
            {summary.total === 0
              ? `No hay parcelas con cadencia vencida o próxima a vencer en los próximos ${summary.max_days_ahead} días.`
              : "Ninguna parcela coincide con el filtro de severidad activo. Limpiá el filtro para ver todas."}
          </p>
        </div>
      ) : (
        <ul
          aria-label="Lista de parcelas que necesitan fumigación"
          className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
        >
          {filtered.map((parcel, idx) => (
            <OverdueRow
              isLast={idx === filtered.length - 1}
              key={parcel.parcel_id}
              parcel={parcel}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OverdueRow({
  parcel,
  isLast
}: {
  parcel: OverdueParcel;
  isLast: boolean;
}) {
  const daysLabel =
    parcel.days_until_next_due === null
      ? "—"
      : parcel.days_until_next_due < 0
        ? `${Math.abs(parcel.days_until_next_due)} d vencido`
        : parcel.days_until_next_due === 0
          ? "vence hoy"
          : `${parcel.days_until_next_due} d`;

  return (
    <li
      className={`flex flex-col gap-2 px-5 py-4 transition hover:bg-[#f7f9fb] sm:flex-row sm:items-center sm:gap-4 ${
        isLast ? "" : "border-b border-[#eef2ee]"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            className="text-base font-semibold text-[#121815] hover:text-[#0b5f2d] hover:underline"
            href={`/parcels/${parcel.parcel_id}`}
          >
            {parcel.land_name ?? `Parcela #${parcel.parcel_id}`}
          </Link>
          <span className="rounded-full bg-[#f4f7f4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            {parcel.crop_type}
          </span>
          {parcel.is_orchard ? (
            <span className="rounded-full bg-[#fff9e7] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a5f0d]">
              Orchard
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[#4a5b50]">
          {parcel.drone_model_name ?? "Sin dron asignado"} ·{" "}
          {parcel.area_fumigable_ha !== null
            ? `${parcel.area_fumigable_ha.toFixed(2)} ha`
            : "—"}
          {parcel.waypoint_count !== null
            ? ` · ${parcel.waypoint_count} waypoints`
            : ""}
        </p>
      </div>

      <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-end sm:text-right">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            Cadencia
          </p>
          <p className="text-sm font-semibold text-[#121815]">
            cada {parcel.recommended_cadence_days} d
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            Estado
          </p>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${severityChipClass(
              parcel.severity
            )}`}
          >
            {severityLabel(parcel.severity)}
          </span>
        </div>
        <div className="min-w-[5rem] text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            {parcel.days_until_next_due !== null && parcel.days_until_next_due < 0
              ? "Atraso"
              : "Próximo"}
          </p>
          <p className="text-base font-black text-[#121815]">{daysLabel}</p>
        </div>
      </div>
    </li>
  );
}
