# SDD — Software Design Document

> Documento formal de diseño de producto. Define **qué** es AeroAdmin AFM,
> **para quién**, y **qué no es**. Es la fuente de verdad del producto,
> separado de la implementación (TDD.md) y de las prácticas de los
> agentes (AGENTS.md).
>
> Reemplaza el SDD implícito que vivía mezclado en `AGENTS.md` hasta el
> sprint S5 (2026-07-28). AGENTS.md sigue siendo el índice canónico y el
> living doc de reglas operativas; este archivo es la spec de producto.
>
> Última actualización: 2026-07-28 (sprint S5 cerrado, S6 en curso).

---

## 1. Visión

AeroAdmin AFM es un **panel admin + GIS interno** para un operador de
fumigación con drones **DJI Agras** en el Valle del Cauca, Colombia.

Permite a un único cliente operativo:

- Ingerir datos crudos de la nube de DJI SmartFarm (sin API oficial).
- Modelar la operación como **parcelas fumigadas** + **vuelos** +
  **eventos de fumigación** con geometría PostGIS.
- Visualizar en un **mapa GIS interactivo** el histórico espacial y
  temporal de aplicaciones, con filtros por cliente / dron / cadencia.
- Calcular **alertas** (alta / media / baja) según área trabajada y
  frecuencia, y llevar un **historial de tareas** con rollup diario.
- Manejar una **cadencia esperada de fumigación** por cultivo, con
  `next_due_date` automático.

### 1.1 Cliente y escala

- **Cliente**: 1 piloto-operador (single tenant).
- **Volumen**: ~1.200 parcelas, ~16.000 vuelos, ~17.000 fumigaciones.
- **Equipo**: 1 dev (single contributor).
- **Geografía**: Valle del Cauca, Colombia (SRID 4326, TZ `America/Bogota`).

### 1.2 Lo que NO es

- **No** es una consola de piloto (no vuela el dron).
- **No** es la app DJI embebida ni un wrapper de SmartFarm.
- **No** es SaaS multi-tenant (todavía).
- **No** es un scraper HTML tradicional — es un **cliente de browser
  real** que captura las responses HTTP que la UI de SmartFarm genera
  (más estable, ver `docs/ARCHITECTURE.md` §2.1).

---

## 2. Roles y autenticación

Dos roles, con un único helper para consultarlos desde server components
y route handlers:

- **`admin`** — puede editar parcelas, ver health del pipeline DJI.
- **`viewer`** — read-only.

Helper: `getViewerRole()` en `lib/auth/role.ts`. Display layer:
`lib/auth/role-display.ts`.

Auth: NextAuth v5 (beta) con Credentials + `bcryptjs`, JWT en cookie
`afm.session` (httpOnly, sameSite=lax, maxAge 12h). Edge split entre
`lib/auth.config.ts` (edge-safe, sin bcrypt) y `lib/auth.ts` (Node).
Middleware Edge: `proxy.ts`.

**PII y secrets NUNCA en logs, comments ni fixtures de test.**

---

## 3. Stack (resumen)

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | **Next.js** (App Router) | `16.2.4` |
| UI runtime | **React** | `19.2.5` |
| Lenguaje | **TypeScript** | `5.9.3` (`strict`) |
| Estilos | **Tailwind CSS v4** + PostCSS | `4.2.4` |
| Tokens | `lib/ui-tokens.ts` + `lib/utils.ts#cn()` | shadcn-style |
| Mapa | **MapLibre GL JS** (sustituye Leaflet en S5) | `6.0.0` |
| Primitives | Propios `components/ui/*` (patrón shadcn-style) | — |
| Primitives reservado | **@base-ui/react** | `^1.6.0` (no usado en runtime aún) |
| Iconos | `lucide-react` | `^1.27.0` |
| Auth | NextAuth v5 + bcryptjs | `5.0.0-beta.31` |
| DB driver | `pg` | `8.20.0` |
| BD | **Postgres 16 + PostGIS 3.4** | Docker local / Supabase prod (pooled URL 6543) |
| Tests | Vitest + jsdom + RTL + Playwright | `3.2.4` / `1.61.1` |
| Scraper | Playwright | `1.49.0` |

