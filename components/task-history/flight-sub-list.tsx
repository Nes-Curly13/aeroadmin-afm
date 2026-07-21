"use client";

/**
 * FlightSubList — sub-lista de vuelos individuales dentro de DayCard.
 *
 * v1.7 Track C — audit #11: complementa el rollup diario del DayCard
 * con los vuelos individuales que componen el día. Responde la pregunta
 * del operador: "qué vuelo fumigó qué parcela, con qué dron, a qué hora".
 *
 * Layout:
 *
 *   ┌─ divider ──────────────────────────────────────────┐
 *   │ 09:14  T40#45            Breiner    12.5mu  0.5h  │  ← item clickable
 *   │ 11:32  T40#45            Breiner     5.8mu  0.4h  │
 *   │ 14:50  T50#98            Carlos      0.0mu  0.0h  │
 *   └────────────────────────────────────────────────────┘
 *
 * Decisiones:
 *   - `divider` arriba para separar visualmente del MetricsGrid.
 *   - "HH:MM  drone  piloto  area  duration" — ultra-compacto. Sin
 *     labels (el operador ya sabe qué es cada columna del contexto).
 *   - Items clickeables solo si se pasa `onFlightClick`. Si no, se
 *     renderizan como `<div>` (no `<button>`) para no confundir a
 *     screen readers.
 *   - Sin truncado hardcode: el caller pasa la lista ya truncada (típicamente
 *     top 3-5). Esto deja el control de "cuántos mostrar" en el caller
 *     (la page puede ajustar según densidad de pantalla).
 *   - Sin emoji/lucide: el drone serial va acortado (últimos 5 chars)
 *     si es muy largo para no romper la fila.
 */

import type { FlightListItem } from "@/lib/djiag-from-make/task-history";

export interface FlightSubListProps {
  flights: FlightListItem[];
  /** Opcional: callback para abrir el FlightDetailDrawer. */
  onFlightClick?: (flight: FlightListItem) => void;
  /** Opcional: aria-label para la lista. */
  ariaLabel?: string;
  /** Opcional: data-testid base. Default: "task-history-flight-sub-list". */
  testId?: string;
}

const DEFAULT_ARIA_LABEL = "Vuelos del día";
const DEFAULT_TEST_ID = "task-history-flight-sub-list";
const MAX_VISIBLE_FLIGHTS = 5;

/** Acorta un serial de dron tipo "1581F5BKD23100045" → "…00045". */
function shortDroneSerial(serial: string | null): string {
  if (!serial) return "—";
  if (serial.length <= 7) return serial;
  return `…${serial.slice(-5)}`;
}

/** Formatea duration (seconds) a "XhYm" compacto. */
function compactDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function FlightSubList({
  flights,
  onFlightClick,
  ariaLabel = DEFAULT_ARIA_LABEL,
  testId = DEFAULT_TEST_ID
}: FlightSubListProps) {
  if (flights.length === 0) return null;
  // Mostrar solo los primeros N — el caller pasa la lista completa,
  // acá limitamos para que el card no explote visualmente.
  const visible = flights.slice(0, MAX_VISIBLE_FLIGHTS);
  const hidden = flights.length - visible.length;
  return (
    <section
      aria-label={ariaLabel}
      className="mt-3 border-t border-[#d2ddd6] pt-3"
      data-testid={testId}
    >
      <ul className="flex flex-col gap-1.5" data-testid={`${testId}-items`}>
        {visible.map((flight) => {
          const drone = shortDroneSerial(flight.droneSerial);
          const pilot = flight.pilotName ?? "—";
          const area = flight.areaMu.toFixed(1);
          const dur = compactDuration(flight.durationSeconds);
          const time = flight.localTime;
          // Fila: HH:MM  drone  piloto  area  duration
          const content = (
            <>
              <span
                aria-hidden={onFlightClick ? undefined : "true"}
                className="font-mono text-[11px] tabular-nums text-[#587064]"
              >
                {time}
              </span>
              <span className="font-mono text-[11px] font-semibold text-[#121815]">
                {drone}
              </span>
              <span className="truncate text-[11px] text-[#4a5b50]">{pilot}</span>
              <span className="text-right font-mono text-[11px] tabular-nums text-[#0b5f2d]">
                {area}mu
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-[#c7a43a]">
                {dur}
              </span>
            </>
          );
          const baseRow =
            "grid grid-cols-[44px_64px_minmax(0,1fr)_56px_44px] items-center gap-2 rounded-md px-2 py-1 text-left transition";
          if (onFlightClick) {
            return (
              <li key={flight.id}>
                <button
                  aria-label={`Vuelo ${flight.id} a las ${time} con dron ${drone}`}
                  className={`${baseRow} w-full cursor-pointer hover:bg-[#f4f7f4] focus:bg-[#f4f7f4] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30`}
                  data-testid={`${testId}-item`}
                  data-flight-id={flight.id}
                  onClick={() => onFlightClick(flight)}
                  type="button"
                >
                  {content}
                </button>
              </li>
            );
          }
          return (
            <li
              className={`${baseRow} bg-transparent`}
              data-flight-id={flight.id}
              data-testid={`${testId}-item`}
              key={flight.id}
            >
              {content}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p
          className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#587064]"
          data-testid={`${testId}-more`}
        >
          +{hidden} vuelo{hidden === 1 ? "" : "s"} más
        </p>
      ) : null}
    </section>
  );
}

export default FlightSubList;
