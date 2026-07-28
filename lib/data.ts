// lib/data.ts
//
// V0 data adapter (port del mockup `docs/fumigation-management-dashboard`).
//
// Reemplaza los mocks deterministas del V0 por queries a Supabase vía
// `api/repositories.ts`. Devuelve los SHAPES que el V0 espera (V0 types
// en `lib/types.ts`) para que los componentes del V0 (dashboard, geovisor,
// parcelas) funcionen sin cambios.
//
// Las pages server-side (V0) consumen `getParcels`, `getFumigations`, etc.
// Acá hacemos el mapeo project → V0 una sola vez y lo cacheamos por
// request vía `unstable_cache` con tag-based invalidation desde el repo.
//
// Reglas:
//   - `import "server-only"` — nunca se bundlea en el cliente.
//   - Las pages V0 que llamen estas funciones deben llevar `export const
//     dynamic = "force-dynamic"` (porque tocan BD y pueden fallar en
//     build-time con ENETUNREACH contra Supabase).
//   - Los campos del V0 que el proyecto no tiene (client_name, farm_name,
//     municipality, variety en dji_parcels) caen a defaults conservadores
//     — no rompen el render, solo muestran "Sin asignar".
//   - Constantes (NOW, DRONE_MODELS, STATUS_META, complianceStatus) viven
//     en `lib/data-constants.ts` para que Client Components puedan
//     importarlas sin bundlear este archivo (que arrastra node:fs).
//     Acá se re-exportan por compat con la convención del V0 mockup
//     (`import { NOW } from "@/lib/data"`).

import "server-only";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import {
  getParcelsNormalized,
  getParcelById,
  getFumigationEventsByParcel,
  getRecentFumigations,
  getFlightPoints,
  getAllFumigationSchedules,
  getScheduleHistory as getScheduleHistoryFromRepo
} from "@/api/repositories";
import { readHealthFile, deriveResponse, type PipelineHealth } from "@/lib/djiag-health";
import { getBogotaDateString, toDateString } from "@/lib/format";

// Re-export de las constantes V0 (mismas que el V0 mockup exportaba).
// Importan desde `lib/data-constants` para mantener el archivo puro y
// seguro de importar desde client components.
import { NOW, DRONE_MODELS, droneModel, complianceStatus, STATUS_META } from "@/lib/data-constants";
export { NOW, DRONE_MODELS, droneModel, complianceStatus, STATUS_META };
// Re-export types via inline `export type` so the line above can stay a value-import.
export type { ComplianceStatus, DroneModelId } from "@/lib/types";
import {
  type DjiParcelRecord,
  type DjiFumigationEvent,
  type DjiFumigationSchedule,
  type FlightPointRecord,
  type DjiParcel,
  type DjiFumigationV0,
  type DjiFlightV0,
  type DjiFumigationScheduleV0,
  type DjiScheduleHistory,
  type DjiImportBatch,
  type DjiAgHealth,
  type ComplianceStatus,
  type ParcelSummary,
  type DroneModelId,
  type GeovisorPayload
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constantes V0 (port del mockup).
// ---------------------------------------------------------------------------
// Re-exportadas arriba desde `lib/data-constants`. Acá solo quedan las
// constantes internas (DAY) y los helpers de adaptación.

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Helpers de mapeo: project → V0 shapes.
// ---------------------------------------------------------------------------

/** Extrae el centroide de un polígono GeoJSON (lng, lat promedio). */
function polygonCentroid(geom: GeoJSON.Geometry | null): { lng: number; lat: number } {
  if (!geom || geom.type !== "Polygon") return { lng: -76.3, lat: 3.45 };
  const ring = geom.coordinates[0] ?? [];
  if (ring.length === 0) return { lng: -76.3, lat: 3.45 };
  const sum = ring.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 }
  );
  return { lng: sum.lng / ring.length, lat: sum.lat / ring.length };
}

