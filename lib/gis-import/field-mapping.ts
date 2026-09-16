/**
 * lib/gis-import/field-mapping.ts — mapea atributos de un archivo GIS
 * (shapefile/GPKG) a los campos que SÍ persistimos en `dji_parcels`.
 *
 * Decisión de producto (2026-09-16): en el import NO agregamos columnas
 * nuevas; mapeamos solo a las columnas existentes. Además, NO mapeamos
 * fechas (`F.SIEMBRA`/`F.COSECHA`) porque vienen desactualizadas.
 *
 * El mapeo es por ALIAS de nombre de campo (case-insensitive, sin
 * acentos ni separadores), así sirve para distintos GIS:
 *   - HDASTE      → external_id (identificador único de la suerte)
 *   - HACIENDA    → farm_name
 *   - STE         → luck_name (suerte)
 *   - VARIEDAD    → variety
 *   - AREA_HA     → declared_area_ha
 *   - land_name   → "HACIENDA · STE" (o HDASTE si no hay)
 *
 * Lo que NO se mapea (queda vacío): fechas de siembra/cosecha, y los
 * agronómicos sin columna (topografía, zona agro, tenencia, sacarosa,
 * rendimiento, etc.).
 */

export interface MappedParcelFields {
  land_name: string | null;
  external_id: string | null;
  luck_name: string | null;
  farm_name: string | null;
  variety: string | null;
  crop_type: string | null;
  client_name: string | null;
  municipality: string | null;
  declared_area_ha: number | null;
}

/** Normaliza el nombre de un campo para comparar (sin acentos/sep.). */
function normKey(k: string): string {
  return k
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const ALIASES: Record<keyof Omit<MappedParcelFields, "land_name">, string[]> = {
  external_id: ["HDASTE", "HDA_STE", "IDSUERTE", "SUERTEID", "CODIGOSUERTE"],
  luck_name: ["STE", "SUERTE", "LUCK", "LUCKNAME"],
  farm_name: ["HACIENDA", "FINCA", "FARM", "FARMNAME", "HDA"],
  variety: ["VARIEDAD", "VARIETY", "VAR"],
  crop_type: ["CULTIVO", "CROP", "CROPTYPE", "TIPOCULTIVO"],
  client_name: ["CLIENTE", "CLIENT", "INGENIO", "CLIENTNAME"],
  municipality: ["MUNICIPIO", "MUNICIPALITY", "CITY"],
  declared_area_ha: ["AREAHA", "AREA", "HECTAREAS", "HA", "SUPHA", "AREAHECTAREAS"]
};

function pickString(
  byKey: Map<string, unknown>,
  aliases: string[]
): string | null {
  for (const a of aliases) {
    const v = byKey.get(a);
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNumber(
  byKey: Map<string, unknown>,
  aliases: string[]
): number | null {
  for (const a of aliases) {
    const v = byKey.get(a);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n) && v.trim() !== "") return n;
    }
  }
  return null;
}

export function mapParcelFields(
  properties: Record<string, unknown> | undefined | null
): MappedParcelFields {
  const byKey = new Map<string, unknown>();
  if (properties) {
    for (const [k, v] of Object.entries(properties)) byKey.set(normKey(k), v);
  }

  const external_id = pickString(byKey, ALIASES.external_id);
  const luck_name = pickString(byKey, ALIASES.luck_name);
  const farm_name = pickString(byKey, ALIASES.farm_name);
  const variety = pickString(byKey, ALIASES.variety);
  const crop_type = pickString(byKey, ALIASES.crop_type);
  const client_name = pickString(byKey, ALIASES.client_name);
  const municipality = pickString(byKey, ALIASES.municipality);
  const declared_area_ha = pickNumber(byKey, ALIASES.declared_area_ha);

  // Nombre humano: "HACIENDA · STE" (lo más identificable), luego HDASTE.
  const land_name =
    [farm_name, luck_name].filter(Boolean).join(" · ") ||
    external_id ||
    null;

  return {
    land_name,
    external_id,
    luck_name,
    farm_name,
    variety,
    crop_type,
    client_name,
    municipality,
    declared_area_ha
  };
}
