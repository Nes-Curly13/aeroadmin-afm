# AeroAdmin AFM — Overview General

> Documento de referencia para entender, **replicar y mejorar** el proyecto en **V0.dev** (u otra IA generativa de UI).
> Stack actual: **Next.js 16 + React 19 + TypeScript + Tailwind v4 + MapLibre GL JS 6.0 + NextAuth v5 + PostGIS/Supabase + Playwright/Vitest**.
> Idioma de UI: **español** (locución: operador cañero del Valle del Cauca, Colombia).

---

## 1. Resumen del producto

**AeroAdmin AFM** es un **panel admin para operadores de drones DJI Agras** (fumigación de cultivos, principalmente caña de azúcar en el Valle del Cauca). El sistema:

- Importa datos desde **DJI Agras (kr-ag2-api)** mediante Playwright + scrapers, y los materializa en una **PostGIS / Supabase** Postgres.
- Visualiza **parcelas, vuelos de fumigación, alertas operativas y planificación de cadencias** en un dashboard + mapa SIG + historial de tareas.
- Soporta **roles** (`admin` / `viewer`) y un único cliente (single-tenant, Opción A).
- Trazabilidad por día, dron, piloto y parcela; exporta PDFs por parcela; calcula áreas fumigadas vs. cobertura objetivo.

Casos de uso núcleo:

1. "Hoy, ¿qué hay que fumigar y qué se fumigó?" → **Dashboard + /parcels/overdue**
2. "¿Dónde está cada parcela y cómo se fumigó?" → **/map + /parcels/[id]**
3. "¿Qué drones/pilotos fumigaron este mes?" → **/task-history + /history**
4. "¿El sync con DJI está al día?" → **SyncBanner** en el dashboard + **/api/admin/djiag-health**
5. "¿Hay fumigaciones que no se pudieron asignar a una parcela?" → **/admin/orphan-fumigations**

---

## 2. Modelo de datos (PostGIS)

Tablas activas (single source of truth). Para la V0 no hace falta conocer todas las columnas, sí **qué entidad representa cada una**.

| Tabla | Qué modela | Origen de los datos |
|---|---|---|
| `clients` | Cliente genérico (legacy, sólo seed) | `db/seed.sql` |
| `parcels` | Parcelas legacy (no se usa en UI nueva) | seed |
| `flights` | Vuelos legacy (no se usa en UI nueva) | seed |
| `dji_import_batches` | Lote de import (auditoría de scraping) | `run-pipeline.js` |
| `dji_drone_models` | Catálogo: `0=Sin asignar`, `72=T16/T20`, `201=T40/T50`, `210=T70` | seed + migration |
| **`dji_parcels`** | **Parcela normalizada (1 fila por campo, columnas planas + geometría PostGIS)** | DJI AG (lands API) |
| `dji_fumigation_schedule` | Cadencia esperada por parcela (1:1 con `dji_parcels`) | backfill + manual |
| `dji_fumigations` | Eventos de fumigación realizados por parcela (manual, import, djiscraper) | manual + backfill |
| **`dji_flights`** | **Sortie individual de dron (1 fila por vuelo, con centroide lng/lat)** | DJI AG (per-flight endpoint) |
| `dji_fumigation_schedule_history` | Historial de cambios de cadencia | triggers |
| `djiag_health` | Singleton con health del último pipeline run | `run-pipeline.js` |
| `app_users` | Usuarios (email + bcrypt + role) | seed + NextAuth |

**Claves que tiene que entender la UI de V0**:

- `dji_parcels` → **el corazón del mapa y el listado de parcelas**. Lleva la geometría `spray_geom` (MultiPolygon 4326), `reference_point` (Point 4326), `waypoints` (MultiPoint 4326), waypoint_count, declared_area_ha, spray_area_m2, is_orchard, drone_model_code, etc.
- `dji_flights` → **la trazabilidad fina**. Cada fila es un vuelo del dron con `drone_serial`, `pilot_name`, `start_at`, `area_m2`, `spray_usage_ml`, `lng/lat` (centroide del vuelo), `parcel_id` (puede ser NULL hasta el spatial join).
- `dji_fumigations` → **el registro humano**. Producto, dosis, ICA, licencia piloto, fecha. Tiene `flight_ids` (array opcional) para vincular con los vuelos que la originaron.
- `dji_fumigation_schedule` → **la cadencia**. `recommended_cadence_days` (default 14), `last_fumigation_date`, `next_due_date`. De acá sale el chip "vencida / por vencer / ok".
- `djiag_health` → **el estado del sync DJI**. Sirve para el banner amarillo/verde del dashboard.

