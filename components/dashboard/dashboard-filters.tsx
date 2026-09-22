"use client";

/**
 * DashboardFilters — filtros del dashboard sobre dimensiones con datos reales.
 *
 * Refactor 2026-09-21: se quitaron **Cliente** y **Municipio/Categoría**
 * (no tienen datos: `clients` vacío, `municipality`/`category_id` null).
 * Hacienda ya NO depende de Cliente. Se agregan **Dron** y **Estado**
 * (dimensiones que sí existen) + búsqueda por texto.
 *
 * Al cambiar un filtro navega a `/?range=…&farm=…&drone=…&estado=…&q=…`
 * y el server component recalcula. No usa `useSearchParams` (evita el
 * requisito de Suspense en Next 16).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";

export interface DashboardFiltersProps {
  farms: { id: number; name: string }[];
  drones: string[];
  range: string;
  farmId: string;
  drone: string;
  estado: string;
  query: string;
}

const RANGES = [
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "365", label: "Último año" },
  { value: "all", label: "Todo el histórico" }
];

const ESTADOS = [
  { value: "", label: "Todas" },
  { value: "con_parcela", label: "Con parcela" },
  { value: "sin_asignar", label: "Sin asignar" },
  { value: "revisar", label: "Por revisar (auto)" }
];

export function DashboardFilters({
  farms,
  drones,
  range,
  farmId,
  drone,
  estado,
  query
}: DashboardFiltersProps) {
  const router = useRouter();
  const [q, setQ] = useState(query);

  // Si el filtro cambia desde la URL (limpiar, atrás), re-sincronizamos.
  useEffect(() => setQ(query), [query]);

  function navigate(next: Partial<{
    range: string;
    farm: string;
    drone: string;
    estado: string;
    q: string;
  }>) {
    const v = { range, farm: farmId, drone, estado, q, ...next };
    const params = new URLSearchParams();
    if (v.range && v.range !== "90") params.set("range", v.range);
    if (v.farm) params.set("farm", v.farm);
    if (v.drone) params.set("drone", v.drone);
    if (v.estado) params.set("estado", v.estado);
    if (v.q && v.q.trim() !== "") params.set("q", v.q.trim());
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  const isFiltered =
    (range && range !== "90") || farmId !== "" || drone !== "" || estado !== "" || query !== "";

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
      data-testid="dashboard-filters"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ q });
      }}
    >
      <span className="flex items-center gap-1.5 self-center text-xs font-medium text-muted-foreground">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filtros
      </span>
      <div className="w-[170px]">
        <FieldSelect
          label="Período"
          value={range}
          onChange={(e) => navigate({ range: e.target.value })}
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
          label="Hacienda"
          value={farmId}
          onChange={(e) => navigate({ farm: e.target.value })}
          data-testid="dashboard-farm"
        >
          <option value="">Todas las haciendas</option>
          {farms.map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.name}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="w-[170px]">
        <FieldSelect
          label="Dron"
          value={drone}
          onChange={(e) => navigate({ drone: e.target.value })}
          data-testid="dashboard-drone"
        >
          <option value="">Todos los drones</option>
          {drones.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="w-[170px]">
        <FieldSelect
          label="Estado"
          value={estado}
          onChange={(e) => navigate({ estado: e.target.value })}
          data-testid="dashboard-estado"
        >
          {ESTADOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Buscar
        </span>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Suerte o hacienda…"
              aria-label="Buscar por suerte o hacienda"
              data-testid="dashboard-search"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Buscar
          </Button>
        </div>
      </div>
      {isFiltered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate({ range: "90", farm: "", drone: "", estado: "", q: "" })}
          data-testid="dashboard-clear"
        >
          Limpiar
        </Button>
      ) : null}
    </form>
  );
}
