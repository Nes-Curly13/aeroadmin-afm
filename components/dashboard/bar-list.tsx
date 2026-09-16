import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

/**
 * BarList — lista con barras horizontales (sin librerías de charts).
 * Reutilizada por Flota, Mix por categoría y Cobertura por cliente.
 */
export interface BarListItem {
  key: string;
  label: string;
  /** Magnitud de la barra (se normaliza al máximo). */
  value: number;
  /** Texto formateado a la derecha. */
  valueLabel: string;
  hint?: string;
  /** Color de la barra (clase Tailwind bg-*). Default bg-primary. */
  barClass?: string;
}

export function BarList({
  title,
  description,
  icon: Icon,
  items,
  emptyText = "Sin datos en el período."
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  items: BarListItem[];
  emptyText?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card data-testid={`bar-list-${title}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          items.map((it) => (
            <div key={it.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium">{it.label}</span>
                <span className="tabular shrink-0 font-mono text-muted-foreground">
                  {it.valueLabel}
                  {it.hint ? ` · ${it.hint}` : ""}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${it.barClass ?? "bg-primary"}`}
                  style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
