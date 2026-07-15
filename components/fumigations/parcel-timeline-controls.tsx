"use client";

/**
 * ParcelTimelineControls — client island.
 *
 * Controles interactivos de la timeline de fumigaciones (M7):
 *   - Date range picker (from / to) — submit recarga la page con
 *     nuevos query params.
 *   - Mode toggle (resumen / detalle) — push a URL con `?mode=...`.
 *
 * Por qué es client component y no server: necesita `useRouter` +
 * `useSearchParams` para navegar sin recargar. El padre (server page)
 * lee los params, fetchea data, y re-renderiza el ParcelTimeline.
 *
 * Diseño "URL-driven": la fuente de verdad del state es la URL, no
 * useState. Esto permite bookmarking, deep linking, y back/forward
 * del browser sin lógica extra. Trade-off conocido (M7): un cambio
 * de fecha hace un round-trip al server (acceptable para data
 * operativa fresca).
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { ParcelTimelineMode } from "./parcel-timeline";

export interface ParcelTimelineControlsProps {
  /** Defaults activos (vienen de la URL actual o del page server). */
  defaultFrom: string;
  defaultTo: string;
  defaultMode: ParcelTimelineMode;
}

const MODES: Array<{ value: ParcelTimelineMode; label: string }> = [
  { value: "detail", label: "Detalle" },
  { value: "summary", label: "Resumen" }
];

export function ParcelTimelineControls({
  defaultFrom,
  defaultTo,
  defaultMode
}: ParcelTimelineControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function applyUpdate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `?${qs}` : "?");
    });
  }

  function handleDateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (from > to) {
      // El server retorna 400. Mejor: no permitir el submit acá.
      // Por simplicidad M7 dejamos que el server responda.
      return;
    }
    applyUpdate({ from, to });
  }

  return (
    <div
      aria-label="Controles de timeline"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d2ddd6] bg-white p-4 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-pending={isPending ? "true" : "false"}
      data-testid="parcel-timeline-controls"
    >
      <form
        className="flex flex-wrap items-end gap-2 text-xs"
        onSubmit={handleDateSubmit}
      >
        <label className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            Desde
          </span>
          <input
            className="mt-1 rounded border border-[#cfd8d3] px-2 py-1.5 text-sm"
            data-testid="parcel-timeline-controls-from"
            onChange={(e) => setFrom(e.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
            Hasta
          </span>
          <input
            className="mt-1 rounded border border-[#cfd8d3] px-2 py-1.5 text-sm"
            data-testid="parcel-timeline-controls-to"
            onChange={(e) => setTo(e.target.value)}
            type="date"
            value={to}
          />
        </label>
        <button
          className="rounded-full bg-[#0b5f2d] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Aplicando…" : "Aplicar"}
        </button>
      </form>

      <div
        aria-label="Modo de visualización"
        className="flex items-center gap-1 rounded-full border border-[#cfd8d3] p-1"
        data-testid="parcel-timeline-controls-mode"
        role="group"
      >
        {MODES.map((m) => {
          const isActive = defaultMode === m.value;
          return (
            <button
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                isActive
                  ? "bg-[#0b5f2d] text-white"
                  : "text-[#0b5f2d] hover:bg-[#dbe7df]"
              }`}
              data-active={isActive}
              data-mode={m.value}
              disabled={isPending}
              key={m.value}
              onClick={() => applyUpdate({ mode: m.value === "detail" ? undefined : m.value })}
              type="button"
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
