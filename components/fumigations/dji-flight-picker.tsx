/**
 * components/fumigations/dji-flight-picker.tsx
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 2.5 — Importar vuelo DJI.
 *
 * Picker read-only que lista los vuelos DJI disponibles para una
 * parcela (consume `GET /api/dji-flights/search?parcelId=X`).
 *
 * El operator elige un vuelo y el callback `onPick` recibe el flight
 * completo. La página padre (e.g. el step 0 del wizard de nueva
 * fumigación) usa esa data para pre-llenar el form:
 *   - applied_at = flight.start_at
 *   - duration_minutes = flight.duration_seconds / 60
 *   - area_fumigated_m2 = flight.area_m2
 *   - drone_code_used (derivado de drone_serial via VehiclePicker)
 *   - pilot_name = flight.pilot_name
 *
 * Patrón visual consistente con `ProductPicker` / `VehiclePicker`:
 * - Card clickable por flight
 * - Loading state con spinner
 * - Empty state con mensaje
 * - Error state con mensaje (no rompe la UI)
 *
 * Por qué fetch en useEffect (no RSC): este componente se monta
 * dentro del wizard client (step 0). La página padre es client, así
 * que el fetch tiene que ser client también. Usar RSC implicaría
 * refactorear el wizard entero a async server component, fuera de
 * scope para este PR.
 */

"use client";

import { useEffect, useState } from "react";
import { Loader2, Plane, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SpinnerInline } from "@/components/ui/loading";
import { fmtDec, fmtInt } from "@/lib/format";

export interface DjiFlight {
  id: number;
  flight_id: number;
  drone_serial: string | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  area_m2: string | null;
  spray_usage_ml: number | null;
  lng: string | null;
  lat: string | null;
}

interface DjiFlightPickerProps {
  parcelaId: number;
  onPick: (flight: DjiFlight) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; flights: DjiFlight[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function DjiFlightPicker({ parcelaId, onPick }: DjiFlightPickerProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/dji-flights/search?parcelId=${parcelaId}`
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({
            kind: "error",
            message: `Error ${res.status} del servidor`
          });
          return;
        }
        const data = (await res.json()) as { flights: DjiFlight[] };
        if (cancelled) return;
        const flights = data.flights ?? [];
        setState(flights.length > 0 ? { kind: "ok", flights } : { kind: "empty" });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "error de red"
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parcelaId]);

  // ============================================================
  // Render
  // ============================================================

  if (state.kind === "loading") {
    return (
      <div
        data-testid="loading"
        className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
      >
        <SpinnerInline />
        <span>Buscando vuelos DJI para esta parcela…</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        data-testid="error"
        className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p className="font-semibold">No se pudieron cargar los vuelos.</p>
        <p className="mt-0.5 text-xs">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div
        data-testid="empty"
        className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground"
      >
        <p>No hay vuelos registrados en los últimos 30 días para esta parcela.</p>
        <p className="mt-1 text-xs">
          Podés registrar la fumigación manualmente igual.
        </p>
      </div>
    );
  }

  // state.kind === "ok"
  return (
    <ul className="flex flex-col gap-2" data-testid="flight-list">
      {state.flights.map((flight) => (
        <li key={flight.id}>
          <FlightCard flight={flight} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// FlightCard — un item de la lista
// ============================================================

function FlightCard({
  flight,
  onPick
}: {
  flight: DjiFlight;
  onPick: (f: DjiFlight) => void;
}) {
  const areaHa = flight.area_m2 ? Number(flight.area_m2) / 10000 : null;
  const durationMin = Math.round(flight.duration_seconds / 60);
  // Format start_at como YYYY-MM-DD HH:mm en Bogota (TZ-fragile tests
  // — usamos Intl.DateTimeFormat, no aserciones en strings exactos).
  const startDate = formatBogota(flight.start_at);

  return (
    <Card
      data-testid="flight-card"
      role="button"
      tabIndex={0}
      onClick={() => onPick(flight)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(flight);
        }
      }}
      className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="font-mono text-[10px] text-muted-foreground">
              {`DJI flight #${flight.flight_id}`}
            </p>
            <p className="text-sm font-semibold">{startDate}</p>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {durationMin} min
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {flight.drone_nickname ? (
            <span className="flex items-center gap-1">
              <Plane className="size-3" aria-hidden />
              {flight.drone_nickname}
            </span>
          ) : flight.drone_serial ? (
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <Plane className="size-3" aria-hidden />
              {flight.drone_serial}
            </span>
          ) : null}
          {flight.pilot_name ? (
            <span className="flex items-center gap-1">
              <User className="size-3" aria-hidden />
              {flight.pilot_name}
            </span>
          ) : null}
          {areaHa != null ? (
            <span className="font-mono tabular-nums">
              {`${fmtDec(areaHa)} ha`}
            </span>
          ) : null}
        </div>
        {flight.spray_usage_ml != null ? (
          <p className="font-mono text-[10px] text-muted-foreground">
            {`Volumen: ${fmtInt(flight.spray_usage_ml)} mL`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Formatea un ISO timestamptz como "YYYY-MM-DD HH:mm" en TZ Bogota.
 * TZ-fragile — los tests NO asertan en el string exacto (ver
 * `lib/format.ts` y los patterns en `vitest-jsdom-patterns.md`).
 */
function formatBogota(iso: string): string {
  try {
    const d = new Date(iso);
    const datePart = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
    return `${datePart} ${timePart}`;
  } catch {
    return iso;
  }
}
