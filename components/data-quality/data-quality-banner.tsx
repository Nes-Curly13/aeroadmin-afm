/**
 * components/data-quality/data-quality-banner.tsx
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.4.1 — Capa de Gestión.
 *
 * Banner read-only que muestra los warnings de calidad de datos para
 * una parcela. Consume `GET /api/data-quality/invariants?parcelaId=X`
 * (admin-only) y renderiza un bloque discreto arriba de la página de
 * detalle de la parcela.
 *
 * Comportamiento:
 *   - Sin warnings (200 + []): no renderiza nada.
 *   - Con warnings: renderiza un banner con la peor severidad como
 *     "primary" (error > warning > info) y la lista de mensajes.
 *   - 401/403 (supervisor sin permisos): no renderiza nada. El
 *     endpoint es admin-only y un supervisor que vea /parcelas/[id]
 *     no debe ver el banner (la Capa de Gestión es admin-only).
 *   - 500/error de red: no renderiza nada. La UI no se rompe.
 *
 * El componente es client (`"use client"`) porque hace fetch en
 * useEffect. Si el endpoint se vuelve lento, podemos cambiar a React
 * Server Component + async fetch, pero por ahora el patrón es
 * consistente con el resto del codebase (e.g. ParcelDrawer).
 *
 * Por qué NO usar TanStack Query: la página no es una SPA con muchos
 * banners; un useEffect + fetch es suficiente. Si el patrón se
 * replica, vale la pena refactorear a TanStack.
 */

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

export type WarningSeverity = "info" | "warning" | "error";
export type WarningCode =
  | "parcela_no_cliente"
  | "parcela_no_finca"
  | "parcela_sin_ciclo_activo"
  | "fumigacion_sin_ciclo"
  | "fumigacion_ciclo_cerrado"
  | "ciclo_sin_eventos"
  | "ciclo_sin_phase_rule"
  | "parcela_data_stale";

export interface DataQualityWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  parcela_id?: number;
  cycle_id?: number;
  fumigation_id?: number;
}

interface DataQualityBannerProps {
  parcelaId: number;
}

export function DataQualityBanner({ parcelaId }: DataQualityBannerProps) {
  const [warnings, setWarnings] = useState<DataQualityWarning[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/data-quality/invariants?parcelaId=${parcelaId}`
        );
        if (!res.ok) {
          // 401/403 (supervisor sin permisos) o 500 (DB caída) →
          // silencioso, no rompemos la UI del detail.
          return;
        }
        const data = (await res.json()) as { warnings: DataQualityWarning[] };
        if (!cancelled) setWarnings(data.warnings ?? []);
      } catch {
        // Network error → silencioso.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parcelaId]);

  // No renderizar mientras carga o si no hay warnings.
  if (!warnings || warnings.length === 0) return null;

  // Determinar la peor severidad (error > warning > info).
  const worstSeverity: WarningSeverity = warnings.some(
    (w) => w.severity === "error"
  )
    ? "error"
    : warnings.some((w) => w.severity === "warning")
      ? "warning"
      : "info";

  const Icon =
    worstSeverity === "error"
      ? ShieldAlert
      : worstSeverity === "warning"
        ? AlertTriangle
        : Info;

  // Colores del borde según severidad. El fondo usa bg-{color}/5 que
  // ya está en el design system (primary/5, destructive/5, etc.).
  const colorClasses: Record<WarningSeverity, string> = {
    error: "border-destructive/40 bg-destructive/5 text-destructive",
    warning: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    info: "border-primary/30 bg-primary/5 text-foreground"
  };

  const headerLabels: Record<WarningSeverity, string> = {
    error: "Errores de calidad de datos",
    warning: "Atención: calidad de datos",
    info: "Calidad de datos"
  };

  return (
    <section
      role="status"
      aria-label="Warnings de calidad de datos"
      data-testid="data-quality-banner"
      data-severity={worstSeverity}
      className={`flex flex-col gap-2 rounded-md border px-4 py-3 ${colorClasses[worstSeverity]}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span>{headerLabels[worstSeverity]}</span>
        <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">
          {warnings.length} {warnings.length === 1 ? "problema" : "problemas"}
        </span>
      </div>
      <ul className="ml-6 list-disc space-y-1 text-xs">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} data-severity={w.severity}>
            <span className="font-medium">{w.message}</span>
            {w.fumigation_id != null ? (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                (fumigación #{w.fumigation_id})
              </span>
            ) : null}
            {w.cycle_id != null ? (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                (ciclo #{w.cycle_id})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
