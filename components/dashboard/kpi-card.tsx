// components/dashboard/kpi-card.tsx
//
// Sprint S6 (V0 port v2) — Tarjeta KPI con label, value, hint, icono
// y chip de delta (verde/rojo). Port 1:1 del mockup V0
// (`docs/fumigation-management-dashboard/components/dashboard/kpi-card.tsx`)
// al proyecto real.
//
// Diferencias con el V0 (mínimas, solo de wiring):
//   - V0 usaba `cn` desde `@/lib/utils` — el proyecto lo exporta igual.
//   - V0 usaba el primitive `<Card>` y `<CardContent>` de
//     `@/components/ui/card`. El proyecto tiene ese primitive (creado por
//     el sprint S6.1 de UI primitives) — lo usamos tal cual.
//   - V0 asume Tailwind con tokens `bg-secondary`, `text-secondary-foreground`,
//     `bg-destructive/10`, `text-destructive` ya definidos. Esos tokens
//     están disponibles vía `app/globals.css`.
//
// Adaptaciones de lógica:
//   - `KpiCardProps` queda EXACTAMENTE igual al V0 (mismos campos, mismos
//     tipos). El caller (dashboard page) ya pasa `icon: LucideIcon` y
//     `delta?: number | null`.
//
// Accesibilidad:
//   - Iconos decorativos con `aria-hidden` (lucide-react lo emite igual,
//     pero lo declaramos explícito para robustez).
//   - `data-slot="kpi-card"` se aplica a la Card para que el wrapper externo
//     pueda identificar instancias (tests, CSS compound, debugging).
//   - El chip de delta es legible (texto + icono + signo), sin color-only.

import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
    <Card className="gap-0 py-4" data-slot="kpi-card">
      <CardContent className="flex flex-col gap-2 px-4">
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
      </CardContent>
    </Card>
  );
}
