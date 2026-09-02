import { getDb } from "@/lib/db";
import { djiParcelsQuery } from "@/api/queries";
import fs from "node:fs";
import path from "node:path";
import {
  CADENCE_DEFAULTS,
  computeNextDueDate
} from "@/lib/fumigation-cadence";
import { getBogotaDateString, toDateString } from "@/lib/format";
import {
  aggregateFlightsByDay,
  type DailySummaryLike,
  type FlightRow
} from "@/lib/dji-flights-aggregate";
import {
  fetchAlertsCached,
  fetchDashboardMetricsCached,
  fetchFlightPointsCached,
  fetchOverdueParcelsCached,
  fetchParcelsNormalizedCached,
  fetchParcelsMetadataNoCache,
  fetchParcelsSummaryCached,
  fetchUpcomingFumigationsCached,
  fetchActivityComparisonCached,
  fetchFlightHullsByParcelCached,
  fetchParcelsCycleDataCached,
  invalidateAfterFumigationMutation,
  invalidateAfterParcelMutation
} from "@/lib/cache";
import type { ActivityComparison } from "@/lib/cache";
import type {
  DashboardMetrics,
  DjiDailySummaryRecord,
  DjiFlightRecord,
  DjiAlertRecord,
  DjiFumigationEvent,
  DjiFumigationSchedule,
  DjiParcelRecord,
  DjiVehicle,
  DjiProduct,
  FumigationInvoice,
  ApplicationType,
  FumigationTimelineInput,
  OverdueParcel,
  UpcomingFumigation,
  FlightPointRecord,
  CyclePhase
} from "@/lib/types";
import type { OverdueParcelsArgs } from "@/lib/cache";

interface MetricsRow {
  total_flights: string;
  total_area_covered_m2: string | null;
  high_alert_days: string;
  total_parcels: string;
}

/**
 * Row cruda de dji_flights que devuelve pg.query (snake_case tal cual la tabla).
 * El cast numérico de pg ya está hecho en lib/db.ts (NUMERIC/BIGINT → number).
 */
interface DjiFlightDbRow {
  id: number;
  flight_id: number;
  start_at: Date;
  end_at: Date;
  duration_seconds: number;
  area_m2: number;
  spray_usage_ml: number;
  drone_nickname: string | null;
  pilot_name: string | null;
  parcel_id: number | null;
}

const localExportsRoot = path.join(process.cwd(), "djiag_exports");

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function parseLooseNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9.]+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseSummaryRecord(item: Record<string, unknown>, index: number): DjiDailySummaryRecord {
  const raw = String(item.raw ?? item.raw_text ?? "");
  const date = String(item.date ?? item.record_date ?? raw.match(/^(\d{4}\/\d{2}\/\d{2})/)?.[1] ?? "");
  const rawMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2})([A-Za-z]+)Agriculture([\d.]+)mu(\d+)times([\d.]+)L-(.+)$/);
  return {
    id: index + 1,
    record_date: date.includes("/") ? date.replace(/\//g, "-") : date,
    weekday: String(item.weekday ?? rawMatch?.[2] ?? "").replace(/Agriculture$/, "") || null,
    category: String(item.category ?? "Agriculture") || "Agriculture",
    area_mu: parseLooseNumber(item.area ?? item.area_mu ?? rawMatch?.[3]),
    times_count: parseLooseNumber(item.times ?? item.times_count ?? rawMatch?.[4]),
    usage_liters: parseLooseNumber(item.usage ?? item.usage_liters ?? rawMatch?.[5]),
    work_time_text: String(item.workTime ?? item.work_time_text ?? rawMatch?.[6] ?? ""),
    raw_text: raw
  };
}

function loadLocalSummaryRecords(): DjiDailySummaryRecord[] {
  const filePath = path.join(localExportsRoot, "records_history.json");
  const raw = readJsonFile<Array<Record<string, unknown>>>(filePath, []);
  return raw.map((item, index) => parseSummaryRecord(item, index)).sort((a, b) => b.record_date.localeCompare(a.record_date));
}

async function withLocalFallback<T>(queryFn: () => Promise<T>, fallbackFn: () => Promise<T>) {
  try {
    return await queryFn();
  } catch {
    return fallbackFn();
  }
}

// S2 (2026-07-01): `loadLocalAssetRecords()` y `getParcels()` legacy eliminados.
// S3 (2026-07-01): `loadLocalFieldCount()` (código muerto) eliminado.
// S1.7 ya migró el último caller (app/page.tsx) a getParcelsNormalized().
// Las tablas legacy de catálogo, denormalización y rollup diario se
// dropearon en la migration 20260628120000 (snapshot en dji_legacy_snapshot).
// El dashboard ahora solo lee de dji_parcels y dji_flights.

export interface DjiParcelsFilter {
  isOrchard?: boolean;
  droneModelCode?: number;
  minSprayAreaM2?: number;
  fieldType?: string;
  /**
   * Filtros "mostrar solo con X vacío" para /admin/parcels (QA
   * gap cerrado 2026-08-02). El operador fumigador tiene 1213
   * parcelas y los 4 campos V0 arrancan vacíos en la BD. Sin
   * este filtro tendría que ir página por página (24 páginas)
   * para encontrar cuáles faltan poblar. Con cualquier subset
   * de estos flags activos, la query agrega `IS NULL OR = ''`
   * al WHERE.
   *
   * Sprint 2026-08-02: agregado. Si en el futuro hay más campos
   * V0 (e.g. `crop_type`, `municipality` ya está), extender el
   * interface con un patrón consistente.
   */
  missingClientName?: boolean;
  missingFarmName?: boolean;
  missingMunicipality?: boolean;
  missingVariety?: boolean;
}

/**
 * Devuelve la lista normalizada de parcelas (Opción B).
 * Usa la tabla dji_parcels, con columnas planas y geometrías PostGIS como GeoJSON.
 *
 * Sprint 7 (2026-06-28): cacheado con `unstable_cache` (TTL 60s, tag
 * `afm:parcels`). El dashboard y /map pegaban este query en cada
 * navegación; ahora es prácticamente gratis entre revalidaciones.
 *
 * v1.3 Track A (2026-07-21): el panel de filtros del mapa
 * (`components/map/map-filter-sidebar.tsx`, antes `map-filters-panel.tsx`
 * en v1.3) usa esta función con
 * `filter = { droneModelCode, fieldType }` para filtrar server-side
 * via URL searchParams. Como el wrapper cacheado no soporta filters
 * (sería un keyParts enorme), esa combinación va a la variante
 * `getParcelsNormalizedUncached` que va directo a la BD. El filtro
 * `fumigated` NO se hace acá — se aplica in-memory en el page.tsx
 * sobre `fumigatedParcelIds` (Set<number>) que ya está en memoria
 * del critical path (M3-M5 Track A).
 */
export async function getParcelsNormalized(page = 1, limit = 20, filter: DjiParcelsFilter = {}) {
  // El filter actual no lo soporta el wrapper cacheado (sería un keyParts
  // enorme); la mayoría de callers pasa filter={} en el dashboard. Mantenemos
  // la versión dinámica como escape hatch — si filter tiene algo, vamos a la
  // BD directo (sin cache).
  const hasFilter =
    filter.isOrchard !== undefined ||
    filter.droneModelCode !== undefined ||
    filter.minSprayAreaM2 !== undefined ||
    filter.fieldType !== undefined ||
    filter.missingClientName === true ||
    filter.missingFarmName === true ||
    filter.missingMunicipality === true ||
    filter.missingVariety === true;

  if (hasFilter) {
    return getParcelsNormalizedUncached(page, limit, filter);
  }
  return fetchParcelsNormalizedCached(page, limit);
}

/**
 * `getParcelsNormalizedMetadata` — wrapper sobre `djiParcelsMetadataQuery`
 * (sin waypoints). Usado por `loadDataset` (lib/data.ts) para listar TODAS
 * las parcelas (~1213) en memoria sin romper el límite 2MB de
 * `unstable_cache`. NO soporta filters (es solo para el dataset completo).
 *
 * Sprint S10 (2026-08-05) — fix del unhandledRejection "items over 2MB can
 * not be cached" en /parcelas + /geovisor. Ver docstring de
 * `djiParcelsMetadataQuery` (api/queries.ts) para el por qué.
 *
 * Importante: usa `fetchParcelsMetadataNoCache` (sin unstable_cache) porque
 * el dataset bulk de 1213 parcelas metadata todavía pesa ~2.35MB y supera
 * el límite 2MB. El detalle page y /admin/parcels siguen usando
 * `fetchParcelsNormalizedCached` (paginada en bloques de 50, fit bajo 2MB).
 */
export async function getParcelsNormalizedMetadata(
  page = 1,
  limit = 2000
): Promise<{ data: DjiParcelRecord[]; total: number; page: number; limit: number; totalPages: number }> {
  return fetchParcelsMetadataNoCache(page, limit);
}

/**
 * Variante sin cache para cuando hay filters. La lógica es idéntica a la
 * implementación previa a S7 — separada en función propia para no envenenar
 * el wrapper de cache.
 */
