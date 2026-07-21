"use client";

/**
 * FlightDetailDrawer — drawer lateral con el detalle completo de un vuelo.
 *
 * v1.7 Track C — audit #11: cuando el operador clickea un vuelo de la
 * sub-lista del DayCard, este drawer muestra:
 *   - ID del vuelo + fecha/hora local
 *   - Drone (serial completo)
 *   - Piloto
 *   - Parcela fumigada (si tiene parcel_id)
 *   - Métricas: duración, área (m² + mu), litros
 *   - Source URL del DJI (si está disponible)
 *
 * Implementación: `<dialog>` HTML nativo con animación CSS simple. Sin
 * librerías de modal (sin shadcn, radix, headlessui). El state de
 * `open`/`closed` se gestiona desde el padre via `flight` prop:
 *   - flight === null → drawer cerrado
 *   - flight !== null → drawer abierto mostrando ese vuelo
 *
 * Accesibilidad:
 *   - `aria-modal="true"` + role="dialog"
 *   - `<Esc>` cierra (el `<dialog>` lo hace nativo)
 *   - `aria-labelledby` apunta al título del drawer
 *   - focus management: el `<dialog>` nativo de HTML enfoca el primer
 *     focusable al abrir; acá forzamos el focus al botón "Cerrar" para
 *     que un screen reader anuncie "Cerrar, botón".
 *
 * Si el alcance crece, este drawer es un buen lugar para meter:
 *   - Mapa mini con el spray_geom de la parcela fumigada
 *   - Lista de fumigaciones (dji_fumigations) que derivan de este vuelo
 *   - Link al plan de vuelo (waypoints) si existe
 */

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import type { FlightListItem } from "@/lib/djiag-from-make/task-history";

export interface FlightDetailDrawerProps {
  /** Vuelo a mostrar. `null` = drawer cerrado. */
  flight: FlightListItem | null;
  /** Callback para cerrar (click en overlay, botón cerrar, o Esc). */
  onClose: () => void;
  /**
   * Lookup opcional de nombre de parcela por id. Si se pasa y el vuelo
   * tiene `parcelId`, se muestra el nombre en vez del número crudo.
   * Si no, se muestra "Parcela #N".
   */
  parcelNameById?: Map<number, string> | Record<number, string>;
  /** Opcional: aria-label del dialog. */
  ariaLabel?: string;
  /** Opcional: data-testid. Default: "task-history-flight-drawer". */
  testId?: string;
}

const DEFAULT_ARIA_LABEL = "Detalle del vuelo";
const DEFAULT_TEST_ID = "task-history-flight-drawer";

/** Formatea segundos a "XhYm" (legible, no formato DJI "XHourYminZs"). */
function compactDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function lookupParcelName(
  parcelId: number | null,
  lookup: FlightDetailDrawerProps["parcelNameById"]
): string {
  if (parcelId === null) return "—";
  if (!lookup) return `Parcela #${parcelId}`;
  const name =
    lookup instanceof Map
      ? lookup.get(parcelId)
      : lookup[parcelId];
  return name ?? `Parcela #${parcelId}`;
}

export function FlightDetailDrawer({
  flight,
  onClose,
  parcelNameById,
  ariaLabel = DEFAULT_ARIA_LABEL,
  testId = DEFAULT_TEST_ID
}: FlightDetailDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Sincronizar el `<dialog>` nativo con el state del padre.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (flight && !dlg.open) {
      dlg.showModal();
      // Mover el foco al botón "Cerrar" para que screen reader anuncie
      // el dialog + su botón de cierre.
      requestAnimationFrame(() => closeBtnRef.current?.focus());
    } else if (!flight && dlg.open) {
      dlg.close();
    }
  }, [flight]);

  // Cerrar con Esc — `<dialog>` lo hace nativo, pero también queremos
  // notificar al padre via onClose (sino el state queda desincronizado).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault(); // dejamos que se cierre solo
      onClose();
    };
    dlg.addEventListener("cancel", onCancel);
    return () => dlg.removeEventListener("cancel", onCancel);
  }, [onClose]);

  // Cerrar cuando el usuario clickea el backdrop (fuera del contenido).
  // El `<dialog>` nativo NO emite un evento para esto; hay que detectar
  // el click en el dialog en sí y ver si el target === currentTarget.
  const onDialogClick = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      aria-label={ariaLabel}
      aria-modal={flight ? "true" : undefined}
      className="w-full max-w-md rounded-2xl border border-[#d2ddd6] bg-white p-0 shadow-2xl backdrop:bg-[#0f1713]/50"
      data-testid={testId}
      onClick={onDialogClick}
      ref={dialogRef}
    >
      {flight ? (
        <div className="flex flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-[#d2ddd6] p-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#587064]">
                Vuelo #{flight.id}
              </p>
              <h2
                className="mt-1 text-lg font-black tracking-tight text-[#121815]"
                id={`${testId}-title`}
              >
                {flight.localDate} · {flight.localTime}
              </h2>
            </div>
            <button
              aria-label="Cerrar detalle del vuelo"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d2ddd6] bg-white text-[#4a5b50] transition hover:bg-[#f4f7f4] hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
              data-testid={`${testId}-close`}
              onClick={onClose}
              ref={closeBtnRef}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 16 16"
              >
                <line x1="3" x2="13" y1="3" y2="13" />
                <line x1="13" x2="3" y1="3" y2="13" />
              </svg>
            </button>
          </header>
          <dl
            aria-labelledby={`${testId}-title`}
            className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2"
            data-testid={`${testId}-details`}
          >
            <DetailRow label="Drone" testId={`${testId}-drone`} value={flight.droneSerial ?? "—"} />
            <DetailRow label="Piloto" testId={`${testId}-pilot`} value={flight.pilotName ?? "—"} />
            <DetailRow
              label="Parcela"
              testId={`${testId}-parcel`}
              value={lookupParcelName(flight.parcelId, parcelNameById)}
            />
            <DetailRow
              label="Duración"
              testId={`${testId}-duration`}
              value={compactDuration(flight.durationSeconds)}
            />
            <DetailRow
              label="Área fumigada"
              testId={`${testId}-area`}
              value={`${flight.areaMu.toFixed(2)} mu`}
            />
            <DetailRow
              label="Litros"
              testId={`${testId}-liters`}
              value={`${flight.liters.toFixed(1)} L`}
            />
          </dl>
          {/*
            TODO v1.7+ Track C: source URL del DJI para este vuelo
            (link al detail page de DJI AG). Requiere:
              1) columna source_url en dji_flights (migration) — bloqueada
                 por el constraint "0 schema changes" del sprint.
              2) JOIN a dji_parcels.source_url_geometry si queremos
                 mostrar también el mapa de la parcela fumigada.
            Por ahora se omite. Si en el futuro se agrega, el lugar
            para meter el <a> es acá, después del </dl> y antes del
            footer.
          */}
          <footer className="border-t border-[#d2ddd6] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#587064]">
              Detalle de vuelo · fuente: dji_flights
            </p>
          </footer>
        </div>
      ) : null}
    </dialog>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  testId?: string;
}

function DetailRow({ label, value, testId }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
        {label}
      </dt>
      <dd
        className="break-words text-sm font-semibold text-[#121815]"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

export default FlightDetailDrawer;
