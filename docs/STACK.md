# AeroAdmin AFM — Resumen técnico del stack y features

> Documento vivo. Snapshot al 2026-07-28 (post-S5: MapLibre + V0 port).
> Repo: `C:\dev\DroneFlightAFM` (movido fuera de OneDrive el 2026-07-13).
> Rama: `main`. Sin remote (riesgo histórico; ver `docs/audit/BITACORA.md`).

---

## 1. Producto

Panel administrativo / SIG interno para un operador de fumigación con drones
**DJI Agras** en el Valle del Cauca, Colombia. Lo que hace:

- Ingesta datos crudos de DJI AG (frontend coreano) vía scraping con Playwright.
- Modela la operación como **parcelas fumigadas** + **vuelos** + **eventos de fumigación**
  con geometría PostGIS.
- Renderiza un **mapa GIS** (Leaflet) con los polígonos fumigados y los polígonos de planes DJI.
- Calcula **alertas** (alta/media/baja) según área trabajada y frecuencia.
- Lleva un **historial de tareas** (Task History) con rollup diario, KPIs y mapa
  de parcelas fumigadas en el rango seleccionado.
- Maneja una **cadencia esperada** de fumigación por cultivo, con next-due automático
  tras registrar un evento.

**Lo que NO es**: consola de piloto, app DJI embebida, SaaS multi-tenant (todavía).

---

## 2. Stack

### 2.1 Frontend

| Capa | Tecnología | Versión | Notas |
|---|---|---|---|
| Framework | **Next.js** (App Router) | `16.2.4` | React Server Components por defecto, route handlers en `app/api/*` |
| UI runtime | **React** | `19.2.5` | Client components solo cuando hay interactividad |
| Lenguaje | **TypeScript** | `5.9.3` | `strict`, sin `any` en código de producto |
| Estilos | **Tailwind CSS v4** + PostCSS | `4.2.4` | Hex inline + tokens semánticos en `lib/ui-tokens.ts` |
| **Primitives UI** | **propios en `components/ui/`** (shadcn-style) | – | Patrón shadcn replicado a mano: `cn()` (clsx + tailwind-merge), `data-slot`, `useId()`, CVA cuando hace falta. Primitives: `PageHeader`, `FieldSelect`, `ToggleButton`, `Switch`, `KpiPill`, `FilterSidebar` + `FilterSidebarSection`, `MetricCard`, `BentoGrid`, `EmptyState`, `Pagination`, `ScrollablePanel`. Ver `docs/TDD.md` §2. |
| **Primitives reservado** | **@base-ui/react** | `^1.6.0` | Instalado pero **no usado en runtime** todavía. Reservado para primitives no triviales (Slider doble, Combobox, Dialog con focus trap). Decisión: NO adoptar shadcn CLI (ver `docs/V0_ADAPTATION.md` §4.1). |
| Tipografía | **Inter** (Google Fonts) | – | Pesos 400/500/600/700/800/900 |
| Iconos | `lucide-react` | `^1.27.0` | Tree-shakeable, `aria-hidden` en decorativos |
| Mapa | **MapLibre GL JS** | `6.0.0` | **Sustituye a Leaflet desde S5** (Leaflet + react-leaflet eliminados). Wrapper en `components/map/maplibre-view.tsx` (cargado via `next/dynamic` con `ssr: false`). Patrón shadcn-style con paint expressions inline, `feature-state` para selección, `setStyle` re-add layers. Migración de mini-mapa y task-history también cubiertas. |
| Auth cliente | **NextAuth v5** (beta) | `5.0.0-beta.31` | JWT strategy, cookie `afm.session` |

### 2.2 Backend (Next.js route handlers + scripts)

| Capa | Tecnología | Notas |
|---|---|---|
| HTTP | Next.js Route Handlers (`app/api/*/route.ts`) | `export const dynamic = "force-dynamic"` en todo |
| DB driver | **`pg`** `8.20.0` (node-postgres) | Pool singleton, NUMERIC/INT8 → `number` via type parsers |
| Auth | NextAuth Credentials + **bcryptjs** | Hash puro JS, edge-safe (no `bcrypt` nativo) |
| Validación | Helpers locales (`lib/request.ts` → `parseIntParam`) | Sin Zod, parsing manual en route handlers |
| Caching | `unstable_cache` + `revalidateTag` (`lib/cache.ts`) | Tags por dominio: `parcels`, `flights`, `alerts`, `dashboard` |
| Middleware | `proxy.ts` (Edge) | Importa solo `lib/auth.config.ts` (edge-safe, sin bcrypt) |

### 2.3 Base de datos

| Capa | Tecnología | Notas |
|---|---|---|
| Motor | **PostgreSQL 16 + PostGIS 3.4** | Docker local (`postgis/postgis:16-3.4`) **y** Supabase gestionado |
| Driver | `pg` con SSL opcional | `DATABASE_URL` (pooled) + `DATABASE_URL_DIRECT` (admin) |
| Migrations | `supabase/migrations/*.sql` | `npm run db:migrate` aplica pendientes (idempotente) |
| Geometría | `geometry(MultiPolygon, 4326)`, `geometry(Point, 4326)`, `geometry(MultiPoint, 4326)` | GIST indexes en `spray_geom`, `waypoints`, `reference_point` |
| Conexión local | `localhost:5432`, db `afm_flights`, user `postgres`/`postgres` | (Puerto 5432 = AFM, vs TerraSight en 5433) |

