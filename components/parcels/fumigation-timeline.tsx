"use client";

// components/parcels/fumigation-timeline.tsx
//
// FumigationTimeline — v0.1 (port del V0 a nuestro proyecto).
//
// Sprint v0.1 — port de `docs/fumigation-management-dashboard/components/parcels/fumigation-timeline.tsx`.
// Adaptaciones al proyecto actual:
//   - Tipos: usa `DjiFumigationEvent` (de `lib/types.ts`) en lugar del `DjiFumigation`
//     del V0. La fecha es `fumigation_date` (YYYY-MM-DD) en lugar de `executed_at`
//     (ISO datetime) — más simple, sin TZ drift.
//   - Sin `Badge` primitive (todavía no existe). Usamos divs con clases
//     `rounded-full px-2.5 py-0.5` que es el patrón que usa el resto de
//     `components/parcels/*` (consistente con `parcel-fumigations.tsx`).
//   - Sin `lib/data` (droneModel, SOURCE_LABEL, fmtDate, etc. del V0). Usamos
//     los helpers de `lib/format.ts` (`toDateString`, `daysBetween`).
//   - Flight linkage: el V0 usaba `DjiFlight.fumigation_id`. Nuestro modelo
//     es al revés: `DjiFumigationEvent.flight_ids: number[] | null`
//     (linkage N:M agregado en Sprint G2). Filtramos `flights` por
//     `fumigation.flight_ids.includes(flight.id)`.
//   - "En ventana" (gap <= cadencia + 2 días) se muestra como chip verde.
//     Fuera de ventana se muestra como chip rojo con la deriva vs cadencia.
//   - `human_notes` (Track C v1.4) se muestra como nota libre. `notes` se
//     muestra solo si NO es provenance JSON (vía `isProvenanceNotes`).
//
// El gap se calcula con `daysBetween()` para consistencia TZ (UTC midnight
// en el boundary) — no usamos `new Date().getTime()` directo como el V0
// porque rompe en Bogota (UTC-5) cuando cruza medianoche.
//
// Decisión de producto: la timeline va de más reciente a más vieja (igual
// que el V0). El V0 usaba `[f, prev]` y dejaba `prev = fumigations[i + 1]`
// porque renderizaba al revés. Acá invertimos el orden del map (mismo
// resultado, lectura más natural: arriba lo más nuevo).
//
// Empty state intencional: si no hay fumigaciones, mensaje claro. NO CTA
// (el CTA "Registrar fumigación" vive en `ParcelFumigations`).

import { Droplets, Plane, User } from "lucide-react";

