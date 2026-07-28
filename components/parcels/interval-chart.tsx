"use client";

// components/parcels/interval-chart.tsx
//
// IntervalChart — v0.1 (port del V0 a nuestro proyecto).
//
// Sprint v0.1 — port de `docs/fumigation-management-dashboard/components/parcels/interval-chart.tsx`.
// Adaptaciones al proyecto actual:
//   - SVG inline (en lugar de divs con `height: %` del V0). El SVG es más
//     preciso para graficar, soporta `<title>` por barra (tooltip nativo)
//     y es más fácil de estilizar con Tailwind via `currentColor`.
//   - Regla de color del V0 era binaria (verde / rojo). Aquí usamos la
//     regla de 3 colores que pidió el PO:
//       · gap <= cadence + 2  → verde   (en ventana, igual al chip del timeline)
//       · gap >  cadence + 2  → amarillo (atraso leve, aún recuperable)
//       · gap >  cadence * 1.5 → rojo    (atraso severo, fumigación urgente)
//   - Sin librería de charts. Es una decisión consciente: el chart es
//     pequeño, sin interacciones, y agregar `recharts`/`visx` traería
//     ~50KB al bundle. Si en el futuro se necesita brush/zoom, se
//     reevalúa.
//
// Layout:
//   - viewBox 0..600 ancho × 0..200 alto
//   - Margen superior para que el label de cadencia no se salga
//   - Margen inferior para los labels de fecha (primera/última)
//   - Barras con ancho dinámico según `points.length` (ancho = 80% / N)
//   - Línea de cadencia como `<line>` con `stroke-dasharray`
//   - Etiqueta de cadencia como `<text>` encima de la línea
//
// Accesibilidad:
//   - `<figure>` con `<figcaption>` describiendo qué muestra el chart.
//   - `role="img"` + `aria-labelledby` apuntando al `<title>` interno.
//   - Cada barra tiene `<title>` (tooltip nativo del browser al hover).
//   - NO es interactivo — es un chart de solo lectura.

import { formatDate } from "@/lib/format";

export interface IntervalPoint {
  /** YYYY-MM-DD (Bogota-local, ya normalizado en el boundary del repository). */
  date: string;
  /** Días desde la aplicación anterior. NO se computa en el cliente. */
  gap: number;
}

export interface IntervalChartProps {
  /**
   * Intervalos entre fumigaciones consecutivas. El caller los calcula
   * (tipicamente en `app/parcels/[id]/page.tsx` con `daysBetween()`).
   * Si hay menos de 2 puntos, se muestra el empty state.
   */
  points: IntervalPoint[];
  /** Cadencia esperada (de `dji_fumigation_schedule.recommended_cadence_days`). */
  cadenceDays: number;
}

// =====================================================================
// Constantes de layout (mantener en sync con la lógica de viewBox abajo)
// =====================================================================

const VIEWBOX_W = 600;
const VIEWBOX_H = 200;
const MARGIN_TOP = 24; // espacio para el label de cadencia
const MARGIN_BOTTOM = 28; // espacio para los labels de fecha
const PLOT_W = VIEWBOX_W;
const PLOT_H = VIEWBOX_H - MARGIN_TOP - MARGIN_BOTTOM;

const COLOR_GREEN = "#0b5f2d"; // en ventana
const COLOR_YELLOW = "#d4b23c"; // atraso leve
const COLOR_RED = "#a93232"; // atraso severo
const COLOR_THRESHOLD = "#587064"; // línea de cadencia (gris-verdoso, distinto del verde "en ventana")

/**
 * Mapea un gap a un color según la regla de 3 niveles (spec del PO).
 *   - gap <= cadence + 2  → verde
 *   - gap >  cadence + 2  → amarillo (no llega a severo todavía)
 *   - gap >  cadence * 1.5 → rojo
 *
 * El orden importa: chequeamos el caso severo PRIMERO porque un gap
 * mayor a `cadence * 1.5` también es > `cadence + 2` (cuando cadence >= 4).
 * Con cadence=14, threshold1=16, threshold2=21. Un gap de 25d es > ambos;
 * queremos rojo, no amarillo.
 */
function colorForGap(gap: number, cadenceDays: number): string {
  if (gap > cadenceDays * 1.5) return COLOR_RED;
  if (gap > cadenceDays + 2) return COLOR_YELLOW;
  return COLOR_GREEN;
}