### 2.4 Datos externos (DJI)

| Capa | Tecnología | Notas |
|---|---|---|
| Scraper frontend | **Playwright** `1.49.0` | Dos scrapers: v2 (`scrape_djiag_records.js`) y v3 (`scrape_djiag_perflight.js`) |
| Backend DJI | `kr-ag2-api.dji.com` (zh-CN) | Locale `zh-CN` obligatorio o el query `?name=lands` devuelve vacío |
| Auth DJI | JWT en `localStorage.x-auth-token` | Reusar sesión 7 días (`lib/djiag-storage.js`) |
| Storage local | `djiag_exports/*.json` | Capturas incrementales; resume automático si se interrumpe |
| Download assets | `playwright` + GraphQL HMAC | `lib/djiag-asset-downloader.js` con shim `.d.ts` |

### 2.5 Testing & QA

| Capa | Tecnología | Notas |
|---|---|---|
| Unit/component | **Vitest** `3.2.4` + **jsdom** `29.1.1` | `@testing-library/react` 16, `@testing-library/jest-dom`, `user-event` |
| E2E | **Playwright** `@playwright/test` `1.61.1` | Suites: `auth-and-dashboard`, `map-and-history` |
| Fixtures DJI | `tests/fixtures/djiag-live/` | Capturas reales del operador (`npm run capture:djiag:*`) |
| DB smoke | `scripts/smoke-test-db.js` | 8 aserciones sobre estado actual de la BD |

### 2.6 Tooling

- **Node.js** `>=22.0.0` (engines en `package.json`).
- **npm** como package manager (hay `package-lock.json`, no `pnpm-lock`).
- **PowerShell** como shell en dev (ver gotchas de JSON largo en memoria).
- **Docker Compose** solo para PostGIS local.

---

## 3. Estructura del proyecto