async function getParcelsNormalizedUncached(page: number, limit: number, filter: DjiParcelsFilter) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (filter.isOrchard !== undefined) {
    where.push(`is_orchard = $${p++}`);
    params.push(filter.isOrchard);
  }
  if (filter.droneModelCode !== undefined) {
    where.push(`drone_model_code = $${p++}`);
    params.push(filter.droneModelCode);
  }
  if (filter.minSprayAreaM2 !== undefined) {
    where.push(`spray_area_m2 >= $${p++}`);
    params.push(filter.minSprayAreaM2);
  }
  if (filter.fieldType) {
    where.push(`field_type = $${p++}`);
    params.push(filter.fieldType);
  }
  // QA gap cerrado 2026-08-02: filtros "mostrar solo con X vacío".
  // El operador fumigador tiene 1213 parcelas y los 4 campos V0
  // arrancan NULL. Con estos flags puede ver solo las que faltan
  // poblar (sin tener que ir página por página). Cada flag agrega
  // un `IS NULL OR = ''` al WHERE — varios flags activos se
  // combinan con AND (la parcela debe tener TODOS los campos
  // marcados como vacíos).
  //
  // Performance: con índices actuales, IS NULL es un seq scan
  // parcial (Postgres). Con 1213 filas es instantáneo. Si el
  // dataset crece a >100k, considerar partial indexes sobre
  // `WHERE client_name IS NULL OR client_name = ''` etc.
  if (filter.missingClientName) {
    where.push(`(client_name IS NULL OR client_name = '')`);
  }
  if (filter.missingFarmName) {
    where.push(`(farm_name IS NULL OR farm_name = '')`);
  }
  if (filter.missingMunicipality) {
    where.push(`(municipality IS NULL OR municipality = '')`);
  }
  if (filter.missingVariety) {
    where.push(`(variety IS NULL OR variety = '')`);
  }
  // Sprint B — H1: soft delete. La migration 20260720000000 dejó la columna
  // `deleted_at` lista; este filtro activa el soft delete en la query de
  // listado paginado. Sin él, las parcelas "borradas" (deleted_at != NULL)
  // seguirían apareciendo en el dashboard y el listado de /map.
  where.push(`p.deleted_at IS NULL`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return withLocalFallback(
    async () => {
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} ${whereSql} ORDER BY land_name ASC NULLS LAST, id ASC LIMIT $${p++} OFFSET $${p++}`,
        [...params, limit, offset]
      );
      const countResult = await db.query<{ total: string }>(
        `SELECT COUNT(*)::int AS total FROM dji_parcels ${whereSql}`,
        params
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      return {
        data: result.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => ({
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 0
    })
  );
}

/**
 * Campos editables de una parcela desde la UI. NO incluye geometrías ni datos
 * de DJI scrapeados — esos vienen del importer. Solo metadata que el operador
 * puede querer ajustar manualmente (nombre visible, tipo declarado, areas,
 * y la metadata humana que DJI no expone: cultivo, siembra, propietario, contacto, notas).
 *
 * Sprint S8.2 (2026-07-29): agregados los 4 campos del V0 mockup que la UI
 * expone en el panel de operaciones y el filtro del geovisor
 * (`client_name`, `farm_name`, `municipality`, `variety`). Estas columnas
 * se agregaron físicamente en `dji_parcels` via la migration
 * 20260728000000_add_v0_fields_to_dji_parcels.sql.
 */
export type ParcelMetadataUpdate = {
  land_name?: string | null;
  field_type?: "Farmland" | "Orchards" | string | null;
  declared_area_ha?: number | null;
  spray_area_m2?: number | null;
  // Metadata humana (sprint 2026-07-22). El supervisor llena una vez por parcela.
  crop_type?: string | null;
  planting_date?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  supervisor_notes?: string | null;
  // V0 fields (sprint S8.2, 2026-07-29). El operador fumigador los llena
  // via /admin/parcels. Sin DJI source — los datos solo los conoce el
  // operario de campo.
  client_name?: string | null;
  farm_name?: string | null;
  municipality?: string | null;
  variety?: string | null;
};

/**
 * Actualiza metadata editable de una parcela. Devuelve `null` si no existe.
 * Las columnas técnicas (external_id, batch_id, geometrías, drone_model_code)
 * NO se tocan — vienen del importer DJI.
 *
 * Si ningun campo editable fue enviado, no hace UPDATE (evita un roundtrip
 * innecesario a la BD). Devuelve el registro actual.
 */
export async function updateParcelMetadata(
  id: number,
  patch: ParcelMetadataUpdate
): Promise<DjiParcelRecord | null> {
  // Whitelist de columnas + valores saneados.
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (patch.land_name !== undefined) {
    sets.push(`land_name = $${idx++}`);
    params.push(patch.land_name ?? null);
  }
  if (patch.field_type !== undefined) {
    sets.push(`field_type = $${idx++}`);
    params.push(patch.field_type ?? null);
  }
  if (patch.declared_area_ha !== undefined) {
    if (patch.declared_area_ha !== null && (patch.declared_area_ha < 0 || patch.declared_area_ha > 100000)) {
      throw new Error("declared_area_ha debe estar entre 0 y 100000 (hectareas)");
    }
    sets.push(`declared_area_ha = $${idx++}`);
    params.push(patch.declared_area_ha ?? null);
  }
  if (patch.spray_area_m2 !== undefined) {
    if (patch.spray_area_m2 !== null && (patch.spray_area_m2 < 0 || patch.spray_area_m2 > 1e9)) {
      throw new Error("spray_area_m2 debe estar entre 0 y 1e9 (m^2)");
    }
    sets.push(`spray_area_m2 = $${idx++}`);
    params.push(patch.spray_area_m2 ?? null);
  }
  if (patch.crop_type !== undefined) {
    if (patch.crop_type !== null && patch.crop_type.length > 100) {
      throw new Error("crop_type max 100 chars");
    }
    sets.push(`crop_type = $${idx++}`);
    params.push(patch.crop_type ?? null);
  }
  if (patch.planting_date !== undefined) {
    // Acepta "YYYY-MM-DD" o null. Validamos formato básico server-side.
    if (patch.planting_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.planting_date)) {
      throw new Error("planting_date debe tener formato YYYY-MM-DD");
    }
    sets.push(`planting_date = $${idx++}`);
    params.push(patch.planting_date ?? null);
  }
  if (patch.owner_name !== undefined) {
    if (patch.owner_name !== null && patch.owner_name.length > 200) {
      throw new Error("owner_name max 200 chars");
    }
    sets.push(`owner_name = $${idx++}`);
    params.push(patch.owner_name ?? null);
  }
  if (patch.owner_contact !== undefined) {
    if (patch.owner_contact !== null && patch.owner_contact.length > 200) {
      throw new Error("owner_contact max 200 chars");
    }
    sets.push(`owner_contact = $${idx++}`);
    params.push(patch.owner_contact ?? null);
  }
  if (patch.supervisor_notes !== undefined) {
    if (patch.supervisor_notes !== null && patch.supervisor_notes.length > 2000) {
      throw new Error("supervisor_notes max 2000 chars");
    }
    sets.push(`supervisor_notes = $${idx++}`);
    params.push(patch.supervisor_notes ?? null);
  }
  // V0 fields (sprint S8.2, 2026-07-29). Validamos longitud razonable para
  // evitar inputs pegados accidentalmente (e.g. un paste de 1MB de texto).
  if (patch.client_name !== undefined) {
    if (patch.client_name !== null && patch.client_name.length > 200) {
      throw new Error("client_name max 200 chars");
    }
    sets.push(`client_name = $${idx++}`);
    params.push(patch.client_name ?? null);
  }
  if (patch.farm_name !== undefined) {
    if (patch.farm_name !== null && patch.farm_name.length > 200) {
      throw new Error("farm_name max 200 chars");
    }
    sets.push(`farm_name = $${idx++}`);
    params.push(patch.farm_name ?? null);
  }
  if (patch.municipality !== undefined) {
    if (patch.municipality !== null && patch.municipality.length > 100) {
      throw new Error("municipality max 100 chars");
    }
    sets.push(`municipality = $${idx++}`);
    params.push(patch.municipality ?? null);
  }
  if (patch.variety !== undefined) {
    if (patch.variety !== null && patch.variety.length > 100) {
      throw new Error("variety max 100 chars");
    }
    sets.push(`variety = $${idx++}`);
    params.push(patch.variety ?? null);
  }

  if (sets.length === 0) {
    // Nada que cambiar — devolvemos el registro actual sin tocar BD.
    return getParcelById(id);
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      // Verificar existencia primero (devolvemos null vs throw).
      // Sprint B — H1: si la parcela está soft-deleted, no se puede editar.
      // Mismo criterio que `getParcelById` — el detail page y el edit panel
      // la ocultan, así que updateParcelMetadata tampoco debería escribir.
      const existing = await db.query<{ id: number }>(
        `SELECT id FROM dji_parcels WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (existing.rows.length === 0) return null;

      params.push(id);
      await db.query(
        `UPDATE dji_parcels SET ${sets.join(", ")} WHERE id = $${idx}`,
        params
      );
      // El parcel puede estar en cache de parcels + parcels-summary + upcoming.
      // Lo mas simple es invalidar todo lo que invalida parcel mutation.
      invalidateAfterParcelMutation();
      // Devolver el row actualizado via getParcelById (que tambien cachea).
      return getParcelById(id);
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

// ============================================================
// Alta manual de parcelas (sprint 2026-08-04, feature/parcel-onboarding)
// ============================================================

/**
 * GeoJSON Polygon o MultiPolygon. Aceptamos Polygon simple y lo
 * convertimos a MultiPolygon en SQL para mantener la columna como
 * MultiPolygon (que es lo que espera `dji_parcels.spray_geom`).
 *
 * El operador puede entregar:
 *   - GeoJSON Polygon  (frontend: terra-draw devuelve Polygon)
 *   - GeoJSON MultiPolygon (frontend: si une varios polígonos)
 */
export type ManualParcelGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

/** GeoJSON Point — para el centroid de la parcela. */
export type ManualParcelPoint = {
  type: "Point";
  coordinates: [number, number];
};

/**
 * Datos alfanuméricos para alta manual. NO incluye geometría
 * (se pasa por separado para mantener la firma legible).
 *
 * Validación de lengths: el server pre-valida los límites
 * razonables. La BD tiene CHECK constraints adicionales (ej
 * `length(luck_name) <= 100`, `source IN ('dji','manual','imported')`).
 * Si algún CHECK falla, pg tira 23514 que el route handler mapea a 400.
 */
export type CreateManualParcelInput = {
  /** Nombre visible de la parcela (obligatorio, max 200). */
  land_name: string;
  /** Tipo de campo DJI (obligatorio, "Farmland" | "Orchards" | otro). */
  field_type: string;
  /** Suerte (opcional, max 100). */
  luck_name?: string | null;
  /** Cliente / ingenio (opcional, max 200). */
  client_name?: string | null;
  /** Hacienda (opcional, max 200). */
  farm_name?: string | null;
  /** Municipio (opcional, max 100). */
  municipality?: string | null;
  /** Variedad (opcional, max 100). */
  variety?: string | null;
  /** Cultivo declarado por el supervisor (opcional, max 100). */
  crop_type?: string | null;
  /** Fecha de siembra (opcional, formato YYYY-MM-DD). */
  planting_date?: string | null;
  /** Propietario (opcional, max 200). */
  owner_name?: string | null;
  /** Contacto del propietario (opcional, max 200). */
  owner_contact?: string | null;
  /** Notas del supervisor (opcional, max 2000). */
  supervisor_notes?: string | null;
  /** Geometría (obligatoria para alta manual). */
  geometry: ManualParcelGeometry;
  /** Geometría centroid (opcional, default = ST_Centroid(geometry)). */
  reference_point?: ManualParcelPoint | null;
};

/**
 * Helper para tirar un error de validación con un code distinguible.
 * El route handler (`mapErrorToHttp`) usa `code === "VALIDATION"` para
 * distinguir errores de validación (→ 400 con mensaje legible) de
 * errores de BD o de red (→ 500). Sin esto, cualquier Error.message
 * legible se mapea a 400 y un error de BD real quedaría como 400.
 */
function validationError(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = "VALIDATION";
  return err;
}

/**
 * Valida los limits razonables. Tira Error con `code: "VALIDATION"`
 * si algún campo excede el límite. La BD tiene los CHECK constraints
 * como red de seguridad (devuelve 23514 → 400).
 */
function validateManualParcelInput(input: CreateManualParcelInput): void {
  if (!input.land_name || input.land_name.trim().length === 0) {
    throw validationError("land_name es obligatorio");
  }
  if (input.land_name.length > 200) {
    throw validationError("land_name max 200 chars");
  }
  if (!input.field_type || input.field_type.trim().length === 0) {
    throw validationError("field_type es obligatorio");
  }
  if (input.luck_name != null && input.luck_name.length > 100) {
    throw validationError("luck_name max 100 chars");
  }
  if (input.client_name != null && input.client_name.length > 200) {
    throw validationError("client_name max 200 chars");
  }
  if (input.farm_name != null && input.farm_name.length > 200) {
    throw validationError("farm_name max 200 chars");
  }
  if (input.municipality != null && input.municipality.length > 100) {
    throw validationError("municipality max 100 chars");
  }
  if (input.variety != null && input.variety.length > 100) {
    throw validationError("variety max 100 chars");
  }
  if (input.crop_type != null && input.crop_type.length > 100) {
    throw validationError("crop_type max 100 chars");
  }
  if (input.planting_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.planting_date)) {
    throw validationError("planting_date debe tener formato YYYY-MM-DD");
  }
  if (input.owner_name != null && input.owner_name.length > 200) {
    throw validationError("owner_name max 200 chars");
  }
  if (input.owner_contact != null && input.owner_contact.length > 200) {
    throw validationError("owner_contact max 200 chars");
  }
  if (input.supervisor_notes != null && input.supervisor_notes.length > 2000) {
    throw validationError("supervisor_notes max 2000 chars");
  }
  // Geometría: validación laxa (decisión QA 2026-08-04). Solo
  // chequeamos que el type sea Polygon|MultiPolygon. La BD no
  // rechaza por auto-intersección (sin ST_IsValid) — si el
  // operador dibujó mal, ve el resultado en el mapa y puede
  // re-dibujar (PATCH /api/admin/parcels/[id]/geometry).
  if (
    !input.geometry ||
    (input.geometry.type !== "Polygon" && input.geometry.type !== "MultiPolygon")
  ) {
    throw validationError("geometry debe ser Polygon o MultiPolygon GeoJSON");
  }
  if (input.geometry.type === "Polygon") {
    const ring = (input.geometry.coordinates as number[][][])[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      throw validationError("Polygon debe tener al menos 4 vértices (3 + cierre)");
    }
  } else {
    const polys = input.geometry.coordinates as number[][][][];
    if (!Array.isArray(polys) || polys.length === 0) {
      throw validationError("MultiPolygon debe tener al menos un polígono");
    }
  }
  if (
    input.reference_point != null &&
    input.reference_point.type !== "Point"
  ) {
    throw validationError("reference_point debe ser GeoJSON Point");
  }
}

/**
 * Crea una parcela manual. El server inyecta:
 *   - source = 'manual'
 *   - batch_id = NULL
 *   - external_id = 'manual-{uuid-v4}'
 *
 * Devuelve el row completo (mismo shape que `getParcelById`).
 *
 * Importante: NO usamos `withLocalFallback` acá porque silenciaría
 * los errores de CHECK constraint (23514) de la BD. Esos errores
 * los necesitamos propagar al route handler para mapearlos a 400.
 * Si la BD está caída, el error se propaga y el route handler lo
 * mapea a 500 — que es el comportamiento correcto.
 */
export async function createManualParcel(
  input: CreateManualParcelInput
): Promise<DjiParcelRecord> {
  validateManualParcelInput(input);

  const db = getDb();
  const externalId = `manual-${crypto.randomUUID()}`;
  const result = await db.query<DjiParcelRecord>(
    `
      INSERT INTO dji_parcels (
        batch_id, external_id, source,
        land_name, field_type, is_orchard,
        declared_area_ha, spray_area_m2,
        luck_name, client_name, farm_name, municipality, variety,
        crop_type, planting_date, owner_name, owner_contact, supervisor_notes,
        spray_geom, reference_point
      )
      VALUES (
        NULL, $1, 'manual',
        $2, $3, false,
        $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        ST_Multi(ST_GeomFromGeoJSON($16::text)),
        CASE WHEN $17::text IS NULL
             THEN ST_Centroid(ST_Multi(ST_GeomFromGeoJSON($16::text)))
             ELSE ST_GeomFromGeoJSON($17::text)
        END
      )
      RETURNING id
    `,
    [
      externalId,
      input.land_name.trim(),
      input.field_type.trim(),
      // declared_area_ha y spray_area_m2 los dejamos NULL: el
      // operador los puede cargar después, o los derivamos
      // de la geometría en otro sprint.
      null,
      null,
      input.luck_name?.trim() ?? null,
      input.client_name?.trim() ?? null,
      input.farm_name?.trim() ?? null,
      input.municipality?.trim() ?? null,
      input.variety?.trim() ?? null,
      input.crop_type?.trim() ?? null,
      input.planting_date ?? null,
      input.owner_name?.trim() ?? null,
      input.owner_contact?.trim() ?? null,
      input.supervisor_notes?.trim() ?? null,
      JSON.stringify(input.geometry),
      input.reference_point ? JSON.stringify(input.reference_point) : null
    ]
  );
  const created = result.rows[0];
  if (!created) {
    throw new Error("INSERT no devolvió row");
  }
  invalidateAfterParcelMutation();
  return getParcelById(Number(created.id)) as Promise<DjiParcelRecord>;
}

/**
 * Crea N parcelas manuales en una sola transacción. Usado por el
 * import GIS para que el operador suba un SHP/KML/GPKG y en 1 click
 * se creen todas (o ninguna, si alguna falla la validación).
 *
 * Decisiones:
 *   - Reusa la misma validación que `createManualParcel` (cada feature
 *     se valida por separado antes del INSERT).
 *   - Si UNA falla, ROLLBACK — no se crea ninguna. El operador
 *     puede editar nombres y reintentar.
 *   - Devuelve los rows completos en el mismo orden que el input.
 *   - NO usa withLocalFallback (mismo rationale que createManualParcel).
 *   - source = 'imported' (distinto de 'manual' = alta desde el form)
 *     para poder filtrar después si el operador quiere.
 *
 * Decisión de scope: el MVP solo soporta crear parcelas desde GIS.
 * No actualizamos parcelas existentes (el matching por external_id se
 * puede agregar después si el operador lo pide).
 */
export async function createManualParcelsBulk(
  inputs: CreateManualParcelInput[]
): Promise<DjiParcelRecord[]> {
  if (inputs.length === 0) return [];
  // Validamos TODO antes de empezar la transacción — si alguno falla,
  // no abrimos la tx y devolvemos el error de validación al cliente.
  for (let i = 0; i < inputs.length; i++) {
    try {
      validateManualParcelInput(inputs[i]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "validación";
      throw new Error(`Parcela #${i + 1} (${inputs[i].land_name}): ${msg}`);
    }
  }

  const db = getDb();
  // pool.connect() nos da un cliente dedicado para la transacción.
  const client = await db.connect();
  const created: DjiParcelRecord[] = [];
  try {
    await client.query("BEGIN");
    for (const input of inputs) {
      const externalId = `imported-${crypto.randomUUID()}`;
      const result = await client.query<{ id: number }>(
        `
          INSERT INTO dji_parcels (
            batch_id, external_id, source,
            land_name, field_type, is_orchard,
            declared_area_ha, spray_area_m2,
            luck_name, client_name, farm_name, municipality, variety,
            crop_type, planting_date, owner_name, owner_contact, supervisor_notes,
            spray_geom, reference_point
          )
          VALUES (
            NULL, $1, 'imported',
            $2, $3, false,
            NULL, NULL,
            $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13,
            ST_Multi(ST_GeomFromGeoJSON($14::text)),
            ST_Centroid(ST_Multi(ST_GeomFromGeoJSON($14::text)))
          )
          RETURNING id
        `,
        [
          externalId,
          input.land_name.trim(),
          input.field_type,
          input.luck_name?.trim() ?? null,
          input.client_name?.trim() ?? null,
          input.farm_name?.trim() ?? null,
          input.municipality?.trim() ?? null,
          input.variety?.trim() ?? null,
          input.crop_type?.trim() ?? null,
          input.planting_date ?? null,
          input.owner_name?.trim() ?? null,
          input.owner_contact?.trim() ?? null,
          input.supervisor_notes?.trim() ?? null,
          JSON.stringify(input.geometry)
        ]
      );
      const newId = Number(result.rows[0]?.id);
      if (!newId) throw new Error("INSERT no devolvió id");
      const fullRow = await client.query<DjiParcelRecord>(
        `SELECT * FROM dji_parcels WHERE id = $1`,
        [newId]
      );
      const row = fullRow.rows[0];
      if (!row) throw new Error(`No se pudo leer la parcela recién creada #${newId}`);
      created.push(row);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  invalidateAfterParcelMutation();
  return created;
}

/**
 * Reemplaza la geometría de una parcela. Usado cuando el operador
 * re-dibuja el polígono. La fumigación pasada queda asociada a la
 * geometría anterior (no se migra), pero el detalle de la parcela
 * muestra la nueva forma a partir de este momento.
 *
 * Loguea el cambio en `djiag_audit_log` para que el supervisor pueda
 * revisar quién modificó la geometría y cuándo.
 *
 * Mismo rationale que `createManualParcel`: NO usamos withLocalFallback
 * para que los errores de BD (23514, 23502, 23503) se propaguen al
 * route handler y se mapeen a 400.
 */
export async function updateParcelGeometry(
  id: number,
  geometry: ManualParcelGeometry,
  changeReason: string
): Promise<DjiParcelRecord | null> {
  if (
    !geometry ||
    (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
  ) {
    throw validationError("geometry debe ser Polygon o MultiPolygon GeoJSON");
  }
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as number[][][])[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      throw validationError("Polygon debe tener al menos 4 vértices (3 + cierre)");
    }
  } else {
    const polys = geometry.coordinates as number[][][][];
    if (!Array.isArray(polys) || polys.length === 0) {
      throw validationError("MultiPolygon debe tener al menos un polígono");
    }
  }
  if (!changeReason || changeReason.trim().length === 0) {
    throw validationError("changeReason es obligatorio para auditoría");
  }
  if (changeReason.length > 500) {
    throw validationError("changeReason max 500 chars");
  }

  const db = getDb();
  // Verificar existencia (mismo criterio que updateParcelMetadata:
  // NO actualizamos parcelas soft-deleted).
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM dji_parcels WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return null;

  const geomJson = JSON.stringify(geometry);
  await db.query(
    `
      UPDATE dji_parcels
         SET spray_geom = ST_Multi(ST_GeomFromGeoJSON($2::text)),
             reference_point = ST_Centroid(ST_Multi(ST_GeomFromGeoJSON($2::text)))
       WHERE id = $1
    `,
    [id, geomJson]
  );
  // Log de auditoría: la tabla djiag_audit_log ya existe (ver
  // migration 20260707000000). Si no existe en este entorno, lo
  // capturamos silenciosamente (best-effort).
  try {
    await db.query(
      `INSERT INTO djiag_audit_log (entity_type, entity_id, action, payload, recorded_at)
         VALUES ('parcel', $1, 'geometry_update', $2::jsonb, NOW())`,
      [id, JSON.stringify({ reason: changeReason, geom_type: geometry.type })]
    );
  } catch {
    // Tabla no existe — el PATCH sigue siendo válido.
  }
  invalidateAfterParcelMutation();
  return getParcelById(id);
}

/**
 * Devuelve una sola parcela por id, con todas sus geometrías como GeoJSON.
 * Devuelve null si no existe.
 */
export async function getParcelById(id: number): Promise<DjiParcelRecord | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // Sprint B — H1: soft delete. Filtramos por `deleted_at IS NULL`
      // para que el detail page y el edit panel NO muestren parcelas
      // borradas (sería confuso para el operador).
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [id]
      );
      return result.rows[0] ?? null;
    },
    async () => null
  );
}