> **Decisión S5**: NO se usa shadcn CLI. Se replican los patrones de
> shadcn (Tailwind 4 + `cn()` + `data-slot` + `useId()` + `cva`
> cuando hace falta) con primitives **propios** en `components/ui/`.
> Razón: control total sobre el bundle y la accesibilidad, sin
> dependencia de un registry externo. Ver `docs/TDD.md` §2.

Detalle y gotchas por capa en `docs/STACK.md`.

---

## 4. Capas del repositorio

```
app/         Next.js App Router (server components, route handlers, layouts)
api/         Data access: repositories.ts (queries pre-armadas con cache)
lib/         Lógica de negocio pura, framework-agnostic
components/  React components, reciben datos por props
  ├── ui/        Primitives accesibles (shadcn-style, propios)
  ├── map/       Wrappers del mapa (MapLibre) y derivados V0
  ├── parcels/   Detalle de parcela
  ├── dashboard/, history/, devices/, task-history/
  ├── app-shell.tsx, map-view.tsx, metric-card.tsx, ...
scripts/     CLI del pipeline DJI
db/migrations/   SQL migrations
tests/       Unit + integration (Vitest) + e2e (Playwright)
docs/        Producto, arquitectura, methodology
djiag_exports/   Output crudo del scraper (gitignored)
```

### 4.1 Reglas duras de capa (R1–R6 en AGENTS.md)

Estas son **invariantes arquitectónicas** que la fitness function de
`dependency-cruiser` (`npm run arch:check`) valida automáticamente:

1. **`pg` NUNCA se importa desde `app/` ni `components/`.** La capa
   de data access es `api/repositories.ts` + `api/queries.ts` +
   `lib/db.ts`. Si lo rompés, el bundle del cliente lleva `pg` adentro
   y revienta el browser.
2. **Server Components y route handlers** SÍ importan
   `api/repositories.ts` y `api/queries.ts` — es el patrón Next.js.
3. **`components/` NUNCA importa `api/**` ni `lib/db.ts`.** Los
   componentes reciben datos por props.
4. **El cliente Playwright y los fetchers HTTP DJI** (`lib/djiag-*`)
   NUNCA se importan desde `app/**`. Se invocan desde `scripts/` o
   wrappers en `api/`. Excepción: `lib/djiag-spatial-aggregator.ts`,
   `lib/djiag-health.ts`, `lib/djiag-from-make/*` SÍ pueden usarse
   desde `app/api/**/route.ts` (lógica pura, no scraping).
5. **Todo código nuevo en `lib/` viene con tests** (happy path + 1
   edge case). Coverage global ≥ 75% lines / 70% branches (umbral
   base, ver `docs/files_TDD/ADOPTION.md` para subir a 80/75).
6. **Toda fecha que sale al usuario** pasa por `lib/format.ts`
   (`toDateString`, `formatToDateString`). TZ = `America/Bogota`.

---

## 5. Data flow (un roundtrip de ejemplo: `/map`)

