// components/dashboard/today-yesterday-card.tsx
//
// Sprint A — F4.0: cards "Ayer" + "Hoy" para que el supervisor tenga la
// vista del DÍA (no del año) cuando abre el dashboard a las 7am.
//
// Layout:
//   - BentoCard colSpan=12 (full width, primera fila del bento).
//   - Header con eyebrow + título + helper.
//   - 2 sub-cards side-by-side: "Ayer" | "Hoy".
//   - Cada sub-card muestra 4 métricas:
//       · Vuelos (flights_count)
//       · Área fumigada (area_fumigated_m2 → ha)
//       · Parcelas únicas (parcels_touched)
//       · Duración (duration_minutes → hh:mm)
//   - Si ambos días están en 0 (BD recién poblada), el card muestra un
//     empty state inline ("Sin actividad ayer" / "Sin actividad hoy")
//     con icono. El banner grande de "empty state global" (F3.0) lo maneja
//     el padre (DashboardClient) — este componente solo describe la
//     "no actividad" día a día.

import type { ActivityComparison, ActivityDayMetrics } from "@/lib/cache";
import { formatNumber, m2ToHa } from "@/lib/format";

/**
 * Formatea un área en m² como "X.XX ha" (1 ha = 10_000 m²).
 * Distinto de `formatArea` (en lib/format.ts) que recibe MU (medida china).
 */
function formatHa(m2: number): string {
  const ha = m2ToHa(m2);
  if (ha === null) return "—";
  return `${ha.toFixed(2)} ha`;
}

export interface TodayYesterdayCardProps {
  comparison: ActivityComparison;
}

/** Minutos totales → "Xh Ym" (redondeo hacia abajo, "0m" si es 0). */
function formatDurationMin(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function isEmptyDay(m: ActivityDayMetrics): boolean {
  return (
    m.flights_count === 0 &&
    m.area_fumigated_m2 === 0 &&
    m.parcels_touched === 0 &&
    m.duration_minutes === 0
  );
}

function DayPanel({ day, label, testId }: { day: ActivityDayMetrics; label: string; testId: string }) {
  if (isEmptyDay(day)) {
    return (
      <div
        className="rounded-xl border border-dashed border-[#cfd8d3] bg-[#f7f9fb] p-5 text-center"
        data-testid={testId}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">{label}</p>
        <p className="mt-2 text-base font-semibold text-[#4a5b50]">Sin actividad</p>
        <p className="mt-1 text-xs text-[#7a8c80]">
          No se registraron vuelos este día.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-[#d2ddd6] bg-[#f7f9fb] p-5"
      data-testid={testId}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
        {label}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a8c80]">
            Vuelos
          </dt>
          <dd
            className="mt-1 text-2xl font-black text-[#121815]"
            data-testid={`${testId}-flights`}
          >
            {formatNumber(day.flights_count)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a8c80]">
            Área fumigada
          </dt>
          <dd
            className="mt-1 text-2xl font-black text-[#121815]"
            data-testid={`${testId}-area`}
          >
            {formatHa(day.area_fumigated_m2)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a8c80]">
            Parcelas únicas
          </dt>
          <dd
            className="mt-1 text-2xl font-black text-[#121815]"
            data-testid={`${testId}-parcels`}
          >
            {formatNumber(day.parcels_touched)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a8c80]">
            Duración
          </dt>
          <dd
            className="mt-1 text-2xl font-black text-[#121815]"
            data-testid={`${testId}-duration`}
          >
            {formatDurationMin(day.duration_minutes)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function TodayYesterdayCard({ comparison }: TodayYesterdayCardProps) {
  return (
    <div data-testid="today-yesterday-card">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#587064]">
            Vista del día
          </p>
          <h2 className="mt-1 text-lg font-black text-[#121815]">
            ¿Qué pasó ayer y qué vas a hacer hoy?
          </h2>
        </div>
        <p className="text-xs text-[#4a5b50]">
          Datos en hora Colombia (America/Bogota)
        </p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DayPanel
          day={comparison.yesterday}
          label={`Ayer · ${comparison.dates.yesterday}`}
          testId="today-yesterday-yesterday"
        />
        <DayPanel
          day={comparison.today}
          label={`Hoy · ${comparison.dates.today}`}
          testId="today-yesterday-today"
        />
      </div>
    </div>
  );
}