// ============================================================
// Fumigaciones: schedule + eventos
// ============================================================

const fumigationScheduleByParcelQuery = `
  SELECT
    parcel_id,
    crop_type,
    recommended_cadence_days,
    last_fumigation_date,
    next_due_date,
    is_active,
    notes
  FROM dji_fumigation_schedule
`;

const fumigationEventsByParcelQuery = `
  SELECT
    f.id,
    f.parcel_id,
    f.fumigation_date,
    f.product_used,
    f.product_id,
    f.dose_l_per_ha,
    f.area_fumigated_m2,
    f.drone_code_used,
    f.duration_minutes,
    f.notes,
    f.human_notes,
    f.recorded_by,
    f.product_registered_ica,
    f.pilot_license,
    f.recorded_at,
    f.source,
    -- Sprint G2: array de flight IDs (solo para fumigaciones del import).
    -- NULL para fumigaciones manuales o pre-G2. Lo necesita el UI de
    -- trazabilidad (al click en la fumigación, ver qué flights la
    -- originaron).
    f.flight_ids,
    -- Sprint S7 — feature/s7-schema-extension / Fase 0.
    -- application_type_id + catálogo hidratado (LEFT JOIN).
    f.application_type_id,
    CASE WHEN f.application_type_id IS NULL THEN NULL
      ELSE row_to_json(at) END AS application_type
  FROM dji_fumigations f
  LEFT JOIN application_types at
    ON at.id = f.application_type_id AND at.is_active = TRUE
  WHERE f.parcel_id = $1
    AND f.deleted_at IS NULL
  ORDER BY f.fumigation_date DESC, f.recorded_at DESC
  LIMIT $2
`;

/**
 * Devuelve el schedule de una parcela (o null si no existe).
 *
 * `pg` devuelve columnas `DATE` como objetos `Date` de JS; los normalizamos
 * a `YYYY-MM-DD` en el boundary para evitar "Objects are not valid as a
 * React child" cuando se renderizan.
 */
export async function getFumigationSchedule(parcelId: number): Promise<DjiFumigationSchedule | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationSchedule>(
        `${fumigationScheduleByParcelQuery} WHERE parcel_id = $1`,
        [parcelId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...row,
        last_fumigation_date: toDateString(row.last_fumigation_date),
        next_due_date: toDateString(row.next_due_date)
      };
    },
    async () => null
  );
}

/**
 * v2.1 (sprint S7.2) — batch query: trae TODAS las schedules de la BD
 * en una sola query. Usado por el `/admin/parcels` page para alimentar
 * la `ParcelsTable` con cadencia per-parcela.
 *
 * Sin esto, alimentar 1200 filas de la tabla requería 1200 queries
 * individuales (N+1 problem). Esta query es O(1) y trae ~5KB de data.
 *
 * Cacheada con TTL 60s y tag `afm:schedules-all`. Se invalida con
 * `invalidateAfterFumigationMutation()`.
 *
 * Devuelve un `Map<parcelId, DjiFumigationSchedule>` para lookup O(1)
 * en el caller. La parcela no presente en el map = no tiene schedule
 * (cadencia por defecto según field_type).
 */
/**
 * Cadencia por defecto cuando la parcela NO tiene `dji_fumigation_schedule`
 * (caso histórico: parcela recién creada, o `setFumigationCadence` nunca
 * se corrió para ella). 14 días = cadencia operativa estándar para
 * arroz en Valle del Cauca (ver `docs/FUMIGATION_CADENCE.md`).
 *
 * Sprint Fase 2 / S2 (2026-08-23): centralizado en este constante
 * para que `effectiveCadence()` y los call-sites no repitan el
 * literal `14` (antes había 2 copias en `createFumigationEvent` y
 * `linkFumigationToParcel`).
 */
export const DEFAULT_CADENCE_DAYS = 14;

/**
 * Devuelve la cadencia efectiva de una parcela. Si la parcela tiene
 * un schedule con `recommended_cadence_days` setado (>0), lo usa. Si
 * no, devuelve `DEFAULT_CADENCE_DAYS` (14).
 *
 * Pure function — sin side effects, sin I/O. Trivial pero está
 * duplicado en 2 call-sites, así que se extrajo para tener un solo
 * punto de cambio si la regla de default evoluciona (ej: si
 * diferenciamos cadencia por `field_type`).
 *
 * Sprint Fase 2 / S2 (2026-08-23).
 */
export function effectiveCadence(
  sched: DjiFumigationSchedule | null | undefined
): number {
  if (sched && typeof sched.recommended_cadence_days === "number" && sched.recommended_cadence_days > 0) {
    return sched.recommended_cadence_days;
  }
  return DEFAULT_CADENCE_DAYS;
}

export async function getAllFumigationSchedules(): Promise<Map<number, DjiFumigationSchedule>> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationSchedule>(fumigationScheduleByParcelQuery);
      const out = new Map<number, DjiFumigationSchedule>();
      for (const row of result.rows) {
        out.set(row.parcel_id, {
          ...row,
          last_fumigation_date: toDateString(row.last_fumigation_date),
          next_due_date: toDateString(row.next_due_date)
        });
      }
      return out;
    },
    async () => new Map<number, DjiFumigationSchedule>()
  );
}

/**
 * Lista de eventos de fumigación de una parcela, ordenados por fecha desc.
 *
 * Normaliza `fumigation_date` de `Date` (devuelto por `pg`) a `YYYY-MM-DD`.
 *
 * Fase 2 / Q2 (2026-08-23): agrega `limit` opcional (default 50, cap 500).
 * El caller típico (timeline del detail page) solo muestra los últimos
 * N; un LIMIT defensivo evita traer el historial completo de una
 * parcela con muchos eventos (>200 es razonable en Valle del Cauca
 * después de varios años de operación).
 *
 * Si el caller NECESITA el historial completo (reportes, exports),
 * debe pasar un `limit` explícito mayor a 500 o usar
 * `getRecentFumigations` con `parcelIds` + filtros de fecha.
 */
/**
 * Sprint S9 (2026-08-30) — feature/multi-parcela-fumigation.
 *
 * Helper que resuelve un array de `parcel_external_id` (que es lo que
 * vive en `dji_fumigations.parcels[]`) a un shape mínimo para mostrar
 * en UI: id, land_name, field_type.
 *
 * Usado por `/fumigacion/[id]` para listar las "Otras suertes cubiertas"
 * con links a `/parcelas/[id]`. La fumigación guarda los `external_id`
 * (text[]) para mantener compat con el resto de la app (CSV reports,
 * URLs, etc.) que ya usan external_id como identificador público.
 *
 * Si la lista de external_ids está vacía, devuelve [] sin tocar la BD.
 * Soft-deleted parcels (`deleted_at IS NOT NULL`) se filtran para
 * que no aparezcan como "suerte activa" en fumigaciones históricas.
 */
export async function getParcelsByExternalIds(
  externalIds: string[]
): Promise<Array<{
  id: number;
  external_id: string;
  land_name: string | null;
  field_type: string;
}>> {
  if (!externalIds || externalIds.length === 0) return [];
  const db = getDb();
  try {
    const result = await db.query<{
      id: number;
      external_id: string;
      land_name: string | null;
      field_type: string;
    }>(
      `SELECT id, external_id, land_name, field_type
       FROM dji_parcels
       WHERE external_id = ANY($1::text[])
         AND deleted_at IS NULL
       ORDER BY land_name NULLS LAST`,
      [externalIds]
    );
    return result.rows;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") return [];
    throw err;
  }
}

/**
 * Sprint S9 — feature/standalone-fumigation-v2 (2026-08-30).
 *
 * Resuelve TODAS las suertes cubiertas por una fumigación (1 primaria +
 * N secundarias del array `parcels[]`) con su geometría `spray_geometry`
 * + área declarada. Usado por `/fumigacion/[id]` para renderizar el mapa
 * multi-parcela y calcular totales del "plan".
 *
 * Shape de retorno (un row por parcela, marcado `is_primary`):
 *   - id, external_id, land_name, field_type
 *   - declared_area_ha  — area declarada por el operador (la que se factura)
 *   - spray_geometry    — GeoJSON Polygon (puede ser null si la parcela
 *                         no fue scrapeada con geometría)
 *
 * Input:
 *   - primaryParcelId  — `dji_fumigations.parcel_id`
 *   - secondaryExternalIds — `dji_fumigations.parcels[]` (puede ser [])
 *
 * Estrategia SQL: dos queries en paralelo (primary y secondaries), union
 * en JS. Más simple que un UNION ALL con dos paths de JOIN y permite
 * marcar `is_primary` claramente. El costo es 1 round-trip extra cuando
 * hay secondaries; aceptable.
 */
export interface FumigationParcelForMap {
  id: number;
  external_id: string;
  land_name: string | null;
  field_type: string;
  declared_area_ha: number | string | null;
  spray_geometry: GeoJSON.Geometry | null;
  is_primary: boolean;
}

export async function getFumigationParcelsForMap(
  primaryParcelId: number | null,
  secondaryExternalIds: string[] | null | undefined
): Promise<FumigationParcelForMap[]> {
  const db = getDb();
  const ids: number[] = [];
  const externals: string[] = [];

  if (primaryParcelId != null) ids.push(primaryParcelId);
  if (secondaryExternalIds && secondaryExternalIds.length > 0) {
    externals.push(...secondaryExternalIds);
  }
  if (ids.length === 0 && externals.length === 0) return [];

  const result: FumigationParcelForMap[] = [];
  const errors: unknown[] = [];

  // 1) Parcela primaria por id
  if (ids.length > 0) {
    try {
      const r = await db.query<Omit<FumigationParcelForMap, "is_primary">>(
        `SELECT id, external_id, land_name, field_type,
                declared_area_ha,
                ST_AsGeoJSON(spray_geom)::json AS spray_geometry
           FROM dji_parcels
          WHERE id = ANY($1::bigint[])
            AND deleted_at IS NULL`,
        [ids]
      );
      for (const row of r.rows) {
        result.push({ ...row, is_primary: true });
      }
    } catch (err) {
      errors.push(err);
    }
  }

  // 2) Secundarias por external_id (puede traer 0 si alguna no matchea)
  if (externals.length > 0) {
    try {
      const r = await db.query<Omit<FumigationParcelForMap, "is_primary">>(
        `SELECT id, external_id, land_name, field_type,
                declared_area_ha,
                ST_AsGeoJSON(spray_geom)::json AS spray_geometry
           FROM dji_parcels
          WHERE external_id = ANY($1::text[])
            AND deleted_at IS NULL`,
        [externals]
      );
      for (const row of r.rows) {
        // No duplicar si la primaria también está en externals
        if (!result.some((p) => p.id === row.id)) {
          result.push({ ...row, is_primary: false });
        }
      }
    } catch (err) {
      errors.push(err);
    }
  }

  if (errors.length > 0 && process.env.NODE_ENV === "production") {
    throw errors[0];
  }
  return result;
}

