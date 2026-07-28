// components/dashboard/health-panel.tsx
//
// Sprint S6 (V0 port v2) — Panel de salud del pipeline DJI AG.
// Port 1:1 del mockup V0 (`docs/fumigation-management-dashboard/components/
// dashboard/health-panel.tsx`) al proyecto real, con adaptación del shape
// de datos.
//
// Decisiones de adaptación:
//
//   1. SHAPE DE HEALTH — el V0 usaba `DjiAgHealth` (status: "ok"|"partial"|
//      "error", duration_ms, parcels_synced, flights_synced, api_latency_ms,
//      next_run_at, token_expires_at, consecutive_failures, last_run_at).
//      El proyecto expone `HealthResponse` (5 estados: "ok"|"partial"|
//      "stale"|"unknown"|"failed") con un set de campos distinto:
//      lastRunAt, lastRunStatus, flightsLastSync, fumigationsLastSync,
//      landsLastSync, hoursSinceLastSync, warnings, steps. Por eso
//      `health: HealthResponse`.
//
//      Campos no disponibles que el V0 mostraba (api_latency_ms,
//      next_run_at, token_expires_at, consecutive_failures) se omiten del
//      grid de metrics. En su lugar usamos los 4 campos que sí tenemos.
//
//   2. SHAPE DE BATCHES — el V0 usaba `DjiImportBatch[]` con id, status,
//      started_at, parcels_upserted, flights_upserted, fumigations_upserted,
//      message. El proyecto no tiene una tabla `dji_import_batches`;
//      usa `StepHealth[]` (cada step es una fase del pipeline). El
//      prop se llama `batches?: StepHealth[]` (default = `health.steps`).
//      Esto preserva el shape del V0 (lista de runs) sin requerir una
//      tabla nueva.
//
//   3. CARD / BADGE — el V0 usa `<Card>`, `<CardHeader>`, etc. + `<Badge>`.
//      Card existe en el proyecto. Badge AÚN NO EXISTE — usamos un span
//      con las clases equivalentes al Badge "outline" del V0, y un TODO
//      para que el agente de primitives lo reemplace por `<Badge
//      variant="outline">` cuando esté listo.
//
//   4. BANNER ROJO si status !== "ok" — el V0 pintaba rojo si status no
//      era "ok". En nuestro caso, "stale" no es un fallo del pipeline
//      sino solo "el último run exitoso fue hace mucho". Mantenemos
//      el banner rojo solo para `partial` y `failed` (críticos). `stale`
//      se renderiza con amarillo (warning). `unknown` se renderiza con
//      gris (neutro). Es la misma lógica que la versión previa.
//
//   5. HELPERS — el V0 importa `fmtDateTime`, `fmtInt`, `fmtRelative`
//      desde `@/lib/format`. El proyecto tiene `formatAgo`, `formatNumber`
//      pero no `fmtDateTime`, `fmtInt`, ni `fmtRelative` (excepto el que
//      definimos en `recent-activity.tsx`). Definimos los helpers
//      faltantes localmente. Si en el futuro se usan en otros lados, se
//      promueven a `lib/format.ts`.
//
// Accesibilidad:
//   - `data-slot="health-panel"` para identificación externa.
//   - `data-tone` en el banner para que el caller pueda aplicar styling
//     compuesto (e.g. según el tono, ocultar el flights badge).
//   - Banner tiene `aria-label` con el estado textual para screen
//     readers (los iconos son decorativos).

import { Activity, CircleAlert, CircleCheck, CircleX, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAgo, formatNumber } from "@/lib/format";
import {
  type HealthResponse,
  type HealthStatus,
  type StepHealth
} from "@/lib/djiag-health-types";

/**
 * Mapping de HealthStatus → icono + label + tono visual.
 *
 * Tonos:
 *   - "ok"       → verde (CircleCheck).
 *   - "partial"  → amarillo (CircleAlert). El último run tuvo steps
 *                  fallidos pero no es un fallo total.
 *   - "stale"    → amarillo (CircleAlert). El último run fue ok pero
 *                  hace >24h. No es un fallo, es un atraso.
 *   - "failed"   → rojo (CircleX). El último run falló.
 *   - "unknown"  → gris (CircleAlert). No hay info disponible.
 */
const STATUS_UI: Record<
  HealthStatus,
  { icon: LucideIcon; label: string; className: string; tone: "ok" | "warn" | "danger" | "unknown" }
> = {
  ok: { icon: CircleCheck, label: "OK", className: "text-primary", tone: "ok" },
  partial: { icon: CircleAlert, label: "Parcial", className: "text-[#c7a43a]", tone: "warn" },
  stale: { icon: CircleAlert, label: "Stale", className: "text-[#c7a43a]", tone: "warn" },
  failed: { icon: CircleX, label: "Error", className: "text-destructive", tone: "danger" },
  unknown: { icon: CircleAlert, label: "Sin datos", className: "text-muted-foreground", tone: "unknown" }
};

