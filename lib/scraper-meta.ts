// lib/scraper-meta.ts
//
// Sprint H2 — Parser de metadata del scraper DJI para fumigaciones
// huérfanas.
//
// Las 30 fumigaciones huérfanas actuales son agregaciones diarias
// del scraper DJI (formato `djiscraper-aggr-by-day`). Su campo
// `notes` (jsonb en la BD, string en el cliente) trae:
//
//   {
//     "source": "djiscraper-aggr-by-day",
//     "sortieCount": 103,            // # de vuelos ese día
//     "sprayUsageMl": 1111792,       // mL totales asperjados
//     "workTimeSec": 30327194,       // segundos totales de trabajo
//     "createTimestamp": 1782968400  // unix ts (fin del día UTC)
//   }
//
// Como no incluyen `parcel_id` ni coords, no se pueden matchear
// automáticamente. El admin las revisa y vincula manualmente —
// pero para tomar la decisión informada, este helper expone
// `sortieCount` / `sprayUsageMl` / `workTimeHours` en columnas
// separadas en la tabla de la página /admin/orphan-fumigations.
//
// Devuelve `null` si el `notes` no es del formato esperado (p.ej.
// fumigaciones manuales, fumigaciones per-parcel del backfill
// import, o fumigaciones vacías). Esto deja la fila con guiones
// "—" en vez de tirar error en el render.

export interface ScraperAggrMeta {
  /** Cantidad de vuelos (sorties) que componen la agregación diaria. */
  sortieCount: number;
  /** Volumen total asperjado en mililitros. */
  sprayUsageMl: number;
  /** Horas de trabajo (workTimeSec / 3600, redondeado a 1 decimal). */
  workTimeHours: string;
}

/**
 * Parsea el campo `notes` de una fumigación y devuelve la metadata
 * del scraper si la fila es del formato `djiscraper-aggr-by-day`.
 *
 * Acepta:
 *   - string JSON (lo que viene del cliente; la BD almacena jsonb
 *     pero al cruzar el server→client boundary, `pg` lo serializa
 *     a string en algunos paths)
 *   - objeto ya parseado
 *   - null / undefined / string inválido → devuelve null
 *
 * `workTimeHours` se devuelve como string formateado a 1 decimal
 * para evitar problemas de hidratación con `toLocaleString` y
 * TZ (ver vitest-jsdom-patterns.md).
 */
export function parseScraperAggrMeta(
  notes: string | object | null | undefined
): ScraperAggrMeta | null {
  if (notes == null) return null;

  let obj: unknown;
  if (typeof notes === "string") {
    try {
      obj = JSON.parse(notes);
    } catch {
      return null;
    }
  } else {
    obj = notes;
  }

  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o.source !== "djiscraper-aggr-by-day") return null;

  const sortieCount = numOrNull(o.sortieCount);
  const sprayUsageMl = numOrNull(o.sprayUsageMl);
  const workTimeSec = numOrNull(o.workTimeSec);
  if (sortieCount == null || sprayUsageMl == null || workTimeSec == null) {
    return null;
  }

  return {
    sortieCount,
    sprayUsageMl,
    workTimeHours: (workTimeSec / 3600).toFixed(1)
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}