export async function getFumigationEventsByParcel(
  parcelId: number,
  limit: number = 50
): Promise<DjiFumigationEvent[]> {
  // Clamp defensivo. Mínimo 1, máximo 500. Si el caller quiere más,
  // que use otra función explícita.
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationEvent>(
        fumigationEventsByParcelQuery,
        [parcelId, safeLimit]
      );
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

/**
 * Sprint 2026-08-05 (sub-sprint navegabilidad fumigaciones):
 * devuelve UN evento de fumigación por id, con la misma proyección
 * que `getRecentFumigations` (incluye lat/lng centroide calculado
 * desde dji_flights, y n_matched_flights).
 *
 * Devuelve `null` si no existe o si está soft-deleted.
 *
 * Usado por la página /fumigacion/[id] para mostrar la ficha
 * completa de un evento con mapa, links al parcel, y a la lista
 * de fumigaciones.
 */
export async function getFumigationById(id: number): Promise<DjiFumigationEvent | null> {
  const db = getDb();
  try {
    const result = await db.query<DjiFumigationEvent>(
      `SELECT
          f.id,
          f.parcel_id,
          f.fumigation_date,
          f.product_used,
          f.dose_l_per_ha,
          f.area_fumigated_m2,
          f.drone_code_used,
          f.duration_minutes,
          f.notes,
          f.human_notes,
          f.recorded_by,
          f.product_registered_ica,
          f.pilot_license,
          f.recorded_at,
          f.source,
          f.category_id,
          f.flight_ids,
          -- Sprint S9 (2026-08-30) — feature/multi-parcela-fumigation.
          -- Lista de suertes SECUNDARIAS (excluye parcel_id primario).
          -- Default '{}' en fumigaciones single-parcela o sin flight_ids.
          -- Lo popula scripts/backfill-fumigation-parcels.js.
          COALESCE(f.parcels, '{}') AS parcels,
          -- Sprint S7 — feature/s7-schema-extension.
          f.application_type_id,
          -- Sprint S7 / Fase 1 (PR-B): placa del vehículo usado
          -- (columna propia, ver migration 20260824000001).
          f.vehicle_plate,
          -- Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
          -- FK a products.id. La UI muestra el chip de color del
          -- producto y permite saltar del fumigación al detail del
          -- producto en el catálogo.
          f.product_id,
          -- Sprint Fase 2 / Q3 (2026-08-23): centroide pre-calculado en
          -- la MV mv_fumigation_flight_centroids (migration 20260824000002).
          -- El LEFT JOIN contra la MV es O(1) lookup por fumigation_id
          -- con UNIQUE INDEX, vs el ST_Centroid on-the-fly que recalculaba
          -- en cada request.
          -- Para fumigaciones manuales (sin flight_ids) o soft-deleted
          -- flights, la MV no tiene la fila y el LEFT JOIN trae NULL
          -- en lat/lng y 0 en n_matched_flights — la UI muestra
          -- "Sin mapa" para fumigaciones manuales, mismo comportamiento
          -- que antes del cambio.
          mv.n_matched_flights,
          mv.lat,
          mv.lng,
          -- Catálogo de categoría hidratado (LEFT JOIN; null si fumigación
          -- histórica no clasificada). row_to_json para que el caller
          -- reciba un objeto anidado, no columnas planas.
          CASE WHEN f.category_id IS NULL THEN NULL
            ELSE row_to_json(cat) END AS category,
          -- Catálogo de application_type hidratado (Sprint S7).
          CASE WHEN f.application_type_id IS NULL THEN NULL
            ELSE row_to_json(at) END AS application_type,
          -- Facturas de la fumigación (Sprint S7 — fumigation_invoices).
          -- Aggregate para devolver un array de jsonb en una sola query.
          -- Cancelled se incluye en el row para que el UI pueda filtrar
          -- sin re-procesar.
          COALESCE(
            (SELECT jsonb_agg(row_to_json(inv) ORDER BY inv.invoiced_at DESC)
               FROM fumigation_invoices inv
              WHERE inv.fumigation_id = f.id),
            '[]'::jsonb
          ) AS invoices
         FROM dji_fumigations f
         LEFT JOIN mv_fumigation_flight_centroids mv
           ON mv.fumigation_id = f.id
         LEFT JOIN fumigation_categories cat
           ON cat.id = f.category_id AND cat.is_active = TRUE
         LEFT JOIN application_types at
           ON at.id = f.application_type_id AND at.is_active = TRUE
        WHERE f.id = $1
          AND f.deleted_at IS NULL`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      // Sprint S9 — parcels[] puede venir como {} (default) o null.
      // Normalizamos a [] para que la UI pueda hacer .length sin check.
      parcels: row.parcels && row.parcels.length > 0 ? row.parcels : [],
      fumigation_date: toDateString(row.fumigation_date) ?? ""
    };
  } catch (err) {
    // Modo offline de tests sin Docker: devolvemos null en vez de tirar.
    if (process.env.NODE_ENV !== "production") {
      return null;
    }
    throw err;
  }
}

/**
 * Variante raw de `getFumigationById`: NO filtra por `deleted_at IS NULL`.
 * Devuelve la fumigación esté soft-deleted o no, e hidrata los campos
 * `deleted_at` y `deleted_by` (que `getFumigationById` filtra).
 *
 * Usado por el audit log (sub-2 del sprint feature/fumigation-audit-log)
 * y por el endpoint restore (que necesita ver fumigaciones soft-deleted
 * para restaurarlas). NO se usa en la UI pública — eso sigue pasando
 * por `getFumigationById`.
 *
 * Devuelve `null` si la fumigación no existe (ni siquiera soft-deleted).
 */
export async function getFumigationRawById(
  id: number
): Promise<DjiFumigationEvent | null> {
  const db = getDb();
  try {
    const result = await db.query<DjiFumigationEvent>(
      `SELECT
          f.id,
          f.parcel_id,
          f.fumigation_date,
          f.product_used,
          f.product_id,
          f.dose_l_per_ha,
          f.area_fumigated_m2,
          f.drone_code_used,
          f.duration_minutes,
          f.notes,
          f.human_notes,
          f.recorded_by,
          f.product_registered_ica,
          f.pilot_license,
          f.recorded_at,
          f.source,
          f.category_id,
          f.flight_ids,
          -- Sprint S9 (2026-08-30) — feature/multi-parcela-fumigation.
          -- Lista de suertes SECUNDARIAS (excluye parcel_id primario).
          -- Default '{}' en fumigaciones single-parcela o sin flight_ids.
          -- Lo popula scripts/backfill-fumigation-parcels.js.
          COALESCE(f.parcels, '{}') AS parcels,
          f.deleted_at,
          f.deleted_by,
          -- Sprint S7 — application_type_id + catálogo hidratado.
          f.application_type_id,
          -- Sprint S7 / Fase 1 (PR-B): placa del vehículo usado
          -- (columna propia, ver migration 20260824000001).
          f.vehicle_plate,
          CASE WHEN f.category_id IS NULL THEN NULL
            ELSE row_to_json(cat) END AS category,
          CASE WHEN f.application_type_id IS NULL THEN NULL
            ELSE row_to_json(at) END AS application_type
         FROM dji_fumigations f
         LEFT JOIN fumigation_categories cat
           ON cat.id = f.category_id AND cat.is_active = TRUE
         LEFT JOIN application_types at
           ON at.id = f.application_type_id AND at.is_active = TRUE
        WHERE f.id = $1
        GROUP BY f.id, cat.id, at.id`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      parcels: row.parcels && row.parcels.length > 0 ? row.parcels : [],
      fumigation_date: toDateString(row.fumigation_date) ?? ""
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      return null;
    }
    throw err;
  }
}

/**
 * Devuelve los dji_flights asociados a un evento de fumigación.
 * Usado por /fumigacion/[id] para mostrar la lista de vuelos con
 * piloto, dron, duración y área.
 *
 * Si la fumigación no tiene `flight_ids` (caso típico: fumigación
 * manual sin asociar) o si el array está vacío, devuelve [].
 *
 * @param flightIds array de IDs de dji_flights (bigint[] en BD, number[] en JS)
 */
export interface FumigationFlightRow {
  flight_id: number;
  start_at: string;
  pilot_name: string | null;
  drone_nickname: string | null;
  area_m2: number | string | null;
  spray_usage_ml: number | null;
  /**
   * Duración en minutos (deriva de `dji_flights.duration_seconds / 60`).
   * `number | string` porque la division proyecta a `numeric` y `pg`
   * devuelve numerics como string por default. La UI usa `Intl.NumberFormat`
   * que acepta ambos.
   */
  duration_min: number | string | null;
  /** Lat/lng del flight para el mapa. */
  lng: number | string | null;
  lat: number | string | null;
  /**
   * s9.0 (2026-08-30) — `dji_flights.parcel_id` resuelto por
   * `scripts/spatial-join-v2.js`. Null para flights que el spatial-join
   * no pudo asociar a ninguna finca dentro de 200m (orphan).
   *
   * Usado por `/fumigacion/[id]` para mostrar la suerte que cubrió
   * cada vuelo (columna "Suerte" en la tabla de vuelos asociados).
   */
  parcel_id: number | null;
}

export async function getFumigationFlights(
  flightIds: number[] | null | undefined
): Promise<FumigationFlightRow[]> {
  if (!flightIds || flightIds.length === 0) return [];
  const db = getDb();
  try {
    const result = await db.query<FumigationFlightRow>(
      `SELECT
          flight_id,
          start_at,
          pilot_name,
          drone_nickname,
          area_m2,
          spray_usage_ml,
          -- Sprint S9 (2026-08-30) - fix. La columna real es
          -- duration_seconds (integer, segundos). La consulta previa
          -- referenciaba duration_min (que no existe) y el query
          -- fallaba; el catch en dev devolvia [] silenciosamente,
          -- ocultando los 14 vuelos asociados en fumigaciones multi-parcela.
          -- El PDF y CSV reports (fumigation-pdf-template.ts:163,
          -- fumigation-csv.ts:176) consumian fl.duration_min con el
          -- mismo bug latente. La conversion seconds->minutos la hace
          -- la BD con division por 60.0 (numeric).
          (duration_seconds / 60.0)::numeric AS duration_min,
          ST_X(point)::numeric AS lng,
          ST_Y(point)::numeric AS lat,
          -- s9.0 - parcel_id del flight (resuelto por spatial-join).
          parcel_id
         FROM dji_flights
        WHERE flight_id = ANY($1::bigint[])
        ORDER BY start_at ASC NULLS LAST`,
      [flightIds]
    );
    return result.rows;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") return [];
    throw err;
  }
}

/**
 * Actualiza una fumigación existente. Devuelve el row actualizado.
 *
 * Reglas:
 *   - Solo acepta los campos editables. NO se puede cambiar
 *     `parcel_id`, `source`, `recorded_by`, `flight_ids`, `recorded_at`:
 *     esos son provenance inmutable (el parcel donde se aplicó, de dónde
 *     vino el dato, quién lo creó originalmente, los flights que la
 *     originaron). Si el operador fumigador necesita "mover" una
 *     fumigación, tiene que eliminarla y crear una nueva.
 *   - Si la fumigación está soft-deleted (`deleted_at IS NOT NULL`),
 *     no se puede editar (404).
 *   - Valida FK de `category_id` (la BD tira 23503 si no existe).
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-3.
 */
export async function updateFumigationEvent(
  id: number,
  patch: {
    fumigation_date?: string;
    product_used?: string | null;
    /**
     * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup. FK
     * a `products.id`. Editable (sparse PATCH) igual que
     * `product_used`: si el operador cambia el producto del catálogo,
     * se actualiza la FK (null = clear si el operador borra la selección).
     */
    product_id?: number | null;
    dose_l_per_ha?: number | null;
    area_fumigated_m2?: number | null;
    drone_code_used?: number | null;
    duration_minutes?: number | null;
    notes?: string | null;
    product_registered_ica?: string | null;
    pilot_license?: string | null;
    category_id?: number | null;
    /**
     * Sprint S7 — application_type_id editable. Ortogonal a
     * category_id (producto vs fase/uso). El operador puede
     * re-clasificar la fase sin cambiar el producto.
     */
    application_type_id?: number | null;
    /**
     * Sprint S7 / Fase 1 (PR-B) — placa del vehículo usado.
     * Editable (sparse PATCH). null = clear; string = set.
     * El server normaliza a UPPER antes de UPDATE.
     */
    vehicle_plate?: string | null;
  }
): Promise<DjiFumigationEvent | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // Construir el SET dinámicamente con solo los campos provistos.
      // El $N placeholder se incrementa por cada campo. Esto evita
      // sobreescribir con null campos que el caller no mandó.
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.fumigation_date !== undefined) {
        setClauses.push(`fumigation_date = $${i++}`);
        values.push(patch.fumigation_date);
      }
      if (patch.product_used !== undefined) {
        setClauses.push(`product_used = $${i++}`);
        values.push(patch.product_used);
      }
      // Sprint S9 (2026-08-29) — product_id editable. El operador puede
      // re-seleccionar el producto del catálogo (cambia la FK) o limpiarlo
      // (null = texto libre o sin clasificar). BD valida FK (23503 si
      // apunta a un id inexistente).
      if (patch.product_id !== undefined) {
        setClauses.push(`product_id = $${i++}`);
        values.push(patch.product_id);
      }
      if (patch.dose_l_per_ha !== undefined) {
        setClauses.push(`dose_l_per_ha = $${i++}`);
        values.push(patch.dose_l_per_ha);
      }
      if (patch.area_fumigated_m2 !== undefined) {
        setClauses.push(`area_fumigated_m2 = $${i++}`);
        values.push(patch.area_fumigated_m2);
      }
      if (patch.drone_code_used !== undefined) {
        setClauses.push(`drone_code_used = $${i++}`);
        values.push(patch.drone_code_used);
      }
      if (patch.duration_minutes !== undefined) {
        setClauses.push(`duration_minutes = $${i++}`);
        values.push(patch.duration_minutes);
      }
      if (patch.notes !== undefined) {
        setClauses.push(`notes = $${i++}`);
        values.push(patch.notes);
      }
      if (patch.product_registered_ica !== undefined) {
        setClauses.push(`product_registered_ica = $${i++}`);
        values.push(patch.product_registered_ica);
      }
      if (patch.pilot_license !== undefined) {
        setClauses.push(`pilot_license = $${i++}`);
        values.push(patch.pilot_license);
      }
      if (patch.category_id !== undefined) {
        setClauses.push(`category_id = $${i++}`);
        values.push(patch.category_id);
      }
      // Sprint S7 — application_type_id editable.
      if (patch.application_type_id !== undefined) {
        setClauses.push(`application_type_id = $${i++}`);
        values.push(patch.application_type_id);
      }
      // Sprint S7 / Fase 1 (PR-B) — vehicle_plate editable.
      if (patch.vehicle_plate !== undefined) {
        setClauses.push(`vehicle_plate = $${i++}`);
        // Misma normalización que create: trim + upper, "" → null.
        values.push(
          patch.vehicle_plate && patch.vehicle_plate.trim().length > 0
            ? patch.vehicle_plate.trim().toUpperCase()
            : null
        );
      }

      // Si no se mandó ningún campo editable, no-op (devuelve el row actual).
      if (setClauses.length === 0) {
        return await getFumigationById(id);
      }

      const sql = `
        UPDATE dji_fumigations
           SET ${setClauses.join(", ")}
         WHERE id = $${i}
           AND deleted_at IS NULL
        RETURNING id, parcel_id, fumigation_date, product_used, product_id, dose_l_per_ha,
                  area_fumigated_m2, drone_code_used, duration_minutes, notes,
                  human_notes, recorded_by, product_registered_ica, pilot_license,
                  category_id, application_type_id, vehicle_plate, recorded_at, source
      `;
      values.push(id);
      const result = await db.query<DjiFumigationEvent>(sql, values);
      const row = result.rows[0];
      if (!row) return null;
      // Invalidar cache (dashboard, upcoming, alertas, listados) tras update.
      invalidateAfterFumigationMutation();
      // Re-fetch con el JOIN de categoría (no se puede hacer JOIN arriba
      // porque RETURNING no soporta JOINs arbitrarios en todas las versiones
      // de Postgres; y la fumigación editada puede haber cambiado de
      // categoría). El costo es 1 query extra, vale por la consistencia.
      return await getFumigationById(id);
    },
    async () => null
  );
}

/**
 * Soft-delete de una fumigación. Marca `deleted_at = NOW()` y registra
 * `deleted_by` con el email del session user. La fumigación sigue en
 * la BD para auditoría pero desaparece de todos los listados.
 *
 * Idempotente: si la fumigación ya está soft-deleted, devuelve la fila
 * tal cual sin error.
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
 */
export async function softDeleteFumigationEvent(
  id: number,
  deletedBy: string
): Promise<DjiFumigationEvent | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationEvent>(
        `UPDATE dji_fumigations
            SET deleted_at = NOW(),
                deleted_by = $2
          WHERE id = $1
            AND deleted_at IS NULL
        RETURNING id`,
        [id, deletedBy]
      );
      if (result.rows.length === 0) {
        // Ya estaba borrada o no existe. Devolvemos el row (que puede
        // ser null si no existe).
        return await getFumigationById(id);
      }
      invalidateAfterFumigationMutation();
      return await getFumigationById(id);
    },
    async () => null
  );
}

/**
 * Restaura una fumigación soft-deleted (un-delete). Limpia `deleted_at`
 * y `deleted_by`. La fumigación vuelve a aparecer en listados, timeline
 * y reportes.
 *
 * Idempotente: si la fumigación NO está soft-deleted, devuelve la fila
 * tal cual sin error (es un no-op, no falla).
 *
 * Si la fumigación tiene `next_due_date` o `last_fumigation_date`
 * desactualizados, NO los recalcula. La fumigación vuelve al estado
 * pre-delete; los cálculos de cadencia se ajustan en la próxima
 * fumigación (mismo patrón que `softDeleteFumigationEvent` — no
 * toca el schedule).
 *
 * No tiene UI todavía. El admin lo invoca via curl si borra por error:
 *   curl -X POST https://aeroadmin.local/api/admin/fumigations/123/restore
 *
 * Sprint 2026-08-13 — feature/fumigaciones-detail-polish.
 */
export async function restoreFumigationEvent(
  id: number,
  restoredBy: string
): Promise<DjiFumigationEvent | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // Para restaurar, primero necesitamos la fumigación SIN el filtro
      // de deleted_at IS NULL (sino getFumigationById devuelve null).
      // Hacemos un SELECT directo. Si la fumigación no existe (ni
      // siquiera soft-deleted), devolvemos null.
      const exists = await db.query<{ id: number }>(
        `SELECT id FROM dji_fumigations WHERE id = $1`,
        [id]
      );
      if (exists.rows.length === 0) {
        return null;
      }

      // Idempotente: si no estaba soft-deleted, no hay UPDATE.
      // Devolvemos el row con el JOIN de categoría hidratado.
      const result = await db.query<DjiFumigationEvent>(
        `UPDATE dji_fumigations
            SET deleted_at = NULL,
                deleted_by = NULL
          WHERE id = $1
            AND deleted_at IS NOT NULL
        RETURNING id`,
        [id]
      );

      // Si realmente se restauró (no era no-op), invalidamos cache.
      // La auditoría del restore la hace el endpoint (`recordFumigationRestore`
      // en lib/fumigation-audit.ts, sprint 2026-08-15). Antes de ese
      // sprint hacíamos console.log acá — el audit log lo reemplaza
      // con un INSERT en `fumigation_audit_log`.
      if (result.rows.length > 0) {
        invalidateAfterFumigationMutation();
      }
      return await getFumigationById(id);
    },
    async () => null
  );
}