/** Mapea un DjiParcelRecord (project) → DjiParcel (V0). */
function adaptParcel(
  p: DjiParcelRecord,
  schedule: DjiFumigationSchedule | null
): DjiParcel {
  const { lng, lat } = polygonCentroid(p.spray_geometry);
  const droneCode = (p.drone_model_code ?? 0) as DroneModelId;
  // El proyecto ya tiene `crop_type` (metadata humana, migration 2026-07-22)
  // y `location_label` (direccion humana, migration 2026-07-09). Para
  // `client_name`/`farm_name`/`municipality`/`variety` caemos a defaults.
  const variety = p.variety ?? p.crop_type ?? "Sin asignar";
  return {
    id: String(p.id),
    dji_land_id: p.external_id,
    name: p.land_name ?? `Parcela #${p.id}`,
    farm_name: p.farm_name ?? "Sin asignar",
    client_name: p.client_name ?? "Sin asignar",
    municipality: p.municipality ?? "Sin asignar",
    area_ha: p.declared_area_ha ?? (p.spray_area_m2 != null ? p.spray_area_m2 / 10_000 : 0),
    variety,
    drone_model_id: droneCode,
    centroid_lng: lng,
    centroid_lat: lat,
    geom:
      p.spray_geometry?.type === "Polygon"
        ? (p.spray_geometry as { type: "Polygon"; coordinates: [number, number][][] })
        : { type: "Polygon", coordinates: [[[lng, lat], [lng, lat + 0.001], [lng + 0.001, lat + 0.001], [lng + 0.001, lat], [lng, lat]]] },
    created_at: p.fetched_at ?? new Date().toISOString(),
    is_active: !p.is_orchard || p.field_type !== "Orchards" || true
  };
}

/** Mapea un DjiFumigationSchedule (project) → DjiFumigationScheduleV0. */
function adaptSchedule(s: DjiFumigationSchedule | null | undefined, parcelId: string): DjiFumigationScheduleV0 {
  return {
    parcel_id: parcelId,
    cadence_days: s?.recommended_cadence_days ?? 14,
    product: s?.crop_type ?? "Madurante",
    dose_l_ha: 2.0, // el proyecto no tiene este campo en schedule — default razonable
    window_start_hour: 6,
    window_end_hour: 18,
    updated_at: new Date().toISOString()
  };
}

/** Mapea un DjiFumigationEvent (project) → DjiFumigationV0. */
function adaptFumigation(e: DjiFumigationEvent, flightsCount: number): DjiFumigationV0 {
  const areaHa = e.area_fumigated_m2 != null ? e.area_fumigated_m2 / 10_000 : 0;
  // El proyecto no tiene volume_l directo, pero sí dose_l_per_ha.
  // Volumen = area_ha * dose_l_ha. Si no hay, 0.
  const volumeL = e.dose_l_per_ha != null ? areaHa * e.dose_l_per_ha : 0;
  return {
    id: String(e.id),
    parcel_id: String(e.parcel_id),
    executed_at: `${e.fumigation_date ?? ""}T00:00:00Z`,
    source: (e.source ?? "manual") as "manual" | "import" | "djiscraper",
    area_treated_ha: areaHa,
    product: e.product_used ?? "Sin producto",
    volume_l: volumeL,
    operator: e.recorded_by ?? "Sin asignar",
    flights_count: flightsCount,
    notes: e.human_notes ?? null
  };
}

/** Mapea un FlightPointRecord (project) → DjiFlightV0. */
function adaptFlight(f: FlightPointRecord, idx: number, parcelId: number): DjiFlightV0 {
  return {
    id: String(f.flight_id ?? idx),
    fumigation_id: "", // no tenemos link directo fumigación↔flight
    parcel_id: String(f.parcel_id ?? parcelId),
    drone_model_id: 0, // el flight point no tiene el código del dron
    drone_sn: f.drone_nickname ?? "",
    pilot: f.pilot_name ?? "",
    started_at: f.start_at,
    duration_min: 0, // flight point no tiene duración
    area_ha: f.area_m2 != null ? f.area_m2 / 10_000 : 0,
    volume_l: f.spray_usage_ml != null ? f.spray_usage_ml / 1_000 : 0,
    lng: f.lng,
    lat: f.lat,
    battery_cycles: 0
  };
}

// ---------------------------------------------------------------------------
// Carga unificada de datos (cacheada).
// ---------------------------------------------------------------------------

interface Dataset {
  parcels: DjiParcel[];
  schedules: DjiFumigationSchedule[];
  schedulesByParcelId: Record<number, DjiFumigationSchedule>;
  fumigationEvents: DjiFumigationEvent[];
  flightPoints: FlightPointRecord[];
  health: DjiAgHealth;
  importBatches: DjiImportBatch[];
  scheduleHistory: Record<string, DjiScheduleHistory[]>;
  fetchedAt: string;
}

