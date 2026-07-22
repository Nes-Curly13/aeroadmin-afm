/**
 * SQL queries compartidas entre `lib/cache.ts` y `api/repositories.ts`.
 *
 * Sprint A — H2 (refactor). Antes de este archivo, la query
 * `SELECT ... FROM dji_parcels` estaba duplicada en:
 *   - `lib/cache.ts` (versión cacheada, SIN los 5 campos de la hoja
 *     de vida y SIN `location_label`).
 *   - `api/repositories.ts` (versión no-cached, CON los 5 campos pero
 *     SIN `location_label`).
 *
 * Consecuencia: la query cached NO devolvía `crop_type`/`planting_date`/
 * `owner_*`/`supervisor_notes`/`location_label`. El dashboard y el
 * detail page divergían silenciosamente. Va a divergir más cada vez
 * que se agreguen campos.
 *
 * Fix: una sola fuente de verdad acá. Todos los campos disponibles
 * en `dji_parcels` están proyectados. La definición del type
 * `DjiParcelRecord` (en `lib/types.ts`) marca algunos como opcionales
 * (los de hoja de vida) por compatibilidad con fixtures de tests
 * viejos — pero en runtime la query SIEMPRE los trae.
 *
 * Patrón de uso:
 *   - `getParcelsNormalizedRaw` (en `lib/cache.ts`) y
 *     `getParcelsNormalizedUncached` + `getParcelById` (en
 *     `api/repositories.ts`) importan `djiParcelsQuery` desde acá.
 *   - Si necesitás agregar un campo a las parcelas, agregalo ACÁ y
 *     agregalo al type `DjiParcelRecord`. No copies la query a otro
 *     archivo.
 *
 * Decisión: ¿por qué NO un helper que devuelva el row tipado?
 *   - Esta query es un template SQL puro (string interpolation
 *     con WHERE/ORDER BY/LIMIT/OFFSET en el caller). Hacer un helper
 *     que construya todo nos acopla a una API que después cuesta
 *     cambiar. El string compartido es la cantidad mínima viable de
 *     acoplamiento.
 */

/**
 * `djiParcelsQuery` — proyección completa de `dji_parcels`.
 *
 * Trae TODOS los campos que el UI puede llegar a necesitar:
 *   - Identidad: id, external_id, land_name, field_type, location_label
 *   - Áreas: declared_area_ha, spray_area_m2
 *   - Modelo de dron: drone_model_code, drone_model_name
 *   - Geometrías: spray_geometry, reference_point, waypoints_geometry,
 *     waypoint_count (ST_AsGeoJSON → json; null si el row no tiene)
 *   - Parámetros operativos: spray_width_m, work_speed_mps, optimal_heading_deg,
 *     radar_height_m, edge_offset_m, obstacle_offset_m, climb_height_m,
 *     no_spray_zone_m2, droplet_size, sweep_direction, is_orchard, uses_side_spray
 *   - Provenance: source_url_geometry/parameter/waypoint, fetched_at
 *   - Hoja de vida (sprint 2026-07-22): crop_type, planting_date, owner_name,
 *     owner_contact, supervisor_notes
 *
 * NOTA: NO agrega `WHERE` ni `ORDER BY` ni `LIMIT/OFFSET` — eso lo hace
 * cada caller. Acá solo proyectamos columnas.
 */
export const djiParcelsQuery = `
  SELECT
    p.id,
    p.external_id,
    p.land_name,
    p.field_type,
    -- location_label: address humana de DJI (re-scrape 2026-07-09,
    -- migration 20260709000000). null hasta que se complete el backfill.
    p.location_label,
    p.declared_area_ha,
    p.spray_area_m2,
    p.drone_model_code,
    p.drone_model_name,
    p.spray_width_m,
    p.work_speed_mps,
    p.optimal_heading_deg,
    p.radar_height_m,
    p.edge_offset_m,
    p.obstacle_offset_m,
    p.climb_height_m,
    p.no_spray_zone_m2,
    p.droplet_size,
    p.sweep_direction,
    p.is_orchard,
    p.uses_side_spray,
    CASE WHEN p.spray_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(p.spray_geom)::json END AS spray_geometry,
    CASE WHEN p.reference_point IS NULL THEN NULL ELSE ST_AsGeoJSON(p.reference_point)::json END AS reference_point,
    CASE WHEN p.waypoints IS NULL THEN NULL ELSE ST_AsGeoJSON(p.waypoints)::json END AS waypoints_geometry,
    p.waypoint_count,
    p.source_url_geometry,
    p.source_url_parameter,
    p.source_url_waypoint,
    p.fetched_at,
    -- Metadata editable por el supervisor (migration 20260722000000).
    -- DJI no expone estos datos — los llena el operador manualmente.
    p.crop_type,
    p.planting_date,
    p.owner_name,
    p.owner_contact,
    p.supervisor_notes,
    -- Sprint A — F1.1: dot de cadencia por color en /parcels.
    -- LEFT JOIN LATERAL con la fumigación más reciente (no soft-deleted)
    -- para que el supervisor pueda escanear prioridades de un vistazo.
    -- days_since_last_fumigation se calcula en SQL (CURRENT_DATE - fecha)
    -- para que sea determinístico: el client solo lee el número, no lo
    -- computa. El null se preserva para "sin historial" (separa el caso
    -- de "vencida" de "nunca fumigada").
    last_fum.fumigation_date AS last_fumigation_date,
    CASE
      WHEN last_fum.fumigation_date IS NULL THEN NULL
      ELSE (CURRENT_DATE - last_fum.fumigation_date)
    END AS days_since_last_fumigation
  FROM dji_parcels p
  LEFT JOIN LATERAL (
    SELECT fumigation_date
      FROM dji_fumigations
     WHERE parcel_id = p.id
       AND deleted_at IS NULL
     ORDER BY fumigation_date DESC
     LIMIT 1
  ) last_fum ON true
`;
