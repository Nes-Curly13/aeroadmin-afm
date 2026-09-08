# AeroAdmin AFM — User Flows

> **Snapshot 2026-09-08**, master `3414c05`.
> **Source of truth**: `app/(auth)/**/page.tsx` + `components/**` + `docs/TEST-PLAN-V2.md` (test plan del operador).
> **Audience**: AI reviewer (Claude, etc.) que quiera entender qué hace el operador día a día.

---

## 0. Actores

- **Operador fumigador** (rol: `admin`): single contributor. Pilota drones + registra fumigaciones manualmente + edita metadata de fincas.
- **Supervisor** (rol: `supervisor`): read-only + puede registrar fumigaciones pero no editar metadata de fincas.
- **Dron físico** (T50 / T40 / M3M): vuela y sube data a DJI SmartFarm. Sincroniza cuando el piloto hace login en su app.
- **Sistema DJI SmartFarm**: backend coreano (`kr-ag2-api.dji.com`). Auth via Playwright headless.

## 1. Login

**Path**: `/login` (público, no AppShell)
**Files**: `app/(public)/login/page.tsx`

1. User llega a `/login` (sin AppShell, gracias al fix S10.4)
2. Form nativo HTML: `email` + `password`
3. JS fetch:
   - `GET /api/auth/csrf` → token + cookie
   - `POST /api/auth/callback/credentials` con `csrfToken` + creds
4. NextAuth valida contra `app_users.password_hash` (bcrypt)
5. Si OK: redirect a `/` (dashboard) con cookie `afm.session`
6. Si FAIL: mostrar error "Email o password incorrectos" (no revelar cuál)

**Auth flow de fondo** (proxy.ts):
- Llama `authConfig.callbacks.authorized` por cada request
- Si el path es `/login` o `/api/auth/*` → pasa
- Si no → check session, redirect a `/login` si no hay

## 2. Dashboard (/)

**Path**: `/` (AppShell)
**Files**: `app/page.tsx`

KPIs:
- Parcelas totales
- Vuelos totales (últimos 30d)
- Fumigaciones (últimas 30d)
- Hectáreas fumigadas (30d)

Paneles:
- **Cumplimiento de cadencia**: % parcelas en estado `al_dia` / `por_vencer` / `vencido` / `crítico`
- **Salud del pipeline DJI**: último run, próximas runs, fallos consecutivos
- **Lotes recientes**: últimas 24h

## 3. Geovisor (`/geovisor`)

**Path**: `/geovisor` (AppShell, QA-02 simplificado)
**Files**: `app/(auth)/geovisor/page.tsx`, `components/geovisor/geovisor-client.tsx`

Mapa MapLibre con:
- Capas toggleables: `parcels` (polígonos), `flights` (CircleMarkers), `fumigations` (eventos)
- Sidebar derecho con lista de fumigaciones filtradas por fecha
- Date range picker (default: últimos 90 días)
- Click en evento → card de detalle
- Filtros: fuente (DJI/manual/all), categoría, parcela específica, dron usado

## 4. Parcelas (`/parcelas`)

**Path**: `/parcelas` (AppShell, S10 fix — admin buttons ACÁ)
**Files**: `app/(auth)/parcelas/page.tsx`, `components/parcels/parcels-table.tsx`

Tabla con:
- Búsqueda full-text (nombre, hacienda, municipio, variedad)
- Filtro Cliente (dropdown desde `clients`)
- Filtro Estado (al_dia / por_vencer / vencido / crítico)
- Sort por name / area / last / due / events
- 7 columnas: nombre, hacienda, área, última fumigación, próxima, status chip, eventos count, fase ciclo
- Click fila → `/parcelas/[id]`

Botones admin (solo si role=admin):
- "Importar GIS" → `/admin/parcels/import`
- "Crear parcela" → `/admin/parcels/new` (form con mapa para dibujar)

## 5. Detalle de parcela (`/parcelas/[id]`)

