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
  getScheduleHistory as getScheduleHistoryFromRepo,
  getFlightHullsByParcel
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

/** Extrae el centroide de un polígono GeoJSON (lng, lat promedio).
 *  Acepta Polygon o MultiPolygon (toma el primer anillo del primer
 *  polígono para MultiPolygon). */
function polygonCentroid(geom: GeoJSON.Geometry | null): { lng: number; lat: number } {
  if (!geom) return { lng: -76.3, lat: 3.45 };
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
    return { lng: -76.3, lat: 3.45 };
  }
  const ring: [number, number][] =
    geom.type === "Polygon"
      ? ((geom.coordinates[0] ?? []) as [number, number][])
      : ((geom.coordinates[0]?.[0] ?? []) as [number, number][]);
  if (ring.length === 0) return { lng: -76.3, lat: 3.45 };
  const sum = ring.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 }
  );
  return { lng: sum.lng / ring.length, lat: sum.lat / ring.length };
}

// Centro del Valle del Cauca (Palmira/Candelaria) como default cuando no
// hay geometria real. La region tiene ~80km × 80km de extent util.
const DEFAULT_CENTER: { lng: number; lat: number } = { lng: -76.3, lat: 3.45 };
// 1 grado de longitud ≈ 111km en el ecuador, ~108km a latitud 3.45N.
// 1 grado de latitud ≈ 110.5km.
// Para que las 1213 parcelas se vean bien, las esparcimos en un cuadrado
// de 1 grado × 1 grado (~110km × 110km). Eso da 1213 puntos en un area
// razonable de la region canera del Valle.
const SYNTHETIC_REGION_DEG = 0.9; // ~99km en lng, ~99km en lat

// v2.5.5 (S8.7+): convierte hectareas a un radio en grados decimales.
// Usado por el N-gon sintetico y por el buffer alrededor de flight
// centroide. Asumimos parcelas aproximadamente circulares para el
// calculo del area equivalente (A = π * r² → r = sqrt(A/π)).
//
// 1 grado ≈ 111km. Para area = A ha:
//   - r_m = sqrt(A * 10000 / π) (radio en metros)
//   - r_deg = r_m / 111000       (radio en grados)
//
// 0.5 ha mínimo para evitar polígonos degeneres (un parcel de 0.1 ha
// daría un polígono de 2.5m de radio, invisible a z=10).
function areaHaToRadiusDeg(areaHa: number): number {
  const ha = Math.max(areaHa, 0.5);
  const radiusM = Math.sqrt((ha * 10_000) / Math.PI);
  return Math.max(radiusM / 111_000, 0.0006);
}

/**
 * Genera una localizacion sintetica UNICA por parcel ID.
 *
 * Por que: para parcels SIN flights ni geometria real (~65% del dataset),
 * necesitamos una posicion estable y unica por parcel ID. Misma entrada
 * → misma salida siempre (importante para que el render no "salte" entre
 * re-renders).
 *
 * Estrategia: hash determinista del ID → coords (x, y) en una grilla
 * uniforme dentro de la region del Valle del Cauca. Parcel #1 va
 * a (-76.3, 3.45) (top-left), parcel #2 a (-76.3 + dx, 3.45) (top-row),
 * etc.
 */
function syntheticCentroid(parcelId: number): { lng: number; lat: number } {
  const hash = (parcelId * 2654435761) >>> 0; // Knuth multiplicative hash
  const lngOffset = ((hash % 10000) / 10000 - 0.5) * SYNTHETIC_REGION_DEG;
  const latOffset = (((hash >>> 16) % 10000) / 10000 - 0.5) * SYNTHETIC_REGION_DEG;
  return {
    lng: DEFAULT_CENTER.lng + lngOffset,
    lat: DEFAULT_CENTER.lat + latOffset
  };
}

/**
 * Genera un polígono N-gon IRREGULAR sintetico alrededor de un centroide.
 *
 * v2.5.5 (S8.7+): reemplaza al cuadrado perfecto de v2.5.3. El cuadrado
 * se veía irreal para el operador (un lote de caña nunca es cuadrado).
 * El N-gon tiene:
 *   - 8-12 lados (n = 8 + (id % 5))
 *   - Cada vértice perturbado radialmente entre 0.65x y 1.35x del radio
 *     base, usando un segundo hash para que la perturbación sea estable
 *   - Aspect ratio variable (no siempre cuadrado): width/height entre
 *     0.7x y 1.3x, derivado de un tercer hash
 *
 * Determinista: misma entrada → misma forma siempre. Cada parcel tiene
 * una "huella" geometrica única derivada de su ID.
 *
 * @param center centroide (lng, lat) del N-gon
 * @param areaHa hectareas declaradas — determina el radio base
 * @param parcelId ID del parcel — determina N, perturbaciones, y aspect ratio
 * @returns GeoJSON Polygon (ring cerrado)
 */