/**
 * Resultado de un bulk-delete: fumigaciones que se borraron + las
 * que se saltearon (no existían o ya estaban soft-deleted).
 *
 * Para evitar N+1 en el audit log, el repo devuelve el row COMPLETO
 * pre-delete de cada fumigación afectada (`affected[]`). El endpoint
 * usa eso para el snapshot sin un SELECT extra por fumigación.
 */
export interface BulkDeleteResult {
  /** Fumigaciones borradas, con su snapshot pre-delete. */
  affected: { id: number; before: DjiFumigationEvent }[];
  /** Ids que se saltearon (ya soft-deleted o no existían). */
  skippedIds: number[];
}

/**
 * Soft-delete en bulk de N fumigaciones. Marca `deleted_at = NOW()` y
 * `deleted_by = deletedBy` para cada id. Idempotente: fumigaciones
 * ya soft-deleted se cuentan como `skipped` y no se modifican. Las
 * fumigaciones inexistentes también se cuentan como `skipped`.
 *
 * Para evitar N+1 en el audit log, el repo devuelve el snapshot
 * pre-delete de cada fumigación afectada (1 SELECT + 1 UPDATE).
 *
 * Sprint 2026-08-29 — feature/bloque-f-bulk-operations.
 */
export async function bulkSoftDeleteFumigations(
  ids: number[],
  deletedBy: string
): Promise<BulkDeleteResult> {
  if (ids.length === 0) {
    return { affected: [], skippedIds: [] };
  }
  const db = getDb();
  return withLocalFallback(
    async () => {
      // 1) Traer los rows pre-delete (no soft-deleted) para tener
      // el snapshot completo antes de aplicar el UPDATE. Esto es 1
      // round-trip en vez de N+1.
      const candidates = await db.query<DjiFumigationEvent>(
        `SELECT id, parcel_id, fumigation_date, product_used, product_id, dose_l_per_ha,
                area_fumigated_m2, drone_code_used, duration_minutes, notes,
                human_notes, recorded_by, product_registered_ica, pilot_license,
                category_id, application_type_id, vehicle_plate, recorded_at, source,
                deleted_at, deleted_by
           FROM dji_fumigations
          WHERE id = ANY($1::bigint[])
            AND deleted_at IS NULL`,
        [ids]
      );
      if (candidates.rows.length === 0) {
        return { affected: [], skippedIds: [...ids] };
      }

      // 2) UPDATE bulk.
      const candidateIds = candidates.rows.map((r) => r.id);
      const result = await db.query<{ id: number }>(
        `UPDATE dji_fumigations
            SET deleted_at = NOW(),
                deleted_by = $2
          WHERE id = ANY($1::bigint[])
            AND deleted_at IS NULL
        RETURNING id`,
        [candidateIds, deletedBy]
      );
      if (result.rows.length === 0) {
        return { affected: [], skippedIds: [...ids] };
      }
      invalidateAfterFumigationMutation();

      // 3) Mapear affected: para cada id en el result del UPDATE,
      // buscar el `before` correspondiente en candidates. Si no está
      // (race: soft-deleted entre el SELECT y el UPDATE), lo salteo.
      const beforeById = new Map(candidates.rows.map((r) => [r.id, r]));
      const updatedSet = new Set(result.rows.map((r) => r.id));
      const affected: { id: number; before: DjiFumigationEvent }[] = [];
      for (const id of updatedSet) {
        const before = beforeById.get(id);
        if (before) {
          affected.push({ id, before });
        }
      }
      const affectedIdSet = new Set(affected.map((a) => a.id));
      const skippedIds = ids.filter((id) => !affectedIdSet.has(id));

      return { affected, skippedIds };
    },
    async () => ({ affected: [], skippedIds: [...ids] })
  );
}

/**
 * Resultado detallado del bulk-update de categoría: además de los
 * ids, devuelve la categoría ANTERIOR de cada fumigación afectada
 * para que el caller (endpoint) pueda construir el audit log sin
 * un SELECT extra por fumigación.
 */
export interface BulkCategoryUpdateResult {
  affected: { id: number; oldCategoryId: number | null }[];
  skippedIds: number[];
}

/**
 * Update en bulk de la categoría (`category_id`) de N fumigaciones.
 * Acepta `null` para limpiar la categoría (sin clasificar). El id de
 * categoría se valida por FK en la BD; si algún id no existe, esa
 * fumigación se cuenta como `skipped` (no rompe el batch).
 *
 * Si una fumigación YA tiene la categoría destino, se cuenta como
 * `skipped` (no-op, no se inserta audit para no llenar el log con
 * "el operador no cambió nada"). Si la fumigación tiene otra
 * categoría, se actualiza y se cuenta como `affected`.
 *
 * Soft-deleted fumigaciones se saltean siempre (no se editan
 * fumigaciones borradas).
 *
 * **IMPORTANTE:** Este repo NO registra audit. El caller (endpoint)
 * recibe `affected[].oldCategoryId` y registra en `fumigation_audit_log`
 * con action `edited` y diff `{ category_id: { from, to } }`.
 *
 * Implementación: 2 round-trips (SELECT old + UPDATE). Podría hacerse
 * en 1 con un CTE `WITH old AS ... UPDATE ... RETURNING`, pero
 * mantener 2 queries es más legible y el costo es despreciable
 * (N <= 200 por cap del endpoint).
 *
 * Sprint 2026-08-29 — feature/bloque-f-bulk-operations.
 */
export async function bulkUpdateFumigationCategory(
  ids: number[],
  categoryId: number | null
): Promise<BulkCategoryUpdateResult> {
  if (ids.length === 0) {
    return { affected: [], skippedIds: [] };
  }
  const db = getDb();
  return withLocalFallback(
    async () => {
      // 1) Traer las fumigaciones candidatas (no soft-deleted) con
      // su `category_id` actual. Esto nos da la lista de fumigaciones
      // que potencialmente se actualizan, más el valor anterior para
      // el audit log.
      const candidates = await db.query<{ id: number; category_id: number | null }>(
        `SELECT id, category_id
           FROM dji_fumigations
          WHERE id = ANY($1::bigint[])
            AND deleted_at IS NULL`,
        [ids]
      );

      // 2) Filtrar las que REALMENTE cambian (idempotencia en JS).
      // null handling: `null → 5` cambia, `null → null` no,
      // `5 → 5` no, `5 → 3` cambia.
      const toUpdate: { id: number; oldCategoryId: number | null }[] = [];
      for (const row of candidates.rows) {
        const sameAsTarget =
          row.category_id === categoryId ||
          (row.category_id == null && categoryId == null);
        if (!sameAsTarget) {
          toUpdate.push({ id: row.id, oldCategoryId: row.category_id });
        }
      }

      if (toUpdate.length === 0) {
        // Nada para hacer — todas las fumigaciones ya estaban en la
        // categoría destino, o no existían / estaban soft-deleted.
        return { affected: [], skippedIds: [...ids] };
      }

      // 3) UPDATE bulk de los que sí cambian.
      const updateIds = toUpdate.map((t) => t.id);
      const result = await db.query<{ id: number }>(
        `UPDATE dji_fumigations
            SET category_id = $2
          WHERE id = ANY($1::bigint[])
        RETURNING id`,
        [updateIds, categoryId]
      );
      invalidateAfterFumigationMutation();

      // 4) affected = intersección entre toUpdate y el result del
      // UPDATE (un soft-delete concurrente podría haber eliminado
      // alguno entre el SELECT y el UPDATE — caso marginal).
      const updatedSet = new Set(result.rows.map((r) => r.id));
      const affected = toUpdate.filter((t) => updatedSet.has(t.id));
      const affectedIdSet = new Set(affected.map((a) => a.id));
      const skippedIds = ids.filter((id) => !affectedIdSet.has(id));

      return { affected, skippedIds };
    },
    async () => ({ affected: [], skippedIds: [...ids] })
  );
}

/**
 * Valida que un valor sea una `FumigationAuditAction` válida. Usado
 * por `insertFumigationAuditEvent` para defense-in-depth — el CHECK
 * de la BD también valida, pero queremos devolver errores tipados en
 * código (no `23514` opaco) si alguien pasa un action inválido.
 *
 * Sprint 2026-08-15 — feature/fumigation-audit-log / sub-1.
 */
const FUMIGATION_AUDIT_ACTIONS = [
  "created",
  "edited",
  "deleted",
  "restored"
] as const;

function isFumigationAuditAction(
  v: string
): v is (typeof FUMIGATION_AUDIT_ACTIONS)[number] {
  return (FUMIGATION_AUDIT_ACTIONS as readonly string[]).includes(v);
}

/**
 * Inserta un evento en la tabla `fumigation_audit_log`. Append-only:
 * la tabla no se UPDATE ni se DELETE en operación normal. La usan los
 * endpoints POST/PATCH/DELETE/restore para registrar quién hizo qué
 * cuándo. La fumigación puede ser soft-deleted (deleted_at IS NOT
 * NULL) — el audit log sigue existiendo.
 *
 * Sprint 2026-08-15 — feature/fumigation-audit-log / sub-1.
 *
 * @param event.fumigation_id - FK a dji_fumigations. CASCADE delete:
 *   si en el futuro se hace un hard-delete, el audit log va con la
 *   fumigación (no sobrevive como fantasma sin contexto).
 * @param event.action - uno de los 4 valores del enum.
 *   `created | edited | deleted | restored`.
 * @param event.actor_email - email del session user (denormalizado).
 * @param event.changes - JSONB con la diff o snapshot segun action.
 *   Ver `FumigationAuditEvent.changes` en `lib/types.ts` para el
 *   shape exacto de cada action.
 *
 * @returns La fila insertada, o `null` si la fumigación no existe
 *   (en ese caso el FK falla con 23503 — la mapeamos a null para
 *   no romper al caller con un error opaco).
 */
export async function insertFumigationAuditEvent(event: {
  fumigation_id: number;
  action: "created" | "edited" | "deleted" | "restored";
  actor_email: string;
  changes?: Record<string, unknown>;
}): Promise<import("@/lib/types").FumigationAuditEvent | null> {
  // Defense-in-depth: validar el action en código ademas del CHECK
  // de la BD. Asi devolvemos un error tipado si el caller mete mal
  // el string (no un PG 23514 "check_violation" opaco).
  if (!isFumigationAuditAction(event.action)) {
    throw new Error(
      `insertFumigationAuditEvent: action inválido (${event.action}). Esperado uno de: ${FUMIGATION_AUDIT_ACTIONS.join(", ")}`
    );
  }
  if (
    typeof event.actor_email !== "string" ||
    event.actor_email.trim().length === 0
  ) {
    throw new Error(
      "insertFumigationAuditEvent: actor_email requerido (string no vacío)"
    );
  }
  if (!Number.isInteger(event.fumigation_id) || event.fumigation_id <= 0) {
    throw new Error(
      "insertFumigationAuditEvent: fumigation_id requerido (entero positivo)"
    );
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      const changes = event.changes ?? {};
      const result = await db.query<import("@/lib/types").FumigationAuditEvent>(
        `INSERT INTO fumigation_audit_log
            (fumigation_id, action, actor_email, changes)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, fumigation_id, action, actor_email, changes, created_at`,
        [
          event.fumigation_id,
          event.action,
          event.actor_email.trim(),
          JSON.stringify(changes)
        ]
      );
      const row = result.rows[0];
      if (!row) return null;
      // PG devuelve `changes` como objeto (no string) porque `pg` parsea
      // JSONB automáticamente. Lo devolvemos tal cual.
      return row;
    },
    async () => null
  );
}

/**
 * Devuelve la historia de auditoría de una fumigación, ordenada de la
 * más reciente a la más vieja. Usado por la sección "Historial" del
 * detail page `/fumigacion/[id]`.
 *
 * Devuelve `[]` si la fumigación no tiene eventos (caso normal para
 * fumigaciones históricas que se crearon antes de este sprint — el
 * audit log solo se popula desde la implementación en adelante).
 *
 * Sprint 2026-08-15 — feature/fumigation-audit-log / sub-1.
 */
export async function getFumigationAuditTrail(
  fumigationId: number
): Promise<import("@/lib/types").FumigationAuditEvent[]> {
  if (!Number.isInteger(fumigationId) || fumigationId <= 0) {
    throw new Error(
      "getFumigationAuditTrail: fumigationId requerido (entero positivo)"
    );
  }
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<import("@/lib/types").FumigationAuditEvent>(
        `SELECT id, fumigation_id, action, actor_email, changes, created_at
           FROM fumigation_audit_log
          WHERE fumigation_id = $1
          ORDER BY created_at DESC, id DESC`,
        [fumigationId]
      );
      return result.rows;
    },
    async () => []
  );
}

/**
 * Shape reducido de una parcela para usar en pickers/autocomplete
 * (sprint 2026-08-05, /fumigaciones/nueva). Solo trae los campos
 * que el operador necesita para identificar visualmente la parcela.
 *
 *   - id: para POST a /api/admin/fumigations
 *   - land_name: nombre humano
 *   - external_id: "DJI-LAND-1234" o "manual-uuid"
 *   - client_name, farm_name, municipality: contexto V0
 *   - source: "dji" | "manual" | "imported" — para diferenciar visualmente
 */
export interface ParcelPickerRow {
  id: number;
  land_name: string | null;
  external_id: string;
  source: string | null;
  client_name: string | null;
  farm_name: string | null;
  municipality: string | null;
}

/**
 * Sprint Fase 2 / Q4 (2026-08-23): agrega `search` opcional para
 * filtrar server-side con `ILIKE`. Antes el picker traía 500 parcelas
 * (los más recientes por id) y filtraba en cliente — si el operador
 * buscaba por nombre que no estaba en los 500, no encontraba.
 *
 * Con `search`: la SQL hace `ILIKE %search%` sobre los campos
 * principales (land_name, external_id, client_name, farm_name,
 * municipality) y `LIMIT` el resultado. Devuelve los matches más
 * relevantes (orden por id DESC = más recientes primero entre los
 * matches).
 *
 * Sin `search`: comportamiento original (los N más recientes).
 *
 * El caller típico (page.tsx de /fumigaciones/nueva) puede pasar
 * `searchParams.q` como `search` para pre-filtrar en el server
 * (SSR-friendly, útil para deep-links).
 */
export async function getRecentParcelsForPicker(
  limit: number = 500,
  search: string = ""
): Promise<ParcelPickerRow[]> {
  const cappedLimit = Math.min(2000, Math.max(1, Math.floor(limit)));
  const q = (search ?? "").trim();
  const db = getDb();
  return withLocalFallback(
    async () => {
      // Si hay query, filtramos con ILIKE en 5 campos + orden por id DESC
      // (matches más recientes primero). Sin query, los N más recientes.
      if (q.length > 0) {
        const like = `%${q}%`;
        const result = await db.query<ParcelPickerRow>(
          `SELECT
              id,
              land_name,
              external_id,
              source,
              client_name,
              farm_name,
              municipality
             FROM dji_parcels
            WHERE deleted_at IS NULL
              AND (
                land_name ILIKE $1
                OR external_id ILIKE $1
                OR COALESCE(client_name, '') ILIKE $1
                OR COALESCE(farm_name, '') ILIKE $1
                OR COALESCE(municipality, '') ILIKE $1
                OR CAST(id AS text) = $2
              )
            ORDER BY id DESC
            LIMIT $3`,
          [like, q, cappedLimit]
        );
        return result.rows;
      }
      const result = await db.query<ParcelPickerRow>(
        `SELECT
            id,
            land_name,
            external_id,
            source,
            client_name,
            farm_name,
            municipality
           FROM dji_parcels
          WHERE deleted_at IS NULL
          ORDER BY id DESC
          LIMIT $1`,
        [cappedLimit]
      );
      return result.rows;
    },
    async () => []
  );
}

