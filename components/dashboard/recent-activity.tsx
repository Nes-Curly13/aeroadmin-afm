// components/dashboard/recent-activity.tsx
//
// Sprint S6 (V0 port) — Lista de fumigaciones recientes del dashboard.
// Adaptado del mockup V0 (docs/fumigation-management-dashboard/components/
// dashboard/recent-activity.tsx) al proyecto real.
//
// Decisiones de adaptación:
//
//   1. INPUTS:
//      V0 usaba `DjiFumigation[]` y `parcelById: Map<string, DjiParcel>`.
//      El proyecto real tiene `DjiFumigationEvent` (campos:
//        id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
//        area_fumigated_m2, drone_code_used, duration_minutes,
//        recorded_by, product_registered_ica, pilot_license,
//        recorded_at, source, flight_ids) y `DjiParcelRecord` (id:
//        number, land_name, external_id, ...).
//      Por eso:
//        - `fumigations: DjiFumigationEvent[]`
//        - `parcelById: Map<number, DjiParcelRecord>` (id es number).
//
//   2. CAMPOS DERIVADOS:
//      V0 tenía `area_treated_ha`, `volume_l`, `flights_count` directos
//      en el row. En el proyecto:
//        - ha: area_fumigated_m2 / 10000 (usar `m2ToHa`).
//        - volume_l: dose_l_per_ha * area_fumigated_m2 / 10000.
//        - flights_count: flight_ids?.length ?? 0.
//      Los calculamos en una función pura `enrichFumigation` para que sea
//      testeable.
//
//   3. FECHA RELATIVA:
//      V0 usaba `fmtRelative` (de `lib/format`). El proyecto no tiene
//      ese helper. Implementamos `formatRelative(iso, now?)` local en
//      este archivo. La exportamos para tests y para reutilización.
//      Es TZ-fragile por diseño (depende de `new Date()`); los tests
//      pasan `now` explícito para que sean determinísticos.
//
//   4. CARD / BADGE / TABLE: no usados — solo divs + Tailwind.

import Link from "next/link";

import { m2ToHa } from "@/lib/format";
import type { DjiFumigationEvent, DjiParcelRecord } from "@/lib/types";

export interface RecentActivityProps {
  /** Eventos de fumigación a listar. El caller decide el orden y la cantidad (sugerido: 12). */
  fumigations: DjiFumigationEvent[];
  /**
   * Lookup de parcela por id (Map<number, DjiParcelRecord>). Si el parcel
   * no está en el map, se renderiza el `parcel_id` como fallback (no se
   * rompe el render).
   *
   * En la práctica el dashboard ya carga TODAS las parcelas en
   * `getParcelsNormalized()`, así que construir el map es O(N) y barato.
   */
  parcelById: Map<number, DjiParcelRecord>;
}

export interface EnrichedFumigation {
  id: number;
  parcelId: number;
  parcelLabel: string;
  /** YYYY-MM-DD (puede ser "" si la fumigación no tiene fecha, edge case). */
  date: string;
  /** Hectáreas tratadas (null si area_fumigated_m2 es null). */
  areaHa: number | null;
  /** Volumen asperjado en L (null si no se puede calcular). */
  volumeL: number | null;
  /** Cantidad de vuelos asociados. */
  flightsCount: number;
  /** Nombre del producto o "—" si null. */
  product: string;
  /** Origen (manual | djiscraper | import). */
  source: "manual" | "djiscraper" | "import";
}

/**
 * Enriquece un evento crudo con los derivados que la UI necesita.
 * Pura → testeable sin DOM.
 */
export function enrichFumigation(
  event: DjiFumigationEvent,
  parcelById: Map<number, DjiParcelRecord>
): EnrichedFumigation {
  const parcel = parcelById.get(event.parcel_id);
  const parcelLabel = parcel?.land_name || parcel?.external_id || `#${event.parcel_id}`;
  const areaHa = m2ToHa(event.area_fumigated_m2);
  const volumeL =
    areaHa !== null && event.dose_l_per_ha !== null && event.dose_l_per_ha !== undefined
      ? Math.round(areaHa * event.dose_l_per_ha * 10) / 10
      : null;
  const flightsCount = event.flight_ids?.length ?? 0;
  return {
    id: event.id,
    parcelId: event.parcel_id,
    parcelLabel,
    date: event.fumigation_date,
    areaHa,
    volumeL,
    flightsCount,
    product: event.product_used ?? "—",
    source: event.source
  };
}

