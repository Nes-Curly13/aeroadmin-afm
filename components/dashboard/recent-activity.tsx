// components/dashboard/recent-activity.tsx
//
// Sprint S6 (V0 port v2) — Tabla de fumigaciones recientes del dashboard.
// Port 1:1 del mockup V0 (`docs/fumigation-management-dashboard/components/
// dashboard/recent-activity.tsx`) al proyecto real, con adaptación del shape
// de datos.
//
// Decisiones de adaptación:
//
//   1. INPUTS — mapeo de campos del V0 al proyecto real:
//
//      V0 (lib/types.ts)                  │ Proyecto (lib/types.ts)
//      ───────────────────────────────────│────────────────────────────────
//      DjiFumigation[]                    │ DjiFumigationEvent[]
//      f.id (string)                      │ f.id (number)
//      f.parcel_id (string)               │ f.parcel_id (number)
//      f.executed_at (ISO)                │ f.fumigation_date (YYYY-MM-DD)
//      f.product (string)                 │ f.product_used (string | null)
//      f.area_treated_ha (number)         │ area_fumigated_m2 / 10000
//      f.volume_l (number)                │ ha * dose_l_per_ha
//      f.flights_count (number)           │ flight_ids?.length ?? 0
//      f.source ("manual"|"import"|       │ f.source ("manual"|"djiscraper"
//              "djiscraper")              │         |"import")
//      parcel.name (string)               │ DjiParcelRecord.land_name
//      parcel.farm_name (string)          │ (no existe en DjiParcelRecord;
//                                         │  se omite la sub-línea)
//
//   2. CARD / TABLE / BADGE — el V0 usa primitives `@/components/ui/card`,
//      `@/components/ui/table`, `@/components/ui/badge`. El proyecto ya
//      tiene Card y Table (creados en S6.1 por el agente de primitives).
//      El primitive Badge AÚN NO EXISTE — usamos un span con las clases
//      equivalentes al Badge "outline" / "secondary" del V0, y un TODO
//      para que el agente de primitives lo reemplace por `<Badge variant>`
//      cuando esté listo.
//
//   3. HELPERS — V0 importa `fmtDateTime`, `fmtDec`, `fmtLiters`,
//      `SOURCE_LABEL` desde `@/lib/format`. El proyecto tiene helpers
//      similares pero no idénticos (`formatNumber`, `formatArea`,
//      `m2ToHa`, no tiene `formatRelative` ni `SOURCE_LABEL`). Definimos
//      los helpers localmente en este archivo para que la portabilidad
//      sea 1:1 sin contaminar `lib/format.ts` con cosas del dashboard.
//      La función pura `enrichFumigation` se mantiene — es la que el
//      caller (dashboard page) usa para mapear el row crudo al row
//      enriquecido que la tabla renderiza.
//
//   4. ENRIQUECIMIENTO — el row crudo del proyecto tiene
//      `area_fumigated_m2` y `dose_l_per_ha`; el V0 muestra los derivados
//      `area_treated_ha` y `volume_l` listos. Mantenemos
//      `enrichFumigation()` para hacer el cálculo en el boundary de la
//      capa de presentación, y exportamos los tipos para que sea
//      testeable sin DOM.
//
//   5. RUTAS — el V0 usa `/parcelas/${f.parcel_id}`; el proyecto usa
//      `/parcels/${id}` (verificado en `app/parcels/[id]/page.tsx`).
//
//   6. FECHAS — el V0 usa `fmtDateTime` (full timestamp con hora). El
//      proyecto renderiza fechas DATE como YYYY-MM-DD (sin hora, porque
//      la columna `fumigation_date` es DATE). Usamos `formatRelative`
//      local para mantener el shape del V0 (texto relativo humano) en
//      lugar de timestamp literal.

import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { formatArea, m2ToHa } from "@/lib/format";
import type { DjiFumigationEvent, DjiParcelRecord } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

// TODO: replace with `<Badge variant="outline|secondary">` from
// "@/components/ui/badge" when the UI primitives agent lands it.
// Same V0 classes (rounded-full, px-1.5, py-0.5, font-mono, text-[10px])
// but inlined as a span to keep this file self-contained while the
// primitive is being authored in parallel.
export interface RecentActivityProps {
  /** Eventos de fumigación a listar. El caller decide el orden y la cantidad. */
  fumigations: DjiFumigationEvent[];
  /**
   * Lookup de parcela por id (Map<number, DjiParcelRecord>). Si el parcel
   * no está en el map, se renderiza el `parcel_id` como fallback.
   */
  parcelById: Map<number, DjiParcelRecord>;
}

