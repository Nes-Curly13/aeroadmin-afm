// lib/reports/fetch-farms-report-data.ts
//
// Data layer del reporte por hacienda / multi-hacienda (nivel 2 de
// feature/reports-level, 2026-08-08).
//
// F4 fix (2026-08-11): el SQL se movió a
// `api/repositories.ts#getFarmsReportFumigations`. Acá solo queda
// la capa de agregación en TS (el dataset es chico — decenas a
// cientos de fumigaciones por mes para 1 operador).
//
// Decisiones:
//   - **Cap 200 fumigaciones** en el PDF. Si hay más, se reporta en el
//     footer. Igual que el reporte por parcela (consistencia).
//   - **Cap 50 parcelas** en la vista general. Una operación cañera
//     típica tiene ~10-20 haciendas activas, así que 50 es holgura
//     amplia. Si llega al cap, se reporta.
//   - **Sin cache** (M7: datos operativos frescos, como Task History).
//     El cache del PDF completo es del route handler si lo necesita.
//   - **Una sola query SQL** (no N+1). Los subqueries para
//     `drone_nickname` y `pilot_name` son el patrón existente en
//     `getFumigationTimelineForParcel` (subquery correlacionada a
//     dji_flights por parcel_id + fecha Bogota).
//   - **Sin `spray_geom`**: el reporte por hacienda NO incluye mapa
//     (sería 1 mapa por hacienda = impráctico en un solo PDF). El nivel
//     1 ya tiene el mapa por parcela. La sección de "Ubicación" del
//     PDF de nivel 2 muestra un texto descriptivo ("X haciendas en Y
//     municipios") en vez de una imagen.
//
// Out of scope (nivel 2):
//   - Imagen satelital por hacienda (no aplica — el mapa es por parcela).
//   - Agregación por piloto o producto (nivel 3 si el operador lo pide).
//   - Selección múltiple de haciendas (filtro = 1 hacienda a la vez).

import { getFarmsReportFumigations } from "@/api/repositories";
import { m2ToHa, toDateString } from "@/lib/format";

export interface FarmsReportFilters {
  /** YYYY-MM-DD (Bogota local). */
  from: string;
  /** YYYY-MM-DD (Bogota local). */
  to: string;
  /** null/undefined = vista multi-hacienda (general). */
  farmName?: string | null;
}

/** Última fumigación del rango (1 sola, destacada en la page). */
export interface FarmsLastFumigation {
  id: number;
  fumigation_date: string;
  parcel_id: number;
  parcel_name: string;
  farm_name: string | null;
  pilot_name: string | null;
  drone_nickname: string | null;
  area_fumigated_ha: number | null;
  dose_l_per_ha: number | null;
  product_used: string | null;
}

/** Fumigación individual del rango (ordenada por fecha DESC, cap 200). */
export interface FarmsFumigationRow {
  id: number;
  fumigation_date: string;
  parcel_id: number;
  parcel_name: string;
  farm_name: string | null;
  land_name: string | null;
  pilot_name: string | null;
  drone_nickname: string | null;
  area_fumigated_ha: number | null;
  dose_l_per_ha: number | null;
  product_used: string | null;
  recorded_by: string | null;
  notes: string | null;
}

/** Agregado por parcela (1 fila por parcela en la tabla resumen). */
export interface FarmsParcelAgg {
  parcel_id: number;
  parcel_name: string;
  farm_name: string | null;
  n_fumigations: number;
  total_area_ha: number;
  total_liters: number;
  last_fumigation_date: string | null;
}

export interface FarmsReportData {
  window: { from: string; to: string };
  /** null = vista general. Definida = vista de 1 hacienda. */
  farmName: string | null;
  generatedAt: string;
  operatorName: string;
  operatorRegion: string;
  /** Última fumigación del rango (la más reciente). */
  lastFumigation: FarmsLastFumigation | null;
  /** Lista cruda de fumigaciones (cap MAX_FUMIGATIONS_IN_PDF). */
  fumigations: FarmsFumigationRow[];
  capReached: boolean;
  /** Agregado por parcela. En vista de 1 hacienda, también se lista. */
  parcels: FarmsParcelAgg[];
  totals: {
    nFumigations: number;
    totalAreaHa: number;
    totalLiters: number;
    nParcels: number;
  };
}

/** Cap para la lista de fumigaciones en el PDF. */
const MAX_FUMIGATIONS_IN_PDF = 200;
/** Cap para la lista de parcelas en la vista general. */
const MAX_PARCELS_IN_PDF = 50;

/**
 * Carga la data del reporte. Devuelve la lista de fumigaciones + los
 * agregados pre-calculados en TS (no en SQL — el dataset es chico).
 *
 * Si no hay fumigaciones en el rango, devuelve un FarmsReportData con
 * `lastFumigation = null`, `fumigations = []`, `parcels = []`, totales
 * en 0. El template renderiza "Sin fumigaciones en el rango" en ese caso.
 */