**Status de fumigación** (lógica pura, vive en `lib/fumigation-cadence.ts`):

```text
days = (next_due_date - today)
status:
  "no_history"  → last_fumigation_date IS NULL
  "overdue"     → days < 0
  "due_soon"    → 0 <= days <= 7
  "ok"          → days > 7
```

---

## 3. Mapa de páginas → datos → utilidad

Cada página es un **Server Component** (salvo `/login` y los clientes interactivos). Todas las queries pasan por `api/repositories.ts`, que a su vez usa `lib/cache.ts` (Next `unstable_cache`, TTL 60s, tags por dominio).

### 3.1 `/login` — Inicio de sesión

- **Tipo**: Client Component + Server Action (`app/login/actions.ts`).
- **Datos consumidos**: `app_users` (email, password_hash bcrypt) vía NextAuth v5 Credentials provider.
- **Utilidad**: gate de acceso. Sin sesión → middleware (`proxy.ts`) redirige a `/login`. Roles: `admin` (CRUD + admin) y `viewer` (lectura).
- **Para V0**: pantalla simple con logo, email, password, botón "Ingresar". Mensaje genérico "email o password incorrectos" (mitigación user-enum). Sin "recordarme" (sesión 12h fija).

### 3.2 `/` — Panel de Control (Dashboard)

- **Tipo**: Server Component (`dynamic = "force-dynamic"`).
- **Queries paralelas (8 en Promise.all)**:
  1. `getDashboardMetrics()` → KPIs top: totalFlights, totalAreaCovered, highAlertParcels, totalAssets.
  2. `getParcelsNormalized(1, 200)` → listado de parcelas (para sidebar count y mini-mapa).
  3. `getFlights()` → vuelos recientes (lista de "Operaciones recientes").
  4. `getAlerts()` → alertas operativas activas (HIGH/MEDIUM/LOW).
  5. `getUpcomingFumigations(8)` → próximas fumigaciones con status `due_soon`.
  6. `getOverdueParcels({ maxDaysAhead: 14 })` → parcelas vencidas y por vencer.
  7. `getOverdueParcels({ maxDaysAhead: 0 })` → sólo las **ya vencidas** (chip del sidebar).
  8. `getActivityComparison()` → comparativa ayer/hoy (área fumigada, horas, litros).
  9. `loadSyncHealth()` → estado del pipeline DJI (lee `djiag_health`).
- **Utilidad por bloque (BentoGrid)**:
  - **SyncBanner**: amarillo si `last_run_status = "partial" | "failed"`, verde si `"ok"`, gris si `"unknown"`. Muestra `hoursSinceLastSync`.
  - **5 KPIs (colSpan mixto)**: Vuelos totales, Área total cubierta, Parcelas totales, Alertas HIGH, Atrasadas.
  - **TodayYesterdayCard**: comparativa día-a-día (área, horas, litros).
  - **UpcomingFumigations** (8 próximas) + **AlertsPanel** (filtrable HIGH/MED/LOW/ALL).
  - **OperationsPanel / RecentFlightsList**: últimos vuelos con `drone_serial`, `pilot_name`, `area_m2`, `spray_usage_ml`, link a parcela.
- **Para V0**: dashboard con 5 metric cards arriba, 2 cards medianas (próximas fumigaciones + alertas) y 1 card full-width (operaciones recientes). Incluir un banner superior que indique el estado del sync.

### 3.3 `/map` — Mapa de Operaciones

- **Tipo**: Server Component que pasa a `MapPageClient` (cliente MapLibre).
- **Queries paralelas (3)**:
  1. `getParcelsNormalized(1, 200, { droneModelCode?, fieldType? })` → geometrías `spray_geom` para polígonos.
  2. `getFumigatedParcelIdsSince(6 meses)` → Set de IDs fumigados (para filtro "Sí fumigada / No fumigada").
  3. `getParcelsSummary()` → agregado por dron.
