"use client";

/**
 * DashboardFilters — filtros interactivos del dashboard.
 *
 * Periodo + Cliente + Hacienda. Al cambiar un filtro navega a
 * `/?range=...&client=...&farm=...` y el server component recalcula
 * KPIs / tendencia / paneles. No usa `useSearchParams` (evita el
 * requisito de Suspense en Next 16): reconstruye el query string con
 * las props actuales.
 */

import { useRouter } from "next/navigation";
import { FieldSelect } from "@/components/ui/field-select";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";

export interface DashboardFiltersProps {
  clients: { id: number; name: string }[];
  farms: { id: number; name: string }[];
  range: string;
  clientId: string;
  farmId: string;
}

const RANGES = [
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "365", label: "Último año" },
  { value: "all", label: "Todo el histórico" }
];

export function DashboardFilters({
  clients,
  farms,
  range,
  clientId,
  farmId
}: DashboardFiltersProps) {
  const router = useRouter();

  function navigate(nextRange: string, nextClient: string, nextFarm: string) {
    const params = new URLSearchParams();
    if (nextRange && nextRange !== "90") params.set("range", nextRange);
    if (nextClient) params.set("client", nextClient);
    if (nextFarm) params.set("farm", nextFarm);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  const isFiltered = (range && range !== "90") || clientId !== "" || farmId !== "";

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
      data-testid="dashboard-filters"
    >
      <span className="flex items-center gap-1.5 self-center text-xs font-medium text-muted-foreground">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filtros
      </span>
      <div className="w-[180px]">
        <FieldSelect
          label="Período"
          value={range}
          onChange={(e) => navigate(e.target.value, clientId, farmId)}
          data-testid="dashboard-range"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="w-[210px]">
        <FieldSelect
          label="Cliente"
          value={clientId}
          onChange={(e) => navigate(range, e.target.value, "")}
          data-testid="dashboard-client"
        >
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="w-[210px]">
        <FieldSelect
          label="Hacienda"
          value={farmId}
          onChange={(e) => navigate(range, clientId, e.target.value)}
          disabled={clientId === "" || farms.length === 0}
          data-testid="dashboard-farm"
        >
          <option value="">
            {clientId === "" ? "— Elegí un cliente —" : "Todas las haciendas"}
          </option>
          {farms.map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.name}
            </option>
          ))}
        </FieldSelect>
      </div>
      {isFiltered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate("90", "", "")}
          data-testid="dashboard-clear"
        >
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}