```
                                          ┌──────────────────────────┐
                                          │  Postgres + PostGIS      │
                                          │  (dji_parcels,           │
                                          │   dji_flights,           │
                                          │   dji_fumigations)       │
                                          └────────────┬─────────────┘
                                                       │  pg (sql parametrizado)
                                                       ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  app/map/page.tsx (server component)                        │
   │  - parse searchParams (drone, crop, fumigated)              │
   │  - Promise.all de queries en api/repositories.ts:           │
   │      getParcelsNormalized()                                 │
   │      getFumigatedParcelIdsSince()                           │
   │      getParcelsSummary()                                    │
   │      getFumigationsByMonth({})                              │
   │      getFumigationsSummary({parcelIds: visible})            │
   │  - Aplica filtros en memoria (sobre result set chico)       │
   │  - Pasa datos ya cocinados al client component              │
   └─────────────────────────┬───────────────────────────────────┘
                             │ props (serializables: Set<number> ok)
                             ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  components/map/map-page-client.tsx ("use client")         │
   │  Estado: filterCollapsed, timeRange, playing,               │
   │          selectedParcelId, liveSummary (fetch al cambiar     │
   │          timeRange via /api/map/summary)                    │
   │  Renderiza:                                                 │
   │      <PageHeader>  → wrapper simple (no es el de V0)        │
   │      <MapView>     → MapLibreView (WebGL)                   │
   │        KpiPill overlay (Aplicaciones/Ha/L/Vuelos)           │
   │        TimeRange slider (bottom)                            │
   │      <MapFilterSidebar>  (drawer a la derecha, colapsable)  │
   │      <ParcelsList>   (rail derecho, click → flyTo)          │
   └─────────────────────────────────────────────────────────────┘
```

El client component **NO importa `api/**` ni `pg`**. Solo recibe
datos del server y los pasa a primitives y al mapa. Las queries
vuelven a poder ejecutarse por mutaciones de fumigación vía
`invalidateAfterFumigationMutation()` (`lib/cache.ts`).

---

## 6. Vistas (producto, no archivos)

### 6.1 Dashboard (`/`)
KPIs limpios (vuelos, área, alertas, parcelas), `OperationsSummary`
panel oscuro "Reporte 2026", `RecentFlightsList` con export CSV,
`AlertsPanel` lateral con filtro por severidad,
`UpcomingFumigations` según cadencia. AppShell con sidebar y
bloque "Estado actual".

### 6.2 Mapa (`/map`) — vista estrella

Server component con `MapPageClient` (v2.0, sprint S5). Layout:

- Page header compacto: logo + título + subtítulo + chip "X Parcelas" + botón "Filtros".
- Body flex-row (mobile → flex-col): mapa a la izquierda, rail derecho con lista de parcelas.
- Mapa: MapLibre GL JS, 5 capas toggleables (`parcels`, `waypoints`, `alerts`, `flights`, `flight-plan`), basemap satellite/streets persistido en localStorage, popups HTML, click → flyTo + highlight, fitBounds automático.
- KPIs overlay pill (Aplicaciones / Ha tratadas / Volumen / Vuelos) sobre el mapa, esquina superior izquierda, recalculan al cambiar el TimeRange via `/api/map/summary`.
- TimeRange slider con histograma de actividad mensual y play/pause (respeta `prefers-reduced-motion`), bottom-center.
- Drawer de filtros colapsable a la derecha (default cerrado): drone model, crop, fumigadas (6m), limpiar.
- Rail derecho con `ParcelsList` ordenada por status de cadencia, click → flyTo + detalle expandido.

### 6.3 Historial plano (`/history`)
Tabla ordenable + filtro + paginación top 200 client-side. A diferencia
de **Task History**, este es el listado crudo.

### 6.4 Task History (`/task-history`) — feature estrella del sprint previo
Vista según Figma frame B. Server component orquesta data; client
component interactivo. Filtros por rango de fechas, parcela, dron,
piloto. Output: `totals` + `days[]` + `polygons[]`. Estrategia: si
hay filtros de vuelo → desde `dji_flights`; si no → desde
`dji_daily_summaries`; si no existe → fallback a `dji_flights`.
Polígonos fumigados en rango via `lib/djiag-spatial-aggregator`.

### 6.5 Detalle de parcela (`/parcels/[id]`)
`ParcelDetail` (info, fumigaciones, cadencia, mini-mapa), lista de
fumigaciones, `ParcelEditPanel` (PUT a `/api/parcels/[id]` con
`requireAuth`).

### 6.6 Dispositivos (`/devices`)
Lista limpia. **Sin form vacío** (decisión de producto).

### 6.7 Login (`/login`)
Server action con Credentials provider.