export interface EnrichedFumigation {
  id: number;
  parcelId: number;
  parcelLabel: string;
  /** YYYY-MM-DD (string vacío si la fumigación no tiene fecha, edge case). */
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

// ---------------------------------------------------------------------------
// Helpers locales (espejo del V0 `lib/format.ts` + `SOURCE_LABEL`).
// Definidos localmente para no contaminar `lib/format.ts` con cosas
// específicas del dashboard. Si después se usan en otros lados, se
// promueven a `lib/format.ts`.
// ---------------------------------------------------------------------------

/** Formato de litros: >=1000 → "X.X m³", sino "N L" (espejo de `fmtLiters` V0). */
function fmtLiters(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)} m³`;
  }
  return `${Math.round(n)} L`;
}

/** Mapeo source → label humano (espejo de `SOURCE_LABEL` V0). */
const SOURCE_LABEL: Record<"manual" | "djiscraper" | "import", string> = {
  manual: "Manual",
  import: "Import",
  djiscraper: "DJI Scraper"
};

/**
 * Formato de fecha relativa al momento actual (es-CO). Espejo de
 * `fmtRelative` V0 pero con granularidad de minutos/horas/meses/años
 * para que las fumigaciones se vean siempre como "hace N ..." en
 * lugar de "ayer" / "hace 91 días" (la cadencia del V0 era por días
 * solamente, lo que en >30 días daba un número grande poco útil).
 *
 *   - < 1 min   → "justo ahora"
 *   - < 60 min  → "hace N min" / "en N min"
 *   - < 24 h    → "hace N h" / "en N h"
 *   - < 30 d    → "hace N día(s)" / "en N día(s)"
 *   - < 12 m    → "hace N mes(es)" / "en N mes(es)"
 *   - resto     → "hace N año(s)" / "en N año(s)"
 *
 * Usamos formato custom (no `Intl.RelativeTimeFormat`) para que
 * `numeric: "auto"` no devuelva "ayer" / "mañana" / "hace X días"
 * en valores de 1 día, 1 mes, 1 año. Esos casos son los que
 * el operador fumigador más mira.
 *
 * TZ-fragile por diseño — usa `new Date()`. Si llega a romper tests,
 * se le pasa `now` explícito.
 */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const diffMs = then.getTime() - now.getTime();
  const future = diffMs > 0;
  const absMs = Math.abs(diffMs);
  const minutes = Math.floor(absMs / 60_000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) return future ? `en ${minutes} min` : `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `en ${hours} h` : `hace ${hours} h`;
  const days = Math.floor(absMs / 86_400_000);
  if (days < 30) {
    return future
      ? `en ${days} día${days === 1 ? "" : "s"}`
      : `hace ${days} día${days === 1 ? "" : "s"}`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return future
      ? `en ${months} mes${months === 1 ? "" : "es"}`
      : `hace ${months} mes${months === 1 ? "" : "es"}`;
  }
  const years = Math.floor(months / 12);
  return future
    ? `en ${years} año${years === 1 ? "" : "s"}`
    : `hace ${years} año${years === 1 ? "" : "s"}`;
}

export function RecentActivity({ fumigations, parcelById }: RecentActivityProps) {
  const items = fumigations.map((f) => enrichFumigation(f, parcelById));

  return (
    <Card data-slot="recent-activity">
      <CardHeader>
        <CardTitle>Últimas aplicaciones registradas</CardTitle>
        <CardDescription>
          dji_fumigations · trazabilidad por parcela, origen del dato y volumen aplicado
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {items.length === 0 ? (
          <p
            className="px-4 text-sm text-muted-foreground"
            data-testid="recent-activity-empty"
          >
            Sin fumigaciones registradas todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Área</TableHead>
                <TableHead className="text-right">Volumen</TableHead>
                <TableHead className="text-right">Vuelos</TableHead>
                <TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody data-testid="recent-activity-list">
              {items.map((f) => {
                const parcel = parcelById.get(f.parcelId);
                return (
                <TableRow data-fumigation-id={f.id} data-testid={`recent-activity-item-${f.id}`} key={f.id}>
                  <TableCell
                    className="whitespace-nowrap font-mono text-xs"
                    data-testid="recent-activity-date"
                  >
                    {formatRelative(f.date)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Link
                      className="font-semibold hover:text-primary hover:underline"
                      data-testid={`recent-activity-link-${f.id}`}
                      href={`/parcels/${f.parcelId}`}
                    >
                      {f.parcelLabel}
                    </Link>
                    {parcel?.location_label ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {parcel.location_label}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="max-w-56 truncate text-xs"
                    data-testid={`recent-activity-product-${f.id}`}
                  >
                    {f.product}
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-right font-mono text-xs"
                    data-testid={`recent-activity-ha-${f.id}`}
                  >
                    {f.areaHa === null ? "—" : formatArea(f.areaHa)}
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-right font-mono text-xs"
                    data-testid={`recent-activity-volume-${f.id}`}
                  >
                    {f.volumeL === null ? "—" : fmtLiters(f.volumeL)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                    {f.flightsCount}
                  </TableCell>
                  <TableCell data-testid={`recent-activity-source-${f.id}`}>
                    <Badge
                      className="font-mono text-[10px] uppercase tracking-wider"
                      variant={f.source === "manual" ? "outline" : "secondary"}
                    >
                      {SOURCE_LABEL[f.source]}
                    </Badge>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
