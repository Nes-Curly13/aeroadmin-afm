// components/dashboard/health-panel.tsx
//
// Sprint S6 (V0 port) — Panel de salud del pipeline DJI AG.
// Adaptado del mockup V0 (docs/fumigation-management-dashboard/components/
// dashboard/health-panel.tsx) al proyecto real.
//
// Decisiones de adaptación:
//
//   1. TIPO DE HEALTH:
//      V0 usaba `DjiAgHealth` (status: ok | partial | error, duration_ms,
//      parcels_synced, flights_synced, api_latency_ms, next_run_at,
//      token_expires_at, consecutive_failures, last_run_at, ...).
//      El proyecto real expone `HealthResponse` (lib/djiag-health.ts) con
//      5 estados (ok | partial | stale | unknown | failed) y un set de
//      campos distinto: hoursSinceLastSync, flightsLastSync,
//      fumigationsLastSync, landsLastSync, warnings, steps, etc.
//      Por eso `health: HealthResponse`.
//
//   2. TIPO DE BATCHES:
//      V0 usaba `DjiImportBatch[]` con id, status, started_at,
//      parcels_upserted, flights_upserted, fumigations_upserted, message.
//      El proyecto NO expone una tabla "import batches" — lo más cercano
//      es `HealthResponse.steps: StepHealth[]` (cada step es una fase del
//      pipeline: flights, fumigations, lands). Por eso:
//        `batches?: StepHealth[]` (opcional, default = `health.steps`).
//      El componente renderiza los campos disponibles: name, status,
//      durationMs, error. Si en el futuro se agrega una tabla real
//      `dji_import_batches`, solo cambia el tipo del prop.
//
//   3. CAMPOS NO DISPONIBLES:
//      - `duration_ms` del run total → no se muestra. En su lugar,
//        mostramos "Última sync hace X" (hoursSinceLastSync).
//      - `api_latency_ms`, `next_run_at`, `token_expires_at`,
//        `consecutive_failures` → no se exponen en HealthResponse.
//        Los omitimos del grid de 6 metrics. El grid queda con 4 metrics
//        derivados de los datos que sí tenemos.
//
//   4. BANNER ROJO si status !== "ok":
//      V0 pintaba rojo si status !== "ok". En nuestro caso, "stale" no es
//      un fallo del pipeline sino solo "el último run exitoso fue hace
//      mucho". Mantenemos el banner rojo solo para los estados realmente
//      críticos: `partial`, `failed`. `stale` se renderiza con amarillo
//      (warning). `unknown` se renderiza con gris (neutro).
//
//   5. CARD / BADGE / TABLE: no usados — solo divs + Tailwind.

import { Activity, CircleAlert, CircleCheck, CircleX, type LucideIcon } from "lucide-react";

import { formatAgo, formatNumber } from "@/lib/format";
import {
  type HealthResponse,
  type HealthStatus,
  type StepHealth
} from "@/lib/djiag-health-types";

/**
 * Mapping de HealthStatus → icono + label + tono visual.
 *
 * "stale" y "partial" comparten icono CircleAlert (alerta) pero diferente
 * clase CSS (warning vs destructive). "unknown" usa CircleAlert también
 * (no es un error, es falta de info) pero en muted.
 *
 * "ok" usa CircleCheck (verde). "failed" usa CircleX (rojo).
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

export interface HealthPanelProps {
  /** Estado del pipeline DJI (cargado vía loadSyncHealth() en el page). */
  health: HealthResponse;
  /**
   * Lotes / steps recientes del pipeline. Si se omite, usa
   * `health.steps` (default).
   *
   * En el proyecto no hay tabla `dji_import_batches`; usamos
   * `StepHealth[]` como equivalente: cada step es una fase del
   * pipeline (flights, fumigations, lands).
   */
  batches?: StepHealth[];
}

const TONE_BANNER: Record<"ok" | "warn" | "danger" | "unknown", { bg: string; border: string; text: string }> = {
  ok: { bg: "bg-[#e9f5ed]", border: "border-[#0b5f2d]/20", text: "text-[#0b5f2d]" },
  warn: { bg: "bg-[#fff7e0]", border: "border-[#d4b23c]/40", text: "text-[#7a5f0d]" },
  danger: { bg: "bg-[#fdecec]", border: "border-[#a93232]/30", text: "text-[#a93232]" },
  unknown: { bg: "bg-[#f4f7f4]", border: "border-[#cfd8d3]", text: "text-[#4a5b50]" }
};

export function HealthPanel({ health, batches }: HealthPanelProps) {
  const Ui = STATUS_UI[health.status];
  const bannerStyles = TONE_BANNER[Ui.tone];
  const listBatches = batches ?? health.steps;

  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-slot="health-panel"
    >
      <div className="mb-3 flex items-center gap-2">
        <Activity aria-hidden className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Salud del pipeline DJI AG</h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        djiag_health + últimos pasos del pipeline
      </p>

      <div className="flex flex-col gap-4">
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
                {new Date(health.lastRunAt).toISOString()}
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
            <span
              className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[11px] ${bannerStyles.text} ${bannerStyles.border} bg-white/40`}
              data-testid="health-flights-badge"
            >
              {`${formatNumber(health.flightsLastSync)} vuelos`}
            </span>
          ) : null}
        </div>

        {/* Grid de 4 metrics derivados de HealthResponse. */}
        <dl
          className="grid grid-cols-2 gap-2"
          data-testid="health-metrics"
        >
          {(
            [
              ["Parcelas sincronizadas", formatNumber(health.landsLastSync ?? 0)],
              ["Vuelos del último run", formatNumber(health.flightsLastSync ?? 0)],
              ["Fumigaciones del último run", formatNumber(health.fumigationsLastSync ?? 0)],
              [
                "Última sync hace",
                health.hoursSinceLastSync !== null ? formatAgo(health.hoursSinceLastSync) : "—"
              ]
            ] as const
          ).map(([k, v]) => (
            <div className="rounded-md border border-border px-2.5 py-2" key={k}>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {k}
              </dt>
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

        {/* Lista de steps / batches. */}
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
            <ul
              className="divide-y divide-border"
              data-testid="health-batches"
            >
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
      </div>
    </div>
  );
}
