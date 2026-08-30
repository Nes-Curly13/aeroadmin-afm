// ---------------------------------------------------------------------------
// V0 formatters (es-CO) — port del mockup de V0. Usados por componentes
// adaptados del V0 (dashboard, geovisor, parcelas). Conviven con los
// formatters del proyecto (en-US) en este módulo.
// ---------------------------------------------------------------------------

const _esInt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const _esDec = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
});

export const fmtInt = (n: number) => _esInt.format(n);
export const fmtDec = (n: number) => _esDec.format(n);

/**
 * Formatea un monto en pesos colombianos (COP). Usa el locale
 * es-CO con estilo currency. El monto se redondea a entero (los
 * centavos no se manejan en este sistema — el cliente factura en
 * pesos redondos, no en centavos).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
 * Usado por `components/fumigations/invoices-card.tsx` para
 * formatear `amount_cop` de las facturas.
 *
 * @example fmtCop(1500000) → "$ 1.500.000"
 */
export function fmtCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(n);
}

export function fmtHa(n: number) {
  return `${n >= 1000 ? _esInt.format(Math.round(n)) : _esDec.format(n)} ha`;
}

export function fmtLiters(n: number) {
  if (n >= 1000) return `${_esDec.format(n / 1000)} m³`;
  return `${_esInt.format(Math.round(n))} L`;
}

/**
 * Helper: rebuildea un string de fecha/hora desde las `parts` de
 * `formatToParts`, evitando los caracteres invisibles (U+202F, U+00A0)
 * que `Intl.DateTimeFormat` mete entre la hora y el sufijo AM/PM, o
 * entre la fecha y la hora, en ICU 73+. Esos caracteres difieren
 * entre Node (server) y el ICU del SO del cliente, causando React
 * hydration mismatch #418.
 *
 * `get(type)` extrae el value de una part por tipo (year, month,
 * day, hour, minute). Devuelve "" si no existe (caso defensivo).
 *
 * Si necesitas dayPeriod ("p. m." / "a. m.") en la salida, agregalo
 * aca en vez de delegar a toLocaleString.
 */
function buildIntlString(
  date: Date,
  fmt: Intl.DateTimeFormatOptions,
  build: (get: (type: Intl.DateTimeFormatPartTypes) => string) => string
): string {
  const dtf = new Intl.DateTimeFormat("es-CO", fmt);
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return build(get);
}

export function fmtDate(iso: string | null, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return "—";
  // IMPORTANTE: pasamos `timeZone: "America/Bogota"` para evitar
  // hydration mismatches (Sprint S8 / Bloque D — React #418). El
  // server corre en UTC; el cliente (operador) corre en America/Bogota
  // (UTC-5). Sin timeZone explicito, `toLocaleDateString` usa la TZ
  // del sistema — server vs client divergen cerca de medianoche UTC
  // y React aborta la hydration del <td> que contiene la fecha.
  // Ver https://react.dev/errors/418 para el detalle.
  //
  // Sprint S9 (2026-08-30) — rebuildeamos desde formatToParts para
  // evitar el U+202F que Intl mete entre componentes en ICU 73+.
  // Output: "15 mar 2026" (separador " " regular, no narrow no-break).
  const baseOpts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Bogota"
  };
  return buildIntlString(new Date(iso), { ...baseOpts, ...opts }, (get) => {
    // `month: "short"` produce "mar", "ene" — concatenamos con " ".
    // NO usamos "literal" de formatToParts (que seria " de " o "/")
    // para mantener compat con el formato previo ("15 mar 2026").
    return `${get("day")} ${get("month")} ${get("year")}`;
  });
}

export function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  // Misma TZ que fmtDate — Sprint S8 / Bloque D fix hydration #418.
  // Sprint S9 (2026-08-30) — formatToParts para evitar U+202F.
  // Output: "15 mar 2026, 14:30" (separadores ASCII explicitos).
  return buildIntlString(
    new Date(iso),
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Bogota"
    },
    (get) => `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`
  );
}

export function fmtTime(iso: string) {
  // Misma TZ + formatToParts (Sprint S9 2026-08-30).
  return buildIntlString(
    new Date(iso),
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Bogota"
    },
    (get) => `${get("hour")}:${get("minute")}`
  );
}