- **Filtros via URL searchParams**: `?drone=72&crop=Farmland&fumigated=yes|no`.
- **Capas MapLibre** (GeoJSON sources + paint expressions):
  - Polígonos de parcelas (verde brand si fumigada, dashed gris si no).
  - Polígono de "reference_point" + waypoints (cluster on click).
  - (Opcional futuro) Capa de vuelos con `CircleMarker` por `dji_flights.lng/lat`.
- **Drawer lateral**: filtros + lista de parcelas, click → abre `parcels/[id]`.
- **Para V0**: layout de **mapa 60% + sidebar 40%**, header con título + chip "X Parcelas" + botón "Filtros" (que abre el drawer). `minZoom=3, maxZoom=22` (ver país → ver edificio).

### 3.4 `/parcels` — Listado de Parcelas

- **Tipo**: Server Component → `ParcelsList` (cliente).
- **Query**: `getParcelsNormalized(1, 1000)` (cacheado, tag `afm:parcels`, TTL 60s). 1000 hard-coded hasta que se migre a paginación server-side.
- **Columnas mostradas**: `land_name`, `external_id`, `field_type`, `declared_area_ha`, `spray_area_m2`, `is_orchard`, `drone_model_name`, **`days_since_last_fumigation`** (chip de color), `last_fumigation_date`.
- **Utilidad**: vista agregada, búsqueda + sort + paginación client-side. Click en fila → `/parcels/[id]`.
- **Para V0**: tabla con sort + filter + paginación. Los puntos críticos de UX: el chip de cadencia (rojo si nunca fumigada o vencida, amarillo si vence pronto, verde si ok) y un campo de búsqueda full-text sobre `land_name`.

### 3.5 `/parcels/[id]` — Detalle de Parcela

- **Tipo**: Server Component que carga 8+ queries en `Promise.all` (parcela, schedule, eventos, stats, summary, totals, schedule history, flight traces).
- **Queries clave**:
  - `getParcelById(id)` → la parcela puntual.
  - `getFumigationSchedule(id)` → cadencia esperada + `next_due_date`.
  - `getFumigationEventsByParcel(id)` → historial de fumigaciones (`product_used`, `dose_l_per_ha`, `area_fumigated_m2`, `drone_code_used`, `human_notes`, `product_registered_ica`, `pilot_license`).
  - `getFumigationYearlySummary(id, year)` → agregados mensuales del año actual.
  - `getFumigationYearTotals(id, year)` → totales anuales.
  - `getScheduleHistory(id, 10)` → últimos 10 cambios de cadencia.
  - `getFumigationFlightTrace(eventId)` por cada fumigación con `flight_ids` → lista de vuelos que la originaron.
- **Bloques UI**:
  - `<ParcelFumigations>`: status actual (vencida / vence pronto / ok), días hasta próximo, lista de fumigaciones futuras.
  - `<ParcelFumigationHistory>`: tabla de eventos, totalizadores año, timeline de cambios de cadencia, trazabilidad flights (cuando hay `flight_ids`).
  - `<ParcelDetail>`: geometría, waypoints, parámetros del plan DJI (spray_width, work_speed, radar_height, etc.).
- **Acciones**: `← Anterior` / `Siguiente →` (navegación secuencial por ID) y `Ver timeline` (link a `/parcels/[id]/timeline`).
- **Para V0**: header con breadcrumb + nombre + status. Tres paneles apilados: (1) Fumigaciones + próximas + status, (2) Historial con tabs (Eventos | Trazabilidad | Cambios cadencia), (3) Datos del plan DJI (parámetros de vuelo + geometría renderizada en un mini-mapa).

### 3.6 `/parcels/[id]/timeline` — Timeline de Fumigaciones

- **Tipo**: Server Component.
- **Query**: `getFumigationTimelineForParcel(id, from, to)` + `buildFumigationTimeline()` (función pura que combina fumigaciones + cadencia para armar la línea de tiempo).
- **Filtros URL**: `?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=detail|summary`. Default: últimos 6 meses.
- **Utilidad**: línea de tiempo visual de fumigaciones con cadencia esperada marcada. `mode=summary` agrupa por mes, `mode=detail` muestra cada fumigación.
- **Para V0**: vista cronológica con dot por evento, línea de cadencia esperada encima, controles de rango de fecha y switch detail/summary.

### 3.7 `/parcels/overdue` — Faltan por fumigar

