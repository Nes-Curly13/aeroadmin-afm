// components/dashboard/kpi-card.tsx
//
// Sprint S6 (V0 port) — Tarjeta KPI compacta con label, value, hint, icono
// y chip de delta (verde/rojo). Adaptada del mockup V0 (docs/fumigation-
// management-dashboard/components/dashboard/kpi-card.tsx) al proyecto real.
//
// Diferencias con el V0:
//   - V0 usaba `<Card>` y `<CardContent>` de `@/components/ui/card`. Ese
//     primitive aún NO existe en el proyecto (lo va a crear el agente
//     `v0-primitives` en otro sprint). Implementamos con divs + Tailwind
//     usando los design tokens del proyecto (border, bg-card, etc.).
//   - El V0 asume Tailwind con `bg-secondary`, `text-secondary-foreground`,
//     `bg-destructive/10`, `text-destructive` ya definidos. Esos tokens
//     están disponibles vía `app/globals.css` (los usa KpiPill).
//
// Inputs decididos:
//   - `label`     : texto uppercase arriba (eyebrow).
//   - `value`     : valor principal en font-mono (numérico/texto corto).
//   - `hint`      : texto descriptivo pequeño abajo.
//   - `icon`      : LucideIcon; se renderiza en una caja 28x28 arriba a la
//                   derecha.
//   - `delta?`    : variación porcentual vs periodo anterior. null/undefined
//                   → no se renderiza el chip. ≥0 = verde (TrendingUp), <0 =
//                   rojo (TrendingDown). Formato: "+12.3%" / "-4.5%".
//
// Accesibilidad:
//   - Iconos decorativos con `aria-hidden` (lucide-react lo emite igual,
//     pero lo declaramos explícito para que sea robusto a custom icons).
//   - El label "uppercase tracking-wider" funciona como eyebrow para screen
//     readers (separa semánticamente label de value).
//   - El chip de delta es legible (texto + icono + signo), sin color-only.

import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  /** Variación porcentual vs periodo anterior. null/undefined = sin chip. */
  delta?: number | null;
}

export function KpiCard({ label, value, hint, icon: Icon, delta }: KpiCardProps) {
  const showDelta = delta !== null && delta !== undefined;
  const up = (delta ?? 0) >= 0;
  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-slot="kpi-card"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="grid size-7 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Icon aria-hidden className="size-4" />
          </span>
        </div>
        <p className="font-mono text-2xl font-extrabold leading-none tabular-nums">
          {value}
        </p>
        <div className="flex items-center gap-2">
          {showDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                up
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-destructive/10 text-destructive"
              )}
            >
              {up ? (
                <TrendingUp aria-hidden className="size-3" />
              ) : (
                <TrendingDown aria-hidden className="size-3" />
              )}
              {`${up ? "+" : ""}${delta.toFixed(1)}%`}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        </div>
      </div>
    </div>
  );
}
