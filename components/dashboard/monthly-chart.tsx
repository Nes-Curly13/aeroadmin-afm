// components/dashboard/monthly-chart.tsx
//
// Sprint S6 (V0 port) — Bar chart inline de fumigaciones por mes.
// Adaptado del mockup V0 (docs/fumigation-management-dashboard/components/
// dashboard/monthly-chart.tsx).
//
// Diferencias con el V0:
//   - El V0 usaba `<Card>` / `<CardHeader>` / `<CardContent>` de
//     `@/components/ui/card`. Como `v0-primitives` aún no corrió, usamos
//     divs con clases Tailwind y los tokens del proyecto.
//   - El V0 tenía un dot de flights sobre cada barra con color `bg-chart-2`
//     (token semántico). En el proyecto aún no hay un color "chart-2" en
//     globals.css. Usamos un color brand-compatible (`bg-primary` con opacidad
//     reducida) que sobrevive a un eventual rebrand. Si después se introduce
//     el token `chart-2`, el cambio es de 1 clase.
//   - Renderizamos el `MonthlyBar[]` con su `label` ya formateado en es-CO
//     desde el caller (mantenemos el componente libre de Intl — la TZ
//     la aplica el padre, que sí tiene acceso a `lib/format.ts` + `NOW`).
//   - Usamos `formatNumber` de `lib/format.ts` para el hover (consistente
//     con el resto del dashboard).
//
// Inputs decididos:
//   - `data: MonthlyBar[]` : array de 12 meses (no asumo 12, pero la altura
//                            se calcula con `flex-1` para escalar a N).
//                            Cada item: { label, ha, flights }.
//
// Accesibilidad:
//   - El chart tiene `role="img"` + `aria-label` con el total de ha tratadas
//     en el período (lectura sintética del chart para screen readers).
//   - Cada barra es un <div> sin role propio (decorativo), pero el wrapper
//     de cada mes es un grupo (`group`) que muestra el valor al hover.
//   - El dot de flights tiene `aria-hidden` (es un marker visual, no aporta
//     info que no esté ya en el label o el title del bar).

import { formatNumber } from "@/lib/format";

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
  // Guards: si no hay data, no rompemos — devolvemos un placeholder vacío.
  // El caller puede preferir renderizar un EmptyState, pero acá mantenemos
  // la robustez para que no se renderice un chart con altura 0.
  if (data.length === 0) {
    return (
      <div
        aria-label="Sin datos mensuales"
        className="rounded-md border border-border bg-card p-4"
        data-slot="monthly-chart"
        data-state="empty"
      >
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Hectáreas tratadas por mes</h3>
          <p className="text-[11px] text-muted-foreground">
            No hay fumigaciones en el período seleccionado.
          </p>
        </div>
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          Sin datos
        </div>
      </div>
    );
  }

  const maxHa = Math.max(1, ...data.map((d) => d.ha));
  const maxFlights = Math.max(1, ...data.map((d) => d.flights));
  const totalHa = data.reduce((acc, d) => acc + d.ha, 0);
  const totalFlights = data.reduce((acc, d) => acc + d.flights, 0);

  return (
    <div
      aria-label={`${formatNumber(totalHa)} ha tratadas en ${data.length} meses, ${formatNumber(totalFlights)} vuelos`}
      className="rounded-md border border-border bg-card p-4"
      data-slot="monthly-chart"
      role="img"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Hectáreas tratadas por mes</h3>
        <p className="text-[11px] text-muted-foreground">
          {`Últimos ${data.length} meses · barra = ha aplicadas, marcador = vuelos ejecutados`}
        </p>
      </div>
      <div className="flex h-56 items-end gap-2">
        {data.map((d) => {
          const heightPct = (d.ha / maxHa) * 100;
          const flightsRatio = d.flights / maxFlights;
          // El V0 usa "chart-2" para el dot. En el proyecto aún no
          // definimos ese token; usamos un color brand con contraste
          // suficiente (info) y borde ring-card para que destaque.
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
    </div>
  );
}
