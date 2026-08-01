# scripts/_archive/2026-Q1-Q2-debug/

> Scripts de debug/diagnóstico que ya cumplieron su propósito.
> Archivados el 2026-08-01 durante la limpieza del sprint S6.7.
> No se referencian desde `package.json` ni desde código de producción
> (verificado con grep antes de archivar).

## Tabla de archivos → bug que resolvió → sprint

| Script | Categoría | Bug que resolvió | Sprint | Notas |
|---|---|---|---|---|
| `align-docker-inspect.js` | Align (Docker→Supabase) | Inspeccionaba diferencias de schema docker vs Supabase antes de la migración | s3 (2026-04) | Usar `apply-migrations-to-docker.js` ahora |
| `align-docker-list-fks.js` | Align | Listaba FKs para diagnosticar orden de drop | s3 | |
| `align-docker-step1-add-columns.js` | Align | Step 1: agregar columnas faltantes a Docker antes de migrar | s3 | |
| `align-docker-step2-alter-types.js` | Align | Step 2: alter types en Docker | s3 | |
| `align-docker-step3-verify.js` | Align | Step 3: verificar que Docker == Supabase | s3 | |
| `align-docker-step3b-fix-remainder.js` | Align | Step 3b: fix manual de filas remanentes que no pasaron verify | s3 | |
| `capture-aggr-from-records.js` | Capture | Convertía `debug-records-responses.json` → formato legible | s4 | Dependía de `debug-records-responses.js` |
| `debug-aggr-response.js` | Debug | Dump del response de `aggr_by_day` para entender shape | s4 | Ver docs/audit/BITACORA.md §4 |
| `debug-records-responses.js` | Debug | Capturaba responses de records para inspección manual | s4 | |
| `decode-make-canvas.mjs` | One-off | **BORRADO** (2026-08-01). Decodificaba `canvas.fig` de Make.com una vez. | s4 (V0) | |
| `diag-5-random-side-by-side.js` | Diagnóstico | Comparaba 5 parcelas side-by-side (docker vs supabase) | s3 | |
| `diag-batches-seq.js` | Diagnóstico | Investigaba el sequence drift de `dji_import_batches` | s3 | |
| `diag-bbox-vs-polygon.js` | Diagnóstico | Comparaba bbox vs polígono real de parcelas | s5 (map) | |
| `diag-bd-state.js` | Diagnóstico | Estado general de la BD (counts por tabla) | s3 | Usar `dashboard-queries.js` o psql directo |
| `diag-compare-docker-supabase.js` | Diagnóstico | Diff docker vs supabase (counts + sample rows) | s3 | |
| `diag-constraint.js` | Diagnóstico | Investigaba una constraint violation específica | s3 | |
| `diag-debug-diff-function.js` | Diagnóstico | Debug de una función de diff que producía rows diferentes | s3 | |
| `diag-debug-diffs.js` | Diagnóstico | Iteración de diffs en la migración docker→supabase | s3 | |
| `diag-dji-drone-models.js` | Diagnóstico | Investigaba valores de `drone_model_name` en flights | s3 | |
| `diag-docker-state.js` | Diagnóstico | Estado del contenedor Docker (logs, espacio) | s3 | Usar `docker compose ps` ahora |
| `diag-failing-test.js` | Diagnóstico | Investigaba un test que fallaba intermittentemente | s4 | |
| `diag-final-areas.js` | Diagnóstico | Verificaba cálculo de áreas fumigadas finales | s3 | |
| `diag-final-counts.js` | Diagnóstico | Counts finales después de la migración docker→supabase | s3 | |
| `diag-guachisona-row.js` | Diagnóstico | Investigaba una fila específica de Guachisona (parcela de test) | s3 | |
| `diag-history-dupes.js` | Diagnóstico | Duplicados en `dji_history_*` tables | s4 (fumigation) | |
| `diag-history-full-flow.js` | Diagnóstico | Reproducir el flow completo de history (insert→update→select) | s4 | |
| `diag-history-insert-test.js` | Diagnóstico | Probar inserts en `dji_history_*` con varios shapes | s4 | |
| `diag-history-nullable.js` | Diagnóstico | Investigaba campos nullable en history tables | s4 | |
| `diag-indexes.js` | Diagnóstico | Listaba indexes de la BD (para investigar query plans) | s3 | |
| `diag-land-name-null.js` | Diagnóstico | Filas con `land_name = NULL` en dji_parcels | s4 | |
| `diag-migrations.js` | Diagnóstico | Estado de la tabla `dji_migrations` (qué se aplicó, qué no) | s3 | Usar `npm run db:migrate` ahora |
| `diag-migration-scope.js` | Diagnóstico | Scope de la migration X (cuántas filas afecta) | s3 | |
| `diag-missing-parcels.js` | Diagnóstico | Parcelas con flights pero sin parcela asignada | s3 (spatial) | Usar `spatial-join-flights-parcels.js` ahora |
| `diag-mystery.js` / `diag-mystery2.js` / `diag-mystery3.js` / `diag-mystery4.js` | Diagnóstico | 4 iteraciones de debugging de un bug que empezó como mystery | s3-s4 | Resuelto, ver BITACORA |
| `diag-no-buffer.js` | Diagnóstico | Reproducir un bug sin buffers intermedios | s3 | |
| `diag-one.js` | Diagnóstico | Inspeccionar 1 fila específica (genérico, ad-hoc) | s3 | |
| `diag-one-parcel.js` | Diagnóstico | Inspeccionar 1 parcela específica (genérico) | s3 | |
| `diag-orchard-conflict.js` | Diagnóstico | Conflict entre field_type=Orchard vs Farmland en una parcela | s4 | |
| `diag-orphan-debug.js` | Diagnóstico | Debug de parcelas huérfanas (sin geometry) | s5 (map) | |
| `diag-orphan-meta.js` | Diagnóstico | Huérfanas a nivel metadata | s5 | |
| `diag-orphan-notes.js` | Diagnóstico | Huérfanas que solo tenían notes | s5 | |
| `diag-orphan-spatial.js` | Diagnóstico | Huérfanas después del spatial join | s3 | |
| `diag-orphans.js` | Diagnóstico | Listado de todas las parcelas huérfanas | s5 | |
| `diag-parcel-map.js` | Diagnóstico | Estado del mapa de una parcela (geometry, layers) | s5 (map) | |
| `diag-parcels.js` | Diagnóstico | Estado general de `dji_parcels` | s3 | |
| `diag-parcels-schema.js` | Diagnóstico | Schema real de `dji_parcels` vs lo esperado por el código | s3 | |
| `diag-polygons-offline.js` | Diagnóstico | Generaba polígonos de prueba offline (sin servidor) | s5 (map) | |
| `diag-polygons-shape.js` | Diagnóstico | Validar shape de polígonos (válidos, no degenerados) | s5 | |
| `diag-polygons-vs-source.js` | Diagnóstico | Comparar polígonos derivados vs polígonos fuente (kml) | s5 | |
| `diag-source-area.js` | Diagnóstico | Área source vs área reportada por DJI | s3 | |
| `diag-spraygeom-vs-source.js` | Diagnóstico | Spray geometry vs source KML | s5 | |
| `diag-test-update.js` | Diagnóstico | Investigaba un UPDATE que afectaba 0 rows | s4 | |
| `diag-v0.js` | Diagnóstico | Verificar shape V0 en una parcela específica | s6 (V0) | |
| `diag-validate-docker.js` | Diagnóstico | Validar estado de Docker antes de hacer un backfill | s3 | |
| `diag-zero-area.js` | Diagnóstico | Filas con `area = 0` en flights | s3 | |
| `diagnose-parcel-geometry.js` | Diagnóstico | Investigaba geometría inválida de una parcela | s5 (map) | |
| `migrate-docker-to-supabase.js` | Migración (one-shot) | v1 de la migración docker→supabase (reemplazada por v2) | s3 | Usar `apply-migrations-to-docker.js` |
| `migrate-v2-docker-to-supabase.js` | Migración (one-shot) | v2 (mejorada) de la migración docker→supabase | s3 | Ya corrió, no re-correr |
| `reset-supabase-pre-migrate.js` | Reset (one-shot) | Reset de Supabase antes de la migración | s3 | NO correr sin consultar antes |
| `scan-decoded.mjs` | One-off | Scan de binarios decoded de Make.com (analizar estructura) | s4 (V0) | |
| `simulate-v0-export.js` | One-off | Simulaba un export V0 insertando en docker+supabase | s5 (V0) | |
| `sync-polygons-to-supabase.js` | Sync (one-shot) | Sync manual de polígonos a Supabase | s5 (map) | |
| `sync-param-waypoint-to-supabase.js` | Sync (one-shot) | Sync manual de param/waypoint data | s5 | |
| `verify-migration.js` | Verificación (one-shot) | v1 del verify post-migración | s3 | Reemplazado por `verify-migration-final.js` |
| `verify-migration-final.js` | Verificación (one-shot) | v2 del verify post-migración | s3 | |
| `verify-unique-external-id.js` | Verificación (one-shot) | Verificar constraint UNIQUE de external_id en dji_parcels | s3 | |

## Cómo buscar un script de debug antiguo

1. Si tenés un error específico: `grep -r "nombre-del-script" docs/audit/BITACORA.md`
2. Si querés reproducir un bug histórico: leé el comentario de cabecera del script
3. Si necesitás re-correr un script: **NO lo corras directamente** — los scripts one-shot asumen estados de BD que ya no aplican. Leé el script, entendé qué hacía, y escribí una nueva versión que use el código actual.

## Política de retención

- **Mínimo 6 meses** desde la fecha de archivo (2026-08-01 → 2027-02-01).
- Después, evaluar borrar los que no se referencien en ningún doc y no tengan un test o reproducer asociado.
- Antes de borrar, mover a `scripts/_archive/2026-Q1-Q2-debug/ATTIC/` con un commit que explique por qué se borró.

## Qué se mantuvo en `scripts/`

Ver `scripts/README.md` para la lista actual de scripts operacionales.
