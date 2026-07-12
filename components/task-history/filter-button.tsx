"use client";

/**
 * FilterButton — client component.
 *
 * Filtros adicionales para el Task History: parcelId, droneSerial, pilot,
 * cropType. URL state `?parcelId=X&droneSerial=Y&pilot=Z&cropType=W`.
 *
 * Implementación: `<details>` HTML nativo como popover (sin lib). Si
 * el usuario quiere un popover más pulido (shadcn, radix) lo cambiamos
 * después — el contrato de URL state no cambia.
 *
 * Estilo: mismo verde teal (#0b5f2d) y palette del Task History.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";

const DEFAULT_ARIA_LABEL = "Filtros del Task History";
const CROP_TYPES = ["", "Caña", "Frutales", "Otro"] as const;

export interface FilterButtonProps {
  /** Lista de drones sugeridos para el datalist (opcional). */
  droneSuggestions?: string[];
  ariaLabel?: string;
}

export function FilterButton({
  droneSuggestions = [],
  ariaLabel = DEFAULT_ARIA_LABEL
}: FilterButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const [parcelId, setParcelId] = useState(() => searchParams.get("parcelId") ?? "");
  const [droneSerial, setDroneSerial] = useState(() => searchParams.get("droneSerial") ?? "");
  const [pilot, setPilot] = useState(() => searchParams.get("pilot") ?? "");
  const [cropType, setCropType] = useState(() => searchParams.get("cropType") ?? "");

  const apply = useCallback(
    (next: { parcelId?: string; droneSerial?: string; pilot?: string; cropType?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const setOrDelete = (key: string, value: string | undefined) => {
        if (value && value.length > 0) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      };
      setOrDelete("parcelId", next.parcelId);
      setOrDelete("droneSerial", next.droneSerial);
      setOrDelete("pilot", next.pilot);
      setOrDelete("cropType", next.cropType);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
    },
    [router, pathname, searchParams]
  );

  const onApply = useCallback(() => {
    apply({ parcelId, droneSerial, pilot, cropType });
    if (detailsRef.current) detailsRef.current.open = false;
  }, [apply, parcelId, droneSerial, pilot, cropType]);

  const onReset = useCallback(() => {
    setParcelId("");
    setDroneSerial("");
    setPilot("");
    setCropType("");
    apply({ parcelId: "", droneSerial: "", pilot: "", cropType: "" });
  }, [apply]);

  const hasActiveFilters = !!(
    searchParams.get("parcelId") ||
    searchParams.get("droneSerial") ||
    searchParams.get("pilot") ||
    searchParams.get("cropType")
  );

  return (
    <details
      className="relative"
      data-testid="task-history-filter-button"
      ref={detailsRef}
    >
      <summary
        aria-label={ariaLabel}
        className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-[#d2ddd6] bg-white px-3 py-1.5 text-sm font-semibold text-[#121815] hover:bg-[#f4f7f4] [&::-webkit-details-marker]:hidden"
      >
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
          <path d="M2 3h12l-5 6v4l-2-1V9L2 3Z" />
        </svg>
        Filter
        {hasActiveFilters ? (
          <span
            aria-label="filtros activos"
            className="ml-1 inline-block h-2 w-2 rounded-full bg-[#0b5f2d]"
          />
        ) : null}
      </summary>
      <div
        className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-[#d2ddd6] bg-white p-4 shadow-lg"
        data-testid="task-history-filter-panel"
        role="dialog"
      >
        <div className="mb-3 flex flex-col gap-1">
          <label
            className="text-xs font-semibold uppercase tracking-wider text-[#587064]"
            htmlFor="task-history-filter-parcelId"
          >
            Parcel ID
          </label>
          <input
            className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
            data-testid="task-history-filter-parcelId"
            id="task-history-filter-parcelId"
            inputMode="numeric"
            onChange={(e) => setParcelId(e.target.value)}
            placeholder="ej. 42"
            type="text"
            value={parcelId}
          />
        </div>
        <div className="mb-3 flex flex-col gap-1">
          <label
            className="text-xs font-semibold uppercase tracking-wider text-[#587064]"
            htmlFor="task-history-filter-droneSerial"
          >
            Drone serial
          </label>
          <input
            className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
            data-testid="task-history-filter-droneSerial"
            id="task-history-filter-droneSerial"
            list="task-history-drone-suggestions"
            onChange={(e) => setDroneSerial(e.target.value)}
            placeholder="ej. 1581F5BKD23100045"
            type="text"
            value={droneSerial}
          />
          {droneSuggestions.length > 0 ? (
            <datalist id="task-history-drone-suggestions">
              {droneSuggestions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          ) : null}
        </div>
        <div className="mb-3 flex flex-col gap-1">
          <label
            className="text-xs font-semibold uppercase tracking-wider text-[#587064]"
            htmlFor="task-history-filter-pilot"
          >
            Piloto
          </label>
          <input
            className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
            data-testid="task-history-filter-pilot"
            id="task-history-filter-pilot"
            onChange={(e) => setPilot(e.target.value)}
            placeholder="ej. Breiner"
            type="text"
            value={pilot}
          />
        </div>
        <div className="mb-4 flex flex-col gap-1">
          <label
            className="text-xs font-semibold uppercase tracking-wider text-[#587064]"
            htmlFor="task-history-filter-cropType"
          >
            Tipo de cultivo
          </label>
          <select
            className="rounded-md border border-[#d2ddd6] bg-white px-2 py-1.5 text-sm focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
            data-testid="task-history-filter-cropType"
            id="task-history-filter-cropType"
            onChange={(e) => setCropType(e.target.value)}
            value={cropType}
          >
            {CROP_TYPES.map((c) => (
              <option key={c} value={c}>
                {c === "" ? "(Todos)" : c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            className="rounded-md border border-[#d2ddd6] bg-white px-3 py-1.5 text-xs font-semibold text-[#587064] hover:bg-[#f4f7f4]"
            data-testid="task-history-filter-reset"
            onClick={onReset}
            type="button"
          >
            Reset
          </button>
          <button
            className="rounded-md bg-[#0b5f2d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a4f25]"
            data-testid="task-history-filter-apply"
            onClick={onApply}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>
    </details>
  );
}

export default FilterButton;