```
DroneFlightAFM/
├── app/                          # Next.js App Router
│   ├── api/                      # Route handlers (server-only)
│   │   ├── auth/[...nextauth]/   # NextAuth handler
│   │   ├── auth/change-password/
│   │   ├── parcels/[id]/         # GET / PUT
│   │   ├── parcels/normalized/   # Lista normalizada para UI
│   │   ├── flights/              # Lista de vuelos
│   │   ├── fumigations/          # CRUD eventos fumigación
│   │   ├── fumigations/upcoming/ # Próximas fumigaciones (cadencia)
│   │   ├── fumigation-schedule/[parcelId]/
│   │   ├── task-history/         # Snapshot rollup por día + polygons
│   │   ├── map/summary/          # v2.0: summary live (KpiPill) para TimeRange
│   │   └── alerts/
│   ├── page.tsx                  # Dashboard
│   ├── map/page.tsx              # Mapa (orquesta data + renderiza MapPageClient)
│   ├── history/page.tsx          # Historial plano
│   ├── task-history/             # Task History (Figma frame B)
│   │   ├── page.tsx              # Server component, orquesta data
│   │   └── TaskHistoryClient.tsx # Client component interactivo
│   ├── parcels/[id]/page.tsx     # Detalle parcela
│   ├── devices/page.tsx
│   ├── login/                    # Server action + form
│   ├── layout.tsx
│   ├── error.tsx
│   ├── loading.tsx
│   └── not-found.tsx
├── components/                   # React components
│   ├── app-shell.tsx             # Sidebar + header (server)
│   ├── map-view.tsx              # Wrapper next/dynamic de MapLibreView (ssr:false)
│   ├── metric-card.tsx           # Shim deprecado que re-exporta ui/metric-card
│   ├── dashboard/                # alerts-panel, operations-panel,
│   │                             # operations-summary, recent-flights-list,
│   │                             # upcoming-fumigations
│   ├── map/                      # v2.0 (S5): map-page-client (orquestador),
│   │                             # maplibre-view (WebGL), map-filter-sidebar
│   │                             # (drawer colapsable), map-legend, parcels-list
│   │                             # (rail), parcel-detail-panel, parcel-selector,
│   │                             # parcel-search, time-range (slider+histograma),
│   │                             # map-stats-island, map-stats-skeleton
│   ├── history/history-table.tsx
│   ├── parcels/                  # parcel-detail, parcel-edit-panel,
│   │                             # parcel-fumigations, parcel-mini-map (MapLibre),
│   │                             # cadence-editor
│   ├── devices/device-grid.tsx
│   ├── task-history/             # date-range-picker, day-card, day-list,
│   │                             # filter-button, header-card, map-view (MapLibre),
│   │                             # metrics-grid, screenshot-button, tab-switcher
│   ├── ui/                       # Primitives accesibles (shadcn-style):
│   │                             # page-header, field-select, toggle-button,
│   │                             # switch, kpi-pill, filter-sidebar (+ section),
│   │                             # metric-card, bento-grid, empty-state,
│   │                             # pagination, scrollable-panel
├── lib/                          # Lógica de negocio y helpers
│   ├── db.ts                     # Pool pg + type parsers
│   ├── auth.ts, auth.config.ts   # NextAuth (Node + edge)
│   ├── cache.ts                  # unstable_cache + tags
│   ├── alerts.ts                 # Reglas de alerta (area_mu, times_count)
│   ├── devices.ts
│   ├── format.ts                 # date/area/duration formatting
│   ├── request.ts                # parseIntParam
│   ├── types.ts                  # Records: DjiParcelRecord, DjiFlightRecord,
│   │                             # DjiAlertRecord, DjiFumigationEvent, etc.
│   ├── ui-tokens.ts              # Colores, spacing, surfaces
│   ├── fumigation-cadence.ts     # Lógica de cadencia y next_due_date
│   ├── fumigation-cadence-config # .js + .d.ts, generado desde JSON
│   ├── map-styles.ts             # Polygon/alert PathOptions puros (M3-M5)
│   ├── flight-plan.ts            # waypointsToFlightPlan (MultiPoint → LineString)
│   ├── flight-plan-styles.ts     # Polyline pathOptions dashed cyan (M3-M5)
│   └── map-parcel-content.ts     # hover/popup/a11y helpers + bindParcelLayerInteractions
│   ├── dji-flights-aggregate.ts  # Rollup dji_flights → dji_daily_summaries shape
│   ├── djiag-from-make/          # field-management.ts, task-history.ts,
│   │                             # index.ts (capa de normalización)
│   ├── djiag-spatial-aggregator.ts # Polígonos fumigados en rango
│   ├── djiag-storage.js          # Storage state freshness (7 días)
│   ├── djiag-korean-client.js    # Login + locale trap + GraphQL
│   ├── djiag-*-fetcher.js        # Parsers puros por entidad
│   ├── djiag-graphql-queries.js  # Strings GraphQL (whitespace-sensitive)
│   ├── djiag-graphql-types.d.ts  # Tipos de respuesta
│   ├── djiag-asset-downloader.js
│   ├── djiag-lands-to-parcels.js
│   └── playwright-scroll.js      # scrollUntilStagnant (Ant Design)
├── api/
│   └── repositories.ts           # Data-access: 1 archivo compartido por
│                                 # page server + route handler + scripts
├── db/
│   ├── schema.sql                # Modelo canónico (no usado en runtime)
│   └── seed.sql                  # Demo data
├── supabase/
│   ├── config.toml
│   ├── migrations/               # 14 migrations (2026-04-28 → 2026-07-11)
│   └── seed.sql
├── scripts/                      # CLI: 30+ scripts Node
│   ├── run-pipeline.js           # Wrapper: scrape → upsert → spatial-join → backfill
│   ├── apply-pending-migrations.js
│   ├── apply-schema.js
│   ├── upsert-flights-from-djiag.js
│   ├── upsert-fumigations-from-djiag.js
│   ├── upsert-lands-from-djiag.js
│   ├── spatial-join-flights-parcels.js   # dji_flights.parcel_id ← spray_geom
│   ├── backfill-fumigations-from-flights.js
│   ├── update-fumigation-schedule.js
│   ├── aggregate-daily-summaries.mjs
│   ├── fetch-lands-from-djiag.js
│   ├── fetch-fumigations-from-djiag.js
│   ├── download-land-assets.js
│   ├── capture-*.js              # Capturan fixtures para tests
│   ├── print-*.js                # Pretty-print de exports
│   ├── seed-admin-user.js, seed-cadences.js
│   ├── smoke-test-db.js
│   ├── db-check.js, db-validate.js, db-constraints-stress.js
│   ├── diag-*.js                 # Diagnóstico puntual
│   └── ...
├── tests/                        # Vitest (unit + component) + Playwright (e2e)
│   ├── setup.ts
│   ├── alerts.test.ts
│   ├── api-routes.test.ts
│   ├── api-task-history.test.ts
│   ├── auth.test.ts
│   ├── backfill-fumigations*.test.ts
│   ├── cache.test.ts
│   ├── dji-flights-aggregate.test.ts
│   ├── djiag-*.test.ts           # Parsers + storage + fetcher
│   ├── fetch-lands-direct.test.ts
│   ├── format-to-date-string.test.ts
│   ├── fumigation-cadence*.test.ts
│   ├── map-view-flight-points.test.tsx
│   ├── parcels-normalized.test.ts
│   ├── request.test.ts
│   ├── smoke.test.tsx
│   ├── spatial-join-flights-parcels.test.ts
│   ├── upsert-flights-from-djiag.test.ts
│   ├── upsert-lands-from-djiag.test.ts
│   ├── user-story-dashboard-e2e.test.ts
│   ├── components/               # ~25 archivos de component tests
│   ├── e2e/                      # Playwright: auth-and-dashboard,
│   │                             # map-and-history, global-setup
│   ├── fixtures/djiag-live/      # Capturas reales del operador
│   └── lib/ui-tokens.test.ts
├── types/
│   └── next-auth.d.ts            # Augmentation del JWT/Session
├── config/
│   └── fumigation-cadences.json  # Defaults por crop / drone / parcel
├── docs/
│   ├── SPEC.md                   # Decisiones de producto del refactor
│   ├── DJI_SCRAPER.md            # Gotchas del scraper
│   ├── DJI_AREA_UNITS.md         # Conversiones MU, ha, m²
│   ├── FUMIGATION_CADENCE.md     # Cadencias por cultivo (fuente)
│   ├── SCRAPER_DEFECTS.md        # Bitácora de defectos DJI
│   ├── STACK.md                  # ESTE DOCUMENTO
│   ├── assets/                   # Prototipos visuales
│   └── audit/                    # BITACORA.md, figma-vs-bd.md
├── make/                         # (vacío, legado)
├── public/                       # Assets estáticos, logo.svg
├── proxy.ts                      # Middleware (Edge runtime)
├── next.config.ts                # Security headers
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── docker-compose.yml
├── .env.example, .env.local
├── package.json
└── README.md
```

