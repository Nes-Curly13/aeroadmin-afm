// lib/reports/fetch-parcel-report-data.ts
//
// Carga la data que necesita el reporte PDF de una parcela (header del
// operador, datos de la parcela, fumigaciones del último mes, totales).
// Capa fina sobre los repositorios existentes — sin SQL nuevo, sin
// lógica de UI.
//
// Decisiones (Sprint B — F1.11):
//   - Ventana: últimos 30 días calendario. Coincide con el "último mes"
//     que el auditor pidió. Si el caller quiere otra ventana, hay que
//     agregar `from`/`to` al route handler (no en este sprint).
//   - Las fumigaciones vienen de `getFumigationTimelineForParcel` (que
//     ya resuelve drone_nickname / pilot_name dominante del día vía
//     subquery a dji_flights). Reusar evita duplicar la query del
//     timeline.
//   - El summary (count, área, litros) lo computamos en TS en lugar
//     de SQL — la lista es chiquita (decenas de eventos por parcela
//     al mes) y la lógica es trivial.
//   - El estado de cadencia (🟢/🟡/🔴) sale de
//     `getFumigationStatus()` que ya usa el resto de la app.

import { revalidateTag, unstable_cache } from "next/cache";

import { getFumigationSchedule } from "@/api/repositories";
import { getParcelById } from "@/api/repositories";
import { getFumigationTimelineForParcel } from "@/api/repositories";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache";
import {
  computeNextDueDate,
  getFumigationStatus
} from "@/lib/fumigation-cadence";
import { m2ToHa, toDateString } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";
import type { FumigationTimelineInput } from "@/lib/types";

/** Estado de cadencia (mapea a 🟢/🟡/🔴 en el template). */
export type CadenceStatus = "ok" | "due_soon" | "overdue" | "no_history";

/** Evento de fumigación ya normalizado para el template PDF. */
export interface ParcelReportEvent {
  id: number;
  fumigation_date: string; // YYYY-MM-DD
  product_used: string | null;
  dose_l_per_ha: number | null;
  area_fumigated_ha: number | null;
  duration_minutes: number | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  recorded_by: string | null;
  notes: string | null;
}

/** Shape que consume el template PDF. Puro, sin acoplar a DjiParcelRecord. */
export interface ParcelReportData {
  /** Header — desde env vars. */
  operatorName: string;
  operatorRegion: string;
  /** Metadata del PDF. */
  generatedAt: string; // YYYY-MM-DD HH:mm (Bogota local)
  /** Datos de la parcela. */
  parcel: {
    id: number;
    external_id: string;
    land_name: string | null;
    field_type: string | null;
    declared_area_ha: number | null;
    spray_area_m2: number | null;
    crop_type: string | null | undefined;
    planting_date: string | null | undefined;
    owner_name: string | null | undefined;
    supervisor_notes: string | null | undefined;
  };
  /** Cadencia. */
  cadence: {
    recommended_cadence_days: number | null;
    last_fumigation_date: string | null;
    next_due_date: string | null;
    status: CadenceStatus;
  };
  /** Ventana del reporte. */
  window: { from: string; to: string };
  /** Eventos del rango (cap a 50 para el PDF — si hay más, lo decimos en el footer). */
  events: ParcelReportEvent[];
  /** Total en el rango + cap info. */
  totals: {
    count: number;
    totalAreaHa: number;
    totalLiters: number;
    averageAreaHa: number;
    lastFumigationDate: string | null;
    capReached: boolean;
  };
  /** Cobertura del mes. */
  coverage: {
    areaFumigableHa: number | null | undefined;
    areaFumigadaHa: number;
    coveragePct: number | null;
  };
}

/** Tamaño máximo de la lista de eventos en el PDF (50 = holgado para 1 mes). */
const MAX_EVENTS_IN_PDF = 50;

/** Ventana del reporte: últimos 30 días calendario, fin = hoy (Bogota local). */
const WINDOW_DAYS = 30;

/** Formato Bogota local YYYY-MM-DD (mismo helper que el resto de la app). */
function todayBogotaDateString(): string {
  // El servidor tiene su TZ (probablemente UTC en prod). Para el header
  // del PDF queremos la fecha local del operador. Usamos Intl con
  // timeZone 'America/Bogota' para que sea determinístico independientemente
  // del TZ del server.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date()); // en-CA da YYYY-MM-DD
}