const _loadDatasetCached = unstable_cache(
  async (): Promise<Dataset> => {
    // 1) Parcels (traemos todos — la BD tiene ~1200, fits in memory).
    const parcelsResult = await getParcelsNormalized(1, 2000, {});
    const parcelRecords: DjiParcelRecord[] = parcelsResult.data;
    const schedulesMap = await getAllFumigationSchedules();
    // unstable_cache no preserva `Map` al serializar — usar objeto plano.
    const schedules: DjiFumigationSchedule[] = Array.from(schedulesMap.values());
    const schedulesByParcelId: Record<number, DjiFumigationSchedule> = {};
    for (const s of schedules) schedulesByParcelId[s.parcel_id] = s;

    // 2) Fumigation events (los más recientes 2000 — la BD tiene ~17k).
    const fumigationEvents = await getRecentFumigations(2000);

    // 3) Flight points (max 2000 por la cache).
    const flightPoints = await getFlightPoints(2000);

    // 4) Health (lee el _health.json del filesystem).
    const healthRaw = await readHealthFile("./djiag_exports/_health.json");
    const healthResponse = deriveResponse(healthRaw);
    const health: DjiAgHealth = {
      last_run_at: healthResponse.lastRunAt ?? new Date().toISOString(),
      next_run_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      status: mapHealthStatus(healthResponse.status),
      duration_ms: 0,
      parcels_synced: healthResponse.landsLastSync ?? 0,
      flights_synced: healthResponse.flightsLastSync ?? 0,
      api_latency_ms: 0,
      token_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      consecutive_failures:
        healthResponse.status === "failed" || healthResponse.status === "stale" ? 1 : 0
    };

    // 5) Import batches — derivamos de health.steps como un solo batch.
    const importBatches: DjiImportBatch[] = healthRaw
      ? [
          {
            id: "1",
            started_at: healthRaw.lastRunAt,
            finished_at: healthRaw.lastRunAt,
            status: healthRaw.lastRunStatus === "ok" ? "ok" : healthRaw.lastRunStatus === "partial" ? "partial" : "error",
            parcels_upserted: healthRaw.totals?.lands ?? 0,
            flights_upserted: healthRaw.totals?.flights ?? 0,
            fumigations_upserted: healthRaw.totals?.fumigations ?? 0,
            message: null
          }
        ]
      : [];

    // 6) Schedule history — vacío por ahora (el proyecto no tiene tabla
    // `dji_fumigation_schedule_history` aún).
    const scheduleHistory: Record<string, DjiScheduleHistory[]> = {};

    // 7) Adaptar parcels.
    const parcels: DjiParcel[] = parcelRecords.map((p) =>
      adaptParcel(p, schedulesByParcelId[p.id] ?? null)
    );

    return {
      parcels,
      schedules,
      schedulesByParcelId,
      fumigationEvents,
      flightPoints,
      health,
      importBatches,
      scheduleHistory,
      fetchedAt: new Date().toISOString()
    };
  },
  ["v0-dataset"],
  {
    revalidate: 60,
    tags: ["afm:v0-dashboard"]
  }
);

function mapHealthStatus(s: "ok" | "partial" | "stale" | "unknown" | "failed"): DjiAgHealth["status"] {
  if (s === "ok") return "ok";
  if (s === "partial") return "partial";
  return "error";
}

async function loadDataset(): Promise<Dataset> {
  return _loadDatasetCached();
}

// ---------------------------------------------------------------------------
// Cálculo de compliance (derivado).
// ---------------------------------------------------------------------------
// `complianceStatus` y `STATUS_META` viven en `lib/data-constants` para
// que los Client Components los puedan importar sin bundlear `lib/data.ts`.
// Acá se re-exportan arriba.