---

## 4. Modelo de datos (PostGIS)

> **Convenciones**:
> - Geometrías en SRID 4326 (WGS84).
> - Fechas DATE en `America/Bogota` (Colombia) — conversiones en `lib/format.ts`.
> - `dji_*` = datos crudos/importados de DJI; `*_summary`/`flights` = modelos operativos.

### 4.1 Tablas core (modelo operativo)

| Tabla | Propósito | Campos clave |
|---|---|---|
| `clients` | Tenants del operador (1 cliente hoy) | `id, name, contact` |
| `parcels` | Parcelas agrícolas (modelo demo) | `id, client_id, name, crop_type, planting_date, geom (MultiPolygon)` |
| `flights` | Vuelos de fumigación demo | `id, parcel_id, date, area_covered, image_url, footprint (Polygon)` |

### 4.2 Tablas DJI (modelo importado, normalizado)

| Tabla | Filas | Propósito |
|---|---|---|
| `dji_import_batches` | N | Cabecera de cada corrida del scraper |
| `dji_drone_models` | 4 | Lookup: code → name (T16/T20, T40/T50, T70, Sin asignar) |
| **`dji_parcels`** | **1207** | 1 fila por campo fumigable (modelo normalizado). Campos: `external_id, land_name, field_type, declared_area_ha, spray_area_m2, drone_model_code, spray_width_m, work_speed_mps, optimal_heading_deg, radar_height_m, edge_offset_m, obstacle_offset_m, climb_height_m, no_spray_zone_m2, droplet_size, sweep_direction, is_orchard, uses_side_spray, spray_geom (MultiPolygon), reference_point (Point), waypoints (MultiPoint), waypoint_count, raw_* (JSONB)` |
| `dji_fumigation_schedule` | 1 por parcela | Cadencia: `crop_type, recommended_cadence_days, last_fumigation_date, next_due_date, is_active, notes` |
| **`dji_fumigations`** | N | Eventos realizados: `parcel_id, fumigation_date, product_used, dose_l_per_ha, area_fumigated_m2, drone_code_used, duration_minutes, notes, recorded_by, source ('manual'|'djiscraper'|'import')` |
| **`dji_flights`** | ~7050/30d | Sorties individuales: `flight_id, start_at, end_at, duration_seconds, area_m2, spray_usage_ml, drone_nickname, drone_serial, pilot_name, parcel_id, location, lat, lng, raw_*` |

> **GIST indexes** en `dji_parcels.spray_geom`, `dji_parcels.waypoints`,
> `dji_parcels.reference_point`, `dji_flights.parcel_id`, `parcels.geom`,
> `flights.footprint`. El spatial-join flights × parcels
> (`scripts/spatial-join-flights-parcels.js`) usa `ST_DWithin(geom, point, tolerance)`
> con `--tolerance 10000` para matching permisivo (10 km).

### 4.3 Tablas app (auth + data quality)

| Tabla | Propósito |
|---|---|
| `app_users` | Usuarios del panel (Sprint 3, migración `20260628150000`) |
| Data quality checks | Constraints y validaciones (migración `20260707000000`) |

### 4.4 Tablas removidas (legacy, ya droppeadas)

- `dji_field_catalog` (catálogo duplicado) — drop en `20260628100001`
- `dji_land_assets` y `dji_daily_summaries` — snapshot a `dji_legacy_snapshot`
  y drop en `20260628120000`. `dji_daily_summaries` quedó **reemplazada**
  por rollup on-the-fly desde `dji_flights` vía `lib/dji-flights-aggregate.ts`
  con TZ `America/Bogota`.

### 4.5 Constraints clave

- `dji_parcels (batch_id, external_id)` UNIQUE
- `dji_fumigation_schedule.parcel_id` UNIQUE
- `dji_fumigation_schedule` CHECK `recommended_cadence_days > 0`
- `dji_fumigations.source` CHECK IN ('manual','djiscraper','import')
- `dji_flights` con índice point en `location` (GIST) desde `20260628100000`

---

## 5. Features

### 5.1 Dashboard (`/`)

Server component que renderiza:
- 4 KPIs limpios (header): total vuelos, área cubierta, alertas altas, total parcelas.
- `OperationsSummary` (panel oscuro "Reporte 2026", único — sin duplicar KPIs).
- `RecentFlightsList` (con filtro por alerta + export CSV).
- `AlertsPanel` (panel lateral con filtro por severidad).
- `UpcomingFumigations` (próximas fumigaciones según cadencia).
- `AppShell` con sidebar (`Panel`, `Mapa`, `Historial`, `Dispositivos`)
  y bloque "Estado actual" (parcelas + alertas altas).

### 5.2 Mapa (`/map`)

