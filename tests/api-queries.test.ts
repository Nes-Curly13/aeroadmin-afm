// tests/api-queries.test.ts
//
// MT-12 — cobertura estática de api/queries.ts.
//
// Tests que validan, sin tocar la BD, que los SQL templates exportados
// contienen las cláusulas esperadas. Son guards de contrato: si alguien
// borra una columna, un JOIN, o el filtro de soft-delete, el test
// explota con un mensaje claro que apunta al archivo.
//
// Por qué este archivo existe:
//   - api/queries.ts es una fuente de verdad compartida entre
//     lib/cache.ts y api/repositories.ts (ver header del archivo).
//     Cambios inadvertidos rompen el dashboard / detail page / geovisor
//     silenciosamente (mismatch de shape entre cache y uncached).
//   - Los templates son strings puros (no funciones), así que no se
//     ejercitan en runtime hasta que un caller los concatena con
//     WHERE/ORDER BY/LIMIT/OFFSET. Los tests unitarios tradicionales no
//     los cubren. Sin tests acá, vitest reporta "sin datos" para este
//     archivo.
//
// Limitaciones honestas (importantes al leer este test):
//   - El header de api/queries.ts documenta que el template NO agrega
//     WHERE/ORDER BY/LIMIT/OFFSET a nivel top-level — eso lo hace cada
//     caller. Por lo tanto este test NO verifica esas cláusulas.
//   - El WHERE `deleted_at IS NULL` aparece dentro del subquery del
//     LEFT JOIN LATERAL (no a nivel top-level). Eso filtra fumigaciones
//     borradas para calcular `last_fumigation_date`. El test verifica
//     que esa cláusula esté presente (sin importar dónde) porque es el
//     comportamiento crítico.
//   - djiParcelsQuery proyecta p.client_name / p.farm_name (V0-style,
//     pre-S11+ Fase 3.A). Las FKs client_id / farm_id NO se proyectan
//     en este template — los callers que las necesitan las leen de
//     otras queries. Por eso este test verifica client_name / farm_name
//     (que es lo que el archivo realmente contiene).
//   - djiParcelsMetadataQuery omite waypoints_geometry / reference_point
//     / source_url_waypoint por el límite de 2MB del unstable_cache de
//     Next 16 (ver header del archivo). El test verifica esa omisión.

import { describe, expect, it } from "vitest";
import { djiParcelsQuery, djiParcelsMetadataQuery } from "@/api/queries";

// ============================================================
// djiParcelsQuery — proyección completa
// ============================================================

describe("api/queries — djiParcelsQuery (proyección completa)", () => {
  it("1. tiene un SELECT inicial con las columnas de identidad", () => {
    expect(djiParcelsQuery).toMatch(/\bSELECT\b/i);
    expect(djiParcelsQuery).toContain("p.id");
    expect(djiParcelsQuery).toContain("p.external_id");
    expect(djiParcelsQuery).toContain("p.land_name");
    expect(djiParcelsQuery).toContain("p.declared_area_ha");
  });

  it("2. proyecta las columnas de hoja de vida (crop_type, planting_date)", () => {
    // Migration 20260722000000 — metadata editable por el supervisor.
    // Si alguien borra estas columnas del template, el detail page
    // y el geovisor divergen silenciosamente.
    expect(djiParcelsQuery).toContain("p.crop_type");
    expect(djiParcelsQuery).toContain("p.planting_date");
  });

  it("3. proyecta los identificadores V0 client_name / farm_name", () => {
    // Ver nota en el header del archivo: pre-S11+ se usan nombres
    // legibles en vez de FKs numéricas.
    expect(djiParcelsQuery).toContain("p.client_name");
    expect(djiParcelsQuery).toContain("p.farm_name");
  });

  it("4. lee desde dji_parcels con alias p", () => {
    expect(djiParcelsQuery).toMatch(/FROM\s+dji_parcels\s+p\b/i);
  });

  it("5. tiene LEFT JOIN LATERAL para la última fumigación", () => {
    // Necesario para `last_fumigation_date` y `days_since_last_fumigation`
    // que pinta el dot de cadencia en /parcels (F1.1).
    expect(djiParcelsQuery).toMatch(/LEFT JOIN LATERAL/i);
    expect(djiParcelsQuery).toContain("dji_fumigations");
    expect(djiParcelsQuery).toContain("last_fum.fumigation_date");
  });

  it("6. tiene LEFT JOIN a dji_fumigation_schedule (cadencia esperada)", () => {
    // 1:1 por la UNIQUE constraint sobre parcel_id. La columna
    // recomendada_cadence_days alimenta el cálculo de vencido vs
    // por-vencer en el panel de cadencia.
    expect(djiParcelsQuery).toMatch(/LEFT JOIN\s+dji_fumigation_schedule\b/i);
    expect(djiParcelsQuery).toContain("s.recommended_cadence_days");
  });

  it("7. filtra fumigaciones soft-deleted en el subquery lateral", () => {
    // El `deleted_at IS NULL` vive dentro del LEFT JOIN LATERAL, no
    // a nivel top-level. Garantiza que el dot de cadencia NO use
    // fumigaciones borradas por el usuario desde el admin.
    expect(djiParcelsQuery).toContain("deleted_at IS NULL");
  });

  it("8. termina con un LEFT JOIN (no con WHERE/ORDER BY/LIMIT del caller)", () => {
    // Contrato documentado en el header: el template solo proyecta
    // columnas y los LEFT JOIN. El caller concatena WHERE/ORDER
    // BY/LIMIT/OFFSET al final. Verificamos que el template cierra
    // con el JOIN (no con una cláusula top-level del caller) — eso
    // basta para detectar si alguien hardcodea un LIMIT acá.
    const trimmed = djiParcelsQuery.trimEnd();
    expect(trimmed).toMatch(/LEFT JOIN\s+dji_fumigation_schedule\s+s\s+ON\s+s\.parcel_id\s+=\s+p\.id\s*$/i);
  });
});