function buildSummaries(
  parcels: DjiParcel[],
  schedulesByParcelId: Record<number, DjiFumigationSchedule>,
  fumigationEvents: DjiFumigationEvent[],
  flightPoints: FlightPointRecord[]
): ParcelSummary[] {
  // Index fumigations by parcel.
  const eventsByParcel = new Map<number, DjiFumigationEvent[]>();
  for (const e of fumigationEvents) {
    if (e.parcel_id == null) continue;
    const list = eventsByParcel.get(e.parcel_id) ?? [];
    list.push(e);
    eventsByParcel.set(e.parcel_id, list);
  }
  // Index flights by parcel.
  const flightsByParcel = new Map<number, number>();
  for (const f of flightPoints) {
    if (f.parcel_id == null) continue;
    flightsByParcel.set(f.parcel_id, (flightsByParcel.get(f.parcel_id) ?? 0) + 1);
  }

  const nowMs = NOW.getTime();
  return parcels.map((parcel) => {
    const parcelIdNum = Number(parcel.id);
    const schedule = adaptSchedule(schedulesByParcelId[parcelIdNum] ?? null, parcel.id);
    const events = eventsByParcel.get(parcelIdNum) ?? [];
    // Sort descending by date for "last" calculation.
    const sortedEvents = [...events].sort((a, b) =>
      (b.fumigation_date ?? "").localeCompare(a.fumigation_date ?? "")
    );
    const last = sortedEvents[0] ?? null;
    const lastAt = last?.fumigation_date
      ? `${last.fumigation_date}T00:00:00Z`
      : null;
    const nextDue =
      lastAt != null
        ? new Date(new Date(lastAt).getTime() + schedule.cadence_days * DAY).toISOString()
        : null;
    const daysSince = lastAt
      ? Math.floor((nowMs - new Date(lastAt).getTime()) / DAY)
      : null;
    const daysToDue = nextDue ? Math.ceil((new Date(nextDue).getTime() - nowMs) / DAY) : null;

    const intervals: number[] = [];
    for (let i = 0; i < Math.min(sortedEvents.length - 1, 8); i++) {
      const curr = new Date(sortedEvents[i].fumigation_date ?? "").getTime();
      const prev = new Date(sortedEvents[i + 1].fumigation_date ?? "").getTime();
      if (Number.isFinite(curr) && Number.isFinite(prev)) {
        intervals.push((curr - prev) / DAY);
      }
    }

    const flightsCount = flightsByParcel.get(parcelIdNum) ?? 0;
    const totalAreaHa = events.reduce(
      (s, e) => s + (e.area_fumigated_m2 != null ? e.area_fumigated_m2 / 10_000 : 0),
      0
    );
    const totalVolumeL = events.reduce((s, e) => {
      const ha = e.area_fumigated_m2 != null ? e.area_fumigated_m2 / 10_000 : 0;
      return s + (e.dose_l_per_ha != null ? ha * e.dose_l_per_ha : 0);
    }, 0);

    return {
      parcel,
      schedule,
      last_fumigation_at: lastAt,
      next_due_at: nextDue,
      days_since_last: daysSince,
      days_to_due: daysToDue,
      status: complianceStatus(daysToDue),
      fumigations_count: events.length,
      flights_count: flightsCount,
      total_area_treated_ha: Math.round(totalAreaHa * 10) / 10,
      total_volume_l: Math.round(totalVolumeL),
      avg_interval_days:
        intervals.length > 0
          ? Math.round((intervals.reduce((a, b) => a + b, 0) / intervals.length) * 10) / 10
          : null
    };
  });
}

// ---------------------------------------------------------------------------
// Re-exports de V0 types para que los client components V0 puedan
// importar tipos desde `@/lib/data` (mantiene la convención del V0 mockup).
// ---------------------------------------------------------------------------

