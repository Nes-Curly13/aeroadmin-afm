# Feature: Reportes de fumigación

> **Sprint**: feature/reports-level-1 + feature/reports-level-2
> **Fecha**: 2026-08-08 → 2026-08-09
> **Estado**: ✅ en producción (merged a master, commit `9c72fd4`)

Permite al operador fumigador generar **reportes PDF + CSV** de
fumigaciones por parcela individual o agregados por hacienda.
El PDF de parcela incluye una **imagen satelital real** (EOX Sentinel-2
cloudless 2020) renderizada server-side con MapLibre.

## Acceso

- **PDF/CSV por parcela** — botones "PDF" y "CSV" en el detail page de
  cualquier parcela (`/parcelas/[id]`).
- **Reportes por hacienda / multi-hacienda** — nueva página `/reportes`
  con filtros (rango fechas + dropdown de hacienda).

## Capturas

| # | Descripción | Archivo |
|---|---|---|
| 01 | Detail page con botones "PDF" y "CSV" en el header | `screenshots/01-detail-page-with-pdf-csv-buttons.png` |
| 02 | PDF nivel 1 (sin imagen satelital) — sub-sprint 1 | `screenshots/02-pdf-nivel1-sub1.pdf` |
| 03 | Detail page con callout "Reportes disponibles" + botones | `screenshots/03-detail-page-with-callout.png` |
| 04 | PDF nivel 1 con imagen satelital real (EOX + MapLibre) — sub-sprint 3 | `screenshots/04-pdf-nivel1-sub3-with-satellite.png` |
| 05 | Página `/reportes` — vista general (todas las haciendas) | `screenshots/05-reportes-page-general.png` |
| 06 | PDF nivel 2 — reporte general por hacienda | `screenshots/06-pdf-nivel2-general.pdf` |
| 07 | Página `/reportes` filtrada por hacienda específica | `screenshots/07-reportes-page-filtered.png` |

## Endpoints

- `GET /api/admin/parcels/[id]/report.pdf` — PDF de 1 parcela
- `GET /api/admin/parcels/[id]/report.csv` — CSV de 1 parcela
- `GET /api/admin/reports/farms/report.pdf?from=...&to=...&farm=...` — PDF multi-parcela
- `GET /api/admin/reports/farms/report.csv?from=...&to=...&farm=...` — CSV multi-parcela
- `GET /api/internal/print-map/[id]` — HTML del mapa (usado por el screenshot server-side del PDF)

Auth: `admin` o `supervisor` (mismo gate en los 4 endpoints).

## Componentes clave

- `lib/reports/fetch-parcel-report-data.ts` — data layer del reporte por parcela
- `lib/reports/fetch-farms-report-data.ts` — data layer del reporte por hacienda/general
- `lib/reports/parcel-pdf-template.ts` — template HTML self-contained
- `lib/reports/farms-pdf-template.ts` — template HTML self-contained
- `lib/reports/parcel-csv.ts` — serializer CSV (BOM, separador `;`, formato es-CO)
- `lib/reports/farms-csv.ts` — idem para farms
- `lib/reports/parcel-svg.ts` — generador de SVG vectorial del polígono (fallback)
- `lib/reports/render-pdf.ts` — wrapper de Playwright con `@sparticuz/chromium` para serverless
- `lib/reports/render-map-screenshot.ts` — screenshot del mapa MapLibre con EOX (sub-sprint 3)
- `app/api/internal/print-map/[id]/route.ts` — endpoint público con HTML del mapa

## Métricas finales

- **Tests**: 1235/1235 verde (66 nuevos en los 2 niveles)
- **Arch:check**: 0 errors
- **Archivos**: 16 nuevos, 4 modificados
- **Líneas**: ~3700

## Decisiones de producto

1. **Auth admin/supervisor** (no admin-only) — el reporte es
   read-only y el supervisor fumigador también lo necesita para
   auditoría ICA.
2. **BOM + separador `;` + formato es-CO** (coma decimal) — para
   que Excel-CO abra los CSV sin tocar nada.
3. **Imagen satelital** (no SVG) — el user pidió imagen real, no
   vectorial. Implementado con MapLibre + EOX Sentinel-2 cloudless
   2020. Fallback al SVG si EOX está caído.
4. **Cap PDF 200 fumigaciones + 50 parcelas** — operación cañera típica
   no llega al cap, pero previene PDFs de 50MB.

## Deuda técnica documentada

- `docs/audit/DOSE_FIELDS_BACKFILL.md` — `product_used` y `dose_l_per_ha`
  no se capturan del scraper DJI (limitación del backend externo).
  El form manual SÍ los captura con validación estricta. Las 640
  fumigaciones del dataset histórico DJI siguen con esos campos NULL.
  Solución a largo plazo: tabla `products` con catálogo curado + FK en
  `dji_fumigations` (sprint aparte, no incluido en este).
