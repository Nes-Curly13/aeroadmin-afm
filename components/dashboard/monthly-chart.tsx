// components/dashboard/monthly-chart.tsx
//
// Sprint S6 (V0 port v2) — Bar chart inline de fumigaciones por mes.
// Port 1:1 del mockup V0 (`docs/fumigation-management-dashboard/components/
// dashboard/monthly-chart.tsx`) al proyecto real.
//
// Decisiones de adaptación:
//
//   1. CARD / TABLE / BADGE — el V0 usa `<Card>`, `<CardHeader>`, etc. El
//      proyecto ya tiene esos primitives (creados en S6.1 por el agente
//      de primitives). Usamos `<Card>` directamente. La forma visual
//      queda 1:1 con el V0.
//
//   2. SHAPE DE DATOS — el V0 define `MonthlyBar` con `{ label, ha,
//      flights }`. El proyecto ya tiene ese mismo type exportado
//      (mantenido en la versión anterior del componente). Lo reusamos
//      tal cual. El caller (dashboard page) ya pasa la data formateada
//      con `label` corto en es-CO ("ene", "feb", …) y los `ha`/`flights`
//      agregados por mes.
//
//   3. COLOR DEL DOT DE FLIGHTS — el V0 usa `bg-chart-2` (token
//      semántico de paleta). El proyecto aún no tiene ese token en
//      `app/globals.css`; mantenemos el color explícito `#16847e`
//      (verde-azulado, "Por vencer" en la paleta de cadencia) que ya
//      usaba la versión previa del componente. Si después se introduce
//      el token `chart-2`, el cambio es de 1 clase.
//
//   4. TOKEN `font-mono` + `tabular` — el V0 combina las dos con
//      `tabular font-mono`; el proyecto desdobla en `font-mono
//      tabular-nums` (utility más explícita de Tailwind 4). Mantenemos
//      el patrón del proyecto, equivalente visual.
//
//   5. EMPTY STATE — el V0 siempre renderiza el chart (asume data no
//      vacía). El proyecto ya tenía un empty state con data-state="empty"
//      (test d). Lo preservamos porque los callers pueden pasar un
//      dataset vacío (rango sin fumigaciones).
//
// Accesibilidad:
//   - `role="img"` + `aria-label` con totales agregados (lectura sintética
//     del chart para screen readers, ver test).
//   - El dot de flights tiene `aria-hidden` (es decorativo, la info
//     ya está en el `title` del bar y en el `aria-label` del chart).
//   - `data-slot="monthly-chart"` para identificación externa
//     (tests, CSS compound, debugging).
//   - `data-month` y `data-ha` en cada item para testing hooks.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

/** Mes individual del chart. Coincide 1:1 con el shape del V0. */
export interface MonthlyBar {
  /** Etiqueta corta del mes en es-CO (ej: "ene", "feb"). */
  label: string;
  /** Hectáreas tratadas en el mes (eje principal). */
  ha: number;
  /** Vuelos ejecutados en el mes (marcador secundario). */
  flights: number;
}

export interface MonthlyChartProps {
  data: MonthlyBar[];
}

export function MonthlyChart({ data }: MonthlyChartProps) {
  // Empty state: dataset vacío → no rompemos, mostramos placeholder.
  if (data.length === 0) {
    return (
      <Card data-slot="monthly-chart" data-state="empty">
        <CardHeader>
          <CardTitle>Hectáreas tratadas por mes</CardTitle>
          <CardDescription>No hay fumigaciones en el período seleccionado.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            Sin datos
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxHa = Math.max(1, ...data.map((d) => d.ha));
  const maxFlights = Math.max(1, ...data.map((d) => d.flights));
  const totalHa = data.reduce((acc, d) => acc + d.ha, 0);
  const totalFlights = data.reduce((acc, d) => acc + d.flights, 0);

  return (
    <Card
      aria-label={`${formatNumber(totalHa)} ha tratadas en ${data.length} meses, ${formatNumber(totalFlights)} vuelos`}
      data-slot="monthly-chart"
      role="img"
    >
      <CardHeader>
        <CardTitle>Hectáreas tratadas por mes</CardTitle>
        <CardDescription>
          {`Últimos ${data.length} meses · barra = ha aplicadas, línea = vuelos ejecutados`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-56 items-end gap-2">
          {data.map((d) => {
            const heightPct = (d.ha / maxHa) * 100;
            const flightsRatio = d.flights / maxFlights;
            return (
              <div
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                data-ha={d.ha}
                data-month={d.label}
                key={d.label}
              >
                <span className="font-mono text-[10px] font-semibold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {formatNumber(d.ha)}
                </span>
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    aria-hidden
                    className="w-full rounded-t-sm bg-primary/85 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(2, heightPct)}%` }}
                    title={`${d.label}: ${formatNumber(d.ha)} ha · ${d.flights} vuelos`}
                  />
                  <span
                    aria-hidden
                    className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#16847e] ring-2 ring-card"
                    style={{ bottom: `${Math.max(2, flightsRatio * 100)}%` }}
                  />
                </div>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