export type {
  DjiParcel,
  DjiFumigationV0,
  DjiFlightV0,
  DjiFumigationScheduleV0,
  DjiScheduleHistory,
  DjiImportBatch,
  DjiAgHealth,
  ParcelSummary,
  GeovisorPayload
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Selectores V0 (los que usan las pages del V0).
// ---------------------------------------------------------------------------

let _summariesCache: { key: string; summaries: ParcelSummary[] } | null = null;

async function getSummaries(): Promise<ParcelSummary[]> {
  const ds = await loadDataset();
  // Cache dentro del mismo request.
  if (_summariesCache && _summariesCache.key === ds.fetchedAt) {
    return _summariesCache.summaries;
  }
  const summaries = buildSummaries(
    ds.parcels,
    ds.schedulesByParcelId,
    ds.fumigationEvents,
    ds.flightPoints
  );
  _summariesCache = { key: ds.fetchedAt, summaries };
  return summaries;
}

export async function getParcels(): Promise<DjiParcel[]> {
  const ds = await loadDataset();
  return ds.parcels;
}

export async function getSchedules(): Promise<DjiFumigationScheduleV0[]> {
  const ds = await loadDataset();
  return ds.schedules.map((s) => adaptSchedule(s, String(s.parcel_id)));
}

export async function getFumigations(): Promise<DjiFumigationV0[]> {
  const ds = await loadDataset();
  const flightsByParcel = new Map<number, number>();
  for (const f of ds.flightPoints) {
    if (f.parcel_id == null) continue;
    flightsByParcel.set(f.parcel_id, (flightsByParcel.get(f.parcel_id) ?? 0) + 1);
  }
  return ds.fumigationEvents.map((e) => adaptFumigation(e, flightsByParcel.get(e.parcel_id) ?? 0));
}

export async function getFlights(): Promise<DjiFlightV0[]> {
  const ds = await loadDataset();
  return ds.flightPoints.map((f, i) => adaptFlight(f, i, f.parcel_id ?? 0));
}

export async function getParcelSummaries(): Promise<ParcelSummary[]> {
  return getSummaries();
}

export async function getParcelSummary(id: string): Promise<ParcelSummary | null> {
  const summaries = await getSummaries();
  return summaries.find((s) => s.parcel.id === id) ?? null;
}

export async function getFumigationsByParcel(id: string): Promise<DjiFumigationV0[]> {
  const ds = await loadDataset();
  const parcelIdNum = Number(id);
  const events = ds.fumigationEvents
    .filter((e) => e.parcel_id === parcelIdNum)
    .sort((a, b) => (b.fumigation_date ?? "").localeCompare(a.fumigation_date ?? ""));
  const flightsCount = ds.flightPoints.filter((f) => f.parcel_id === parcelIdNum).length;
  return events.map((e) => adaptFumigation(e, flightsCount));
}

export async function getFlightsByParcel(id: string): Promise<DjiFlightV0[]> {
  const ds = await loadDataset();
  const parcelIdNum = Number(id);
  return ds.flightPoints
    .filter((f) => f.parcel_id === parcelIdNum)
    .map((f, i) => adaptFlight(f, i, parcelIdNum));
}

export async function getScheduleHistory(id: string): Promise<DjiScheduleHistory[]> {
  // El proyecto no tiene tabla de schedule_history todavía. Si más adelante
  // se agrega, conectar acá. Por ahora devolvemos [].
  return [];
}

export async function getImportBatches(): Promise<DjiImportBatch[]> {
  const ds = await loadDataset();
  return ds.importBatches;
}

export async function getHealth(): Promise<DjiAgHealth> {
  const ds = await loadDataset();
  return ds.health;
}

export async function getClients(): Promise<string[]> {
  const ds = await loadDataset();
  return Array.from(new Set(ds.parcels.map((p) => p.client_name))).sort();
}

export async function getFarms(): Promise<string[]> {
  const ds = await loadDataset();
  return Array.from(new Set(ds.parcels.map((p) => p.farm_name))).sort();
}

// ---------------------------------------------------------------------------
// Payload del geovisor (todo el dataset que necesita el mapa).
// ---------------------------------------------------------------------------

export async function getGeovisorPayload(): Promise<GeovisorPayload> {
  const summaries = await getSummaries();
  const fumigations = await getFumigations();
  return {
    parcels: summaries.map((s) => ({
      id: s.parcel.id,
      name: s.parcel.name,
      farm_name: s.parcel.farm_name,
      client_name: s.parcel.client_name,
      municipality: s.parcel.municipality,
      variety: s.parcel.variety,
      area_ha: s.parcel.area_ha,
      drone_model_id: s.parcel.drone_model_id,
      centroid_lng: s.parcel.centroid_lng,
      centroid_lat: s.parcel.centroid_lat,
      geom: s.parcel.geom,
      status: s.status,
      last_fumigation_at: s.last_fumigation_at,
      next_due_at: s.next_due_at,
      cadence_days: s.schedule.cadence_days,
      fumigations_count: s.fumigations_count
    })),
    events: fumigations.map((f) => {
      const parcel = summaries.find((s) => s.parcel.id === f.parcel_id)?.parcel;
      return {
        id: f.id,
        parcel_id: f.parcel_id,
        executed_at: f.executed_at,
        source: f.source,
        area_treated_ha: f.area_treated_ha,
        volume_l: f.volume_l,
        flights_count: f.flights_count,
        product: f.product,
        operator: f.operator,
        lng: parcel?.centroid_lng ?? -76.3,
        lat: parcel?.centroid_lat ?? 3.45
      };
    })
  };
}