- **Tipo**: Server Component → `OverdueList` (cliente).
- **Query**: `getOverdueParcels({ maxDaysAhead=14, cropType?, isOrchard? })`.
- **Filtros URL**: `?severity=overdue|due_soon|ok|no_history&cropType=Maíz&isOrchard=true&maxDaysAhead=N` (default 14, max 90).
- **Resumen calculado en server**:
  - `total`, `overdue`, `due_soon`, `ok`, `no_history` (counts).
  - `totalHa` (suma de `area_fumigable_ha`).
- **Utilidad**: **vista de planificación**. El supervisor/owner abre esta página y ve qué parcelas necesitan fumigación esta semana, ordenadas por urgencia.
- **Para V0**: header con 4 chips de severidad (counts) + sumador de ha + tabla ordenada por urgencia (overdue primero, luego due_soon). Click en fila → `/parcels/[id]`.

### 3.8 `/task-history` — Historial de tareas (Figma B)

- **Tipo**: Server Component → `TaskHistoryClient` (cliente).
- **Queries**:
  1. `resolveEnrichedDays({ from, to, parcelId?, droneSerial?, pilot? })` → día-cards con sub-lista de vuelos.
     - Path 1: si hay filtros por vuelo → agrega directo desde `dji_flights`.
     - Path 2: si no hay filtros → usa `dji_daily_summaries` (rollup) + query separada a `dji_flights` para la sub-lista.
     - Path 3: fallback a path 1 si la tabla de summaries no existe (CI).
  2. `getPolygonsInRange({ from, to, onlyFumigated: true, parcelId?, droneSerial?, pilot? })` → polígonos fumigados en el rango.
  3. `fetchDroneSuggestions(30)` → seriales distintos para el datalist del filtro.
- **Filtros URL**: `?from=YYYY-MM-DD&to=YYYY-MM-DD&parcelId=N&droneSerial=HK-...&pilot=...`. Default: últimos 6 meses.
- **Layout v1.7**: mapa 60% (polígonos fumigados) + sidebar 40% (filtros arriba + lista de días abajo). Click en vuelo → `FlightDetailDrawer` con metadata completa.
- **Para V0**: layout 60/40, **mapa con polígonos fumigados coloreados por día** (gradiente de color del más viejo al más reciente), sidebar con `DateRangePicker` + `FiltroParcela` + `FiltroDrone` (con datalist) + `FiltroPiloto` + `DayList` (cards por día con sub-lista de vuelos) + botón "Screenshot".

### 3.9 `/history` — Historial DJI (legacy, redirige)

- **Estado**: deprecado. Redirige a `/task-history` vía `next.config.js`. Mantenido para no romper bookmarks.
- **Para V0**: no incluir; usar solo `/task-history`.

### 3.10 `/devices` — Gestión de dispositivos

- **Tipo**: Server Component con role-gate. `role !== "admin"` → `redirect("/")`.
- **Datos**: `DEFAULT_DEVICES` (hardcoded en `lib/devices.ts`). Lista ilustrativa.
- **Estado**: marcado "Próximamente" en UI. CRUD real se habilita cuando haya auth más robusta.
- **Para V0**: grilla de tarjetas de dron (modelo, serial, estado, última fumigación) con banner amarillo "Próximamente". Solo visible para admin.

### 3.11 `/admin/orphan-fumigations` — Fumigaciones sin parcela (admin)

- **Tipo**: Server Component con role-gate. `role !== "admin"` → `notFound()`.
- **Queries**:
  1. `getOrphanFumigations(PAGE_SIZE=25, offset)` → fumigaciones con `parcel_id IS NULL` (vienen del backfill cuando el spatial join no encontró parcela).
  2. `getFumigationDbStats()` → contadores globales.
  3. `getParcelsNormalized(1, 200)` → catálogo de parcelas para el selector "Vincular a...".
- **Paginación**: `?page=N`, default 1.
- **Utilidad**: limpieza manual de fumigaciones huérfanas. El admin las revisa y las vincula a una parcela vía el form.
- **Para V0**: tabla paginada con: ID fumigación, fecha, producto, drone_serial, polygon centroid, dropdown "Vincular a..." con búsqueda de parcelas, botón "Vincular" (POST al endpoint). Solo visible para admin.

---

## 4. Endpoints API (clientes externos / scripts / curl)