function syntheticPolygon(
  center: { lng: number; lat: number },
  areaHa: number,
  parcelId: number
): { type: "Polygon"; coordinates: [number, number][][] } {
  // Cantidad de lados: 8 a 12. Usamos (id - 1) % 5 para que el rango
  // sea exactamente 0..4 (los parcel IDs reales empiezan en 1, no en 0).
  const n = 8 + ((parcelId - 1) % 5);
  // Radio base (mismo para todos los vértices, después se perturba).
  const r = areaHaToRadiusDeg(areaHa);
  // Aspect ratio: 0.7x a 1.3x. Multiplicamos lng por aspectRatio,
  // dividimos lat por aspectRatio. Resultado: parcelas elongadas
  // (algunas más anchas, otras más altas), no todas redondos.
  const aspectRatio = 0.7 + ((parcelId * 17) % 100) / 100 * 0.6;
  // Hash secundario para perturbar el radio de cada vértice.
  // (parcelId * 31) es otro primo que no colisiona con el hash del
  // centroide. >>> 8 desplaza para tener bits "frescos" en mod 100.
  const perturbSeed = (parcelId * 31) >>> 8;
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    // Angulo base: 2π * i / n
    // Jitter angular: ±(π / (2n)) para que los vértices no caigan
    // exactamente sobre una grilla regular — eso es lo que hace que
    // el polígono se vea "natural" y no simétrico.
    const angleBase = (2 * Math.PI * i) / n;
    const angleJitter = (((perturbSeed + i * 7) % 100) / 100 - 0.5) * (Math.PI / n);
    const angle = angleBase + angleJitter;
    // Perturbacion radial: 0.65x a 1.35x del radio base.
    const radialFactor = 0.65 + (((perturbSeed + i * 13) % 100) / 100) * 0.7;
    const rActual = r * radialFactor;
    // Aplicar aspect ratio. Si aspect > 1, el polígono es más ancho
    // en lng que alto en lat (parcela horizontal). Si < 1, al revés.
    const dLng = (rActual * Math.cos(angle)) * aspectRatio;
    const dLat = (rActual * Math.sin(angle)) / aspectRatio;
    ring.push([center.lng + dLng, center.lat + dLat]);
  }
  // Cerrar el ring (GeoJSON requiere primer punto = último punto).
  ring.push([ring[0][0], ring[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Genera un polígono buffer circular alrededor de un centroide, dimensionado
 * segun el area del parcel.
 *
 * v2.5.5 (S8.7+): usado para parcels con 1-2 flights (no suficientes para
 * hacer un hull significativo). Devuelve un circulo de N lados — más
 * realista que un cuadrado y refleja que "hay datos pero pocos".
 *
 * @param center centroide (lng, lat) del circulo
 * @param areaHa hectareas declaradas — determina el radio
 * @returns GeoJSON Polygon (circulo de 16 lados, cerrado)
 */
function flightBufferPolygon(
  center: { lng: number; lat: number },
  areaHa: number
): { type: "Polygon"; coordinates: [number, number][][] } {
  // 16 lados es suficiente para que el círculo se vea suave a cualquier
  // zoom. Mas lados = más bytes en el payload GeoJSON sin beneficio
  // visual a z<=16.
  const sides = 16;
  const r = areaHaToRadiusDeg(areaHa);
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    ring.push([center.lng + r * Math.cos(angle), center.lat + r * Math.sin(angle)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

/** Mapea un DjiParcelRecord (project) → DjiParcel (V0). */
function adaptParcel(
  p: DjiParcelRecord,
  schedule: DjiFumigationSchedule | null,
  flightHull: { flightCount: number; centroid: { lng: number; lat: number }; hullGeometry: GeoJSON.Polygon | null } | null
): DjiParcel {
  const droneCode = (p.drone_model_code ?? 0) as DroneModelId;
  // El proyecto ya tiene `crop_type` (metadata humana, migration 2026-07-22)
  // y `location_label` (direccion humana, migration 2026-07-09). Para
  // `client_name`/`farm_name`/`municipality`/`variety` caemos a defaults.
  const variety = p.variety ?? p.crop_type ?? "Sin asignar";
  const areaHa = p.declared_area_ha ?? (p.spray_area_m2 != null ? p.spray_area_m2 / 10_000 : 0);

  // v2.5.5 (S8.7+): cascade por capas para el poligono del parcel.
  //
  //   1. spray_geometry REAL del scraper (dji_parcels.spray_geom) — si existe.
  //      Caso raro hoy (0/1213) pero el codigo lo soporta para cuando
  //      se popule.
  //   2. HULL REAL de flights fumigados (ST_ConvexHull) — si hay ≥3 flights
  //      con coordenadas. Cubre 34.5% de los parcels (419/1213). Es la
  //      fuente de máxima fidelidad disponible.
  //   3. BUFFER CIRCULAR alrededor del flight centroid — si hay 1-2 flights.
  //      Cubre 2.6% de los parcels (32/1213). Hull no es viable con tan
  //      pocos puntos, pero tenemos al menos la posición real del lote.
  //   4. N-GON SINTETICO IRREGULAR (Knuth hash) — si no hay nada.
  //      Cubre 62.8% de los parcels (762/1213). Determinista, no es
  //      cuadrado perfecto, tiene aspect ratio variable.
  //
  // El centroide que devolvemos (centroid_lng, centroid_lat) SIEMPRE
  // viene de la fuente de maxima fidelidad disponible: real > hull > buffer
  // > synthetic. Eso garantiza que el label/marker del mapa este donde
  // realmente está (o estaria) el lote.
  let center: { lng: number; lat: number };
  let geom: { type: "Polygon"; coordinates: [number, number][][] };

  if (p.spray_geometry?.type === "Polygon" || p.spray_geometry?.type === "MultiPolygon") {
    // 1) Real geometry del scraper (acepta Polygon o MultiPolygon).
    // El query en api/queries.ts ya normaliza a Polygon con ST_GeometryN,
    // pero aceptamos MultiPolygon también por defensa (futuros scrapers
    // podrían traer multipolígonos válidos sin necesidad de tomar el primero).
    center = polygonCentroid(p.spray_geometry);
    geom = p.spray_geometry as { type: "Polygon"; coordinates: [number, number][][] };
  } else if (flightHull?.hullGeometry) {
    // 2) Hull real de flights fumigados
    center = flightHull.centroid;
    geom = flightHull.hullGeometry as { type: "Polygon"; coordinates: [number, number][][] };
  } else if (flightHull) {
    // 3) Buffer alrededor del flight centroid (1-2 flights)
    center = flightHull.centroid;
    geom = flightBufferPolygon(center, areaHa);
  } else {
    // 4) N-gon sintetico irregular
    center = syntheticCentroid(p.id);
    geom = syntheticPolygon(center, areaHa, p.id);
  }

  return {
    id: String(p.id),
    dji_land_id: p.external_id,
    name: p.land_name ?? `Parcela #${p.id}`,
    farm_name: p.farm_name ?? "Sin asignar",
    client_name: p.client_name ?? "Sin asignar",
    municipality: p.municipality ?? "Sin asignar",
    area_ha: areaHa,
    variety,
    drone_model_id: droneCode,
    centroid_lng: center.lng,
    centroid_lat: center.lat,
    geom,
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
    notes: e.human_notes ?? null,
    // s8.8 (2026-07-31): lng/lat del centroide de flights (calculado en
    // getRecentFumigations via LEFT JOIN). Pasa al DjiFumigationV0
    // para que el geovisor pueda renderizar el evento en su posición
    // real. Si es NULL, el evento NO se renderiza.
    lng: e.lng ?? null,
    lat: e.lat ?? null,
    n_matched_flights: e.n_matched_flights ?? null
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
// Health-only loader (liviano, sin parcelas/fumigaciones/flights).
//
// Sprint S8.2 (2026-07-29): antes `getHealth()` llamaba `loadDataset()`
// (cacheado con unstable_cache, 60s TTL) que cargaba las 2000 parcels + 2000
// fumigations + 2000 flight points. El layout (app/layout.tsx) llama
// getHealth() en CADA request (incluso /login que no necesita data), y el
// cache layer de Next.js no liberaba la memoria entre requests → leak de
// ~4-8 MB/request que tumbaba el dev server en ~30-40 requests.
//
// Fix: separar la lectura del health file del dataset completo. Health es
// liviano (lee 1 archivo JSON, deriva 1 objeto). Lo cacheamos por 30s
// porque el `_health.json` solo se actualiza cuando corre el pipeline
// (`scripts/run-pipeline.js`), no en cada request.
// ---------------------------------------------------------------------------

const HEALTH_FILE_PATH = "./djiag_exports/_health.json";

const _loadHealthCached = unstable_cache(
  async (): Promise<DjiAgHealth> => {
    const healthRaw = await readHealthFile(HEALTH_FILE_PATH);
    const healthResponse = deriveResponse(healthRaw);
    return {
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
  },
  ["v0-health"],
  {
    revalidate: 30,
    tags: ["afm:v0-health"]
  }
);

async function loadHealth(): Promise<DjiAgHealth> {
  return _loadHealthCached();
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
  importBatches: DjiImportBatch[];
  scheduleHistory: Record<string, DjiScheduleHistory[]>;
  /** v2.5.5: hulls de flights fumigados por parcel (cache de PostGIS). */
  flightHullsByParcelId: Record<number, {
    flightCount: number;
    centroid: { lng: number; lat: number };
    hullGeometry: GeoJSON.Polygon | null;
  }>;
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

    // 4) v2.5.5 — flight hulls (PostGIS ST_ConvexHull agrupado por parcel).
    // Query cara (~200ms en Supabase sobre 8k flights), cacheada aparte en
    // `fetchFlightHullsByParcelCached` con TTL 10min. Devuelve una entrada
    // por parcel con flights válidos (incluyendo parcels con 1-2 flights
    // que tendran `hullGeometry: null`).
    const flightHulls = await getFlightHullsByParcel();
    const flightHullsByParcelId: Dataset["flightHullsByParcelId"] = {};
    for (const h of flightHulls) {
      flightHullsByParcelId[h.parcelId] = {
        flightCount: h.flightCount,
        centroid: h.centroid,
        hullGeometry: h.hullGeometry
      };
    }

    // 5) Health (leído del _health.json en `loadHealth()` aparte, ver arriba).
    //    Acá solo necesitamos los import batches derivados del health raw.
    const healthRaw = await readHealthFile(HEALTH_FILE_PATH);
    const healthResponse = deriveResponse(healthRaw);

    // 6) Import batches — derivamos de health.steps como un solo batch.
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

    // 7) Schedule history — vacío por ahora (el proyecto no tiene tabla
    //    `dji_fumigation_schedule_history` aún).
    const scheduleHistory: Record<string, DjiScheduleHistory[]> = {};

    // 8) Adaptar parcels — v2.5.5 cascade: real > hull > buffer > N-gon synth.
    const parcels: DjiParcel[] = parcelRecords.map((p) =>
      adaptParcel(p, schedulesByParcelId[p.id] ?? null, flightHullsByParcelId[p.id] ?? null)
    );

    // NOTA: `health` ya no se devuelve desde acá. Está en `loadHealth()`
    // que se llama independiente (sin cargar parcels/fumigations/flights).
    return {
      parcels,
      schedules,
      schedulesByParcelId,
      fumigationEvents,
      flightPoints,
      importBatches,
      scheduleHistory,
      flightHullsByParcelId,
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
  // Sprint S8.2: este ya no carga el dataset completo — solo el _health.json.
  // Ver docstring de `loadHealth()` arriba para el por qué.
  return loadHealth();
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
    events: fumigations
      // s8.8 (2026-07-31): filtrar eventos sin coordenadas validas
      // (centroide de flights). El `f.lng`/`f.lat` ya viene calculado
      // de `getRecentFumigations` (LEFT JOIN con dji_flights por
      // flight_ids). Antes se usaba el centroide de la parcela como
      // fallback, lo que hacia que 5 fumigaciones en la misma parcela
      // se vieran como 5 puntos superpuestos. Ahora cada fumigacion
      // se renderiza donde realmente voló el dron.
      .filter((f): f is typeof f & { lng: number; lat: number } =>
        typeof f.lng === "number" && typeof f.lat === "number"
      )
      .map((f) => ({
        id: f.id,
        parcel_id: f.parcel_id,
        executed_at: f.executed_at,
        source: f.source,
        area_treated_ha: f.area_treated_ha,
        volume_l: f.volume_l,
        flights_count: f.flights_count,
        product: f.product,
        operator: f.operator,
        notes: f.notes,
        n_matched_flights: f.n_matched_flights ?? null,
        lng: f.lng,
        lat: f.lat,
      }))
  };
}