/**
 * M3-M5 Track A (commit 2): devuelve el Set<number> de `parcel_id` con
 * al menos un evento de fumigación >= `since` (YYYY-MM-DD). Sirve a
 * `app/map/page.tsx` para derivar el flag `hasFumigation` por parcela y
 * diferenciar visualmente fumigadas (solido) vs no fumigadas (dashed +
 * fill atenuado) en el mapa.
 *
 * Notas de implementación:
 *   - DISTINCT en la SQL para no traer N filas si la parcela tuvo
 *     varios eventos en el rango; el caller quiere un Set, no un multiset.
 *   - `parcel_id IS NOT NULL` para excluir eventos agregados del importer
 *     que quedaron sin asignar (ver `backfill-fumigations-from-flights`).
 *   - Fallback a Set vacio si la BD no esta disponible (modo offline de
 *     tests sin Docker): el mapa no rompe, solo pierde la distinción
 *     fumigado/no-fumigado (todas se ven como fumigadas = backwards
 *     compatible).
 */

/**
 * v2.1 (sprint S6) — eventos de fumigación aplanados para el mapa.

/**
 * M7 — Inputs del timeline de fumigaciones de una parcela, listos para
 * pasarse a `buildFumigationTimeline()` (lib/fumigation-timeline.ts).
 *
 * Hace un JOIN con `dji_flights` para resolver el `drone_nickname` y
 * `pilot_name` DOMINANTE del día — no de cada sortie individual. Misma
 * estrategia que ya usa `lib/djiag-spatial-aggregator.ts` para el mapa
 * de Task History: el join es por `(parcel_id, fecha Bogota-local)`.
 *
 * Devuelve `[]` si no hay eventos en el rango. NO cachea (M7: datos
 * operativos frescos, como Task History).
 */
interface FumigationTimelineDbRow {
  id: number;
  fumigation_date: Date | string;
  product_used: string | null;
  dose_l_per_ha: number | string | null;
  area_fumigated_m2: number | string | null;
  duration_minutes: number | null;
  drone_code_used: number | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  recorded_by: string | null;
  notes: string | null;
  source: "manual" | "djiscraper" | "import";
}

export async function getFumigationTimelineForParcel(
  parcelId: number,
  from: string,
  to: string
): Promise<FumigationTimelineInput[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<FumigationTimelineDbRow>(
        `
          SELECT
            f.id,
            f.fumigation_date,
            f.product_used,
            f.dose_l_per_ha,
            f.area_fumigated_m2,
            f.duration_minutes,
            f.drone_code_used,
            f.recorded_by,
            f.notes,
            f.source,
            (
              SELECT fl.drone_nickname
                FROM dji_flights fl
               WHERE fl.parcel_id = f.parcel_id
                 AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
                 AND fl.drone_nickname IS NOT NULL
               GROUP BY fl.drone_nickname
               ORDER BY COUNT(*) DESC
               LIMIT 1
            ) AS drone_nickname,
            (
              SELECT fl.pilot_name
                FROM dji_flights fl
               WHERE fl.parcel_id = f.parcel_id
                 AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
                 AND fl.pilot_name IS NOT NULL
               GROUP BY fl.pilot_name
               ORDER BY COUNT(*) DESC
               LIMIT 1
            ) AS pilot_name
          FROM dji_fumigations f
          WHERE f.parcel_id = $1
            AND f.deleted_at IS NULL
            AND f.fumigation_date >= $2::date
            AND f.fumigation_date <= $3::date
          ORDER BY f.fumigation_date ASC
        `,
        [parcelId, from, to]
      );
      return result.rows.map((row): FumigationTimelineInput => {
        const dateStr = toDateString(row.fumigation_date) ?? "";
        const minutes = row.duration_minutes;
        return {
          id: row.id,
          fumigation_date: dateStr,
          product_used: row.product_used,
          dose_l_per_ha: row.dose_l_per_ha === null ? null : Number(row.dose_l_per_ha),
          area_fumigated_m2: row.area_fumigated_m2 === null ? null : Number(row.area_fumigated_m2),
          duration_seconds: minutes === null ? null : minutes * 60,
          drone_code_used: row.drone_code_used,
          drone_nickname: row.drone_nickname,
          pilot_name: row.pilot_name,
          recorded_by: row.recorded_by,
          notes: row.notes,
          source: row.source
        };
      });
    },
    async () => []
  );
}

/**
 * Inserta un nuevo evento de fumigación. Recalcula `next_due_date`
 * en el schedule correspondiente.
 */
export async function createFumigationEvent(event: {
  parcel_id: number;
  fumigation_date: string;
  product_used?: string | null;
  /**
   * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup. FK a
   * `products.id` cuando el operador seleccionó el producto del catálogo
   * via `ProductPicker`. NULLABLE en BD (migration 20260829000000).
   * Convive con `product_used` (texto legacy) — el FK es la versión
   * normalizada para joins / reportes. La BD valida FK (23503 si
   * `product_id` apunta a un id inexistente).
   */
  product_id?: number | null;
  dose_l_per_ha?: number | null;
  area_fumigated_m2?: number | null;
  drone_code_used?: number | null;
  duration_minutes?: number | null;
  notes?: string | null;
  human_notes?: string | null;
  recorded_by?: string | null;
  /**
   * Compliance metadata (Sprint C — H2, 2026-07-23):
   *   - product_registered_ica: ej "ICA-1234-PN" (CHECK length 3-50)
   *   - pilot_license:            ej "PCA-12345"  (CHECK regex `^[A-Z0-9-]{4,20}$`)
   *
   * La BD valida el formato final con CHECK constraints. El server
   * pre-valida longitud para no tirar el handler con inputs gigantes.
   * Si el valor no pasa el CHECK de la BD, el INSERT falla con un
   * error de constraint que el route handler mapea a 400.
   */
  product_registered_ica?: string | null;
  pilot_license?: string | null;
  /**
   * Categoría curada (FK a fumigation_categories). Opcional —
   * fumigaciones manuales pueden no tener categoría si el operador
   * fumigador no la conoce o no aplica (caso raro). La BD tiene ON
   * DELETE SET NULL así que borrar una categoría no rompe fumigaciones.
   * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-2.
   */
  category_id?: number | null;
  /**
   * Sprint S7 — application_type_id (FK a application_types).
   * Ortogonal a category_id. La BD tiene ON DELETE SET NULL así
   * que borrar un tipo no rompe fumigaciones. Opcional.
   */
  application_type_id?: number | null;
  /**
   * Sprint S7 / Fase 1 (PR-B) — placa del vehículo usado. No es FK
   * a `dji_vehicles` (la placa es referencial, no relacional — una
   * fumigación puede tener una placa que ya no está en el catálogo).
   * El `VehiclePicker` se encarga de sugerir/crear en `dji_vehicles`
   * desde el form. La fumigación solo guarda el string. Columna
   * `vehicle_plate VARCHAR(12) NULL` (migration 20260824000001).
   * El server normaliza a UPPER antes de guardar. CHECK regex
   * `^[A-Z0-9-]{3,12}$` en la BD.
   */
  vehicle_plate?: string | null;
}): Promise<DjiFumigationEvent> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const ins = await client.query<DjiFumigationEvent>(
          `
            INSERT INTO dji_fumigations
              (parcel_id, fumigation_date, product_used, product_id, dose_l_per_ha,
               area_fumigated_m2, drone_code_used, duration_minutes, notes,
               human_notes, recorded_by, product_registered_ica, pilot_license,
               category_id, application_type_id, vehicle_plate, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'manual')
            RETURNING
              id, parcel_id, fumigation_date, product_used, product_id, dose_l_per_ha,
              area_fumigated_m2, drone_code_used, duration_minutes, notes,
              human_notes, recorded_by, product_registered_ica, pilot_license,
              category_id, application_type_id, vehicle_plate, recorded_at, source
          `,
          [
            event.parcel_id,
            event.fumigation_date,
            event.product_used ?? null,
            // Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
            // FK a products.id. NULL si el operador tipeó texto libre sin
            // seleccionar del catálogo (caso legacy).
            event.product_id ?? null,
            event.dose_l_per_ha ?? null,
            event.area_fumigated_m2 ?? null,
            event.drone_code_used ?? null,
            event.duration_minutes ?? null,
            event.notes ?? null,
            event.human_notes ?? null,
            event.recorded_by ?? null,
            event.product_registered_ica ?? null,
            event.pilot_license ?? null,
            event.category_id ?? null,
            event.application_type_id ?? null,
            // vehicle_plate: trim + upper para coincidir con el CHECK
            // regex y con el formato canonical de dji_vehicles.plate.
            // Si el caller pasa "" o null, guardamos null (clear).
            event.vehicle_plate && event.vehicle_plate.trim().length > 0
              ? event.vehicle_plate.trim().toUpperCase()
              : null
          ]
        );
        const created = ins.rows[0];

        // Recalcular last_fumigation_date y next_due_date en el schedule
        // Sprint Fase 2 / S2 (2026-08-23): usamos `effectiveCadence(sched)`
        // en vez de `sched?.recommended_cadence_days ?? 14` (regla
        // centralizada — un solo lugar para evolucionar el default).
        const sched = await getFumigationSchedule(event.parcel_id);
        const cadence = effectiveCadence(sched);
        const next = computeNextDueDate(event.fumigation_date, cadence);
        await client.query(
          `
            UPDATE dji_fumigation_schedule
            SET last_fumigation_date = $2,
                next_due_date = $3,
                updated_at = NOW()
            WHERE parcel_id = $1
          `,
          [event.parcel_id, event.fumigation_date, next]
        );
        await client.query("COMMIT");
        // Invalidar cache (dashboard + upcoming + alertas) tras COMMIT exitoso.
        // Si falló el COMMIT ya hicimos ROLLBACK; invalidar afuera del try
        // mantiene el invariante "datos en BD == cache".
        invalidateAfterFumigationMutation();
        return created;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Query a dji_flights sin agregación. Traemos todas las columnas que
 * necesita `aggregateFlightsByDay` + algunas extra (drone_nickname, parcel_id)
 * para futuras extensiones del dashboard.
 *
 * (S2 / 2026-07-01) `getParcels()` legacy eliminada — usaba el shape
 * DjiAssetRecord (3-rows-per-field) que tampoco existe. Para listar parcelas
 * con shape normalizado usá `getParcelsNormalized()`.
 */
const flightsRawQuery = `
  SELECT
    id,
    flight_id,
    start_at,
    end_at,
    duration_seconds,
    area_m2,
    spray_usage_ml,
    drone_nickname,
    pilot_name,
    parcel_id
  FROM dji_flights
  ORDER BY start_at DESC
`;

/**
 * Sprint 7: ahora cacheado (TTL 5min, tag `afm:metrics`).
 */

/**
 * Devuelve los N vuelos mas recientes con su centroide (lng, lat) para
 * plot en /map. M6 (2026-06-28) — footprint minimo hasta que se pueda
 * decodear el protobuf detallado de DJI.
 *
 * El cache es por `limit` — dos requests con limit=300 y limit=500 caen
 * en keys distintas. Si el caller quiere siempre el "ultimo vuelo" sin
 * importar el limit, una paginacion client-side tiene mas sentido.
 */
export async function getFlightPoints(limit = 300): Promise<FlightPointRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  return fetchFlightPointsCached(safeLimit);
}

/**
 * v2.1 (sprint S7.2) — batch query: trae TODOS los flight points del
 * dataset en una sola query. Usado por el `<ParcelMap>` del detalle
 * de parcela para mostrar los flights como markers en el mapa.
 *
 * El caller (page server) filtra por `parcelId` con `Array.from` —
 * eficiente cuando el dataset es chico-mediano (10-200 flights por
 * parcela). Para datasets grandes (>1k flights por parcela) conviene
 * agregar `WHERE parcel_id = ANY($1)` cuando se consuma desde un
 * detail (TODO S7.3).
 *
 * Cacheada con TTL 60s y tag `afm:flights-all`. Se invalida con
 * `invalidateAfterFumigationMutation()`.
 */

/**
 * Sprint S8 (Bloque B — 2026-08-29): métricas agregadas de `dji_flights`
 * en un rango de fechas, sin filtro de parcela. Es la fuente de verdad
 * para los KPIs de VUELOS y VOLUMEN del geovisor (antes derivaba de
 * los eventos `dji_fumigations` y daba 0 para fumigaciones importadas
 * de DJI sin `flight_ids` linkeados — bug que reportaba "0 VUELOS"
 * con 610 aplicaciones en el panel).
 *
 * NO usa la cache de `fetchFlightPointsCached` porque:
 *   1. Esa cache trae hasta 2000 flights — no todos los del rango.
 *   2. El caller necesita los agregados (COUNT, SUM), no las rows.
 *
 * Query SQL: filtra por `start_at` en el rango y agrega
 * `count(*)`, `sum(spray_usage_ml / 1000)` (volumen en L),
 * `sum(area_m2 / 10000)` (área en ha). `start_at` es TIMESTAMPTZ —
 * comparamos con `$1::timestamptz` para que el cast sea explicito.
 * NOTA: `dji_flights` NO tiene `deleted_at` (es `dji_fumigations` y
 * `dji_parcels` los que tienen soft-delete). Si se agrega en el
 * futuro, aniadir el `AND deleted_at IS NULL` aca.
 *
 * Cobertura: el dashboard de `app/page.tsx` también muestra vuelos
 * (usando `getFlights()`); esa ruta sigue válida. Esta query es solo
 * para el geovisor cuando el filtro de parcela está activo.
 */
export interface FlightAggregates {
  total_flights: number;
  total_volume_l: number;
  total_area_ha: number;
}

export async function getFlightAggregatesByDateRange(
  fromIso: string,
  toIso: string
): Promise<FlightAggregates> {
  // Clamp defensivo (5 años max — el operador fumigando desde 1970 no es realista)
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { total_flights: 0, total_volume_l: 0, total_area_ha: 0 };
  }
  const db = getDb();
  const r = await db.query<{
    total_flights: string;
    total_volume_l: string | null;
    total_area_ha: string | null;
  }>(
    `SELECT
       COUNT(*)::int                       AS total_flights,
       COALESCE(SUM(spray_usage_ml) / 1000.0, 0)::float8 AS total_volume_l,
       COALESCE(SUM(area_m2) / 10000.0, 0)::float8      AS total_area_ha
     FROM dji_flights
     WHERE start_at >= $1::timestamptz
       AND start_at <  $2::timestamptz`,
    [from.toISOString(), to.toISOString()]
  );
  const row = r.rows[0];
  return {
    total_flights: Number(row?.total_flights ?? 0),
    total_volume_l: Number(row?.total_volume_l ?? 0),
    total_area_ha: Number(row?.total_area_ha ?? 0),
  };
}

/**
 * v2.5.5 (sprint S8.7+): polígonos derivados de flights fumigados
 * reales. Computa el `ST_ConvexHull` de los flight points por parcel.
 *
 * Cobertura actual (medido 2026-07-30 con `scripts/diagnose-parcel-geometry.js`):
 *   - 1213 parcels totales
 *   - 451 parcels (37.2%) tienen al menos 1 flight
 *   - 419 parcels (34.5%) tienen >= 3 flights → devuelven hull real
 *   - 32 parcels (2.6%) tienen 1-2 flights → hull null (caller hace buffer)
 *   - 762 parcels (62.8%) sin flights → no aparecen acá (caller hace synthetic)
 *
 * Cacheado 10min (TTL `flightHulls`). Se invalida junto con `flights`
 * cuando se re-importan. La query es cara (PostGIS sobre 8k flights)
 * pero estable entre re-scrapes.
 *
 * Retorna:
 *   - `hullGeometry`: GeoJSON Polygon cuando flightCount >= 3, sino null
 *   - `centroid`: {lng, lat} promedio de los flights — siempre presente
 *     cuando hay al menos 1 flight. El caller lo usa para buffer cuando
 *     el hull no es viable.
 *
 * Ver `lib/data.ts:adaptParcel` para el cascade: hull → buffer → synthetic.
 */
export async function getFlightHullsByParcel(): Promise<
  Array<{
    parcelId: number;
    flightCount: number;
    centroid: { lng: number; lat: number };
    hullGeometry: GeoJSON.Polygon | null;
  }>
> {
  return fetchFlightHullsByParcelCached();
}

