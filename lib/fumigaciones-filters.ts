// lib/fumigaciones-filters.ts
//
// Helpers puros de parseo / construcción de URL para los searchParams
// del page `/fumigaciones`. Extraídos del page en el sprint
// feature/fumigaciones-detail-polish (2026-08-13) para poder testearlos
// aisladamente (regla R3 del repo: "todo código nuevo en lib/ viene con
// tests").
//
// Decisiones:
//   - **Sin estado, sin side effects, sin imports de server-only** —
//     los tests los importan directo con `import from "@/lib/..."`.
//   - **`FUMIGATION_CATEGORIES` se importa de `lib/data-constants`** —
//     es client-safe y es la única dependencia de runtime (necesaria
//     para `parseCategorySlug`).
//   - **El tipo `FumigacionesSearchParams`** representa la forma cruda
//     que Next.js pasa al server component (todo `string | undefined`).
//     Los `parse*` devuelven tipos específicos (number, FumigationSource,
//     etc.) para que el resto del page los use ya tipados.

import { FUMIGATION_CATEGORIES } from "@/lib/data-constants";

/**
 * Forma de los `searchParams` que Next.js pasa a `FumigacionesPage`.
 * Todos los campos son `string | undefined` (Next.js no parsea tipos).
 * Los `parse*` helpers de este módulo devuelven null cuando el valor
 * está ausente o no es válido (seguridad contra URL manipulation).
 *
 * Sprint 2026-08-13 — feature/fumigaciones-detail-polish.
 */
export interface FumigacionesSearchParams {
  page?: string;
  q?: string;
  source?: string;
  /**
   * Slug de la categoría curada ("herbicida", "insecticida", etc.).
   * El id numérico lo deriva `parseCategorySlug`.
   */
  category?: string;
  /** Fecha ISO YYYY-MM-DD (formato nativo del <input type="date">). */
  from?: string;
  /** Fecha ISO YYYY-MM-DD (formato nativo del <input type="date">). */
  to?: string;
  /** Id numérico de parcela (match con la URL del detail /parcelas/[id]). */
  parcel?: string;
  /** Code numérico del dron (0, 72, 201, 210). */
  drone?: string;
}

/** Source válido de una fumigación (match con el campo `dji_fumigations.source`). */
export type FumigationSource = "djiscraper" | "import" | "manual";

/**
 * Mapea el searchParam `source` al shape interno. Acepta los valores
 * legacy `"dji" | "manual" | "import"` + `"all"` (que cae a `null`).
 * Devuelve `null` para valores desconocidos.
 *
 * Por qué este split: la URL es user-facing (`"dji"`, `"manual"`) y el
 * shape de la BD es técnico (`"djiscraper"`, `"import"`). Sin este
 * mapeo, los filtros no matchearían con los valores reales de la BD.
 */
export function parseSource(v: string | undefined): FumigationSource | null {
  if (v === "dji") return "djiscraper";
  if (v === "manual") return "manual";
  if (v === "import") return "import";
  return null;
}

/**
 * Convierte el slug del searchParam al id de `FUMIGATION_CATEGORIES`.
 * Devuelve `null` si el slug no existe en el catálogo curado.
 *
 * Se pasa el slug en lugar del id en la URL para que sea legible y
 * no se rompa si reasignamos ids en una migration.
 */
export function parseCategorySlug(v: string | undefined): number | null {
  if (!v) return null;
  const cat = FUMIGATION_CATEGORIES.find((c) => c.slug === v);
  return cat?.id ?? null;
}

/**
 * Valida una fecha YYYY-MM-DD. Devuelve la fecha si es válida, null
 * si no. Usado por los filtros `from` / `to` para no inyectar SQL
 * inválido a la BD si el usuario manipula la URL.
 *
 * El check es doble:
 *   1. Regex estructural (formato YYYY-MM-DD).
 *   2. `new Date(...)` parsea y es finite (rechaza "2026-13-99",
 *      "2026-02-30", etc.). Comparamos con `getTime()` NaN-safe.
 */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Validar que la fecha es real. Usamos `Date(y, m-1, d)` con componentes
  // separados Y comparamos con `getDate()` para rechazar overflow silencioso
  // tipo "2026-02-30" (que `new Date("2026-02-30T00:00:00Z")` parsea como
  // "2026-03-02" sin error — bug latente pre-polish-v1).
  const [yStr, mStr, dStr] = v.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return v;
}

/**
 * Parsea un id numérico positivo entero. Devuelve `null` si el valor
 * no es un entero positivo válido (NaN, Infinity, float, <= 0, string
 * no numérico).
 *
 * Usado por los filtros `parcel` y `drone` (cuando el drone no está
 * validado contra el set de codes conocidos).
 */
export function parseIntId(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Drone codes válidos (0 = "Sin asignar", 72/201/210 = los 3 modelos
 * registrados en `dji_drone_models`). Si el query viene con un code
 * inválido (manipulación de URL), lo descartamos.
 */
const VALID_DRONE_CODES: ReadonlySet<number> = new Set<number>([0, 72, 201, 210]);

/**
 * Parsea un drone code validándolo contra el set `VALID_DRONE_CODES`.
 * Devuelve `null` si el código no está registrado.
 *
 * Por qué no reusa `parseIntId`: queremos defensa adicional contra
 * IDs que serían numéricos pero no corresponden a un dron real
 * (ej. el usuario tipea `?drone=99`).
 */
export function parseDroneCode(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || !VALID_DRONE_CODES.has(n)) {
    return null;
  }
  return n;
}

/**
 * Construye una URL preservando los searchParams activos y agregando
 * `page` con el valor provisto. Usado por el componente Pagination
 * para que cambiar de página NO pierda los filtros (bug pre-existente
 * en /fumigaciones, fixed en polish v1).
 *
 * Si no hay filtros ni page>1, devuelve `"?page=1"` (no string vacío)
 * para que la URL siempre tenga al menos un searchParam (consistencia
 * con la semántica de "página 1 = default").
 */
export function buildPageUrl(
  sp: FumigacionesSearchParams,
  page: number
): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.source) params.set("source", sp.source);
  if (sp.category) params.set("category", sp.category);
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  if (sp.parcel) params.set("parcel", sp.parcel);
  if (sp.drone) params.set("drone", sp.drone);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "?page=1";
}