/**
 * Formatea una fecha ISO a texto relativo en español.
 *
 * Si la fecha es null/empty/inválida → devuelve "—".
 * Pasado `now` se usa como referencia (default = new Date()). En tests
 * siempre pasar `now` fijo para evitar flakiness.
 *
 * Resolución:
 *   - < 1 min      → "justo ahora"
 *   - < 60 min     → "hace N min"
 *   - < 24 h       → "hace N h"
 *   - < 30 días    → "hace N día(s)"
 *   - < 12 meses   → "hace N mes(es)"
 *   - resto        → "hace N año(s)"
 *
 * Usamos `Math.floor` (no `Math.round`) para que 30s → "justo ahora"
 * (no "hace 1 min" por redondeo de 0.5→1). Es consistente con
 * `Intl.RelativeTimeFormat` que también redondea hacia abajo.
 */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const diffMs = now.getTime() - then.getTime();
  // Si la fecha es FUTURA, devolvemos "en N ..." (caso edge de TZ).
  const sign = diffMs < 0 ? 1 : -1; // invertimos para que "en N" funcione
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) {
    return sign < 0 ? `hace ${minutes} min` : `en ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return sign < 0 ? `hace ${hours} h` : `en ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return sign < 0 ? `hace ${days} día${days === 1 ? "" : "s"}` : `en ${days} día${days === 1 ? "" : "s"}`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return sign < 0 ? `hace ${months} mes${months === 1 ? "" : "es"}` : `en ${months} mes${months === 1 ? "" : "es"}`;
  }
  const years = Math.floor(months / 12);
  return sign < 0 ? `hace ${years} año${years === 1 ? "" : "s"}` : `en ${years} año${years === 1 ? "" : "s"}`;
}

/** Format helpers locales (el proyecto no tiene fmtInt/fmtDec). */
function formatHa(ha: number | null): string {
  if (ha === null) return "—";
  return `${ha.toFixed(1)} ha`;
}
function formatLiters(l: number | null): string {
  if (l === null) return "—";
  return `${l.toFixed(1)} L`;
}

const SOURCE_LABEL: Record<"manual" | "djiscraper" | "import", string> = {
  manual: "Manual",
  djiscraper: "DJI",
  import: "Import"
};

export function RecentActivity({ fumigations, parcelById }: RecentActivityProps) {
  const items = fumigations.map((f) => enrichFumigation(f, parcelById));

  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-slot="recent-activity"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Últimas aplicaciones registradas</h3>
        <p className="text-[11px] text-muted-foreground">
          dji_fumigations · trazabilidad por parcela, origen del dato y volumen aplicado
        </p>
      </div>

      {items.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="recent-activity-empty"
        >
          Sin fumigaciones registradas todavía.
        </p>
      ) : (
        <ul
          aria-label="Fumigaciones recientes"
          className="divide-y divide-border"
          data-testid="recent-activity-list"
        >
          {items.map((f) => (
            <li
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-4"
              data-fumigation-id={f.id}
              data-testid={`recent-activity-item-${f.id}`}
              key={f.id}
            >
              <span
                className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums sm:w-32"
                data-testid="recent-activity-date"
              >
                {formatRelative(f.date)}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  className="truncate text-sm font-semibold hover:text-primary hover:underline"
                  data-testid={`recent-activity-link-${f.id}`}
                  href={`/parcels/${f.parcelId}`}
                >
                  {f.parcelLabel}
                </Link>
                <p
                  className="truncate text-[11px] text-muted-foreground"
                  data-testid={`recent-activity-product-${f.id}`}
                >
                  {f.product}
                </p>
              </div>
              <span
                className="shrink-0 font-mono text-xs tabular-nums"
                data-testid={`recent-activity-ha-${f.id}`}
              >
                {formatHa(f.areaHa)}
              </span>
              <span
                className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                data-testid={`recent-activity-volume-${f.id}`}
              >
                {formatLiters(f.volumeL)}
              </span>
              <span
                className="shrink-0 rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-secondary-foreground"
                data-testid={`recent-activity-source-${f.id}`}
              >
                {SOURCE_LABEL[f.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