**Path**: `/parcelas/[id]` (AppShell)
**Files**: `app/(auth)/parcelas/[id]/page.tsx`

Layout (Sprint 2026-08-01):
- Header: nombre, hacienda, cliente, municipio, área, fase ciclo, status chip
- Map card: mapa MapLibre con el polígono highlighted + fumigaciones
- Cadencia card: cadencia esperada vs observada, gaps > 60d
- Interval chart: 12 intervals más recientes
- Timeline: TODAS las fumigaciones (last_fumigation_at → ascending)
- Multi-parcela: si tiene `parcels[]`, badge "También cubrió N suertes"
- Admin: botón "Editar metadata" → `/admin/parcels/[id]/metadata`
- Admin: card "Geometría — re-dibujo manual" (TODO: hide si ya tiene geometry, ver DOC-002/UX-009)

## 6. Nueva fumigación (`/fumigaciones/nueva`)

**Path**: `/fumigaciones/nueva` (AppShell, S11+ V2 wizard de 4 steps)
**Files**: `app/(auth)/fumigaciones/nueva/page.tsx`

Wizard 4 steps (S11+ V2 plan):
1. **Mode**: elegir Importar (de DJI flight) vs Manual
2. **Pick**: si Importar → DjiFlightPicker (cards con flights recientes de la parcela, TZ Bogota, área m²→ha)
3. **Form**: RegisterFumigationForm con 13 fields (producto, dosis, área, duración, dron, vehículo, ICA, piloto, fase, etc)
4. **Confirm**: resumen read-only antes de submit

