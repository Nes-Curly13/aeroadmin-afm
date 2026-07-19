"use client";

import Link from "next/link";

import { toDateString } from "@/lib/format";
import type { UpcomingFumigation } from "@/lib/types";

function statusStyle(status: UpcomingFumigation["status"]) {
  switch (status) {
    case "overdue":
      return {
        chip: "bg-[#a93232]/15 text-[#a93232]",
        border: "border-l-4 border-[#a93232]",
        label: "Vencida"
      };
    case "due_soon":
      return {
        chip: "bg-[#d4b23c]/20 text-[#7a5f0d]",
        border: "border-l-4 border-[#d4b23c]",
        label: "Vence pronto"
      };
    case "ok":
      return {
        chip: "bg-[#0b5f2d]/10 text-[#0b5f2d]",
        border: "border-l-4 border-[#0b5f2d]",
        label: "En fecha"
      };
    case "no_history":
      return {
        chip: "bg-[#cfd8d3] text-[#4a5b50]",
        border: "border-l-4 border-[#cfd8d3]",
        label: "Sin historial"
      };
  }
}

function daysLabel(days: number | null): string {
  if (days === null) return "Sin fecha";
  if (days < 0) return `Vencida hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `En ${days} días`;
}

export function UpcomingFumigations({
  items,
  totalOverdue
}: {
  items: UpcomingFumigation[];
  /**
   * Total real de parcelas overdue en el sistema (no solo el top-N de este panel).
   * Cuando es > items.filter(overdue), mostramos el link "Ver todas (N) →" hacia
   * `/parcels/overdue`. Si es `undefined`, el link se oculta (back-compat con tests
   * que sólo pasan `items`).
   */
  totalOverdue?: number;
}) {
  const overdue = items.filter((i) => i.status === "overdue").length;
  const dueSoon = items.filter((i) => i.status === "due_soon").length;
  const ok = items.filter((i) => i.status === "ok").length;
  const showAllOverdueLink = typeof totalOverdue === "number" && totalOverdue > overdue;

  return (
    <section
      aria-label="Próximas fumigaciones"
      className="rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-center justify-between border-b border-[#d2ddd6] px-6 py-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Próximas fumigaciones</p>
          <h3 className="mt-1 text-lg font-semibold text-[#121815]">Plan operativo por cadencia</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.18em]">
          {showAllOverdueLink && (
            <Link
              className="rounded-full border border-[#a93232]/40 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a93232] transition hover:bg-[#a93232]/10"
              data-testid="upcoming-ver-todas-overdue"
              href="/parcels/overdue"
            >
              Ver todas ({totalOverdue}) →
            </Link>
          )}
          <div className="flex items-center gap-2">
          {overdue > 0 && (
            <span className="rounded-full bg-[#a93232]/15 px-2.5 py-1 text-[#a93232]">
              {overdue} vencida{overdue === 1 ? "" : "s"}
            </span>
          )}
          {dueSoon > 0 && (
            <span className="rounded-full bg-[#d4b23c]/20 px-2.5 py-1 text-[#7a5f0d]">
              {dueSoon} pronto
            </span>
          )}
          <span className="rounded-full bg-[#0b5f2d]/10 px-2.5 py-1 text-[#0b5f2d]">{ok} en fecha</span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[#d2ddd6]">
        {items.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#4a5b50]">
            No hay parcelas con schedule activo. Corre <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-xs">node scripts/seed-cadences.js</code> para inicializar.
          </div>
        ) : (
          items.map((item) => {
            const style = statusStyle(item.status);
            return (
              <Link
                className={`flex items-center gap-4 px-6 py-4 transition hover:bg-[#f7f9fb] ${style.border}`}
                href={`/parcels/${item.parcel_id}`}
                key={item.parcel_id}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h4 className="truncate text-sm font-semibold text-[#121815]">
                      {item.land_name || item.external_id}
                    </h4>
                    <span className="rounded-full bg-[#f4f7f4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
                      {item.field_type}
                    </span>
                    <span className="text-[10px] text-[#4a5b50]">{item.crop_type}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#4a5b50]">
                    <span>Cadencia: <strong className="text-[#121815]">{item.recommended_cadence_days} días</strong></span>
                    {item.drone_model_name && (
                      <span>Dron: <strong className="text-[#121815]">{item.drone_model_name}</strong></span>
                    )}
                    {item.last_fumigation_date && (
                      <span>Última: {toDateString(item.last_fumigation_date) ?? "—"}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${style.chip}`}>
                    {style.label}
                  </span>
                  <span className="text-[10px] text-[#4a5b50]">{daysLabel(item.days_until_next_due)}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
