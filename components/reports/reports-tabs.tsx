"use client";

// components/reports/reports-tabs.tsx
//
// Tabs para organizar la vista de /reportes.
//
// Sprint 2026-09-08 — refactor a 2 niveles (Fase 7):
//   - Antes (QA-14, 2026-09-06): 3 tabs (Resumen / Por hacienda / Detalle).
//   - Ahora (Fase 7): 2 tabs (Reporte operativo / Resumen por parcela).
//
// Por que 2 niveles:
//   - El operador fumigador (1 piloto, ~1200 parcelas) quiere 2 vistas
//     mentales: "que paso" (cronologico, fumigacion por fumigacion) y
//     "que parcelas" (agregado, para comparar).
//   - El tab "Resumen" anterior era redundante con los KPIs que ya
//     se muestran arriba de las tabs. Lo sacamos.
//   - El "Detalle" pasa a ser "Reporte operativo" (nombre mas claro:
//     es la lista operativa de las fumigaciones del periodo).
//   - "Por hacienda" pasa a ser "Resumen por parcela" (mas honesto:
//     el agregado es POR PARCELA, no por hacienda).
//
// Decisiones:
//   - 2 tabs: "Reporte operativo" / "Resumen por parcela".
//     Cada tab tiene un titulo + descripcion breve de QUE muestra.
//   - Estado en useState (no URL) — los tabs son UI-only, no
//     afectan la data ni los exports PDF/CSV. Si en el futuro se
//     quiere deep-linking, migrar a searchParams.
//   - Default: "Reporte operativo" (es lo primero que el operador
//     quiere ver: que fumigaciones hubo en el periodo).

import { useState } from "react";
import { History, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReportsTab = "operativo" | "parcela";

export interface ReportsTabsProps {
  operativo: React.ReactNode;
  parcela: React.ReactNode;
}

const TABS: Array<{ id: ReportsTab; label: string; icon: typeof History; description: string }> = [
  {
    id: "operativo",
    label: "Reporte operativo",
    icon: History,
    description:
      "Lista de cada fumigación del rango (cap 200). Click en la parcela para ver la hoja de vida completa."
  },
  {
    id: "parcela",
    label: "Resumen por parcela",
    icon: ListTree,
    description:
      "Agregado por parcela: cuántas fumigaciones, área total y última fecha. Útil para comparar parcelas."
  }
];

export function ReportsTabs({ operativo, parcela }: ReportsTabsProps) {
  const [active, setActive] = useState<ReportsTab>("operativo");
  const content = active === "operativo" ? operativo : parcela;

  return (
    <div className="flex flex-col gap-3" data-testid="reports-tabs">
      <div
        role="tablist"
        aria-label="Secciones del reporte"
        className="flex flex-wrap items-stretch gap-1 rounded-md border border-border bg-card p-1 shadow-sm"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`reports-tab-panel-${t.id}`}
              onClick={() => setActive(t.id)}
              data-testid={`reports-tab-${t.id}`}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      <p
        className="text-xs text-muted-foreground"
        data-testid="reports-tab-description"
      >
        {TABS.find((t) => t.id === active)?.description}
      </p>

      <div
        id={`reports-tab-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`reports-tab-${active}`}
      >
        {content}
      </div>
    </div>
  );
}
