"use client";

// components/reports/reports-tabs.tsx
//
// Tabs para organizar la vista de /reportes (QA-14, 2026-09-06).
//
// Antes la pagina tenia 3 secciones (KPIs + last fumigation, FarmsTable,
// tabla detallada) apiladas verticalmente. El operador pidio "mejorar
// la logica y la usabilidad" — la confusion era que las 3 secciones
// no estaban claramente diferenciadas y no se entendia que hacian.
//
// Decisiones:
//   - 3 tabs: "Resumen" / "Por hacienda" / "Detalle de fumigaciones".
//     Cada tab tiene un titulo + descripcion breve de QUE muestra.
//   - Estado en useState (no URL) — los tabs son UI-only, no
//     afectan la data ni los exports PDF/CSV. Si en el futuro se
//     quiere deep-linking, migrar a searchParams.
//   - Los KPIs (Fumigaciones / Area total / Volumen total / Parcelas
//     activas) SIEMPRE se muestran arriba de las tabs. Son el
//     resumen que el operador quiere ver pase lo que pase.
//   - La "Ultima fumigacion destacada" se movio al tab Resumen.
//     En los otros dos tabs no aporta — es redundante con el
//     detalle del tab 3.

import { useState } from "react";
import { BarChart3, History, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReportsTab = "resumen" | "parcelas" | "detalle";

export interface ReportsTabsProps {
  resumen: React.ReactNode;
  parcelas: React.ReactNode;
  detalle: React.ReactNode;
}

const TABS: Array<{ id: ReportsTab; label: string; icon: typeof BarChart3; description: string }> = [
  {
    id: "resumen",
    label: "Resumen",
    icon: BarChart3,
    description:
      "KPIs del período + la última fumigación destacada. Vista general rápida."
  },
  {
    id: "parcelas",
    label: "Por hacienda",
    icon: ListTree,
    description:
      "Agregado por parcela: cuántas fumigaciones, área total y última fecha. Útil para comparar haciendas."
  },
  {
    id: "detalle",
    label: "Detalle",
    icon: History,
    description:
      "Lista de cada fumigación del rango (cap 200). Click en la parcela para ver la hoja de vida completa."
  }
];

export function ReportsTabs({ resumen, parcelas, detalle }: ReportsTabsProps) {
  const [active, setActive] = useState<ReportsTab>("resumen");
  const content = active === "resumen" ? resumen : active === "parcelas" ? parcelas : detalle;

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