export async function fetchFarmsReportData(
  filters: FarmsReportFilters
): Promise<FarmsReportData> {
  const { from, to, farmName } = filters;

  // 1) Query unica via repo (F4 fix 2026-08-11 — antes era `getDb()` directo).
  const rows = await getFarmsReportFumigations({
    from,
    to,
    farmName: farmName ?? null,
    limit: MAX_FUMIGATIONS_IN_PDF
  });

  // 2) Mapear las filas a la shape del reporte.
  const allFumigations: FarmsFumigationRow[] = rows.map((row) => {
    const dateStr = toDateString(row.fumigation_date) ?? "";
    const areaHa =
      row.area_fumigated_m2 === null ? null : m2ToHa(Number(row.area_fumigated_m2));
    return {
      id: row.id,
      fumigation_date: dateStr,
      parcel_id: row.parcel_id,
      parcel_name: row.parcel_name,
      farm_name: row.farm_name,
      land_name: row.land_name,
      pilot_name: row.pilot_name,
      drone_nickname: row.drone_nickname,
      area_fumigated_ha: areaHa,
      dose_l_per_ha:
        row.dose_l_per_ha === null ? null : Number(row.dose_l_per_ha),
      product_used: row.product_used,
      recorded_by: row.recorded_by,
      notes: row.notes
    };
  });

  // Cap alcanzado si el LIMIT del SQL cortó resultados. Como el LIMIT
  // es MAX_FUMIGATIONS_IN_PDF, no podemos saber si había más sin un
  // count(*) extra. Asumimos que NO se alcanzó (el cap es holgura
  // amplia para una operación cañera). En el template mostramos un
  // warning si la lista tiene exactamente MAX_FUMIGATIONS_IN_PDF
  // (probabilidad muy baja de match exacto sin haber más).
  const capReached = allFumigations.length === MAX_FUMIGATIONS_IN_PDF;

  // Última fumigación: la primera del array (orden DESC por fecha).
  const first = allFumigations[0];
  const lastFumigation: FarmsLastFumigation | null = first
    ? {
        id: first.id,
        fumigation_date: first.fumigation_date,
        parcel_id: first.parcel_id,
        parcel_name: first.parcel_name,
        farm_name: first.farm_name,
        pilot_name: first.pilot_name,
        drone_nickname: first.drone_nickname,
        area_fumigated_ha: first.area_fumigated_ha,
        dose_l_per_ha: first.dose_l_per_ha,
        product_used: first.product_used
      }
    : null;

  // Agregado por parcela.
  const parcelMap = new Map<
    number,
    {
      parcel_id: number;
      parcel_name: string;
      farm_name: string | null;
      n_fumigations: number;
      total_area_ha: number;
      total_liters: number;
      last_fumigation_date: string | null;
    }
  >();

  let totalAreaHa = 0;
  let totalLiters = 0;

  for (const f of allFumigations) {
    totalAreaHa += f.area_fumigated_ha ?? 0;
    if (f.dose_l_per_ha !== null && f.area_fumigated_ha !== null) {
      totalLiters += f.dose_l_per_ha * f.area_fumigated_ha;
    }
    const existing = parcelMap.get(f.parcel_id);
    if (existing) {
      existing.n_fumigations += 1;
      existing.total_area_ha += f.area_fumigated_ha ?? 0;
      if (f.dose_l_per_ha !== null && f.area_fumigated_ha !== null) {
        existing.total_liters += f.dose_l_per_ha * f.area_fumigated_ha;
      }
      if (
        !existing.last_fumigation_date ||
        f.fumigation_date > existing.last_fumigation_date
      ) {
        existing.last_fumigation_date = f.fumigation_date;
      }
    } else {
      parcelMap.set(f.parcel_id, {
        parcel_id: f.parcel_id,
        parcel_name: f.parcel_name,
        farm_name: f.farm_name,
        n_fumigations: 1,
        total_area_ha: f.area_fumigated_ha ?? 0,
        total_liters:
          f.dose_l_per_ha !== null && f.area_fumigated_ha !== null
            ? f.dose_l_per_ha * f.area_fumigated_ha
            : 0,
        last_fumigation_date: f.fumigation_date
      });
    }
  }

  // Ordenar parcelas: las más fumigadas primero. Aplicar cap.
  const allParcels = Array.from(parcelMap.values()).sort(
    (a, b) => b.n_fumigations - a.n_fumigations
  );
  const parcels = allParcels.slice(0, MAX_PARCELS_IN_PDF);

  const operatorName = process.env.OPERATOR_NAME ?? "AeroAdmin";
  const operatorRegion = process.env.OPERATOR_REGION ?? "Valle del Cauca, Colombia";

  return {
    window: { from, to },
    farmName: farmName ?? null,
    generatedAt: new Date().toISOString(),
    operatorName,
    operatorRegion,
    lastFumigation,
    fumigations: allFumigations,
    capReached,
    parcels,
    totals: {
      nFumigations: allFumigations.length,
      totalAreaHa,
      totalLiters,
      nParcels: allParcels.length
    }
  };
}