import { daysBetween, isProvenanceNotes, m2ToHa, toDateString } from "@/lib/format";
import type { DjiFumigationEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Vuelo asociado a una fumigación. Mínimo viable para el UI — el caller
 * arma esta lista con un JOIN a `dji_flights` (drone nickname + pilot name).
 *
 * `areaHa` y `durationSeconds` son opcionales porque la BD no siempre los
 * tiene populados (algunos backfills antiguos dejan `area_m2 = null`).
 */
export interface FlightEvent {
  id: number;
  /** YYYY-MM-DD (Bogota-local, ya normalizado en el boundary del repository). */
  date: string;
  droneNickname: string | null;
  pilotName: string | null;
  /** m² → ha via lib/format.ts. Opcional. */
  areaHa: number | null;
  /** Duración del vuelo en segundos. Opcional. */
  durationSeconds: number | null;
}

export interface FumigationTimelineProps {
  /** Eventos de fumigación, ordenados por fecha DESC (más reciente primero). */
  fumigations: DjiFumigationEvent[];
  /**
   * Vuelos de la parcela (de dji_flights). El componente filtra por
   * `fumigation.flight_ids` para mostrar los vuelos que originaron cada
   * fumigación. Si está vacío, simplemente no se muestra el bloque de
   * vuelos por fumigación.
   */
  flights: FlightEvent[];
  /** Cadencia esperada en días (de `dji_fumigation_schedule.recommended_cadence_days`). */
  cadenceDays: number;
}

// =====================================================================
// Helpers de UI (inline, no se exportan — son detalles del componente)
// =====================================================================

const SOURCE_STYLE: Record<string, string> = {
  manual: "border-[#0b5f2d]/40 bg-[#0b5f2d]/10 text-[#0b5f2d]",
  import: "border-[#587064]/40 bg-[#587064]/10 text-[#587064]",
  djiscraper: "border-[#587064]/40 bg-[#587064]/10 text-[#587064]"
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Import",
  djiscraper: "DJI scraper"
};

/**
 * Mapea un gap a un chip "en ventana" / "fuera de ventana".
 * Regla de producto (Sprint v0.1): tolerancia de ±2 días.
 *   - gap <= cadence + 2  → "En ventana" (verde)
 *   - gap >  cadence + 2  → "Fuera de ventana" (rojo)
 */
function inWindowChip(gap: number, cadenceDays: number): { label: string; className: string } {
  if (gap <= cadenceDays + 2) {
    return { label: "En ventana", className: "bg-[#0b5f2d]/10 text-[#0b5f2d]" };
  }
  return { label: "Fuera de ventana", className: "bg-[#a93232]/10 text-[#a93232]" };
}

/** Filtra los flights que pertenecen a una fumigación por `flight_ids`. */
function flightsForFumigation(
  fumigation: DjiFumigationEvent,
  allFlights: FlightEvent[]
): FlightEvent[] {
  const ids = fumigation.flight_ids;
  if (!ids || ids.length === 0) return [];
  const idSet = new Set(ids);
  return allFlights.filter((f) => idSet.has(f.id));
}

/** Formato de duración MM:SS o HH:MM:SS. */
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function FumigationTimeline({ fumigations, flights, cadenceDays }: FumigationTimelineProps) {
  if (fumigations.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground"
        data-slot="fumigation-timeline"
        data-testid="fumigation-timeline-empty"
      >
        Sin fumigaciones registradas.
      </div>
    );
  }

  // Calcular gaps con la fumigación ANTERIOR (siguiente en el array, porque
  // el array viene DESC). Devuelve null si no hay previa (la primera).
  const items = fumigations.map((f, i) => {
    const prev = fumigations[i + 1] ?? null;
    const dateStr = toDateString(f.fumigation_date) ?? "";
    const prevDateStr = prev ? toDateString(prev.fumigation_date) ?? "" : null;
    const gap = prevDateStr ? daysBetween(prevDateStr, dateStr) : null;
    const drift = gap === null ? null : gap - cadenceDays;
    const windowChip = gap !== null ? inWindowChip(gap, cadenceDays) : null;
    const sortie = flightsForFumigation(f, flights);
    return { fumigation: f, dateStr, gap, drift, windowChip, sortie };
  });

  return (
    <ol
      aria-label={`Timeline de ${fumigations.length} fumigaciones`}
      className="flex flex-col"
      data-slot="fumigation-timeline"
      data-testid="fumigation-timeline"
    >
      {items.map(({ fumigation, dateStr, gap, drift, windowChip, sortie }, i) => {
        const isLast = i === items.length - 1;
        return (
          <li
            className="relative flex gap-4 pb-6 pl-1 last:pb-0"
            data-testid={`fumigation-timeline-item-${fumigation.id}`}
            key={fumigation.id}
          >
            {/* Marker + línea conectora */}
            <div className="relative flex flex-col items-center" aria-hidden>
              <span className="mt-1 size-3 shrink-0 rounded-full border-2 border-card bg-[#0b5f2d]" />
              {!isLast ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>

            <div className="flex-1">
              {/* Header: fecha + source + chip de ventana */}
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-semibold tabular-nums text-[#121815]">
                  {dateStr}
                </p>
                {gap !== null ? (
                  <span
                    className="font-mono text-[11px] text-muted-foreground"
                    data-testid={`fumigation-timeline-gap-${fumigation.id}`}
                  >
                    {`${gap} d desde la anterior`}
                    {drift !== null && drift !== 0 ? (
                      <span className={cn("ml-1", drift > 0 ? "text-[#a93232]" : "text-[#0b5f2d]")}>
                        {`(${drift > 0 ? "+" : ""}${drift} vs cadencia)`}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    SOURCE_STYLE[fumigation.source] ?? "border-border bg-muted text-muted-foreground"
                  )}
                  data-testid={`fumigation-timeline-source-${fumigation.id}`}
                  title={
                    fumigation.source === "manual"
                      ? "Registrada por el operador desde la app"
                      : fumigation.source === "djiscraper"
                        ? "Capturada automáticamente del scraper DJI"
                        : "Generada por el backfill desde flights"
                  }
                >
                  {SOURCE_LABEL[fumigation.source] ?? fumigation.source}
                </span>
                {windowChip ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      windowChip.className
                    )}
                    data-testid={`fumigation-timeline-window-${fumigation.id}`}
                  >
                    {windowChip.label}
                  </span>
                ) : null}
              </div>

              {/* Metadata: producto + dosis + área + vuelos + operador */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {fumigation.product_used ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Droplets className="size-3.5 text-[#0b5f2d]" aria-hidden />
                    {`${fumigation.product_used}${
                      fumigation.dose_l_per_ha !== null ? ` · ${fumigation.dose_l_per_ha} L/ha` : ""
                    }`}
                  </span>
                ) : null}
                {(() => {
                  const ha = m2ToHa(fumigation.area_fumigated_m2);
                  return ha !== null ? (
                    <span className="font-mono tabular-nums">{`${ha.toFixed(2)} ha`}</span>
                  ) : null;
                })()}
                {sortie.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Plane className="size-3.5 text-[#7b3f00]" aria-hidden />
                    {`${sortie.length} vuelo${sortie.length === 1 ? "" : "s"}`}
                  </span>
                ) : null}
                {fumigation.recorded_by ? (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="size-3.5" aria-hidden />
                    {fumigation.recorded_by}
                  </span>
                ) : null}
              </div>

              {/* Sortie: chips con detalle de cada vuelo */}
              {sortie.length > 0 ? (
                <div
                  className="mt-2 flex flex-wrap gap-1.5"
                  data-testid={`fumigation-timeline-sortie-${fumigation.id}`}
                >
                  {sortie.map((fl) => (
                    <span
                      className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      key={fl.id}
                      title={`${fl.droneNickname ?? "—"} · ${fl.pilotName ?? "—"}`}
                    >
                      {`${fl.droneNickname ?? "Dron"} · ${formatDuration(fl.durationSeconds)} · ${
                        fl.areaHa !== null ? `${fl.areaHa.toFixed(2)} ha` : "—"
                      }`}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Notas humanas (separadas de provenance JSON) */}
              {fumigation.human_notes ? (
                <p
                  className="mt-2 text-xs italic leading-relaxed text-muted-foreground"
                  data-testid={`fumigation-timeline-human-notes-${fumigation.id}`}
                >
                  {fumigation.human_notes}
                </p>
              ) : null}
              {fumigation.notes && !isProvenanceNotes(fumigation.notes) ? (
                <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground">
                  {fumigation.notes}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
