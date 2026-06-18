import type { ReactNode } from "react";

export type MetricCardTone = "default" | "success" | "warning" | "danger" | "info";

export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: ReactNode;
  tone?: MetricCardTone;
  testId?: string;
}

/**
 * Tarjeta KPI reutilizable. Variantes por tono:
 *  - default: borde cálido, fondo blanco
 *  - success: borde verde, fondo verde claro
 *  - warning: borde amarillo, fondo amarillo claro
 *  - danger:  borde rojo,    fondo rojo claro
 *  - info:    borde azul,    fondo azul claro
 */
export function MetricCard({ label, value, hint, accent, tone = "default", testId }: MetricCardProps) {
  const toneClass = TONE_CLASS[tone];
  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)] ${toneClass.border}`}
      data-testid={testId}
      data-tone={tone}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${toneClass.label}`}>{label}</p>
        {accent ? <div className={toneClass.accent}>{accent}</div> : null}
      </div>
      <p className={`text-[32px] font-black leading-10 tracking-[-0.03em] ${toneClass.value}`}>{value}</p>
      {hint ? <p className={`mt-2 text-sm ${toneClass.hint}`}>{hint}</p> : null}
    </div>
  );
}

const TONE_CLASS: Record<MetricCardTone, { border: string; label: string; value: string; hint: string; accent: string }> = {
  default: {
    border: "border-[#d2ddd6]",
    label: "text-[#587064]",
    value: "text-[#121815]",
    hint: "text-[#4a5b50]",
    accent: "text-[#5a4136]"
  },
  success: {
    border: "border-[#9fceb0]/60",
    label: "text-[#0b5f2d]",
    value: "text-[#0b5f2d]",
    hint: "text-[#2c7f44]",
    accent: "text-[#0b5f2d]"
  },
  warning: {
    border: "border-[#e2bfb0]/80",
    label: "text-[#7b6b1e]",
    value: "text-[#7b6b1e]",
    hint: "text-[#7b6b1e]",
    accent: "text-[#c7a43a]"
  },
  danger: {
    border: "border-[#f1c0c0]",
    label: "text-[#a93232]",
    value: "text-[#7a1d1d]",
    hint: "text-[#a93232]",
    accent: "text-[#a93232]"
  },
  info: {
    border: "border-[#bcd1e8]",
    label: "text-[#1f4d80]",
    value: "text-[#0b3a66]",
    hint: "text-[#1f4d80]",
    accent: "text-[#1f4d80]"
  }
};