Todos son `force-dynamic` y devuelven JSON. Requieren sesión (excepto `/api/auth/*`).

| Método + Path | Qué devuelve | Para qué sirve |
|---|---|---|
| `GET /api/auth/me` | Usuario actual + role | Validar sesión client-side |
| `POST /api/auth/change-password` | OK | Cambiar password (bcrypt) |
| `GET /api/parcels/normalized?page&limit&isOrchard&droneModelCode&minSprayAreaM2&fieldType&summary=1` | Parcelas paginadas (o summary por dron) | Catálogo + filtros |
| `GET /api/parcels/[id]` | Parcela + fumigaciones + schedule | Detalle completo |
| `GET /api/parcels/[id]/fumigation-history` | Eventos crudos | Auditoría |
| `GET /api/parcels/[id]/report.pdf` | PDF descargable | Reporte ICA |
| `GET /api/fumigation-schedule/[id]` | Cadencia esperada | Sync con apps externas |
| `GET /api/fumigations?from&to&parcelId` | Eventos en rango | Auditoría |
| `GET /api/fumigations/upcoming?limit=10` | Próximas fumigaciones (status due_soon) | Widgets externos |
| `GET /api/fumigations/[id]/link` | fumigación + flight_ids vinculados | Trazabilidad |
| `GET /api/fumigations/[id]/timeline?from&to` | Timeline puro | Apps móviles |
| `GET /api/fumigations/[id]/flights` | Vuelos que originaron la fumigación | Trazabilidad detallada |
| `GET /api/flights?page&limit` | Vuelos con footprint | Historial |
| `GET /api/alerts` | Alertas activas (HIGH/MED/LOW) | Widgets |
| `GET /api/task-history?from&to&parcelId&droneSerial&pilot` | DayCards con flights | Historial enriquecido |
| `GET /api/admin/djiag-health` | Status del último pipeline | Health check |
| `GET /api/admin/orphan-fumigations?page` | Huérfanas | Limpieza |
| `POST /api/admin/backfill-fumigations` | Ejecuta spatial join + backfill | Job manual |

**Autenticación**: NextAuth v5 con `Credentials` provider. La cookie de sesión dura 12h. Middleware Edge (`proxy.ts`) protege todas las rutas excepto `/login` y `/api/auth/*`.

**Para V0**: la mayoría de las páginas consumen **directo desde el repository** (Server Component → `api/repositories.ts`), no desde los endpoints API. Los endpoints existen para clientes externos (apps móviles, scripts CLI, widgets). Si V0 solo replica el panel, no necesitás los endpoints, pero documentá el shape JSON para que la IA entienda la data.

---

## 5. Sistema de design (tokens, no inventar)

- **Color primario**: `#0b5f2d` (verde DJI Agras). Hover `#0d7a3a`.
- **Color de fondo**: `#f0f4f1` (verde hueso muy claro). Cards `#ffffff` con `border-[#d2ddd6]`.
- **Color de alerta HIGH**: `#a93232` sobre `#fff5f5` con border `#f4caca`.
- **Color de advertencia (próximamente)**: `#d4b23c` sobre `#fff8e3`.
- **Tipografía**: `font-black` para títulos, `font-bold uppercase tracking-wide` para eyebrows, sans-serif del sistema.
- **Sombras**: `shadow-[0px_18px_40px_rgba(15,23,42,0.08)]` en cards.
- **Border radius**: `rounded-2xl` en cards, `rounded-full` en chips/badges/pill buttons.
- **Spacing**: `space-y-5` como ritmo entre bloques principales.
- **Sidebar**: `bg-white border-r border-[#d2ddd6]`, items activos con fondo `#e8f1eb` y texto `#0b5f2d`.

**Reglas de UI que V0 tiene que respetar** (si querés que parezca AFM):

1. Toda página está envuelta en `<AppShell>` (sidebar + header). El sidebar tiene secciones: Panel de Control, Mapa, Parcelas, Faltan por fumigar, Historial de tareas, Dispositivos (admin only), Fumigaciones sin parcela (admin only).
2. El header lleva `eyebrow` (small uppercase) + `h1 title` + `subtitle` (gris) + `actions` (pills/botones a la derecha).
3. La métrica se expresa en **mu** (1 mu ≈ 666.67 m²) y **litros**. Función de formato: `formatArea`, `formatNumber` en `lib/format.ts`.
4. Los chips de status de fumigación tienen colores semánticos:
   - `overdue` → rojo
   - `due_soon` → amarillo/ámbar
   - `ok` → verde
   - `no_history` → gris oscuro