/**
 * Sprint A — F4.0: comparativa de actividad "ayer vs hoy" en Bogota
 * local. Lo que consume `<TodayYesterdayCard>` en el dashboard.
 *
 * Las fechas se calculan acá (en Bogota local, via `getBogotaDateString`)
 * y se pasan al wrapper cacheado como parte del cache key. Eso significa
 * que el cache hit es estable dentro del mismo día (los args no cambian
 * entre renders) y se renueva al cruzar el midnight Bogota.
 *
 * Fallback: si la BD no responde, devuelve ceros para ambos días. El
 * card renderiza empty state ("Sin actividad ayer / hoy") que es el
 * comportamiento esperado en una BD vacía recién sembrada.
 */

// ============================================================
// Sprint G1 — Hoja de vida: huérfanas, link manual, stats globales
// ============================================================

/**
 * Stats globales del módulo de fumigaciones.
 *
 * Usado por:
 *   - El empty state inteligente de `ParcelFumigations` (cuando la
 *     parcela no tiene fumigaciones propias, el contexto "X huérfanas
 *     en el sistema" le da sentido al admin).
 *   - La página `/admin/orphan-fumigations` (header con KPIs).
 *
 * Decisión: una sola query agregada en vez de 6 queries separadas.
 * El `withLocalFallback` envuelve para no tumbar la UI si la BD está
 * caída — devuelve ceros (el empty state sigue funcionando).
 *
 * Cobertura: porcentaje redondeado a 1 decimal. No se calcula 0% si
 * no hay parcelas — en ese caso la cobertura es 0 (no NaN.
 */

/**
 * Vincula una fumigación huérfana a una parcela. El admin decide
      if (before.rows[0].parcel_id !== null) {
        return { status: "already_assigned" };
      }

      // 2) Parcela destino existe
      const parcel = await db.query<{ id: number }>(
        `SELECT id FROM dji_parcels WHERE id = $1`,
        [parcelId]
      );
      if (parcel.rows.length === 0) {
        return { status: "not_found" };
      }

      // 3) UPDATE. La condición `parcel_id IS NULL` en el WHERE evita
      // race conditions si dos admins vinculan a la vez (el segundo
      // se queda con 0 rows y devolvemos "already_assigned").
      const updated = await db.query<DjiFumigationEvent>(
        `
          UPDATE dji_fumigations
          SET parcel_id = $2
          WHERE id = $1 AND parcel_id IS NULL AND deleted_at IS NULL
          RETURNING
            id, parcel_id, fumigation_date, product_used, product_id, dose_l_per_ha,
            area_fumigated_m2, drone_code_used, duration_minutes,
            notes, human_notes, recorded_by,
            product_registered_ica, pilot_license,
            recorded_at, source
        `,
        [fumigationId, parcelId]
      );
      if (updated.rows.length === 0) {
        return { status: "already_assigned" };
      }
      const linked = updated.rows[0];

      // 4) Recalcular schedule de la parcela destino
      // Sprint Fase 2 / S2 (2026-08-23): misma centralización que en
      // `createFumigationEvent` (ver comentario en el helper `effectiveCadence`).
      const sched = await getFumigationSchedule(parcelId);
      const cadence = effectiveCadence(sched);
      const next = computeNextDueDate(linked.fumigation_date, cadence);
      await db.query(
        `
          UPDATE dji_fumigation_schedule
          SET last_fumigation_date = $2,
              next_due_date = $3,
              updated_at = NOW()
          WHERE parcel_id = $1
        `,
        [parcelId, linked.fumigation_date, next]
      );

      // 5) Invalidar cache
      invalidateAfterFumigationMutation();

      return {
        status: "linked",
        event: {
          ...linked,
          fumigation_date: toDateString(linked.fumigation_date) ?? ""
        }
      };
    },
    async () => ({ status: "not_found" })
  );
}

// ============================================================
// Sprint G2 — Hoja de vida completa: resumen, trazabilidad, history
// ============================================================

/**
 * Resumen anual de fumigaciones de una parcela: 12 rows (1 por mes)
 * con count + area_total_m2 + litros_total (calculado a partir de
 * dose_l_per_ha × area_fumigated_m2 / 10000).
 *
 * Usado por `components/parcels/parcel-fumigation-history.tsx` para
 * el grid mensual "esta parcela tuvo X fumigaciones en enero, Y en
 * febrero, ...". Selector de año en la UI permite cambiar entre
 * 2024, 2025, 2026.
 *
 * Decisión: en vez de N queries (1 por mes), 1 sola query con
 * `generate_series` para garantizar 12 rows aunque un mes no tenga
 * fumigaciones. El UI ya espera 12 cards.
 */

/**
 * Trazabilidad flight → fumigación: devuelve los dji_flights que
 * originaron una fumigación del import (los IDs están en
 * dji_fumigations.flight_ids, persistidos por el backfill Sprint G2).
 *
 * Devuelve un array vacío si:
 *   - La fumigación no existe
 *   - La fumigación es manual (source='manual') o huérfana pre-G2
 *     (flight_ids=NULL)
 *
 * Orden: por start_at asc (los flights del día en orden temporal).
 */

/**
 * Historial de cambios de cadencia/cultivo de una parcela. Ordenado
 * por changed_at DESC (más reciente primero).
 *
 * Usado por `components/parcels/parcel-fumigation-history.tsx` para
 * mostrar la sección "Cambios de cadencia" con diffs antes/después.
 *
 * Decisión: limit configurable (default 10). El UI no pagina — son
 * cambios raros, los últimos 10 alcanzan.
 */
export interface ScheduleHistoryEntry {
  id: number;
  parcel_id: number;
  old_cadence_days: number | null;
  new_cadence_days: number | null;
  old_crop_type: string | null;
  new_crop_type: string | null;
  changed_by: string | null;
  reason: string | null;
  commit_sha: string | null;
  changed_at: string;
}

export async function getScheduleHistory(
  parcelId: number,
  limit: number = 10
): Promise<ScheduleHistoryEntry[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{
        id: string;
        parcel_id: number;
        old_cadence_days: number | null;
        new_cadence_days: number | null;
        old_crop_type: string | null;
        new_crop_type: string | null;
        changed_by: string | null;
        reason: string | null;
        commit_sha: string | null;
        changed_at: Date;
      }>(
        `
          SELECT id, parcel_id,
                 old_cadence_days, new_cadence_days,
                 old_crop_type, new_crop_type,
                 changed_by, reason, commit_sha, changed_at
            FROM dji_fumigation_schedule_history
           WHERE parcel_id = $1
           ORDER BY changed_at DESC
           LIMIT $2
        `,
        [parcelId, limit]
      );
      return result.rows.map((row) => ({
        id: Number(row.id),
        parcel_id: row.parcel_id,
        old_cadence_days: row.old_cadence_days,
        new_cadence_days: row.new_cadence_days,
        old_crop_type: row.old_crop_type,
        new_crop_type: row.new_crop_type,
        changed_by: row.changed_by,
        reason: row.reason,
        commit_sha: row.commit_sha,
        changed_at: row.changed_at.toISOString()
      }));
    },
    async () => []
  );
}

/**
 * Totales anuales de una parcela: cantidad de fumigaciones, área
 * total fumigada, litros totales, productos únicos usados.
 *
 * Diferencia con `getFumigationYearlySummary`: este es UN solo row con
 * los totales agregados de los 12 meses, para mostrar en el header
 * del UI ("este año: 14 fumigaciones, 87.500 m², 145 L, 4 productos
 * distintos").
 */

/**
 * v2.1 (sprint S7) — fumigaciones más recientes para alimentar el
 * `RecentActivity` del dashboard y la lista de `/fumigaciones`.
 *
 * Trae los últimos N eventos (default 12, /fumigaciones usa 2000)
 * con `parcel_id` válido y `deleted_at IS NULL`. Cacheada con TTL 60s
 * y tag `afm:recent-fumigations` (mismo patrón que el resto del
 * dashboard).
 *
 * **Schema requirement (sprint 2026-08-13, feature/fumigacion-detail-v2):**
 * requiere la tabla `fumigation_categories` (migration
 * `20260813160000_add_fumigation_category.sql`) y la columna
 * `dji_fumigations.category_id`. Si la migration no se aplicó,
 * la query explota con `relation "fumigation_categories" does not
 * exist` (23501). El `withLocalFallback` solo atrapa errores de
 * conexión, no errores de SQL — aplicar la migration antes de
 * usar esta función.
 *
 * Joins activos:
 *   - `dji_flights` (LEFT): para `lng`/`lat` centroide + `n_matched_flights`
 *     (s8.8, 2026-07-31). Usado por el geovisor para plotear el evento.
 *   - `fumigation_categories` (LEFT): para `category` (objeto hidratado
 *     con id, slug, label, color) o `null` si fumigación histórica sin
 *     clasificar (sprint 2026-08-13). Usado por /fumigaciones y
 *     /fumigacion/[id] para mostrar el badge de tipo.
 */
export async function getRecentFumigations(
  limit: number = 12
): Promise<DjiFumigationEvent[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // s8.8 (2026-07-31): LEFT JOIN con dji_flights para calcular el
      // centroide de los flights asociados a la fumigacion (vía
      // flight_ids = bigint[]). Eso da lng/lat REAL para que el
      // geovisor pueda renderizar el punto en el lugar correcto
      // (antes se renderizaba en lng=0/lat=0 porque DjiFumigationV0
      // no tenia lng/lat).
      //
      // El `n_matched_flights` es util para debugging y para el popup
      // ("5 de 7 flights asociados"). Si es 0, el centroide es NULL
      // y el evento NO deberia renderizarse en el mapa.
      //
      // sprint 2026-08-13: LEFT JOIN adicional con `fumigation_categories`
      // para hidratar el campo `category` (row_to_json). Si la fumigación
      // tiene `category_id IS NULL` (fumigación histórica pre-migration),
      // la CASE devuelve NULL y el objeto `category` en el row es null.
      // Mismo patrón que `getFumigationById` arriba.
      const result = await db.query<DjiFumigationEvent>(
        `SELECT
            f.id,
            f.parcel_id,
            f.fumigation_date,
            f.product_used,
            f.dose_l_per_ha,
            f.area_fumigated_m2,
            f.drone_code_used,
            f.duration_minutes,
            f.notes,
            f.human_notes,
            f.recorded_by,
            f.product_registered_ica,
            f.pilot_license,
            f.recorded_at,
            f.source,
            f.category_id,
            f.flight_ids,
            -- Sprint S7 — application_type_id + catálogo hidratado.
            f.application_type_id,
            -- Sprint S9 (2026-08-29) — product_id FK al catálogo products.
            f.product_id,
            count(fl.id)::int AS n_matched_flights,
            CASE
              WHEN count(fl.id) = 0 THEN NULL
              ELSE ST_Y(ST_Centroid(ST_Collect(fl.point)))::numeric
            END AS lat,
            CASE
              WHEN count(fl.id) = 0 THEN NULL
              ELSE ST_X(ST_Centroid(ST_Collect(fl.point)))::numeric
            END AS lng,
            -- Catálogo de categoría hidratado (LEFT JOIN; null si fumigación
            -- histórica no clasificada). row_to_json para anidar.
            CASE WHEN f.category_id IS NULL THEN NULL
              ELSE row_to_json(cat) END AS category,
            -- Catálogo de application_type (Sprint S7).
            CASE WHEN f.application_type_id IS NULL THEN NULL
              ELSE row_to_json(at) END AS application_type
           FROM dji_fumigations f
           LEFT JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
           LEFT JOIN fumigation_categories cat
             ON cat.id = f.category_id AND cat.is_active = TRUE
           LEFT JOIN application_types at
             ON at.id = f.application_type_id AND at.is_active = TRUE
          WHERE f.deleted_at IS NULL
            AND f.parcel_id IS NOT NULL
          GROUP BY f.id, cat.id, at.id
          ORDER BY f.fumigation_date DESC, f.recorded_at DESC
          LIMIT $1`,
        [limit]
      );
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

// ---------------------------------------------------------------------------
// Crop cycle data (sprint 2026-08-01 — "Fase de cultivo y cadencia efectiva").
//
// Devuelve un Map parcel_id → { planting_date, cycle_phase } para todas las
// parcelas no soft-deleted. Se usa desde `getParcelsWithCycle()` en
// `lib/data.ts` para extender el shape V0 (`DjiParcel`) con la fase del
// cultivo sin tocar la query cacheada del dataset.
//
// Decisiones de diseño:
//   - Query dedicado (NO extiende `djiParcelsQuery`). Razón: si la
//     migration 20260801000000_add_planting_date_and_season.sql no se
//     aplicó todavía, este query explota con "column cycle_phase does
//     not exist". El caller (`getParcelsWithCycle`) lo envuelve en
//     try/catch y degrada a null. Si hubiéramos metido `cycle_phase`
//     en `djiParcelsQuery`, el cache de 60s del dataset entero se
//     rompería hasta que se aplique la migration — peor blast radius.
//   - Filtra `deleted_at IS NULL` igual que `djiParcelsQuery`.
//   - Solo trae 3 columnas (id, planting_date, cycle_phase) — chico,
//     no necesita ser cacheado. Si en el futuro se vuelve hot, agregar
//     wrapper con `unstable_cache`.
//   - `cycle_phase` viene como string de Postgres. El driver lo devuelve
//     como string (no enum). Validamos el shape acá para no propagar
//     strings arbitrarios a la UI.
// ---------------------------------------------------------------------------

export interface ParcelCycleRow {
  id: number;
  planting_date: string | null;
  cycle_phase: CyclePhase | null;
}

const VALID_PHASES: ReadonlySet<string> = new Set([
  "establecimiento",
  "vegetativa",
  "madurante",
  "cosecha"
]);

function normalizePhase(value: unknown): CyclePhase | null {
  if (typeof value !== "string") return null;
  return VALID_PHASES.has(value) ? (value as CyclePhase) : null;
}

export async function getParcelsCycleData(): Promise<Map<number, ParcelCycleRow>> {
  // Sprint Fase 2 / Q5 (2026-08-23): el wrapper `fetchParcelsCycleDataCached`
  // cachea el array de tuplas con TTL 60s + tag `afm:parcels-cycles`.
  // Acá reconstruimos el Map (Map no es JSON-serializable, por eso el
  // cache devuelve tuplas). El cache se invalida en
  // `invalidateAfterParcelMutation()` (cambios de metadata de parcela).
  //
  // Si la BD está caída, `fetchParcelsCycleDataCached` tira y
  // devolvemos un Map vacío (backwards compatible con el caller).
  try {
    const tuples = await fetchParcelsCycleDataCached();
    const map = new Map<number, ParcelCycleRow>();
    for (const [id, row] of tuples) {
      map.set(id, { ...row, cycle_phase: normalizePhase(row.cycle_phase) });
    }
    return map;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      return new Map<number, ParcelCycleRow>();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// F4 fix (2026-08-11): helpers de reportes — antes vivían en
// `app/reportes/page.tsx` y `lib/reports/fetch-farms-report-data.ts`
// con `getDb()` directo. Movidos acá para que toda la data access pase
// por `api/repositories.ts` (R1) y la dep-cruiser pueda rule-arlos.
// ---------------------------------------------------------------------------

/**
 * Lista de haciendas distintas (de `dji_parcels.farm_name NOT NULL`)
 * con el conteo de parcelas por hacienda. Usado por el dropdown de
 * filtros en `app/reportes/page.tsx`. Orden alfabético.
 *
 * Devuelve `[]` si la query falla (la página no debe romper si la BD
 * está caída — solo el dropdown queda vacío).
 */
export async function getDistinctFarmsWithCounts(): Promise<
  Array<{ name: string; count: number }>
> {
  try {
    const db = getDb();
    const r = await db.query<{ name: string; count: string }>(
      `SELECT farm_name AS name, COUNT(*)::int AS count
         FROM dji_parcels
        WHERE deleted_at IS NULL AND farm_name IS NOT NULL
        GROUP BY farm_name
        ORDER BY farm_name ASC`
    );
    return r.rows
      .filter((row) => row.name !== null)
      .map((row) => ({ name: row.name, count: Number(row.count) }));
  } catch {
    return [];
  }
}

/** Filtros para `getFarmsReportFumigations`. */
export interface FarmsReportFumigationsFilters {
  /** YYYY-MM-DD (Bogota local). */
  from: string;
  /** YYYY-MM-DD (Bogota local). */
  to: string;
  /** Si está set, filtra por `p.farm_name = $3`. */
  farmName?: string | null;
  /** Cap de filas (default 200). El caller es responsable del cap. */
  limit?: number;
}

/** Row cruda de `dji_fumigations` con JOIN a `dji_parcels` + subqueries
 *  de `dji_flights` para drone_nickname / pilot_name. La shape es la
 *  mínima que necesita `lib/reports/fetch-farms-report-data.ts` para
 *  armar `FarmsReportData` — la agregación por parcela sigue siendo
 *  responsabilidad del caller (el dataset es chico). */
export interface FarmsReportFumigationRow {
  id: number;
  fumigation_date: Date | string;
  parcel_id: number;
  parcel_name: string;
  farm_name: string | null;
  land_name: string | null;
  pilot_name: string | null;
  drone_nickname: string | null;
  area_fumigated_m2: number | string | null;
  dose_l_per_ha: number | string | null;
  product_used: string | null;
  recorded_by: string | null;
  notes: string | null;
}

/**
 * Fumigaciones del rango para el reporte por hacienda (nivel 2 de
 * `feature/reports-level`). Filtra por fecha + opcionalmente por
 * `farm_name`. Cap por `limit` (default 200, igual que
 * `MAX_FUMIGATIONS_IN_PDF` en el caller).
 *
 * Las subqueries de `drone_nickname` y `pilot_name` son el patrón
 * existente en `getFumigationTimelineForParcel` (subquery correlacionada
 * a `dji_flights` por `parcel_id` + fecha Bogota). Se repiten acá para
 * mantener la query en un solo round-trip (sin N+1).
 */
export async function getFarmsReportFumigations(
  filters: FarmsReportFumigationsFilters
): Promise<FarmsReportFumigationRow[]> {
  const db = getDb();
  const { from, to, farmName, limit = 200 } = filters;

  const params: unknown[] = [from, to];
  let whereExtra = "";
  if (farmName && farmName.trim() !== "") {
    params.push(farmName);
    whereExtra = ` AND p.farm_name = $${params.length}`;
  }

  const result = await db.query<FarmsReportFumigationRow>(
    `
      SELECT
        f.id,
        f.fumigation_date,
        f.parcel_id,
        p.land_name AS parcel_name,
        p.farm_name,
        p.land_name,
        f.area_fumigated_m2,
        f.dose_l_per_ha,
        f.product_used,
        f.product_id,
        f.recorded_by,
        f.notes,
        (
          SELECT fl.drone_nickname
            FROM dji_flights fl
           WHERE fl.parcel_id = f.parcel_id
             AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
             AND fl.drone_nickname IS NOT NULL
           GROUP BY fl.drone_nickname
           ORDER BY COUNT(*) DESC
           LIMIT 1
        ) AS drone_nickname,
        (
          SELECT fl.pilot_name
            FROM dji_flights fl
           WHERE fl.parcel_id = f.parcel_id
             AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
             AND fl.pilot_name IS NOT NULL
           GROUP BY fl.pilot_name
           ORDER BY COUNT(*) DESC
           LIMIT 1
        ) AS pilot_name
      FROM dji_fumigations f
      JOIN dji_parcels p ON p.id = f.parcel_id
      WHERE f.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND f.fumigation_date >= $1::date
        AND f.fumigation_date <= $2::date
        ${whereExtra}
      ORDER BY f.fumigation_date DESC, f.id DESC
      LIMIT ${limit}
    `,
    params
  );

  return result.rows;
}

// ============================================================
// Sprint S7 — feature/s7-schema-extension / Fase 0
// CRUD para los 2 catalogos nuevos (application_types, dji_vehicles)
// y la tabla nueva (fumigation_invoices).
// ============================================================

/**
 * Devuelve el catálogo curado de tipos de aplicación (fase/uso).
 * Ortogonal a `getFumigationCategories` (que devuelve TIPO de producto).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function getApplicationTypes(): Promise<ApplicationType[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<ApplicationType>(
        `SELECT id, slug, label, color, sort_order, is_active
           FROM application_types
          WHERE is_active = TRUE
          ORDER BY sort_order ASC, label ASC`
      );
      return result.rows;
    },
    async () => []
  );
}

/**
 * Busca un vehículo por su placa exacta (case-insensitive). Usado por
 * el form de fumigaciones para autocomplete: si la placa existe, se
 * reusa; si no, se crea.
 *
 * Devuelve `null` si no hay match.
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function findDjiVehicleByPlate(
  plate: string
): Promise<DjiVehicle | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiVehicle>(
        `SELECT id, plate, description, is_active, created_at
           FROM dji_vehicles
          WHERE UPPER(plate) = UPPER($1)`,
        [plate.trim()]
      );
      return result.rows[0] ?? null;
    },
    async () => null
  );
}

/**
 * Sprint S8 (Bloque E): busca producto por nombre (case-insensitive,
 * trim-aware). Usado por el POST del endpoint admin/products para
 * idempotencia. Devuelve `null` si no hay match.
 */
export async function findDjiProductByName(
  name: string
): Promise<DjiProduct | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiProduct>(
        `SELECT id, name, category, active_ingredient, ica_registration,
                display_color, notes, is_active, created_by, created_at, updated_at
           FROM products
          WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
            AND is_active = TRUE`,
        [name]
      );
      return result.rows[0] ?? null;
    },
    async () => null
  );
}

