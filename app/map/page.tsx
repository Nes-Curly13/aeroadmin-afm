import { AppShell } from "@/components/app-shell";
import { MapView } from "@/components/map-view";
import { getAlerts, getFlightPoints, getFlights, getFumigatedParcelIdsSince, getParcelsNormalized, getParcelsSummary } from "@/api/repositories";
import { toDateString } from "@/lib/format";

// (Sprint 7) Antes `force-dynamic` — ahora `auto`: el cache de
// `unstable_cache` con TTL 60s se aplica al listado de parcelas + summary.
// El mapa siempre lee data fresca al primer click del usuario (CSR).

export default async function MapPage() {
  // Opción B: usamos la tabla normalizada dji_parcels (1 fila por campo con
  // columnas planas). Mantenemos getAlerts y getFlights (legacy) por ahora
  // hasta migrar la lógica de alertas a dji_fumigations.
  // M6: getFlightPoints() agrega circulos en el mapa con la posición
  // (lng, lat) de los 300 sorties mas recientes.
  // M3-M5 Track A: getFumigatedParcelIdsSince(6m) alimenta el flag
  // `hasFumigation` por parcela — fumigadas se ven solidas, no fumigadas
  // dashed con fill atenuado.
  const sixMonthsAgo = toDateString(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6)) ?? "1970-01-01";

  const [parcelsResult, summary, flightsResult, alerts, flightPoints, fumigatedIds] = await Promise.all([
    getParcelsNormalized(1, 200),
    getParcelsSummary(),
    getFlights(),
    getAlerts(),
    getFlightPoints(300),
    getFumigatedParcelIdsSince(sixMonthsAgo)
  ]);

  // Aggregate por drone
  const droneCounts = new Map<string, number>();
  for (const row of summary) {
    const name = row.drone_model_name || "Sin asignar";
    droneCounts.set(name, (droneCounts.get(name) ?? 0) + Number(row.count_by_drone));
  }
  const totalParcels = [...droneCounts.values()].reduce((a, b) => a + b, 0);
  const orchards = parcelsResult.data.filter((p) => p.is_orchard).length;
  const withWaypoints = parcelsResult.data.filter((p) => p.waypoint_count && p.waypoint_count > 0).length;
  const totalSprayM2 = parcelsResult.data.reduce((s, p) => s + (p.spray_area_m2 ?? 0), 0);
  const totalSprayHa = totalSprayM2 / 10_000;
  const fumigatedCount = parcelsResult.data.filter((p) => fumigatedIds.has(p.id)).length;

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-sm font-semibold text-[#4a5b50]">
          Capas y estado espacial
        </div>
      }
      activeSection="map"
      eyebrow="Vista espacial"
      highAlertsCount={alerts.filter((alert) => alert.level === "HIGH").length}
      parcelsCount={parcelsResult.data.length}
      subtitle="Mapa operativo de parcelas DJI con geometría, plan de vuelo y configuración. Toggle de capas, selector de parcela activa y detalle al costado."
      title="Mapa de Parcelas"
    >
      <div className="mb-4 grid gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Parcelas</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{parcelsResult.data.length}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{orchards} orchards · {parcelsResult.data.length - orchards} farmland</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Área fumigable</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{totalSprayHa.toFixed(2)} ha</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{totalSprayM2.toLocaleString("en-US", { maximumFractionDigits: 0 })} m² agregados</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Con plan de vuelo</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{withWaypoints}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">de {parcelsResult.data.length} parcelas</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Drones en flota</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{droneCounts.size}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{[...droneCounts.entries()].map(([k, v]) => `${v} ${k.split(" ")[0]}`).join(" · ")}</p>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Fumigadas (6m)</p>
          <p className="mt-2 text-3xl font-black text-[#121815]">{fumigatedCount}</p>
          <p className="mt-1 text-xs text-[#4a5b50]">{parcelsResult.data.length - fumigatedCount} sin fumigación reciente</p>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Distribución por drone</p>
          <div className="mt-3 space-y-2">
            {[...droneCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
              const pct = totalParcels > 0 ? (count / totalParcels) * 100 : 0;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-[#121815]">{name}</span>
                    <span className="text-[#4a5b50]">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#f0f4f1]">
                    <div className="h-full bg-[#0b5f2d]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Resúmenes operativos</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[#4a5b50]">Días registrados</p>
              <p className="text-2xl font-black text-[#121815]">{flightsResult.total}</p>
            </div>
            <div>
              <p className="text-[#4a5b50]">Alertas altas</p>
              <p className="text-2xl font-black text-[#a93232]">{alerts.filter((a) => a.level === "HIGH").length}</p>
            </div>
          </div>
        </div>
      </div>

      <MapView
        alerts={alerts}
        flightPoints={flightPoints}
        flights={flightsResult.data}
        fumigatedParcelIds={fumigatedIds}
        parcels={parcelsResult.data}
      />
    </AppShell>
  );
}