5. En mapas, **los polígonos fumigados en los últimos 6 meses** se colorean verde claro (`#a3d9a5`), los no fumigados gris (`#cccccc`).
6. Los markers de cadencia (en `/parcels`) son dots de 8px con tooltip al hover.

---

## 6. Roles y permisos (gate server-side)

| Página | viewer (supervisor) | admin | Sin sesión |
|---|---|---|---|
| `/` | ✅ | ✅ | → /login |
| `/map` | ✅ | ✅ | → /login |
| `/parcels` | ✅ | ✅ | → /login |
| `/parcels/[id]` | ✅ | ✅ | → /login |
| `/parcels/[id]/timeline` | ✅ | ✅ | → /login |
| `/parcels/overdue` | ✅ | ✅ | → /login |
| `/task-history` | ✅ | ✅ | → /login |
| `/history` | ✅ | ✅ | → /login (deprecated, redirige) |
| `/devices` | ❌ redirect("/") | ✅ | → /login |
| `/admin/orphan-fumigations` | ❌ notFound() | ✅ | → /login |
| Endpoints admin | 401 / 403 | ✅ | 401 |

**Para V0**: si vas a replicar el panel completo, **siempre** un gate server-side (no escondas la UI con `display:none` — un curl la puede ver). El patrón de Next.js es: `const session = await auth(); if (role !== "admin") notFound();`.

---

## 7. Datos derivados (cómo se calculan en la app)

V0 no tiene que calcular todo, pero conviene documentar las fórmulas que la UI muestra:

| Métrica | Fórmula | Dónde se calcula |
|---|---|---|
| `hoursSinceLastSync` | `now - last_successful_sync_at` | `lib/format.ts` |
| `status` de cadencia | `no_history | overdue | due_soon | ok` según días vs `next_due_date` | `lib/fumigation-cadence.ts:getFumigationStatus()` |
| `days_until_next_due` | `next_due_date - today` | `lib/fumigation-cadence.ts:daysUntilNextDue()` |
| `area_mu` | `area_m2 / 666.67` | Inline en `app/page.tsx` y `/task-history` |
| `dosis L/ha` | `liters / (area_mu * 0.0667)` | Inline en `/task-history` |
| `dot color` (cadencia) | `red=overdue/no_history, yellow=due_soon, green=ok` | `getDashboardKpiTone()` |
| Total área acumulada | `Σ flights.area_mu` | `app/history/page.tsx` |
| Total litros acumulados | `Σ flights.usage_liters` | `app/history/page.tsx` |
| `AlertsPanel` severity | por edad de la alerta (`age_days`) y tipo de evento | `lib/alerts.ts:countHighAlerts()` |

---

## 8. Patrones para replicar en V0.dev

Cuando le pidas a V0.dev que mejore o replique pantallas:

1. **Empezá siempre por el shell**. Pedile: "un panel admin con sidebar izquierdo con 5 items: Panel de Control, Mapa, Parcelas, Faltan por fumigar, Historial de tareas. Header con logo + título + subtítulo + acciones a la derecha. Color primario verde #0b5f2d, fondo #f0f4f1."

2. **Después el contenido por página**. Adjuntá siempre:
   - El nombre de las columnas de la tabla (ver sección 2).
   - El shape JSON de ejemplo (ver sección 4 — endpoints API).
   - El status visual (colores de chips, íconos).

3. **El mapa SIG** es la pieza más difícil para V0. Mejor estrategia: armá un mapa estático con `<Map>` de una librería (Mapbox/MapLibre) y después pedí que V0 le agregue capas. Si V0 no entiende PostGIS, pasale un JSON de ejemplo con `FeatureCollection` de GeoJSON.

4. **Las alertas** son siempre:
   - `HIGH` (rojo) — fumigación vencida hace >30 días o sin historial.
   - `MEDIUM` (amarillo) — vence en ≤7 días.
   - `LOW` (gris) — informativo (drone sin volar en 30 días, etc.).