export function IntervalChart({ points, cadenceDays }: IntervalChartProps) {
  if (points.length < 2) {
    return (
      <figure
        className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground"
        data-slot="interval-chart"
        data-testid="interval-chart-empty"
      >
        <figcaption>Intervalos entre fumigaciones</figcaption>
        Se necesitan al menos dos aplicaciones para calcular intervalos.
      </figure>
    );
  }

  // Máximo del eje Y: el mayor entre cadencia * 1.5 y el mayor gap observado.
  // 1.15x da headroom para que el label de cadencia no se salga del viewBox.
  const maxGap = Math.max(...points.map((p) => p.gap));
  const maxY = Math.max(cadenceDays * 1.5, maxGap) * 1.15;

  // Y de la línea de cadencia (invertido: y=0 arriba, y=PLOT_H abajo).
  const cadenceY = MARGIN_TOP + (1 - cadenceDays / maxY) * PLOT_H;
  // Para los bars: y=0 arriba, y=PLOT_H abajo. Top del bar = MARGIN_TOP + (1 - gap/maxY) * PLOT_H.
  // Altura del bar = (gap/maxY) * PLOT_H. Y final = VIEWBOX_H - MARGIN_BOTTOM (alineado al eje X).

  // Ancho de cada barra: 80% del plot, dividido en N slots.
  const slotCount = points.length;
  const totalBarArea = PLOT_W * 0.8;
  const slotW = totalBarArea / slotCount;
  const barW = slotW * 0.7; // 30% gap entre barras
  const startX = (PLOT_W - totalBarArea) / 2;

  const firstDate = points[0]?.date ?? "";
  const lastDate = points[points.length - 1]?.date ?? "";

  return (
    <figure
      className="flex flex-col gap-3"
      data-slot="interval-chart"
      data-testid="interval-chart"
    >
      <figcaption className="sr-only">
        {`Intervalos entre ${points.length} aplicaciones consecutivas. ` +
          `Cadencia esperada: ${cadenceDays} días. ` +
          `Desde ${firstDate} hasta ${lastDate}.`}
      </figcaption>

      <svg
        aria-labelledby="interval-chart-title"
        className="h-40 w-full"
        data-testid="interval-chart-svg"
        role="img"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      >
        <title id="interval-chart-title">{`Intervalos entre aplicaciones vs cadencia de ${cadenceDays} días`}</title>

        {/* Eje X (baseline) */}
        <line
          stroke="#cfd8d3"
          strokeWidth={1}
          x1={0}
          x2={VIEWBOX_W}
          y1={VIEWBOX_H - MARGIN_BOTTOM}
          y2={VIEWBOX_H - MARGIN_BOTTOM}
        />

        {/* Línea horizontal de cadencia (umbral). Color distinto del
            verde "en ventana" para que se distinga visualmente de las
            barras (V0 usa chart-2, equivalente a este gris-verdoso). */}
        <line
          data-testid="interval-chart-threshold"
          stroke={COLOR_THRESHOLD}
          strokeDasharray="4 4"
          strokeWidth={1.5}
          x1={0}
          x2={VIEWBOX_W}
          y1={cadenceY}
          y2={cadenceY}
        />
        {/* Chip de fondo para el label (efecto "badge" sobre la línea). */}
        <rect
          fill="var(--card)"
          fillOpacity={0.9}
          height={14}
          rx={2}
          x={VIEWBOX_W - 88}
          y={cadenceY - 13}
        />
        <text
          fill={COLOR_THRESHOLD}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize={10}
          fontWeight={500}
          textAnchor="end"
          x={VIEWBOX_W - 4}
          y={cadenceY - 3}
        >
          {`cadencia ${cadenceDays} d`}
        </text>

        {/* Barras por intervalo */}
        {points.map((p, i) => {
          const slotX = startX + i * slotW + (slotW - barW) / 2;
          const barH = Math.max((p.gap / maxY) * PLOT_H, 3); // 3px mínimo
          const barY = VIEWBOX_H - MARGIN_BOTTOM - barH;
          const color = colorForGap(p.gap, cadenceDays);
          return (
            <g data-testid={`interval-chart-bar-${i}`} key={p.date}>
              <title>{`${formatDate(p.date)} — ${p.gap} días desde la aplicación anterior`}</title>
              <rect
                fill={color}
                fillOpacity={0.85}
                height={barH}
                role="img"
                rx={2}
                width={barW}
                x={slotX}
                y={barY}
              >
                <title>{`${p.gap} días`}</title>
              </rect>
            </g>
          );
        })}

        {/* Labels de fecha en los extremos */}
        <text
          fill="#4a5b50"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize={10}
          textAnchor="start"
          x={4}
          y={VIEWBOX_H - 6}
        >
          {formatDate(firstDate)}
        </text>
        <text
          fill="#4a5b50"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize={10}
          textAnchor="end"
          x={VIEWBOX_W - 4}
          y={VIEWBOX_H - 6}
        >
          {formatDate(lastDate)}
        </text>
      </svg>

      {/* Leyenda inline (no interactiva) */}
      <div
        className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground"
        data-testid="interval-chart-legend"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: COLOR_GREEN }}
          />
          {`≤ ${cadenceDays + 2} d (en ventana)`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: COLOR_YELLOW }}
          />
          {`> ${cadenceDays + 2} d`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: COLOR_RED }}
          />
          {`> ${Math.round(cadenceDays * 1.5)} d`}
        </span>
      </div>
    </figure>
  );
}