Server component (`app/map/page.tsx`) que orquesta data y delega a
`components/map/map-page-client.tsx` ("use client", v2.0 — sprint S5).
Layout: header compacto (logo + título + chip "X Parcelas" + botón "Filtros") + body
flex-row (mobile → flex-col) con mapa a la izquierda y rail derecho con `ParcelsList`.

**Mapa (MapLibre GL JS 6.0 — sustituye a Leaflet desde S5)**:
- Wrapper `components/map-view.tsx` carga `MapLibreView` via `next/dynamic` con
  `ssr: false` (MapLibre usa WebGL, es client-only).
- Setup: `import("maplibre-gl")` dinámico, `addControl` Navigation + Scale,
  `style.load` para agregar sources/layers.
- **5 capas toggleables** (todas visibles por default; flags via props):
  - `parcels` — fill + line + label (symbol). `feature-state.selected` para
    highlight. `fumigated` property computada de `fumigatedParcelIds` (Set<number>).
  - `waypoints` — circle de cada waypoint del plan DJI.
  - `flight-plan` — line dashed conectando waypoints en orden.
  - `alerts` — fill + line con color por `level` (HIGH/MEDIUM/LOW).
  - `flight-points` — circle por sortie, color por `status` (in_progress / completed).
- **Basemap toggle** (Satélite / Calles) persistido en `localStorage` (`afm:map:basemap`).
  El `setStyle` borra sources/layers → re-add via `addLayersToExistingMap()` en
  `style.load` callback.
- **Selección**: `map.setFeatureState({ source: "parcels", id }, { selected: true })` +
  `map.flyTo({ center, zoom: 15 })` en `maplibre-view.tsx`. Limpieza previa con
  `map.removeFeatureState({ source: "parcels" })`.
- **Popups HTML sanitizados** (`escapeHtml` en `maplibre-view.tsx`).
- **fitBounds automático** al cargar si `autoFit=true` (default).
- **a11y**: `<div role="application" tabIndex={0} aria-label="Mapa de parcelas de caña">`.

**KPI overlay pill** (`components/ui/kpi-pill.tsx`, sobre el mapa, esquina sup. izq.):
- 4 KPIs en una pill horizontal dividida: Aplicaciones / Hectáreas tratadas / Volumen / Vuelos.
- Usa `liveSummary` (state) en vez del summary inicial (prop) para actualizarse
  cuando el TimeRange cambia. Si el rango es el completo, evita roundtrip
  usando el `fumigationsSummary` server-side.
- `role="group"` + `aria-label="Resumen del filtro actual"`.

**TimeRange slider** (`components/map/time-range.tsx`, bottom-center del mapa):
- Histograma de actividad por mes (alto = count de fumigaciones).
- 2 inputs HTML nativos para el rango (decisión de scope: no se migró a
  @base-ui Slider por simplicidad — ver §"Riesgos").
- Autoplay con `prefers-reduced-motion` respetado (no inicia si el usuario
  lo prefiere reducir). Play/pause + reset con `aria-label` específico.
- `aria-hidden` en el histograma (decorativo, el valor se anuncia via el label
  del header "ene 26 — jul 26").

**Filtros** (`components/map/map-filter-sidebar.tsx`, drawer colapsable a la derecha):
- URL searchParams (`drone`, `crop`, `fumigated`) → `router.push` con `scroll: false`.
- Botón "Filtros" en el page header abre/cierra el drawer. Default CERRADO
  (mapa full bleed en la carga inicial).
- `FieldSelect` (primitive) para drone/crop/fumigated.
- `FilterSidebar` + `FilterSidebarSection` (primitives) para agrupación colapsable.
- "Limpiar filtros" navega a `/map` sin query string.

**ParcelsList (rail derecho, `components/map/parcels-list.tsx`)**:
- Lista ordenada por status de cadencia (overdue > due_soon > no_history > ok).
- Click selecciona → highlight en mapa + flyTo.
- Header expandido con `<dl>` (definición) cuando hay selección: Área / Cadencia /
  Última aplic. / En el rango + botón "Ver hoja de vida" a `/parcels/[id]`.
- `aria-pressed` en cada item (NO listbox — el highlight visual es suficiente,
  listbox + aria-activedescendant es over-engineering para este caso).
- Empty state: "No hay parcelas que cumplan los filtros."

**Sin iframe de DJI** (decisión explícita, ver `docs/SPEC.md` §2.4).
**Fumigadas vs no fumigadas** se calcula server-side en `app/map/page.tsx` vía
`getFumigatedParcelIdsSince(sixMonthsAgo)` (`api/repositories.ts`) y se pasa al
client como `Set<number>` (serializable, no más de 1207 ids en 6 meses).

Bitácora completa del V0 → nuestra implementación: `docs/V0_ADAPTATION.md`.

### 5.3 Historial plano (`/history`)

Server component con `HistoryTable` (tabla ordenable + filtro + paginación top 200 client-side).
A diferencia de **Task History** (que es rollup), este es el listado crudo.

### 5.4 Task History (`/task-history`) — feature estrella

Vista según **Figma frame B** del archivo `AFM_SIG`. Server component (`page.tsx`)
orquesta data y delega UI a `TaskHistoryClient.tsx`.

**Inputs (query params)**:
- `from`, `to` (YYYY-MM-DD, default últimos 6 meses).
- `parcelId` (int), `droneSerial` (string), `pilot` (string) — filtros de vuelo.

