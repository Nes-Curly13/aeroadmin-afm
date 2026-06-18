"use client";

import { useMemo } from "react";

import type { AlertLevel, DjiAlertRecord } from "@/lib/types";

export interface AlertsPanelProps {
  alerts: DjiAlertRecord[];
  alertFilter: AlertLevel | "ALL";
  onAlertFilterChange: (level: AlertLevel | "ALL") => void;
}

function alertTone(level: DjiAlertRecord["level"]): string {
  if (level === "HIGH") return "border-[#7a1d1d]/10 bg-[#fff0ee] text-[#1a1a1a]";
  if (level === "MEDIUM") return "border-[#d4b23c]/20 bg-[#fff9e7] text-[#1a1a1a]";
  return "border-[#7aa87f]/20 bg-[#eef8ef] text-[#1a1a1a]";
}

const FILTERS: AlertLevel[] = ["HIGH", "MEDIUM", "LOW"];

/**
 * Panel lateral de alertas del dashboard.
 * Filtros por nivel: ALL (default) / HIGH / MEDIUM / LOW.
 */
export function AlertsPanel({ alerts, alertFilter, onAlertFilterChange }: AlertsPanelProps) {
  const filteredAlerts = useMemo(() => {
    if (alertFilter === "ALL") return alerts;
    return alerts.filter((alert) => alert.level === alertFilter);
  }, [alerts, alertFilter]);

  return (
    <div className="rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-[#121815]">Alertas DJI</h2>
        <div className="flex gap-1 rounded-lg border border-[#cfd8d3] p-1" role="group" aria-label="Filtro de alertas">
          {(["ALL", ...FILTERS] as const).map((level) => {
            const active = alertFilter === level;
            return (
              <button
                aria-pressed={active}
                className={`rounded px-2 py-1 text-xs font-semibold uppercase transition ${
                  active ? "bg-[#0b5f2d] text-white" : "text-[#4a5b50] hover:bg-[#dbe7df]/70"
                }`}
                key={level}
                onClick={() => onAlertFilterChange(level)}
                type="button"
              >
                {level}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No hay alertas en este momento.</p>
        ) : filteredAlerts.length === 0 ? (
          <p className="text-sm text-slate-500">No hay alertas para el filtro seleccionado.</p>
        ) : (
          filteredAlerts.map((alert) => (
            <div className={`rounded-xl border p-4 ${alertTone(alert.level)}`} key={`${alert.parcel_id}-${alert.level}`}>
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70">
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">
                    warning
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold">{alert.parcel_name}</p>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                      {alert.level}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5">{alert.message}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
