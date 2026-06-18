import { AppShell } from "@/components/app-shell";
import { HistoryTable } from "@/components/history/history-table";
import { getFlights } from "@/api/repositories";
import { formatArea } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const flightsResult = await getFlights(1, 200);
  const totalArea = flightsResult.data.reduce((sum, flight) => sum + Number(flight.area_mu), 0);
  const totalLiters = flightsResult.data.reduce((sum, flight) => sum + Number(flight.usage_liters), 0);

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-sm font-semibold text-[#4a5b50]">
          Historial completo
        </div>
      }
      activeSection="history"
      eyebrow="Registro histórico"
      subtitle="Detalle por día de las operaciones de fumigación. Ordena por columna o filtra por categoría para acotar la búsqueda."
      title="Historial DJI"
    >
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Registros</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{flightsResult.total}</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Area acumulada</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{formatArea(totalArea)}</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Litros acumulados</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{totalLiters.toFixed(1)} L</p>
        </div>
      </div>

      <HistoryTable flights={flightsResult.data} />
    </AppShell>
  );
}