5. **Para el detalle de parcela**, V0 tiene que entender la jerarquía:
   ```
   Parcela
   ├─ Fumigaciones (eventos)
   │  ├─ Producto + dosis + ICA
   │  ├─ Licencia del piloto
   │  └─ flight_ids[] → dji_flights[] (trazabilidad)
   ├─ Schedule (cadencia esperada)
   │  └─ history[] (cambios)
   └─ Plan DJI (geometría + waypoints + parámetros)
   ```

---

## 9. Variables de entorno (referencia)

```bash
# Auth
NEXTAUTH_URL=https://tu-dominio.com
NEXTAUTH_SECRET=...
AUTH_TRUST_HOST=true

# DB (Supabase pooled para Vercel, direct para migraciones)
DATABASE_URL=postgresql://postgres:xxx@aws-0-us-east-1.pooler.supabase.com:6543/postgres
DATABASE_URL_DIRECT=postgresql://postgres:xxx@db.REF.supabase.co:5432/postgres
DATABASE_SSL=true

# Identidad del operador (para reportes ICA y PDFs)
OPERATOR_NAME="..."
OPERATOR_REGION="Valle del Cauca"

# Health check (opcional)
HEALTH_TOKEN=...
```

---

## 10. Glosario

- **mu (亩)**: unidad china de área, 1 mu = 666.67 m² ≈ 0.0667 ha. DJI reporta áreas fumigadas en mu. AFM convierte a ha/m² para UI.
- **sortie**: un vuelo individual del dron. AFM tiene 1 fila por sortie en `dji_flights`.
- **fumigación**: evento de fumigación (puede comprender N sorties). AFM tiene 1 fila por evento en `dji_fumigations`.
- **cadencia**: cada cuántos días se debe fumigar una parcela. Vive en `dji_fumigation_schedule.recommended_cadence_days`. Default 14 días.
- **huérfana**: fumigación del import que no se pudo asociar a una parcela (spatial join falló). Se corrige manualmente en `/admin/orphan-fumigations`.
- **ICA**: Instituto Colombiano Agropecuario. `product_registered_ica` lleva el número de registro del agroquímico.
- **PCA / PC**: licencias de piloto de dron (Aerocivil). `pilot_license` en `dji_fumigations`.
- **T40 / T50 / T70 / T16 / T20**: modelos de dron DJI Agras. Mapeo en `dji_drone_models` (`code` 72, 201, 210).
- **drone_serial**: número de serie del dron (ej. `R1272065674`). Diferente al `drone_nickname` (ej. "AFM T40 1").
- **flight_records**: endpoint de la API DJI que AFM scrapea con Playwright para obtener las sorties individuales.
- **lands**: parcelas según el portal DJI Agras (`kr-ag2-api`). AFM las importa a `dji_parcels`.

---

## 11. Próximos pasos sugeridos (para que V0 no improvise)

1. **Replicar el shell** (sidebar + header + tipografía + colores) con la guía de la sección 5.
2. **Replicar `/` Dashboard** con un BentoGrid de 5 metric cards + 2 cards medianas + 1 card full-width. Datos mockeados si V0 no puede leer de Supabase.
3. **Replicar `/parcels`** con tabla sort/filter. Chips de cadencia.
4. **Replicar `/parcels/[id]`** con 3 paneles apilados (Fumigaciones, Historial, Detalle).
5. **Replicar `/map`** con un layout 60/40, mapa MapLibre y drawer de filtros.
6. **Replicar `/task-history`** (la más compleja — layout 60/40 con mapa + sidebar de días).
7. **Replicar `/parcels/overdue`** (la más simple después de /devices — tabla con 4 chips de resumen).
8. **Replicar `/admin/orphan-fumigations`** solo si vas a mantener el panel admin.

Si V0 no puede generar el mapa SIG completo en una sola pasada, generá primero el shell + dashboard + listado de parcelas, y después pedile el mapa por separado. Las pantallas más simples (overdue, devices) son ideales para iterar el sistema de design antes de ir a las más densas (task-history, parcel detail).

---

**Última actualización**: 2026-07-28 (sprint S5 cerrado — MapLibre + V0 port; S6 en curso)
**Mantenedor**: AeroAdmin AFM — single contributor
**Stack**: Next.js 16.2.4 · React 19.2.5 · TypeScript 5.9.3 · Tailwind 4.2.4 · MapLibre GL JS 6.0 · NextAuth 5.0 beta · PostGIS/Supabase