### 6.8 Alertas (`/api/alerts` + `lib/alerts.ts`)
Reglas:
- `area_mu >= 60 || times_count >= 80` → **HIGH**
- `area_mu >= 30 || times_count >= 40` → **MEDIUM**
- resto → **LOW**

### 6.9 Cadencia de fumigación
Sistema con precedencia `by_parcel_external_id > by_drone > by_crop >
defaults`. `computeNextDueDate(last, cadence)`. Detalle en
`docs/FUMIGATION_CADENCE.md`.

### 6.10 Pipeline DJI (scripts)
9 pasos idempotentes, todos con `--skip-*` y `--start-from N`.
Detalle en `docs/DJI_SCRAPER.md` y `docs/ARCHITECTURE.md`.

---

## 7. Modelo de datos (PostGIS)

| Tabla | Filas | Propósito |
|---|---|---|
| `dji_parcels` | ~1207 | Parcela normalizada (lands DJI) |
| `dji_flights` | ~16k | Sorties de fumigación |
| `dji_fumigations` | ~17k | Eventos de fumigación |
| `dji_fumigation_schedule` | 1/parcela | Cadencia esperada + `next_due_date` |
| `dji_drone_models` | 4 | Lookup code → name |
| `dji_import_batches` | N | Cabecera de corrida del scraper |
| `parcels`, `flights` | demo | Modelo demo (legacy) |
| `app_users` | N | Usuarios del panel (auth) |

Geometrías: `geometry(MultiPolygon, 4326)`, `geometry(Point, 4326)`,
`geometry(MultiPoint, 4326)`. GIST indexes en spray_geom, waypoints,
reference_point, location.

Convenciones: SRID 4326 (WGS84), fechas DATE en `America/Bogota`
(véase `lib/format.ts`), `dji_*` = datos crudos/importados, modelo
operativo sin prefijo.

Schema detail: `docs/STACK.md` §4.

---

## 8. Adaptación V0 (sprint S5/S6)

### 8.1 Qué es V0

`docs/fumigation-management-dashboard/` es un **mockup navegable**
(Figma-style, pero hecho con Next.js) que el operador-cliente armó como
referencia visual de cómo quería el producto. No es producción: usa
datos mock deterministas (`lib/data.ts` con `mulberry32(20260728)`).

El stack del V0 es: shadcn CLI + @base-ui/react 1.5 +
class-variance-authority + maplibre-gl 6.0 + lucide-react + next 16.

### 8.2 Decisión S5

Replicar la **lógica y el layout** del V0 en el proyecto real, **sin
adoptar shadcn CLI**. Razón: el proyecto ya tiene un sistema de design
tokens (`lib/ui-tokens.ts`) y un set de primitives; importar shadcn
rompe la coherencia y agrega un registry externo. La alternativa es
**replicar los patrones** (Tailwind 4 + `cn()` + `data-slot` +
`useId()` + `cva` cuando hace falta) con primitives **propios** en
`components/ui/`.

### 8.3 Features portada 1:1 en S5

- Migración Leaflet → MapLibre (`MapLibreView`, `MapView`,
  `ParcelMiniMap`, `TaskHistoryMapView`). `react-leaflet` y `leaflet`
  eliminados de `package.json`.
- KPI overlay pill sobre el mapa (`KpiPill`).
- TimeRange slider con histograma y play/pause (`TimeRange`).
- Rail derecho con lista de parcelas por cadencia (`ParcelsList`).
- Drawer de filtros colapsable (`MapFilterSidebar`).
- Primitives accesibles nuevos: `PageHeader`, `FieldSelect`,
  `ToggleButton`, `Switch`, `KpiPill`, `FilterSidebar` +
  `FilterSidebarSection`.

### 8.4 Estado al cierre de S5 (2026-07-28)

S5 cerrado, S6 en curso. El sprint S6 sigue copiando lógica del V0
(parcial: `geovisor-client.tsx` ↔ `MapPageClient`, `time-range.tsx`
↔ `components/map/time-range.tsx`, `geo-map.tsx` ↔
`MapLibreView`, etc.). Lo que se copió y lo que se decidió distinto
está documentado en `docs/V0_ADAPTATION.md`.