// ============================================================
// djiParcelsMetadataQuery — proyección liviana (cache <2MB)
// ============================================================

describe("api/queries — djiParcelsMetadataQuery (proyección liviana)", () => {
  it("9. tiene SELECT con las mismas columnas de identidad que la versión completa", () => {
    expect(djiParcelsMetadataQuery).toMatch(/\bSELECT\b/i);
    expect(djiParcelsMetadataQuery).toContain("p.id");
    expect(djiParcelsMetadataQuery).toContain("p.external_id");
    expect(djiParcelsMetadataQuery).toContain("p.land_name");
    expect(djiParcelsMetadataQuery).toContain("p.declared_area_ha");
  });

  it("10. proyecta las columnas de hoja de vida (crop_type, planting_date)", () => {
    expect(djiParcelsMetadataQuery).toContain("p.crop_type");
    expect(djiParcelsMetadataQuery).toContain("p.planting_date");
  });

  it("11. lee desde dji_parcels con alias p", () => {
    expect(djiParcelsMetadataQuery).toMatch(/FROM\s+dji_parcels\s+p\b/i);
  });

  it("12. conserva el LEFT JOIN LATERAL y el filtro de soft-delete", () => {
    expect(djiParcelsMetadataQuery).toMatch(/LEFT JOIN LATERAL/i);
    expect(djiParcelsMetadataQuery).toContain("dji_fumigations");
    expect(djiParcelsMetadataQuery).toContain("deleted_at IS NULL");
  });

  it("13. conserva el LEFT JOIN a dji_fumigation_schedule", () => {
    expect(djiParcelsMetadataQuery).toMatch(/LEFT JOIN\s+dji_fumigation_schedule\b/i);
    expect(djiParcelsMetadataQuery).toContain("s.recommended_cadence_days");
  });

  it("14. omite las columnas fuente de las geometrías pesadas", () => {
    // Razón: cache unstable_cache de Next.js 16 tiene límite 2MB por
    // item. Las geometrías pesadas (waypoints LineString 50-200 pts +
    // reference_point Point) solo las usa el re-draw del admin, que
    // tiene su propio query puntual. Verificamos las columnas fuente
    // (`p.waypoints`, `p.reference_point`) y NO los aliases — los
    // aliases sí aparecen en los comentarios `-- OMITIDO:` del
    // template, lo que haría un check de string-match dar falso
    // positivo.
    expect(djiParcelsMetadataQuery).not.toMatch(/\bp\.waypoints\b/i);
    expect(djiParcelsMetadataQuery).not.toMatch(/\bp\.reference_point\b/i);
  });

  it("14b. conserva waypoints_geometry en la versión completa (sanity)", () => {
    // Sanity check: la query completa SÍ proyecta la geometría.
    // Si alguien refactorea djiParcelsQuery y rompe esto, este test
    // lo agarra — y el test 14 lo sigue dando en limpio en metadata.
    expect(djiParcelsQuery).toContain("ST_AsGeoJSON(p.waypoints)");
    expect(djiParcelsQuery).toContain("ST_AsGeoJSON(p.reference_point)");
  });

  it("15. termina con un LEFT JOIN (no con WHERE/ORDER BY/LIMIT del caller)", () => {
    // Mismo contrato que djiParcelsQuery — los callers concatenan
    // WHERE/ORDER BY/LIMIT/OFFSET al final del template.
    const trimmed = djiParcelsMetadataQuery.trimEnd();
    expect(trimmed).toMatch(/LEFT JOIN\s+dji_fumigation_schedule\s+s\s+ON\s+s\.parcel_id\s+=\s+p\.id\s*$/i);
  });
});

// ============================================================
// Guards cross-template
// ============================================================

describe("api/queries — invariants cross-template", () => {
  it("16. ambas queries comparten el alias p en FROM", () => {
    expect(djiParcelsQuery).toMatch(/FROM\s+dji_parcels\s+p\b/i);
    expect(djiParcelsMetadataQuery).toMatch(/FROM\s+dji_parcels\s+p\b/i);
  });

  it("17. ambas queries mantienen la misma firma de cadencia (LEFT JOIN LATERAL)", () => {
    // Si divergen, el cache y el uncached devuelven shapes distintos
    // y el dashboard / detail page divergen silenciosamente.
    expect(djiParcelsQuery).toMatch(/LEFT JOIN LATERAL/i);
    expect(djiParcelsMetadataQuery).toMatch(/LEFT JOIN LATERAL/i);
  });

  it("18. ambas queries terminan sin punto y coma", () => {
    // El caller concatena WHERE/ORDER BY/LIMIT/OFFSET al final del
    // template. Un `;` antes del concat cortaría el statement y
    // silenciosamente descartaría los filtros del caller.
    expect(djiParcelsQuery.trimEnd().endsWith(";")).toBe(false);
    expect(djiParcelsMetadataQuery.trimEnd().endsWith(";")).toBe(false);
  });
});
