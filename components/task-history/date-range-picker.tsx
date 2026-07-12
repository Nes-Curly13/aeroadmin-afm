"use client";

/**
 * DateRangePicker — client component.
 *
 * Picker de rango de fechas (from, to) usando `<input type="date">`
 * nativos del browser. No usa react-day-picker (decisión pragmática:
 * el nativo funciona, zero deps, zero incompatibilidades con React 19).
 *
 * URL state: `?from=YYYY-MM-DD&to=YYYY-MM-DD`. El default es últimos 6
 * meses (coincide con DEFAULT_WINDOW_DAYS de la API).
 *
 * Estilo: input con border, hover, focus ring. Mismo verde teal que
 * el resto del Task History (#0b5f2d).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_FROM_DAYS_AGO = 183; // ~6 meses
const DEFAULT_ARIA_LABEL = "Rango de fechas del Task History";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseIsoDateSafe(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return s;
}

export interface DateRangePickerProps {
  /** Default: "2026-01-01" o 6 meses atrás, el que sea mayor. */
  fromDefault?: string;
  /** Default: hoy (UTC). */
  toDefault?: string;
  /** Opcional: aria-label del contenedor. */
  ariaLabel?: string;
}

export function DateRangePicker({
  fromDefault,
  toDefault,
  ariaLabel = DEFAULT_ARIA_LABEL
}: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaultFrom = fromDefault ?? daysAgoIso(DEFAULT_FROM_DAYS_AGO);
  const defaultTo = toDefault ?? todayIso();

  const [from, setFrom] = useState(() =>
    parseIsoDateSafe(searchParams.get("from"), defaultFrom)
  );
  const [to, setTo] = useState(() => parseIsoDateSafe(searchParams.get("to"), defaultTo));

  // Sincronizar con URL changes (e.g. back/forward del browser).
  useEffect(() => {
    const fromUrl = parseIsoDateSafe(searchParams.get("from"), defaultFrom);
    const toUrl = parseIsoDateSafe(searchParams.get("to"), defaultTo);
    if (fromUrl !== from) setFrom(fromUrl);
    if (toUrl !== to) setTo(toUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const apply = useCallback(
    (newFrom: string, newTo: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // Validar: from <= to
      if (newFrom > newTo) {
        // Si el usuario invirtió el rango, swap.
        [newFrom, newTo] = [newTo, newFrom];
      }
      if (newFrom === defaultFrom) {
        params.delete("from");
      } else {
        params.set("from", newFrom);
      }
      if (newTo === defaultTo) {
        params.delete("to");
      } else {
        params.set("to", newTo);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
    },
    [router, pathname, searchParams, defaultFrom, defaultTo]
  );

  return (
    <div
      aria-label={ariaLabel}
      className="flex items-center gap-2"
      data-testid="task-history-date-range-picker"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-[#587064]">
        Rango
      </span>
      <input
        aria-label="Fecha de inicio"
        className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm font-medium text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
        data-testid="task-history-date-from"
        max={to}
        onChange={(e) => setFrom(e.target.value)}
        onBlur={() => from && to && apply(from, to)}
        type="date"
        value={from}
      />
      <span aria-hidden="true" className="text-[#587064]">
        →
      </span>
      <input
        aria-label="Fecha de fin"
        className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm font-medium text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
        data-testid="task-history-date-to"
        min={from}
        onChange={(e) => setTo(e.target.value)}
        onBlur={() => from && to && apply(from, to)}
        type="date"
        value={to}
      />
      {(from !== defaultFrom || to !== defaultTo) && (
        <button
          aria-label="Resetear rango a últimos 6 meses"
          className="ml-1 rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-xs font-semibold text-[#587064] hover:bg-[#f4f7f4] hover:text-[#0b5f2d]"
          data-testid="task-history-date-reset"
          onClick={() => apply(defaultFrom, defaultTo)}
          type="button"
        >
          Reset
        </button>
      )}
    </div>
  );
}

export default DateRangePicker;