/**
 * Lista vehículos activos para alimentar el autocomplete del
 * `VehiclePicker` (Sprint S7 / Fase 1 / PR-B).
 *
 * - Si `search` está vacío (o tiene < 1 char útil), devuelve los
 *   N más recientes (`ORDER BY created_at DESC`). El picker
 *   muestra "los últimos 10" cuando el usuario aún no escribió.
 * - Si hay query, filtra con `plate ILIKE %search%` y ordena:
 *     1. starts-with primero (`plate ILIKE search%`)
 *     2. contains después
 *     3. descripción como tie-breaker
 *
 * Limita el resultado a `limit` (default 10, cap 50).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 (PR-B).
 */
export async function searchDjiVehicles(
  search: string,
  limit: number = 10
): Promise<DjiVehicle[]> {
  const cappedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const q = (search ?? "").trim();
  const db = getDb();
  return withLocalFallback(
    async () => {
      if (q.length < 1) {
        // Lista default: los N más recientes
        const result = await db.query<DjiVehicle>(
          `SELECT id, plate, description, is_active, created_at
             FROM dji_vehicles
            WHERE is_active = TRUE
            ORDER BY created_at DESC, plate ASC
            LIMIT $1`,
          [cappedLimit]
        );
        return result.rows;
      }
      // Búsqueda con ranking starts-with vs contains
      const like = `%${q}%`;
      const prefix = `${q}%`;
      const result = await db.query<DjiVehicle>(
        `SELECT id, plate, description, is_active, created_at
           FROM dji_vehicles
          WHERE is_active = TRUE
            AND plate ILIKE $1
          ORDER BY
            CASE WHEN plate ILIKE $2 THEN 0 ELSE 1 END,
            plate ASC
          LIMIT $3`,
        [like, prefix, cappedLimit]
      );
      return result.rows;
    },
    async () => []
  );
}

/**
 * Inserta un vehículo nuevo. Si ya existe (UNIQUE constraint en `plate`),
 * tira 23505 — el caller lo mapea a un 409 con un mensaje claro.
 *
 * La BD valida el formato de `plate` con CHECK regex
 * `^[A-Z0-9-]{3,12}$`. El server normaliza a UPPER antes de INSERT.
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function createDjiVehicle(input: {
  plate: string;
  description?: string | null;
}): Promise<DjiVehicle> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiVehicle>(
        `INSERT INTO dji_vehicles (plate, description)
         VALUES (UPPER($1), $2)
         RETURNING id, plate, description, is_active, created_at`,
        [input.plate.trim(), input.description?.trim() ?? null]
      );
      const row = result.rows[0];
      if (!row) throw new Error("createDjiVehicle: INSERT sin row");
      return row;
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Sprint S8 (Bloque E — 2026-08-29): catálogo de productos.
 *
 * Búsqueda LIKE con ranking starts-with > contains. Para volúmenes
 * grandes (>10k productos) el caller puede cambiar a trigram. Cap
 * de 50 para que el dropdown no se vuelva infinito.
 */
export async function searchDjiProducts(
  search: string,
  limit: number = 10
): Promise<DjiProduct[]> {
  const cappedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const q = (search ?? "").trim();
  const db = getDb();
  return withLocalFallback(
    async () => {
      if (q.length < 1) {
        // Lista default: productos más usados recientemente (proxy: created_at DESC)
        const result = await db.query<DjiProduct>(
          `SELECT id, name, category, active_ingredient, ica_registration,
                  display_color, notes, is_active, created_by, created_at, updated_at
             FROM products
            WHERE is_active = TRUE
            ORDER BY created_at DESC, name ASC
            LIMIT $1`,
          [cappedLimit]
        );
        return result.rows;
      }
      const like = `%${q}%`;
      const prefix = `${q}%`;
      const result = await db.query<DjiProduct>(
        `SELECT id, name, category, active_ingredient, ica_registration,
                display_color, notes, is_active, created_by, created_at, updated_at
           FROM products
          WHERE is_active = TRUE
            AND name ILIKE $1
          ORDER BY
            CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
            name ASC
          LIMIT $3`,
        [like, prefix, cappedLimit]
      );
      return result.rows;
    },
    async () => []
  );
}

/**
 * Crea un producto nuevo. El UNIQUE INDEX `idx_products_name_unique`
 * previene duplicados por nombre (case-insensitive). Si ya existe,
 * tira 23505 — el caller lo traduce a un 409 con un mensaje claro.
 *
 * Sprint S8 (Bloque E — 2026-08-29).
 */
export async function createDjiProduct(input: {
  name: string;
  category?: DjiProduct["category"];
  active_ingredient?: string | null;
  ica_registration?: string | null;
  display_color?: string | null;
  notes?: string | null;
  created_by?: string;
}): Promise<DjiProduct> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiProduct>(
        `INSERT INTO products (
           name, category, active_ingredient, ica_registration,
           display_color, notes, created_by
         )
         VALUES (TRIM($1), COALESCE($2, 'otro'), $3, $4, $5, $6, COALESCE($7, 'manual@afm.local'))
         RETURNING id, name, category, active_ingredient, ica_registration,
                   display_color, notes, is_active, created_by, created_at, updated_at`,
        [
          input.name,
          input.category ?? null,
          input.active_ingredient ?? null,
          input.ica_registration ?? null,
          input.display_color ?? null,
          input.notes ?? null,
          input.created_by ?? null
        ]
      );
      const row = result.rows[0];
      if (!row) throw new Error("createDjiProduct: INSERT sin row");
      return row;
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Lista facturas de una fumigación, ordenadas por fecha DESC.
 * Usado por la sección "Facturación" del detail page de fumigación.
 * (También se cargan en bloque con `getFumigationById`; este helper
 * es para refresh después de un POST/PATCH.)
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function listFumigationInvoices(
  fumigationId: number
): Promise<FumigationInvoice[]> {
  if (!Number.isInteger(fumigationId) || fumigationId <= 0) {
    throw new Error(
      "listFumigationInvoices: fumigationId requerido (entero positivo)"
    );
  }
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<FumigationInvoice>(
        `SELECT id, fumigation_id, invoice_number, invoiced_at, amount_cop,
                cancelled, cancelled_at, cancelled_by, created_at, updated_at
           FROM fumigation_invoices
          WHERE fumigation_id = $1
          ORDER BY invoiced_at DESC, id DESC`,
        [fumigationId]
      );
      // pg devuelve DATE como Date — normalizar a YYYY-MM-DD en el boundary.
      return result.rows.map((row) => ({
        ...row,
        invoiced_at: toDateString(row.invoiced_at) ?? ""
      }));
    },
    async () => []
  );
}

/**
 * Crea una factura para una fumigación. El UNIQUE constraint
 * (fumigation_id, invoice_number) previene duplicados.
 *
 * Validación de inputs en BD:
 *   - invoice_number: length 1-50 (CHECK)
 *   - amount_cop: >= 0 (CHECK)
 *   - invoiced_at: NOT NULL
 *   - fumigation_id: FK a dji_fumigations (CASCADE delete)
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function createFumigationInvoice(input: {
  fumigation_id: number;
  invoice_number: string;
  invoiced_at: string;     // YYYY-MM-DD
  amount_cop: number;
}): Promise<FumigationInvoice> {
  if (!Number.isInteger(input.fumigation_id) || input.fumigation_id <= 0) {
    throw new Error("createFumigationInvoice: fumigation_id inválido");
  }
  if (!input.invoice_number || input.invoice_number.trim().length === 0) {
    throw new Error("createFumigationInvoice: invoice_number requerido");
  }
  if (input.invoice_number.trim().length > 50) {
    throw new Error("createFumigationInvoice: invoice_number max 50 chars");
  }
  if (!Number.isFinite(input.amount_cop) || input.amount_cop < 0) {
    throw new Error("createFumigationInvoice: amount_cop debe ser >= 0");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiced_at)) {
    throw new Error(
      "createFumigationInvoice: invoiced_at debe ser YYYY-MM-DD"
    );
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<FumigationInvoice>(
        `INSERT INTO fumigation_invoices
            (fumigation_id, invoice_number, invoiced_at, amount_cop)
         VALUES ($1, $2, $3::date, $4)
         RETURNING id, fumigation_id, invoice_number, invoiced_at, amount_cop,
                   cancelled, cancelled_at, cancelled_by, created_at, updated_at`,
        [
          input.fumigation_id,
          input.invoice_number.trim(),
          input.invoiced_at,
          input.amount_cop
        ]
      );
      const row = result.rows[0];
      if (!row) throw new Error("createFumigationInvoice: INSERT sin row");
      return {
        ...row,
        invoiced_at: toDateString(row.invoiced_at) ?? ""
      };
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Marca una factura como cancelada (anulada). NO borra el row — la
 * factura queda en la BD con `cancelled = TRUE` para auditoría.
 *
 * Idempotente: si la factura YA está cancelada, no hace UPDATE
 * (no-op). El `cancelled_at` y `cancelled_by` quedan con el valor
 * del primer cancel.
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 0.
 */
export async function cancelFumigationInvoice(
  id: number,
  cancelledBy: string
): Promise<FumigationInvoice | null> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("cancelFumigationInvoice: id inválido");
  }
  if (!cancelledBy || cancelledBy.trim().length === 0) {
    throw new Error("cancelFumigationInvoice: cancelledBy requerido");
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      // Solo cancela si no estaba cancelada (idempotente).
      const result = await db.query<FumigationInvoice>(
        `UPDATE fumigation_invoices
            SET cancelled = TRUE,
                cancelled_at = NOW(),
                cancelled_by = $2,
                updated_at = NOW()
          WHERE id = $1
            AND cancelled = FALSE
        RETURNING id, fumigation_id, invoice_number, invoiced_at, amount_cop,
                  cancelled, cancelled_at, cancelled_by, created_at, updated_at`,
        [id, cancelledBy.trim()]
      );
      if (result.rows.length === 0) {
        // Ya cancelada o no existe. Devolvemos el row actual (puede ser
        // null si no existe).
        const existing = await db.query<FumigationInvoice>(
          `SELECT id, fumigation_id, invoice_number, invoiced_at, amount_cop,
                  cancelled, cancelled_at, cancelled_by, created_at, updated_at
             FROM fumigation_invoices WHERE id = $1`,
          [id]
        );
        const row = existing.rows[0];
        if (!row) return null;
        return {
          ...row,
          invoiced_at: toDateString(row.invoiced_at) ?? ""
        };
      }
      const row = result.rows[0];
      return {
        ...row,
        invoiced_at: toDateString(row.invoiced_at) ?? ""
      };
    },
    async () => null
  );
}