export function fmtRelative(iso: string | null, refDate?: Date) {
  if (!iso) return "sin registro";
  const ref = refDate ?? new Date();
  const diffDays = Math.round((new Date(iso).getTime() - ref.getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
  if (Math.abs(diffDays) >= 30) return rtf.format(Math.round(diffDays / 30), "month");
  return rtf.format(diffDays, "day");
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Import",
  djiscraper: "DJI Scraper"
};

export const toISODate = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Formatters originales del proyecto (en-US).
// ---------------------------------------------------------------------------

/**
 * Normaliza un valor que viene de Postgres vía `pg` (que devuelve DATE como `Date`)
 * a un string ISO `YYYY-MM-DD`. Acepta Date, string ISO, null o undefined.
 *
 * Por qué existe: `pg` devuelve columnas `DATE` como objetos `Date` de JS aunque
 * los tipos TS digan `string`. Si renderizás un `Date` directo en JSX, React tira
 * "Objects are not valid as a React child (found: [object Date])".
 *
 * Usar SIEMPRE en el boundary del repositorio (después del `db.query`) para
 * columnas DATE, antes de devolver la fila al componente.
 */
export function toDateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  // string: ya viene normalizado (o es 'YYYY-MM-DD'); devolver tal cual.
  return value;
}

/**
 * Formato de fecha con día de semana para el operador fumigador.
 * Devuelve "lun 15 mar 2026" en español (locale es-CO).
 *
 * Por qué existe: el operador fumigador piensa "lunes a las 14:30", no
 * "2026-07-15". El formato de DJI AG también muestra día de semana
 * prominentemente — lo mantenemos consistente.
 *
 * Usa UTC midnight para evitar drift de TZ (mismo patrón que daysBetween).
 * Si el input no es YYYY-MM-DD válido, devuelve el string tal cual.
 */
export function formatDateWithWeekday(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(d);
}

/**
 * Convierte m² → ha. Factor 1 ha = 10_000 m² (definido en docs/DJI_AREA_UNITS.md).
 * Devuelve `null` para que el caller decida cómo renderizar (UI: "—").
 * Para conversiones de MU usá los helpers en lib/djiag-*-fetcher.js — esto
 * es solo para el shape de la BD que ya está en m².
 */
export function m2ToHa(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value / 10_000;
}

/**
 * Formatea segundos a un string estilo DJI: "1Hour24min05s" / "0Hour05min30s".
 * Coincide con `duration.djiFormat` que produce `lib/djiag-from-make/task-history`
 * (mismo formato que ve el operador en DJI AG). Si `seconds` es null, devuelve "—".
 */
export function formatDjiDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = String(h);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}Hour${mm}min${ss}s`;
}

/**
 * Diferencia en días enteros entre dos fechas YYYY-MM-DD.
 * Devuelve `null` si alguna fecha es null o no matchea el formato.
 * Usa UTC midnight para evitar drift de TZ — Bogota local de dos fechas DATE
 * se interpreta consistentemente como UTC midnight en el boundary del repository.
 */
export function daysBetween(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Devuelve la fecha actual en zona horaria `America/Bogota` como string
 * `YYYY-MM-DD`. Opcionalmente shifted `offsetDays` días (puede ser negativo).
 *
 * Por qué existe: el proyecto opera 100% en TZ `America/Bogota` y los
 * tests son TZ-frágiles con `new Date()` directo (jsdom corre en UTC).
 * Centralizar acá permite que el test mockee el helper o setee
 * `process.env.TZ` consistentemente.
 *
 * Implementación: `Intl.DateTimeFormat` con `timeZone: "America/Bogota"`
 * y `en-CA` (que produce `YYYY-MM-DD` por convención del locale canadiense).
 * Funciona en node y jsdom. NO usa `toLocaleDateString` directo.
 */
export function getBogotaDateString(offsetDays = 0): string {
  const target = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Detecta si un string parece un blob JSON de provenance (backfill de DJI scraper).
 *
 * El scraper mete metadata del backfill en `dji_fumigations.notes` como JSON:
 *   {"drones":[...], "pilots":[...], "flights_count":N, "spray_usage_ml":N,
 *    "backfilled_from":"dji_flights", "primary_drone_nickname":"AFM T50-1"}
 * Esos datos NO son notas del operador — son trazabilidad de la ingesta.
 * Renderizarlos en el UI los confunde con notas humanas. Esta función
 * los identifica por el shape (empieza con `{`, contiene `backfilled_from`
 * o `spray_usage_ml`).
 *
 * Usar en los componentes que muestran `event.notes` para decidir si
 * renderizar el campo o no. Si retorna `true`, NO renderizar — los datos
 * ya están expuestos en otros campos del row (drone nickname, pilot name).
 */
export function isProvenanceNotes(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  // Heurística barata: buscar una key conocida del backfill. Evita falsos
  // positivos si alguna nota humana real es JSON-shape.
  return (
    trimmed.includes("backfilled_from") ||
    trimmed.includes("spray_usage_ml") ||
    trimmed.includes("primary_drone_nickname")
  );
}
