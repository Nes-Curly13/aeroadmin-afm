"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect } from "react";

/**
 * TimeRange — slider doble con histograma de actividad y play/pause.
 *
 * Patrón del V0 (`docs/fumigation-management-dashboard/components/geovisor/time-range.tsx`).
 * Permite al operador acotar el rango temporal de fumigaciones que se
 * muestran en el mapa y reproducirlo como una animación.
 *
 * Estructura:
 *   1. Header con label de la ventana ("ene 26 — jul 26") y controles
 *      play/pause + reset.
 *   2. Histograma de actividad por mes (alto = count de fumigaciones,
 *      color = dentro/fuera del rango activo).
 *   3. Slider doble (min/max) con thumbs que arrastran los extremos del
 *      rango.
 *
 * Accesibilidad:
 *   - Los botones play/pause/reset tienen `aria-label` específico.
 *   - El slider usa `<input type="range">` (HTML nativo) con
 *     `aria-label` y `aria-valuemin/max/now` (screen reader friendly).
 *     Limitación: `<input type="range">` solo tiene 1 thumb, no 2.
 *     Para doble-thumb accesible de verdad hace falta @base-ui Slider
 *     o react-range. Decisión de scope: 2 sliders separados (min y max)
 *     con labels claros es accesible y simple.
 *   - El histograma es `aria-hidden` (decorativo — el valor se anuncia
 *     vía el header "ene 26 — jul 26").
 *   - `prefers-reduced-motion`: el autoplay respeta el media query
 *     (no se inicia si el user lo prefiere reducir).
 *
 * Decisión de scope: implementación con 2 sliders HTML nativos (no
 * @base-ui Slider) por simplicidad. El slider doble accesible de
 * verdad se puede migrar a @base-ui en un sprint futuro.
 */

export interface MonthBucket {
  key: string;
  label: string;
  start: number;
  end: number;
  count: number;
}

export interface TimeRangeProps {
  months: MonthBucket[];
  /** Tupla [minIdx, maxIdx] con índices en el array `months`. */
  range: [number, number];
  onRangeChange: (r: [number, number]) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
}

const AUTOPLAY_INTERVAL_MS = 850;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function TimeRange({
  months,
  range,
  onRangeChange,
  playing,
  onPlayingChange
}: TimeRangeProps) {
  const max = Math.max(0, months.length - 1);
  const maxCount = Math.max(1, ...months.map((m) => m.count));

  // Autoplay: avanza el extremo derecho del rango cada 850ms.
  // Respeta prefers-reduced-motion (no inicia).
  useEffect(() => {
    if (!playing) return;
    if (prefersReducedMotion()) {
      onPlayingChange(false);
      return;
    }
    const width = range[1] - range[0];
    const id = setInterval(() => {
      const nextEnd = range[1] + 1;
      if (nextEnd > max) {
        onPlayingChange(false);
        return;
      }
      onRangeChange([Math.max(0, nextEnd - width), nextEnd]);
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, range, max, onRangeChange, onPlayingChange]);

  if (months.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card/95 p-3 text-center text-xs text-muted-foreground shadow-sm">
        Sin fumigaciones en el dataset para mostrar la línea de tiempo.
      </div>
    );
  }

  const startLabel = months[range[0]]?.label ?? "—";
  const endLabel = months[range[1]]?.label ?? "—";

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="map-time-range"
      role="group"
      aria-label="Ventana temporal de fumigaciones"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ventana temporal
          </span>
          <span className="font-mono text-sm font-semibold" data-testid="time-range-label">
            {startLabel} — {endLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={playing ? "Pausar animación temporal" : "Reproducir animación temporal"}
            aria-pressed={playing}
            className={
              "flex h-8 w-8 items-center justify-center rounded-md border outline-none transition-colors " +
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
              (playing
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted")
            }
            data-testid="time-range-play"
            onClick={() => onPlayingChange(!playing)}
          >
            {playing ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            aria-label="Restablecer al histórico completo"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="time-range-reset"
            onClick={() => {
              onPlayingChange(false);
              onRangeChange([0, max]);
            }}
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Histograma de actividad por mes */}
      <div
        className="flex h-12 items-end gap-[3px]"
        aria-hidden
        data-testid="time-range-histogram"
      >
        {months.map((m, i) => {
          const inRange = i >= range[0] && i <= range[1];
          return (
            <div
              key={m.key}
              className={
                "flex-1 rounded-t-[2px] transition-colors " +
                (inRange ? "bg-primary" : "bg-muted")
              }
              style={{ height: `${Math.max(6, (m.count / maxCount) * 100)}%` }}
              title={`${m.label}: ${m.count} aplicaciones`}
            />
          );
        })}
      </div>

      {/* Slider doble (2 inputs HTML nativos) */}
      <div className="flex items-center gap-3">
        <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Desde
          <input
            aria-label="Mes de inicio"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="time-range-min"
            max={range[1]}
            min={0}
            onChange={(e) => {
              onPlayingChange(false);
              const v = Math.min(Number(e.target.value), range[1]);
              onRangeChange([v, range[1]]);
            }}
            type="range"
            value={range[0]}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Hasta
          <input
            aria-label="Mes de fin"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="time-range-max"
            max={max}
            min={range[0]}
            onChange={(e) => {
              onPlayingChange(false);
              const v = Math.max(Number(e.target.value), range[0]);
              onRangeChange([range[0], v]);
            }}
            type="range"
            value={range[1]}
          />
        </label>
      </div>
    </div>
  );
}