Validación zod (PR #58): `formStateSchema` valida ANTES de avanzar al step 3.

Si auto-fill (PR #53): desde el flight DJI seleccionado, pre-popula `fumigation_date`, `duration_minutes`, `area_fumigated_m2`, `drone_code_used`, `notes`.

Submit: POST `/api/admin/fumigations` con zod. Si OK → banner verde con el ID + router.refresh().

## 7. Fumigaciones lista (`/fumigaciones`)

**Path**: `/fumigaciones` (AppShell)
**Files**: `app/(auth)/fumigaciones/page.tsx`, `data-loader.tsx`, `fumigaciones-table.tsx`

Server component con filtros URL-driven:
- `?source=dji|manual|all`
- `?q=texto` (busca en product, ICA, license, notes)
- `?category=herbicida|...`
- `?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `?parcel=123&drone=72`
- `?page=1`

**Bug crítico FUM-001**: `FumigacionesDataLoader` capeado a 2,000 fumigaciones (silent truncation sobre dataset de 17k).

Bulk operations (Bloque F, 2026-08-29):
- Selección múltiple → bulk-delete / bulk-category
- "Select all" solo selecciona página actual (UX-005, mejorable)

## 8. Detalle de fumigación (`/fumigacion/[id]`)

**Path**: `/fumigacion/[id]` (AppShell, **singular** vs `/fumigaciones` plural — inconsistencia de naming)
**Files**: `app/(auth)/fumigacion/[id]/page.tsx`

Layout:
- Header: producto, fecha, parcela(s), área, duración
- Status badges: categoría, application_type, source
- Mapa: centroide del JOIN de flights
- Flight list: vuelos que generaron la fumigación
- Multi-parcela: si `parcels[]` secundario, lista de suertes
- Audit trail: timeline de cambios (created/edited/deleted/restored)
- Invoices: facturas asociadas (si hay)
- Admin: botón "Editar" → `/fumigacion/[id]/edit`
- Admin: botón "Eliminar" (soft-delete con confirmación)

## 9. Editar fumigación (`/fumigacion/[id]/edit`)

**Path**: `/fumigacion/[id]/edit` (AppShell)
**Files**: `app/(auth)/fumigacion/[id]/edit/page.tsx`

Mismo `RegisterFumigationForm` en `mode="edit"`. Inicializa con `initialFumigation`. PATCH en lugar de POST.

Inmutables: `parcel_id`, `source`, `recorded_by`, `flight_ids`, `recorded_at`.

Si rol no es admin/supervisor: muestra card "Sin permisos para editar" con botón "Volver a fumigaciones". **No muestra el detail como read-only** (UX-002 del review).

## 10. Reportes (`/reportes`)

**Path**: `/reportes` (AppShell, QA-14 refactor con tabs)
**Files**: `app/(auth)/reportes/page.tsx`, `components/reports/`

3 tabs:
- **Resumen**: KPIs globales
- **Por hacienda**: agrupado por client/farm
- **Detalle**: tabla con fumigaciones + filtros

Quick-range buttons: 7d / 30d / 90d / Mes / Año. **Deuda S10.5 #5**: verificar que los exports CSV/PDF respeten el rango (issue separado).

Exports:
- CSV (39 cols, cap 50k rows)
- PDF (Chromium, puede fallar en dev)

## 11. Data quality (`/admin/calidad`)

**Path**: `/admin/calidad` (AppShell, admin only)
**Files**: `app/(auth)/admin/calidad/page.tsx`

Lee `/api/data-quality/invariants` que reporta 5 patrones:
1. Parcela sin cliente
2. Parcela sin finca
3. Parcela sin ciclo activo
4. Fumigación en ciclo cerrado
5. Ciclo sin phase_rule

## 12. Admin GIS import (`/admin/parcels/import`)

**Path**: `/admin/parcels/import` (AppShell, admin)
**Files**: `app/(auth)/admin/parcels/import/page.tsx`

Wizard 3 steps:
1. Upload archivo (KML/SHP/GPKG, max 5MB)
2. **Preview**: muestra las fincas que se importarán, conteo, errores
3. **Commit**: `POST /api/admin/parcels/import/commit` con el ID del batch

Solo si previsualización está OK.

## 13. Crear parcela manual (`/admin/parcels/new`)

**Path**: `/admin/parcels/new` (AppShell, admin)
**Files**: `app/(auth)/admin/parcels/new/page.tsx`

Form + mapa. El operador dibuja el polígono en el mapa (MapLibre + terra-draw), llena metadata. Submit crea la parcela con `source = 'manual'`.

QA-12 rediseño: toolbar flotante con Dibujar/Editar/Limpiar/Undo/Redo + search Nominatim + toggle basemap (Satélite/Híbrido/Callejero).

## 14. Auth + roles (cross-cutting)

`getViewerRole()` de `lib/auth/role.ts` decide qué ve cada user:
- `admin`: ve botones admin (Importar GIS, Crear parcela, Editar metadata, Bulk ops en fumigaciones)
- `supervisor`: ve read-only + puede registrar fumigaciones manuales

Helpers: `requireRole(['admin', 'supervisor'])` en route handlers, `getViewerRole()` en pages.

## 15. Resumen de paths

| Path | Auth | Página principal |
|---|---|---|
| `/login` | público | Login |
| `/` | AppShell | Dashboard |
| `/geovisor` | AppShell | Geovisor (mapa) |
| `/parcelas` | AppShell | Inventario |
| `/parcelas/[id]` | AppShell | Detalle de finca |
| `/fumigaciones` | AppShell | Lista de fumigaciones |
| `/fumigaciones/nueva` | AppShell | Wizard 4 steps |
| `/fumigacion/[id]` | AppShell | Detalle de fumigación (singular!) |
| `/fumigacion/[id]/edit` | AppShell | Editar fumigación |
| `/reportes` | AppShell | Reportes (3 tabs) |
| `/admin/calidad` | admin | Data quality |
| `/admin/parcels/new` | admin | Crear parcela manual |
| `/admin/parcels/import` | admin | Import GIS |
| `/admin/parcels/[id]/metadata` | admin | Editar metadata |

---

**Para implementar cambios**: leer primero `docs/REVIEW-PARCELAS-FUMIGACIONES.md` (4 P0 + 7 P1 + 8 P2), después `docs/DATA-MODEL.md` + `docs/API-INVENTORY.md` para entender las reglas.
