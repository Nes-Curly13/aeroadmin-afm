export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatArea(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value)} ha`;
}

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

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
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
