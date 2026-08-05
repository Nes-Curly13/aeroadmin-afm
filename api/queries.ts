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
    -- p.source: origen del registro (sprint 2026-08-04, migration
    -- 20260804081000). Valores posibles: 'dji' (sync), 'manual' (UI
    -- alta), 'imported' (GIS batch, sub-sprint 2 pendiente). El detail
    -- page lo usa para decidir si mostrar u ocultar el dji_land_id
    -- (las parcelas manuales no tienen ID real de DJI). Default
    -- 'dji' en runtime para compat con queries/fixtures viejos que
    -- no proyectan la columna.
    p.source AS source,
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
    -- s8.8+ (2026-07-31): normalizar a Polygon (el adapter en lib/data.ts
    -- espera Polygon, no MultiPolygon). Si spray_geom es MultiPolygon (caso
    -- real hoy en 1213/1213), tomamos el primer polígono con ST_GeometryN.
    -- Para el 99% de las parcelas con un solo anillo, esto es no-op.
    -- Si spray_geom ya es Polygon o NULL, ST_GeometryN no rompe.
    CASE WHEN p.spray_geom IS NULL THEN NULL
         WHEN ST_GeometryType(p.spray_geom) = 'ST_MultiPolygon'
              THEN ST_AsGeoJSON(ST_GeometryN(p.spray_geom, 1))::json
         ELSE ST_AsGeoJSON(p.spray_geom)::json
    END AS spray_geometry,
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
    END AS days_since_last_fumigation,
    -- v2.1 (sprint S6.1 — V0 events map) — cadencia esperada por parcela.
    -- LEFT JOIN simple a dji_fumigation_schedule (1:1 con dji_parcels por
    -- la UNIQUE constraint sobre parcel_id). Null si la parcela no tiene
    -- schedule aún — el caller aplica el fallback (14d Farmland, 10d Orchards).
    s.recommended_cadence_days AS recommended_cadence_days,
    -- v2.1 (sprint S7.2) — V0 fields (client/farm/municipality/variety).
    -- v2.3 (sprint S8.2, 2026-07-29) — aplicadas via migration
    -- 20260728000000_add_v0_fields_to_dji_parcels.sql (commit 4ef376d).
    -- Las 4 columnas existen fisicamente en la BD de Supabase y se
    -- proyectan aca. Si la migration no se aplico (e.g. dev local con
    -- BD fresca), el query falla con column client_name does not exist.
    -- Solucion: correr node scripts/apply-pending-migrations.js o el
    -- script tmp-apply-migration.js. El caller (lib/data.ts) ya no
    -- necesita fallback porque la migration se aplica en CI/dev.
    p.client_name AS client_name,
    p.farm_name AS farm_name,
    p.municipality AS municipality,
    p.variety AS variety
  FROM dji_parcels p
  LEFT JOIN LATERAL (
    SELECT fumigation_date
      FROM dji_fumigations
     WHERE parcel_id = p.id
       AND deleted_at IS NULL
     ORDER BY fumigation_date DESC
     LIMIT 1
  ) last_fum ON true
  LEFT JOIN dji_fumigation_schedule s ON s.parcel_id = p.id
`;

/**
 * `djiParcelsMetadataQuery` — versión liviana de `djiParcelsQuery` sin los
 * campos de geometría pesados (waypoints_geometry, reference_point).
 *
 * Por qué existe:
 *   El cache unstable_cache de Next.js 16 tiene un límite HARD de 2MB por
 *   item. El dataset completo (1213 parcels con waypoints, cada waypoint
 *   con 50-200 puntos) pesa ~4MB serializado, lo que rompe el cache con
 *   "items over 2MB can not be cached" y el unhandledRejection hace que
 *   /parcelas, /geovisor y / devuelvan 404 via el not-found boundary.
 *
 *   Esta query es la misma projection EXCEPTO que omite:
 *   - `waypoints_geometry` (LineString con 50-200 puntos por parcela) — solo
 *     se usa en el re-draw del admin (que tiene su propio query puntual).
 *   - `reference_point` (Point geometry) — solo lo usa el re-draw.
 *
 *   Mantiene `spray_geometry` porque `adaptParcel` lo necesita para el
 *   cascade real > hull > buffer > N-gon synth.
 *
 * Caller:
 *   - `fetchParcelsMetadataCached` en `lib/cache.ts` (cache TTL 60s, tag
 *     afm:parcels-metadata).
 *   - `loadDataset` en `lib/data.ts` lo usa en vez de
 *     `fetchParcelsNormalizedCached` para evitar el 2MB cache limit.
 *
 * Si en el futuro algún caller necesita waypoints para todos los parcels
 * (no solo para uno), crear OTRO cache específico (e.g.
 * `fetchAllParcelsWithWaypoints`) con paginacion cursor y agregar el
 * resultado en runtime al summary. NO revivir `djiParcelsQuery` para 2000
 * rows en un solo cache unstable_cache.
 */
export const djiParcelsMetadataQuery = `
  SELECT
    p.id,
    p.external_id,
    p.source AS source,
    p.land_name,
    p.field_type,
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
    -- Mismo case de spray_geometry que djiParcelsQuery (normalizar a Polygon).
    CASE WHEN p.spray_geom IS NULL THEN NULL
         WHEN ST_GeometryType(p.spray_geom) = 'ST_MultiPolygon'
              THEN ST_AsGeoJSON(ST_GeometryN(p.spray_geom, 1))::json
         ELSE ST_AsGeoJSON(p.spray_geom)::json
    END AS spray_geometry,
    -- OMITIDO: waypoints_geometry (LineString pesado, 50-200 puntos por parcela).
    -- OMITIDO: reference_point (Point geometry, solo re-draw).
    p.waypoint_count,
    p.source_url_geometry,
    p.source_url_parameter,
    -- OMITIDO: source_url_waypoint (solo re-draw).
    p.fetched_at,
    p.crop_type,
    p.planting_date,
    p.owner_name,
    p.owner_contact,
    p.supervisor_notes,
    last_fum.fumigation_date AS last_fumigation_date,
    CASE
      WHEN last_fum.fumigation_date IS NULL THEN NULL
      ELSE (CURRENT_DATE - last_fum.fumigation_date)
    END AS days_since_last_fumigation,
    s.recommended_cadence_days AS recommended_cadence_days,
    p.client_name AS client_name,
    p.farm_name AS farm_name,
    p.municipality AS municipality,
    p.variety AS variety
  FROM dji_parcels p
  LEFT JOIN LATERAL (
    SELECT fumigation_date
      FROM dji_fumigations
     WHERE parcel_id = p.id
       AND deleted_at IS NULL
     ORDER BY fumigation_date DESC
     LIMIT 1
  ) last_fum ON true
  LEFT JOIN dji_fumigation_schedule s ON s.parcel_id = p.id
`;
