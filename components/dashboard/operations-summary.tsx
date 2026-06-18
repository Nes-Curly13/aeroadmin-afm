import { formatArea } from "@/lib/format";

export interface OperationsSummaryProps {
  yearTotalArea: number;
  yearTotalUsage: number;
  avgArea: number;
  avgUsage: number;
  highDays: number;
  topMonth: string | undefined;
  topMonthCount: number;
}

/**
 * Panel oscuro "Reporte 2026" del dashboard.
 * Resume cobertura, intensidad y mes más activo.
 */
export function OperationsSummary({
  avgArea,
  avgUsage,
  highDays,
  topMonth,
  topMonthCount
}: OperationsSummaryProps) {
  return (
    <div className="rounded-2xl border border-[#d2ddd6] bg-[#101814] p-6 text-white shadow-[0px_18px_40px_rgba(15,23,42,0.18)]">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#9fceb0]">Reporte 2026</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white/6 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">Promedio area</p>
          <p className="mt-2 text-2xl font-semibold">{formatArea(avgArea)}</p>
        </div>
        <div className="rounded-xl bg-white/6 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">Promedio litros</p>
          <p className="mt-2 text-2xl font-semibold">{avgUsage.toFixed(1)} L</p>
        </div>
        <div className="rounded-xl bg-white/6 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9fceb0]">Mes mas activo</p>
          <p className="mt-2 text-2xl font-semibold">{topMonth ?? "N/A"}</p>
          <p className="text-sm text-[#c8dcd0]">
            {topMonth ? `${topMonthCount} registros` : "Sin datos"}
          </p>
        </div>
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-[#c8dcd0]">
        Esta vista resume la operación del año, con foco en cobertura, intensidad y alertas. La UI prioriza un panel de control de alto contraste inspirado en la plataforma DJI,
        pero orientado a reportes propios y trazabilidad interna.
      </p>
    </div>
  );
}