### 8.5 Lo que NO migramos del V0

- **shadcn CLI** — replicamos los patrones con primitives propios.
- **`@base-ui/react`** — instalado (`^1.6.0`), reservado para cuando
  un primitive demande comportamiento que no se puede resolver con
  HTML nativo (e.g. Slider doble, Combobox, Dialog con focus trap).
  No se usa en runtime todavía.
- **Datos mock deterministas** — V0 los usa como demo; el proyecto
  real lee de PostGIS. El S5 NO migró el `lib/data.ts` del V0.
- **Páginas del V0 que no existen en el proyecto real** (`/parcelas`,
  detalle `/parcelas/[id]`) — se mapean a `/parcels` y
  `/parcels/[id]` del proyecto, con su propio `ParcelDetail`.

---

## 9. Calidad y testing

El proyecto implementa las 7 compuertas del **Quality Gauntlet**
(`docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md`):

- ✅ Compuerta 1: Lint + tipos (parcial, ESLint pendiente).
- ✅ Compuerta 2: Fitness functions de arquitectura (`dependency-cruiser`).
- ✅ Compuerta 3: Unit tests + coverage (Vitest, umbral 75/70).
- ⏸ Compuerta 4: Gherkin / BDD (fase 3).
- ⏸ Compuerta 5: Mutation testing (fase 4).
- ✅ Compuerta 6: E2E (Playwright).
- ⏸ Compuerta 7: Smoke DB + métricas (fase 5).

Estado detallado en `docs/files_TDD/ADOPTION.md`.

---

## 10. Roadmap (corto / mediano / largo)

### 10.1 Cerrado
- **S1–S3** (2026-04 → 2026-06): bootstrap, auth, scraper hardening.
- **S4** (2026-07-28): Quality Gauntlet setup (arch:check, coverage
  umbral, weekly workflow, AGENTS.md canónico).
- **S5** (2026-07-28): MapLibre migration + V0 port (primitives +
  MapPageClient + KpiPill + TimeRange + ParcelsList + drawer).

### 10.2 En curso
- **S6**: terminar el V0 port — accessible toggles de capa, más
  filtros accesibles, polish de MapPageClient. Refinamiento de UX
  del drawer y los KPIs.

### 10.3 Pendiente
- **S7**: sidebar de salud del pipeline DJI (M3 del roadmap).
- **Fase 2 del Gauntlet** (post-S6): subir coverage a 80/75.
- **Fase 3**: Gherkin sobre cadencia + alertas.
- **Largo**: SaaS multi-tenant, soporte a drones enterprise (M3E / Dock),
  AirData Enterprise si vale la pena pagar.

Detalle en `docs/audit/BITACORA.md`.

---

## 11. Documentos relacionados

| Doc | Contenido |
|---|---|
| `docs/TDD.md` | Technical design — patrones de implementación, data flow, MapLibre setup |
| `docs/V0_ADAPTATION.md` | Bitácora del sprint S5/S6 (qué se copió, qué se omitió) |
| `docs/ARCHITECTURE.md` | Topología de directorios, data flow DJI → BD → UI, decisiones |
| `docs/STACK.md` | Versiones, decisiones de stack, gotchas |
| `docs/SPEC.md` | Decisiones de producto del refactor front-end |
| `docs/DJI_SCRAPER.md` | Gotchas del scraper DJI |
| `docs/FUMIGATION_CADENCE.md` | Cadencias por cultivo con fuentes |
| `docs/audit/BITACORA.md` | Bitácora viva de auditoría + roadmap QW1/S1-S7/M1-M7/L1-L5 |
| `docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md` | Las 7 compuertas |
| `docs/files_TDD/ADOPTION.md` | Estado de adopción del Gauntlet |
| `AGENTS.md` | Índice canónico, reglas operativas, prácticas para agentes |