function todayBogotaTimestamp(): string {
  const fmt = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return fmt.format(new Date());
}

function daysAgoBogotaDateString(n: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  // Sumamos días restando a la fecha local Bogota. Truco: construimos un
  // Date con el día Bogota de hoy y restamos n días en UTC (el offset no
  // importa porque solo leemos YYYY-MM-DD formateado de vuelta).
  const todayStr = fmt.format(new Date()); // YYYY-MM-DD
  const [y, m, d] = todayStr.split("-").map(Number);
  // Usamos UTC midnight para evitar DST drift; restamos n días.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

function eventFromTimeline(e: FumigationTimelineInput): ParcelReportEvent {
  return {
    id: e.id,
    fumigation_date: e.fumigation_date,
    product_used: e.product_used,
    dose_l_per_ha: e.dose_l_per_ha,
    area_fumigated_ha: e.area_fumigated_m2 === null ? null : m2ToHa(e.area_fumigated_m2),
    duration_minutes:
      e.duration_seconds === null ? null : Math.round(e.duration_seconds / 60),
    drone_nickname: e.drone_nickname,
    pilot_name: e.pilot_name,
    recorded_by: e.recorded_by,
    notes: e.notes
  };
}

/**
 * Carga la data del reporte para una parcela. Devuelve `null` si la
 * parcela no existe o está soft-deleted (los repositorios ya filtran
 * por `deleted_at IS NULL` desde Sprint B — H1).
 *
 * No cachea acá. El cache se hace en el route handler con
 * `unstable_cache` + tag `parcelReport` para que se pueda invalidar
 * tras mutaciones de fumigaciones/cadencias.
 */
export async function fetchParcelReportData(
  parcelId: number
): Promise<ParcelReportData | null> {
  const parcel: DjiParcelRecord | null = await getParcelById(parcelId);
  if (!parcel) return null;

  const to = todayBogotaDateString();
  const from = daysAgoBogotaDateString(WINDOW_DAYS);

  const [schedule, timeline] = await Promise.all([
    getFumigationSchedule(parcelId),
    getFumigationTimelineForParcel(parcelId, from, to)
  ]);

  // Estado de cadencia (reusamos el helper que usa el dashboard / upcoming).
  const lastDate = schedule?.last_fumigation_date ?? null;
  // `getFumigationStatus` requiere `cadenceDays: number` (no nullable);
  // cuando no hay cadencia, usamos 14 (default Farmland) para que el
  // helper no truene. El campo "recommended_cadence_days" del PDF se
  // muestra aparte como null, así que el operador ve el dato crudo.
  const cadenceDays = schedule?.recommended_cadence_days ?? 14;
  const status = getFumigationStatus(lastDate, cadenceDays, new Date());
  // Aceptamos que el type devuelva strings distintas a nuestro union,
  // pero en la práctica `getFumigationStatus` solo devuelve esos 4 valores.
  const cadenceStatus: CadenceStatus =
    status === "due_soon" || status === "overdue" || status === "ok" || status === "no_history"
      ? status
      : "no_history";

  // Mapeamos eventos a la shape del PDF. Cap a MAX_EVENTS_IN_PDF.
  const allEvents = timeline.map(eventFromTimeline);
  const capReached = allEvents.length > MAX_EVENTS_IN_PDF;
  const events = allEvents.slice(0, MAX_EVENTS_IN_PDF);

  // Totales del rango (sobre TODOS los eventos, no solo el cap).
  // El accumulator arranca en 0, y `area_fumigated_m2 ?? 0` trata null
  // como 0, así que `totalAreaM2` es siempre un number finito.
  const totalAreaM2 = timeline.reduce(
    (acc, e) => acc + (e.area_fumigated_m2 ?? 0),
    0
  );
  // Conversión inline (no usamos `m2ToHa` porque su type signature
  // devuelve `number | null` para inputs null/undefined — no queremos
  // el null acá porque `totalAreaM2` siempre es finito).
  const totalAreaHa = totalAreaM2 / 10_000;
  // Litros = sum(dose_l_per_ha × area_ha). Si falta uno, 0.
  const totalLiters = timeline.reduce((acc, e) => {
    const areaHa =
      e.area_fumigated_m2 === null ? null : e.area_fumigated_m2 / 10_000;
    if (e.dose_l_per_ha === null || areaHa === null) return acc;
    return acc + e.dose_l_per_ha * areaHa;
  }, 0);
  const averageAreaHa =
    timeline.length > 0 ? totalAreaHa / timeline.length : 0;
  const lastFumigationDate =
    allEvents.length > 0
      ? allEvents
          .map((e) => e.fumigation_date)
          .sort()
          .slice(-1)[0] ?? null
      : null;

  // Cobertura del mes.
  const areaFumigableHa =
    parcel.spray_area_m2 === null ? null : parcel.spray_area_m2 / 10_000;
  const coveragePct =
    areaFumigableHa !== null && areaFumigableHa > 0
      ? Math.min(100, Math.round((totalAreaHa / areaFumigableHa) * 1000) / 10)
      : null;

  const operatorName = process.env.OPERATOR_NAME ?? "AeroAdmin";
  const operatorRegion = process.env.OPERATOR_REGION ?? "Valle del Cauca, Colombia";

  return {
    operatorName,
    operatorRegion,
    generatedAt: todayBogotaTimestamp(),
    parcel: {
      id: parcel.id,
      external_id: parcel.external_id,
      land_name: parcel.land_name,
      field_type: parcel.field_type,
      declared_area_ha: parcel.declared_area_ha,
      spray_area_m2: parcel.spray_area_m2,
      crop_type: parcel.crop_type,
      planting_date: parcel.planting_date,
      owner_name: parcel.owner_name,
      supervisor_notes: parcel.supervisor_notes
    },
    cadence: {
      recommended_cadence_days: schedule?.recommended_cadence_days ?? null,
      last_fumigation_date: lastDate,
      next_due_date:
        schedule?.next_due_date ??
        (lastDate ? computeNextDueDate(lastDate, cadenceDays)?.toISOString().slice(0, 10) ?? null : null),
      status: cadenceStatus
    },
    window: { from, to },
    events,
    totals: {
      count: timeline.length,
      totalAreaHa,
      totalLiters,
      averageAreaHa,
      lastFumigationDate,
      capReached
    },
    coverage: {
      areaFumigableHa,
      areaFumigadaHa: totalAreaHa,
      coveragePct
    }
  };
}

// Re-export para el test smoke y otros callers.
export { toDateString };

/**
 * Wrapper cacheado de `fetchParcelReportData`. La cache es por `parcelId`
 * (cache key incluye el id), así que dos requests a parcelas distintas
 * no comparten cache. Se invalida por tag `parcelReport` cuando hay
 * mutaciones de fumigaciones o metadata de la parcela (ver
 * `invalidateAfterFumigationMutation` y `invalidateAfterParcelMutation`
 * en `lib/cache.ts`).
 *
 * Decisión arquitectural (Sprint B — F1.11): el cache vive en ESTA
 * capa (no en el route handler). Razón: el route solo debería
 * orquestar (auth → fetch → render → respond). Si el cache estuviera
 * en el route, dos routes distintos que llamen a `fetchParcelReportData`
 * no compartirían cache. Manteniendo el cache en el data layer,
 * `getParcelReportData()` es la primitiva canónica para TODO el código
 * que quiera el reporte cacheado (futuro: job programado, mail digest,
 * etc.).
 *
 * Los tests mockean `fetchParcelReportData` directamente (saltando el
 * cache) para no depender de `unstable_cache` (que requiere el runtime
 * de Next y un `incrementalCache` configurado).
 */
export function getParcelReportData(parcelId: number): Promise<ParcelReportData | null> {
  return unstable_cache(
    () => fetchParcelReportData(parcelId),
    ["parcel-report", String(parcelId)],
    {
      revalidate: CACHE_TTL.parcelReport,
      tags: [CACHE_TAGS.parcelReport, CACHE_TAGS.parcels, CACHE_TAGS.upcoming]
    }
  )();
}

/** Helper para invalidar el cache del reporte de una parcela específica.
 *  Usado por tests y por jobs (futuro: revalidación post-mutación
 *  ya está en `invalidateAfterFumigationMutation` /
 *  `invalidateAfterParcelMutation`, este helper es explícito). */
export function invalidateParcelReportCache(): void {
  revalidateTag(CACHE_TAGS.parcelReport, { expire: 0 });
}
