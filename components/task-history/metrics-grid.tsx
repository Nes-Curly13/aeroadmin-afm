/**
 * MetricsGrid — internal shared module (no client/server directive → server-safe).
 *
 * Bloque 2x2 que se repite en el HeaderCard y en cada DayCard. La grilla
 * reproduce la del Figma:
 *
 *   ▲ Ntimes   💧 XL
 *   ▼ -        ⏱ XHourYminZs
 *
 * Los iconos son SVG inline (sin emojis, sin lucide) — siguiendo el patrón
 * del repo (ver `components/app-shell.tsx:NAV_ICON_PATHS`). Los colores
 * vienen del design system:
 *   - verde #0b5f2d: triángulos (times / unused)
 *   - azul  #1f4d80: gota (litros)
 *   - amber #c7a43a: reloj (duración)
 */

import type { ReactNode } from "react";

export interface MetricsGridTotals {
  times: number;
  liters: number;
  durationDjiFormat: string;
}

export interface MetricsGridProps {
  times: number;
  liters: number;
  durationDjiFormat: string;
  /** Tamaño de la fuente del valor (default: sm para DayCard, base para header). */
  size?: "sm" | "md";
  /** Test id prefix (default: "task-history-metrics-grid"). */
  testIdPrefix?: string;
}

export function MetricsGrid({
  times,
  liters,
  durationDjiFormat,
  size = "sm",
  testIdPrefix = "task-history-metrics-grid"
}: MetricsGridProps) {
  const valueClass = size === "md" ? "text-base font-semibold" : "text-sm font-semibold";
  return (
    <div className="grid grid-cols-2 gap-3" data-testid={testIdPrefix}>
      <MetricPill
        icon={<TriangleUpIcon />}
        iconClass="text-[#0b5f2d]"
        label="times"
        testId={`${testIdPrefix}-times`}
        value={String(times)}
        valueClass={valueClass}
      />
      <MetricPill
        icon={<DropIcon />}
        iconClass="text-[#1f4d80]"
        label="L"
        testId={`${testIdPrefix}-liters`}
        value={liters.toFixed(1)}
        valueClass={valueClass}
      />
      <MetricPill
        icon={<TriangleDownIcon />}
        iconClass="text-[#0b5f2d]/60"
        label="-"
        testId={`${testIdPrefix}-unused`}
        value="-"
        valueClass={valueClass}
      />
      <MetricPill
        icon={<ClockIcon />}
        iconClass="text-[#c7a43a]"
        label="duration"
        testId={`${testIdPrefix}-duration`}
        value={durationDjiFormat}
        valueClass={valueClass}
      />
    </div>
  );
}

interface MetricPillProps {
  icon: ReactNode;
  iconClass: string;
  value: string;
  label: string;
  testId: string;
  valueClass: string;
}

function MetricPill({ icon, iconClass, value, label, testId, valueClass }: MetricPillProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-[#d2ddd6] bg-white px-3 py-2"
      data-testid={testId}
    >
      <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center ${iconClass}`}>
        {icon}
      </span>
      <p className={`${valueClass} text-[#121815]`}>
        {value}
        <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-[#587064]">{label}</span>
      </p>
    </div>
  );
}

function TriangleUpIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 12 12">
      <path d="M6 2 11 10 1 10z" />
    </svg>
  );
}

function TriangleDownIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 12 12">
      <path d="M6 10 1 2 11 2z" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 1.5c-.6 1-4.5 5-4.5 8.2A4.5 4.5 0 0 0 8 14.5a4.5 4.5 0 0 0 4.5-4.8C12.5 6.5 8.6 2.5 8 1.5Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}