**Output**:
```ts
{
  totals: { areaMu, times, liters, duration: { hours, minutes, seconds, djiFormat } },
  days: DayCard[],              // un card por día fumigado
  polygons: { parcelId, landName, areaHa, datesFumigated[] }[]
  dateRange: { from, to }
}
```

**Estrategia de datos** (en `app/api/task-history/route.ts` y `app/task-history/page.tsx`):
1. Si hay filtros de vuelo → agrega desde `dji_flights` directo.
2. Si no → lee `dji_daily_summaries` (tabla materializada).
3. Si la tabla no existe (CI fresco) → fallback a `dji_flights`.
4. Polígonos fumigados en rango: `lib/djiag-spatial-aggregator.getPolygonsInRange`.

**Componentes**:
- `HeaderCard` (totales)
- `MetricsGrid` (KPI grid)
- `DayList` + `DayCard` (cards diarios)
- `MapView` con polígonos fumigados (click → filtra)
- `DateRangePicker`, `FilterButton`, `ScreenshotButton`
- `TabSwitcher` (Día / Semana / Mes)

**Tests**: `tests/components/task-history/*` y `tests/api-task-history.test.ts`,
incluyendo `verifier-contract-adversarial.test.tsx` para invariantes
(verde vacío, click filtro, totales siempre coinciden, etc.).

### 5.5 Detalle de parcela (`/parcels/[id]`)

Server component con `ParcelDetail` (info, fumigaciones, cadencia, mini-mapa),
`ParcelFumigations` (lista), `ParcelEditPanel` (metadata editable).
PUT a `/api/parcels/[id]` con `requireAuth`.

### 5.6 Dispositivos (`/devices`)

Lista limpia de devices (`DeviceGrid`). **Sin form vacío** (decisión §2.6 de SPEC).

### 5.7 Login (`/login`)

Server action (`app/login/actions.ts`) que usa `next-auth` Credentials provider.
Edge-safe middleware (`proxy.ts`) protege todas las rutas excepto
`/login` y `/api/auth/*`. Cookie `afm.session`, JWT maxAge 12h, httpOnly,
sameSite=lax, secure en prod.

### 5.8 Alertas (`lib/alerts.ts` + `/api/alerts`)

Reglas:
- `area_mu >= 60 || times_count >= 80` → **HIGH**
- `area_mu >= 30 || times_count >= 40` → **MEDIUM**
- resto → **LOW**

Cada alerta tiene `level, age_days, message, geometry`. Cached en `lib/cache.ts`.

### 5.9 Cadencia de fumigación (`lib/fumigation-cadence.ts` + `config/fumigation-cadences.json`)

Sistema de cadencia esperada por parcela con precedencia:
`by_parcel_external_id > by_drone > by_crop > defaults`.

Defaults aplicados (ver `docs/FUMIGATION_CADENCE.md`):
- Caña fase vegetativa: 14 días
- Caña fase establecimiento: 45 días
- Orchards (frutales): 10 días
- Café/Maíz: 21 días, Arroz: 10 días

`computeNextDueDate(last, cadence)` calcula próximo evento. Tras POST a
`/api/fumigations` se recalcula y se invalida la cache.

### 5.10 Pipeline DJI (`scripts/run-pipeline.js`) — feature crítica de datos

9 pasos en orden, todos con `--skip-*` y `--start-from N` / `--stop-at N`:

| # | Paso | Script | Output |
|---|---|---|---|
| 1 | Scrape per-flight | `scrape_djiag_perflight.js` | `djiag_exports/perflight_records.json` |
| 2 | Scrape fumigations aggregate | `scrape_djiag_records.js` | `djiag_exports/fumigations.json` |
| 3 | Upsert flights | `scripts/upsert-flights-from-djiag.js` | `dji_flights` |
| 4 | Spatial join flights × parcels | `scripts/spatial-join-flights-parcels.js` | `dji_flights.parcel_id` |
| 5 | Upsert fumigations aggregate | `scripts/upsert-fumigations-from-djiag.js` | `dji_fumigations` (parcel_id NULL) |
| 6 | Backfill per-parcel | `scripts/backfill-fumigations-from-flights.js` | `dji_fumigations` (parcel_id NOT NULL) |
| 7 | Update schedule | `scripts/update-fumigation-schedule.js` | `dji_fumigation_schedule.next_due_date` |
| 8 | Fetch lands | `scripts/fetch-lands-from-djiag.js` | `djiag_exports/lands.json` |
| 9 | Upsert lands | `scripts/upsert-lands-from-djiag.js` | `dji_parcels` (parcial UPSERT) |

**Tiempo**: primera corrida ~5 min (login + scraping); siguientes ~1 min con `--skip-scrape`.
**Dry-run**: `npm run pipeline:djiag:dry` lista comandos sin ejecutar.

### 5.11 Gotchas del scraper (memoria institucional)

Ver `docs/DJI_SCRAPER.md` y `SCRAPER_DEFECTS.md`:
1. **Locale trap**: `Accept-Language: zh-CN` o el query `?name=lands` devuelve vacío.
2. **fetch() desde page.evaluate** da 408 — la firma HMAC vive en el interceptor Axios del WASM, no en fetch directo.
3. **Paginación Ant Design**: `.ant-pagination-jump-next` carga solo la landing page — usar `.ant-pagination-next` (1 página por click).
4. **serial_number ≠ drone chassis**: es session-id. Para dedupe usar `drone_nickname`. El chassis real está en `hardware_id` del detail endpoint.
5. **Storage state** se reusa 7 días (`lib/djiag-storage.js`).

