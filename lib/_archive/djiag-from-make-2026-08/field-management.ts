// field-management.ts
//
// Wrapper tipado que replica el comportamiento del blueprint Make.com
// `www_djiag_com_mission_1920w_default.make` (que navega a
// https://www.djiag.com/mission → click "Field Management" y captura la
// lista de fincas).
//
// Source del design: archivo Figma `AFM_SIG`, frame `1001-6945`
// (ver docs/audit/figma-vs-bd.md para la matriz UI ↔ BD completa).
//
// Uso:
//
//   import { fetchFieldManagementSnapshot } from "@/lib/djiag-from-make/field-management";
//   const snap = await fetchFieldManagementSnapshot({ baseUrl: "https://www.djiag.com" });
//   console.log(snap.count, snap.fields[0].name);
//
// Lo que hace distinto del fetcher original (`djiag-lands-fetcher.js`):
//   1. Tipa la salida con tipos específicos del UI (FieldCard, FieldManagementSnapshot).
//   2. Acepta un objeto de opciones con defaults razonables.
//   3. Devuelve el snapshot completo con `count` (del header) y `fields` (cards).
//   4. Es testeable sin Playwright (si le pasás un fetch ya autenticado).
//
// Lo que NO hace (todavía):
//   - Filtrar por type ("All" / "Farmland" / "Orchards"). El fetcher devuelve
//     todos los fields; el caller filtra en memoria.
//   - Filtrar por search ("Location Data"). Tampoco.
//   - Pagination UI (scroll virtualizado). Trae TODOS los fields en una sola
//     query (lands query soporta first:200, pero con 1205 fincas hay que
//     paginar). El caller debe usar el snapshot y/o iterar.

import { LANDS_QUERY } from "@/lib/djiag-graphql-queries";
import type { NormalizedLand, ParsedLandsPage } from "@/lib/djiag-graphql-types";
import { muToHa, parseLandsResponse } from "@/lib/djiag-lands-fetcher";

/** Tipo del chip visible en cada card. */
export type FieldType = "Farmland" | "Orchards";

/** Una card de field tal como aparece en el UI. */
export interface FieldCard {
  /** Título de la card, ej. "Gertrudis STE 116C". Mapea a dji_parcels.land_name. */
  name: string;
  /** Área en ha. Mapea a dji_parcels.declared_area_ha. null si no se conoce. */
  areaHa: number | null;
  /** Location string. Mapea a dji_parcels.location_label. null hasta re-scrape. */
  locationLabel: string | null;
  /** Fecha de la card (YYYY/MM/DD). Viene de DJI (createdAt o updatedAt). */
  date: string;
  /** Tipo de la card. Mapea a dji_parcels.field_type. */
  type: FieldType;
  /** DJI AG uuid interno. Mapea a dji_parcels.dji_land_uuid. */
  uuid: string | null;
  /** External ID (slug de DJI con format `<bigint>-flyer-<uuid>`). Mapea a dji_parcels.external_id. */
  externalId: string | null;
}

/** Resultado de un fetch completo del screen Field Management. */
export interface FieldManagementSnapshot {
  /** Total de fields del usuario (del header "Field Management (N)"). */
  count: number;
  /** Cards parseadas en el orden que las devuelve DJI. */
  fields: FieldCard[];
  /** Cursor por si se quiere seguir paginando (futuro). */
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface FetchFieldManagementOptions {
  /** URL base de DJI AG. Default: https://www.djiag.com */
  baseUrl?: string;
  /** Fetch inyectado (para tests). Debe estar autenticado con cookies válidas. */
  fetchImpl?: typeof fetch;
  /** Tamaño de página. Default 200 (máx. del lands query de DJI). */
  first?: number;
  /** Cursor inicial. Default "0". */
  after?: string;
}

/** Formatea una ISO timestamp a YYYY/MM/DD (formato del card en el UI). */
function formatDjiDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

/** Convierte un NormalizedLand en FieldCard (lo que muestra el UI). */
export function landToFieldCard(land: NormalizedLand): FieldCard {
  const isOrchard = land.landType === "Orchards";
  return {
    name: land.name,
    areaHa: muToHa(land.totalAreaMu),
    locationLabel: land.address,
    // DJI muestra updatedAt en la card (la fecha de última modificación
    // de la finca). Si no está, fallback a createdAt.
    date: formatDjiDate(land.updatedAt ?? land.createdAt),
    type: isOrchard ? "Orchards" : "Farmland",
    uuid: land.uuid,
    externalId: land.externalId
  };
}

/**
 * Fetch el screen Field Management desde DJI.
 *
 * @param opts  Opciones de fetch (ver FetchFieldManagementOptions).
 * @returns     Snapshot con count + fields.
 *
 * Lanza error si la response no es 200 o si la shape es inesperada.
 */
export async function fetchFieldManagementSnapshot(
  opts: FetchFieldManagementOptions = {}
): Promise<FieldManagementSnapshot> {
  const baseUrl = opts.baseUrl ?? "https://www.djiag.com";
  const first = opts.first ?? 200;
  const after = opts.after ?? "0";
  const fetchImpl = opts.fetchImpl ?? fetch;

  const res = await fetchImpl(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: null,
      query: LANDS_QUERY,
      variables: { first, after }
    })
  });

  if (!res.ok) {
    throw new Error(`FieldManagement fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const parsed: ParsedLandsPage = parseLandsResponse(json);

  return {
    count: parsed.totalCount,
    fields: parsed.lands.map(landToFieldCard),
    pageInfo: {
      hasNextPage: parsed.hasNextPage,
      endCursor: parsed.endCursor
    }
  };
}