const TONE_BANNER: Record<"ok" | "warn" | "danger" | "unknown", { bg: string; border: string; text: string }> = {
  ok: { bg: "bg-[#e9f5ed]", border: "border-[#0b5f2d]/20", text: "text-[#0b5f2d]" },
  warn: { bg: "bg-[#fff7e0]", border: "border-[#d4b23c]/40", text: "text-[#7a5f0d]" },
  danger: { bg: "bg-[#fdecec]", border: "border-[#a93232]/30", text: "text-[#a93232]" },
  unknown: { bg: "bg-[#f4f7f4]", border: "border-[#cfd8d3]", text: "text-[#4a5b50]" }
};

export interface HealthPanelProps {
  /** Estado del pipeline DJI (cargado vía `loadSyncHealth()` en el page). */
  health: HealthResponse;
  /**
   * Lotes / steps recientes del pipeline. Si se omite, usa
   * `health.steps` (default).
   *
   * El proyecto no tiene una tabla `dji_import_batches`; usa los
   * `StepHealth[]` del pipeline (flights, fumigations, lands) como
   * equivalente.
   */
  batches?: StepHealth[];
}

// ---------------------------------------------------------------------------
// Helpers locales (espejo del V0 `lib/format.ts`).
// ---------------------------------------------------------------------------

/** Formato de fecha completa con hora: "23 jul 2026, 10:00" en es-CO. */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

/** Formato entero (es-CO, sin decimales). Espejo de `fmtInt` V0. */
function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
}

export function HealthPanel({ health, batches }: HealthPanelProps) {
  const Ui = STATUS_UI[health.status];
  const bannerStyles = TONE_BANNER[Ui.tone];
  const listBatches = batches ?? health.steps;

  return (
    <Card data-slot="health-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity aria-hidden className="size-4 text-primary" />
          Salud del pipeline DJI AG
        </CardTitle>
        <CardDescription>djiag_health + últimos pasos del pipeline</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Banner de estado. Tono derivado del status. */}
        <div
          aria-label={`Estado del pipeline: ${Ui.label}`}
          className={`flex items-center gap-3 rounded-md border p-3 ${bannerStyles.bg} ${bannerStyles.border}`}
          data-testid="health-banner"
          data-tone={Ui.tone}
        >
          <Ui.icon aria-hidden className={`size-6 shrink-0 ${Ui.className}`} />
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-bold ${bannerStyles.text}`}
              data-testid="health-status-line"
            >
              {`Último run ${Ui.label}${health.lastRunAt ? ` · ${formatAgo(health.hoursSinceLastSync)}` : ""}`}
            </p>
            {health.lastRunAt ? (
              <p
                className={`truncate font-mono text-[11px] ${bannerStyles.text}`}
                data-testid="health-last-run-at"
              >
                {fmtDateTime(health.lastRunAt)}
              </p>
            ) : (
              <p
                className={`truncate text-[11px] ${bannerStyles.text}`}
                data-testid="health-last-run-at"
              >
                Sin registro de última corrida
              </p>
            )}
          </div>
          {health.flightsLastSync !== null ? (
            <span data-testid="health-flights-badge">
              <Badge
                className={`font-mono text-[11px] ${bannerStyles.text} ${bannerStyles.border} bg-white/40`}
                variant="outline"
              >
                {`${formatNumber(health.flightsLastSync)} vuelos`}
              </Badge>
            </span>
          ) : null}
        </div>

        {/* Grid de 4 metrics derivados de HealthResponse. */}
        <dl className="grid grid-cols-2 gap-2" data-testid="health-metrics">
          {(
            [
              ["Parcelas sincronizadas", fmtInt(health.landsLastSync ?? 0)],
              ["Vuelos del último run", fmtInt(health.flightsLastSync ?? 0)],
              ["Fumigaciones del último run", fmtInt(health.fumigationsLastSync ?? 0)],
              [
                "Última sync hace",
                health.hoursSinceLastSync !== null ? formatAgo(health.hoursSinceLastSync) : "—"
              ]
            ] as const
          ).map(([k, v]) => (
            <div className="rounded-md border border-border px-2.5 py-2" key={k}>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        {/* Warnings (si los hay). */}
        {health.warnings.length > 0 ? (
          <ul
            aria-label="Advertencias del pipeline"
            className="flex flex-col gap-1 rounded-md border border-[#a93232]/20 bg-[#fdecec] p-2.5 text-[11px] text-[#a93232]"
            data-testid="health-warnings"
          >
            {health.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        ) : null}

        {/* Lista de steps / batches (top 5). */}
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Lotes recientes
          </p>
          {listBatches.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="health-batches-empty"
            >
              No hay corridas registradas.
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="health-batches">
              {listBatches.slice(0, 5).map((b) => {
                const stepTone = STATUS_UI[b.status === "skipped" ? "stale" : b.status] ?? STATUS_UI.unknown;
                return (
                  <li
                    className="flex items-start gap-2.5 py-2"
                    data-batch-name={b.name}
                    data-step-status={b.status}
                    key={`${b.order}-${b.name}`}
                  >
                    <stepTone.icon
                      aria-hidden
                      className={`mt-0.5 size-3.5 shrink-0 ${stepTone.className}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold">{b.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {`status: ${b.status}${b.durationMs !== undefined ? ` · ${(b.durationMs / 1000).toFixed(1)} s` : ""}`}
                      </p>
                      {b.error ? (
                        <p
                          className="mt-0.5 text-[11px] text-destructive"
                          data-testid={`health-batch-error-${b.name}`}
                        >
                          {b.error}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