---

## 6. Autenticación y seguridad

### 6.1 Auth stack

- **NextAuth v5** (beta) con `CredentialsProvider` + `bcryptjs`.
- **JWT strategy**, maxAge 12h, cookie `afm.session` (httpOnly, sameSite=lax).
- **Roles**: `admin` y `viewer` (declarado en `types/next-auth.d.ts`).
- **Edge split**: `lib/auth.config.ts` (edge-safe) para middleware,
  `lib/auth.ts` (Node) para handlers. Razón: bcrypt rompe el bundle de Edge.
- `requireAuth()` helper en `lib/auth.ts` para route handlers.

### 6.2 Augmentations TypeScript (`types/next-auth.d.ts`)

Crítico:
- Augmentation del JWT va a `@auth/core/jwt` (NO `next-auth/jwt`).
- `User.id` está fijado a `string | undefined` en v5 → campo propio `idUsuario: number`.
- `events.signOut` con JWT strategy recibe `{token}` o `{session}`, no `{user}`.

### 6.3 Security headers (`next.config.ts`)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (sin preload todavía).
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (no DENY porque `/map` podría embeberse).
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), interest-cohort=()`
- CSP pendiente para próxima iteración (cuando auth esté cerrado).

### 6.4 Protecciones DB

- SQL parametrizado siempre (`$1, $2, ...`) — sin concatenación.
- Validación de `parcelId`, `droneSerial`, `pilot` con regex antes de query.
- Pool de conexiones `max: 5` con `idleTimeoutMillis: 30_000`.
- SSL opcional (`DATABASE_SSL=true`) para Supabase.
- Type parsers en `lib/db.ts`: NUMERIC → `number` (parseFloat), INT8 → `number` (parseInt).

---

## 7. Caching (`lib/cache.ts`)

- `unstable_cache` de Next.js con tags por dominio: `parcels`, `flights`, `alerts`, `dashboard`, `fumigations`, `task-history`.
- Invalidación explícita en mutaciones: `invalidateAfterFumigationMutation`, `invalidateAfterParcelMutation`, `invalidateAfterFlightMutation`, `invalidateAll`.
- Las pages de Task History **no** cachean: el caller (front) controla la frecuencia.

---

## 8. Convenciones de código

### 8.1 Frontend

- **Server components por defecto**; `"use client"` solo con interactividad.
- Componentes `PascalCase`, **named exports** (no default).
- Props tipados con `interface ComponentNameProps` exportado solo si lo usan otros.
- **Primitives UI en `components/ui/`** siguen el patrón shadcn-style:
  `cn()` (clsx + tailwind-merge) en `lib/utils.ts`, `data-slot` para utility
  targeting, `useId()` para ids autogenerados, `forwardRef` cuando envuelven
  un elemento HTML, controlled-only (sin state interno). Variants con CVA
  solo cuando haga falta. Ver `docs/TDD.md` §2.
- **Accesibilidad**: `aria-pressed` para ToggleButton, `role=switch` +
  `aria-checked` para Switch, `aria-current="page"` en nav, `aria-hidden` en
  iconos decorativos, `sr-only` para texto screen-reader-only, `<dl>/<dt>/<dd>`
  para fichas técnicas, `<fieldset>/<legend>` para grupos de filtros, `<div
  role="application" tabIndex={0} aria-label="...">` para el mapa. Ver
  `docs/TDD.md` §3.
- Tailwind 4 con hex inline (estilo actual); tokens en `lib/ui-tokens.ts` para
  referencia y validación. Sin CSS modules / styled-components / Emotion.
- Sin `any` en código de producto.

### 8.2 Backend

- Route handlers en `app/api/*/route.ts` con `export const dynamic = "force-dynamic"`.
- `parseIntParam` para validar ints antes de pegar a la BD.
- Data-access centralizado en `api/repositories.ts` (compartido por page server
  + route handler + scripts CLI).
- Errores: `try/catch` siempre; `NextResponse.json({error: msg}, {status: 500})`.

### 8.3 Testing (TDD)

- Vitest + jsdom + RTL. Cada componente nuevo trae al menos:
  1. render con datos típicos
  2. render con datos vacíos
  3. render con datos extremos (sin flights, con 1000, etc.)
  4. accesibilidad básica (role, label)
- Tests con `toLocaleDateString` o `new Date` son **TZ-fragiles** en jsdom
  → mockear `Intl.DateTimeFormat` o usar strings con día 15+.
- Ver patrones completos en `tests/setup.ts` y la suite `vitest-jsdom-patterns.md`
  (en memoria del agente).

### 8.4 Naming / imports

- Español en strings de UI, comentarios y mensajes.
- Identifiers en inglés (archivos, funciones, columnas SQL, variables).
- Path alias `@/*` apunta a la raíz del repo.

---

## 9. Variables de entorno (`.env.example`)

| Var | Propósito |
|---|---|
| `DATABASE_URL` | Conexión pooled (Supabase pooler / Docker local) |
| `DATABASE_URL_DIRECT` | Conexión directa admin (Supabase direct) |
| `DATABASE_SSL` | `true` para Supabase |
| `AUTH_SECRET` | `openssl rand -base64 32` (obligatorio en prod) |
| `DJIAG_EMAIL` | Email del operador DJI (scraper) |
| `DJIAG_PASSWORD` | Password DJI (scraper) |
| `DJIAG_FIELD_SELECTOR` | Override del selector heurístico de field cards (opcional) |

`.env.local` está en `.gitignore` (crítico, contiene credenciales DJI).

---

## 10. Comandos rápidos

```bash
# DB
npm run db:up                       # docker compose up -d
npm run db:down
npm run db:migrate                  # aplica migrations pendientes (idempotente)
npm run db:init                     # import djiag (bootstrap inicial)
node scripts/smoke-test-db.js       # 8 aserciones sobre BD

# Scraper / Pipeline
npm run scrape:djiag                # v2 scraper
npm run scrape:djiag:smoke          # discovery de endpoints
npm run pipeline:djiag -- --days 30 # full pipeline (~5 min primera vez)
npm run pipeline:djiag -- --skip-scrape --skip-fetch-lands
npm run pipeline:djiag:dry          # ver comandos sin ejecutar
npm run fetch:djiag:lands:fixtures  # fetch + guardar fixtures
npm run capture:djiag:fumigations   # capturar fixture fumigations

# Dev
npm run dev                         # next dev
npm run build
npm test                            # vitest run
npm run e2e                         # playwright test
npm run e2e:auth                    # auth-and-dashboard
npm run e2e:map                     # map-and-history

# Seeds
npm run auth:seed                   # usuario admin inicial
npm run seed:cadences               # cadencias desde config/*.json
```

---

## 11. Estado y deuda técnica

> Snapshot operativo. El detalle histórico está en `docs/audit/BITACORA.md`.

- **Cerrado (Sprint 3, 2026-06-28)**: auth (NextAuth v5 + middleware Edge),
  drop legacy tables (`dji_field_catalog`, `dji_land_assets`, `dji_daily_summaries`),
  scraper defects §2.2/§2.3/§2.5, storage state 7 días, scroll helper.
- **Post-sprint cleanup (master `7696ba4`)**: AppShell sidebar link,
  audit doc, verifier-contract tests, gitignore.
- **S4 cerrado (2026-07-28)**: Quality Gauntlet setup — AGENTS.md canónico,
  `dependency-cruiser` con 6 reglas, `vitest --coverage` con umbral 75/70,
  workflow semanal `quality-gauntlet-weekly.yml` (jobs fase 4-5 desactivados).
- **S5 cerrado (2026-07-28)**: migración Leaflet → **MapLibre GL JS 6.0** +
  port del mockup V0 — primitives UI accesibles (PageHeader, FieldSelect,
  ToggleButton, Switch, KpiPill, FilterSidebar), MapPageClient v2.0 con
  KpiPill overlay + TimeRange slider + ParcelsList rail + drawer de
  filtros colapsable. Bitácora en `docs/V0_ADAPTATION.md`. Decisión
  arquitectónica: NO se adoptó shadcn CLI (se replican los patrones
  con primitives propios).
- **S6 en curso**: polish del MapPageClient, sidebar de salud del
  pipeline DJI (M3), migración Task History a MapLibre.
- **Quick wins QW1-QW7**: en progreso.
- **Roadmap abierto**: S7 (cort plazo), M1-M7 (mediano), L1-L5 (largo).
- **Tests**: 588/604 verde (16 DB-dependent skipped, Docker apagado).
  Umbral global 75/70 — subir a 80/75 es fase 2 del Gauntlet.
- **Riesgo**: sin remote. Si se pierde `.git/`, el historial se va. Push pendiente.

---

## 12. Documentos relacionados

| Doc | Contenido |
|---|---|
| `README.md` | Setup, comandos de DB, pipeline DJI, migración a Supabase |
| `AGENTS.md` | Índice canónico para agentes, reglas operativas |
| `docs/SDD.md` | Diseño de producto (escrito S5, 2026-07-28) |
| `docs/TDD.md` | Diseño técnico (escrito S5, 2026-07-28) |
| `docs/V0_ADAPTATION.md` | Bitácora del sprint S5/S6 (V0 port) |
| `docs/ARCHITECTURE.md` | Topología de directorios, decisión DB pooled/direct, data flow DJI → BD → UI |
| `docs/SPEC.md` | Decisiones de producto del refactor front-end (qué/qué no) |
| `docs/DJI_SCRAPER.md` | Gotchas del scraper DJI (4 conocidos) |
| `docs/SCRAPER_DEFECTS.md` | Bitácora de defectos resueltos |
| `docs/DJI_AREA_UNITS.md` | Conversiones MU ↔ ha ↔ m² (1 MU = 666.67 m²) |
| `docs/FUMIGATION_CADENCE.md` | Cadencias por cultivo con fuentes (Cenicaña, ICA, DJI) |
| `docs/audit/BITACORA.md` | Bitácora viva de auditoría + roadmap QW1/S1-S7/M1-M7/L1-L5 |
| `docs/audit/figma-vs-bd.md` | Mapeo de Figma `AFM_SIG` → tablas y screens |
| `next.config.ts` | Security headers |
| `proxy.ts` | Middleware Edge + comentarios sobre split auth.config/auth |
