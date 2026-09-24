# AeroAdmin AFM — Overview General

> **Documento vivo.** Referencia de producto para entender el sistema y para la
> sustentación. Reescrito el **2026-09-24** contra el `master` actual.
>
> **Stack:** Next.js 16.2.4 · React 19.2.5 · TypeScript 5.9.3 · Tailwind v4.2.4 ·
> MapLibre GL JS 4.7.1 · NextAuth v5 (beta.31) · Postgres 16 + PostGIS 3.4 ·
> Playwright (scraper + E2E) · Vitest.
> **Idioma de UI:** español (operador cañero del Valle del Cauca, Colombia).

---

## 1. Resumen del producto

**AeroAdmin AFM** es la plataforma de gestión para un **operador de drones DJI Agras**
de fumigación (principalmente caña de azúcar). El sistema:

- **Ingesta** los datos de **DJI SmartFarm** (cliente headless de Playwright que captura
  su API interna) y los materializa en **Postgres + PostGIS**.
- **Visualiza** parcelas, vuelos, fumigaciones y su **cobertura real** en un geovisor
  map-first + dashboard + ficha de parcela.
- **Registra** fumigaciones (wizard, importando vuelo DJI o manual), altas de parcela,
  import SIG y **ciclos/fase** del cultivo.
- **Exporta** reportes PDF/CSV (operativo y por parcela/hacienda).
- **Roles**: `admin` (CRUD + admin) y `supervisor` (lectura + registro de fumigaciones).
- **Single-tenant**, single-contributor.

**Casos de uso núcleo:**

1. "¿Qué se fumigó y dónde?" → **`/fumigaciones`** + **`/geovisor`**.
2. "¿Dónde está cada parcela y su hoja de vida?" → **`/parcelas`** + **`/parcelas/[id]`**.
3. "¿Cuál es el estado operativo del mes?" → **`/`** (dashboard).
4. "¿Cómo se actualizan los datos?" → **`docs/ACTUALIZACION-DATOS.md`**.
5. "¿El sync con DJI está al día?" → **`GET /api/admin/djiag-health`** + watchdog.

---

## 2. Arquitectura y capas

```
DJI SmartFarm Web ─►(Playwright)─► djiag_exports/*.json ─► pipeline (scripts) ─► PostGIS
Operador/Admin ─►(UI)─► /api/admin/* ────────────────► PostGIS
PostGIS ─► api/repositories.ts + api/queries.ts + lib/cache.ts ─► app/ (server) ─► components/ (UI)
```

- `app/` — pages (server) + route handlers (`/api/**`). Auth + data fetching.
- `api/` — capa de data access (`repositories.ts`, `queries.ts`).
- `lib/` — lógica pura (cadencia `fumigation-cadence.ts`, `crop-cycle.ts`,
  `overdue-parcels.ts`, formatos, reports).
- `components/` — React; reciben data por props; **no** importan `api/**` ni `lib/db.ts`.
- `scripts/` — CLI del pipeline DJI + mantenimiento.
- `db/migrations/` — migrations SQL (`npm run db:migrate`).

**Reglas duras** (verificadas por `npm run arch:check`): `pg` nunca se importa desde
`app/` ni `components/`; los componentes reciben datos por props; auth con
`requireRole(...)`; fechas al usuario por `lib/format.ts` (TZ `America/Bogota`).

---

## 3. Modelo de datos (PostGIS, SRID 4326)

> Detalle completo (columnas, índices, invariantes): **`docs/DATA-MODEL.md`**.

| Tabla | Qué modela |
|---|---|
| **`dji_parcels`** | Parcela (jerarquía Cliente → Finca → Parcela; geometría `spray_geom`, `reference_point`, `waypoints`) |
| `clients` / `farms` | Catálogo de clientes y fincas (FK en `dji_parcels`) |
| **`dji_flights`** | Sortie individual de dron (1 fila por vuelo; `parcel_id` tras spatial join; `track`) |
| `dji_flight_tracks` | LineStrings de los tracks KML (cobertura real) |
| **`dji_fumigations`** | Evento de fumigación (manual / import / dji_aggr; `coverage`, `flight_ids`, soft-delete) |
| `fumigation_flights` | Join fumigaciones ↔ vuelos |
| `dji_fumigation_schedule` | Cadencia esperada por parcela (`next_due_date`) |
| **`cycles`** / `cycle_events` | Ciclos productivos por parcela + eventos (siembra/aplicación/corte/renovación) |
| `phase_application_rules` | Reglas de aplicación recomendadas por fase |
| `fumigation_audit_log` | Auditoría append-only (created/edited/deleted/restored) |
| `fumigation_plans` | Agenda manual de planes de fumigación |
| `dji_vehicles` / `products` | Catálogos (vehículos, productos) |
| `djiag_health` | Singleton con salud del último pipeline DJI |
| `app_users` | Usuarios (email + bcrypt + role) |

**Cadencia/fase:** derivadas de `cycles.start_date` y `lib/fumigation-cadence.ts`
(**fuente única** CAD-001). Ver §7.

---

## 4. Mapa de páginas → datos (app actual)

| Ruta | Página | Contenido principal |
|---|---|---|
| `/login` | Login (`(public)`) | Form + NextAuth credentials; sin shell |
| `/` | Panel de operaciones | KPIs (Fumigaciones, Área aplicada, Cobertura real, Volumen, Vuelos), filtros (período/hacienda/dron/estado/búsqueda), tendencia, cumplimiento de planificación, flota, mix por categoría, cobertura por hacienda, planificación |
| `/parcelas` | Inventario | Tabla con búsqueda + filtro cliente/estado + sort + paginación; botones admin (importar/crear) |
| `/parcelas/[id]` | Ficha de parcela | Mapa, KPIs, ciclo/fase, historial de fumigaciones (timeline), cadencia + cambios, manejo fitosanitario, form de fumigación, PDF/CSV |
| `/fumigaciones` | Listado | Filtros server-side (fecha/parcela/fuente/categoría/dron/texto), bulk (borrar/categoría), paginación |
| `/fumigaciones/nueva` | Wizard 3 pasos | "¿Qué se fumigó?" / "¿Con qué se fumigó?" / "Confirmar" (importar vuelo DJI o manual) |
| `/fumigaciones/[id]` | Detalle | Datos, mapa, vuelos, audit trail, facturas, editar/eliminar |
| `/fumigaciones/[id]/editar` | Edición | PATCH sparse del mismo form |
| `/geovisor` | Geovisor (map-first) | Mapa como capa base + **Inspector** (Contexto/Parcelas/Fumigaciones) + filtros overlay (búsqueda, rango, capas, leyenda, basemap) + KPIs |
| `/reportes` | Reportes | 2 tabs (Reporte operativo / Resumen por parcela) + KPIs + export CSV/PDF (admin) |
| `/admin` | Administración | Landing de herramientas internas |
| `/admin/parcels` | Admin parcelas | Edición inline (Cliente/Finca FK, municipio, variedad), búsqueda server-side |
| `/admin/parcels/new` | Alta manual | Form 3 secciones + mapa (terra-draw) |
| `/admin/parcels/import` | Import GIS | Wizard KML/SHP/GPKG (preview → commit) |
| `/admin/reglas-fitosanitarias` | Reglas | CRUD por fase (ventana/cadencia) + restaurar |

> **Retirados (2026-09-24):** `/admin/calidad`, `/admin/pipeline`, `/admin/applications`
> (features sin utilidad). La API `GET /api/admin/djiag-health` y el watchdog siguen.

---

## 5. Roles y permisos (gate server-side)

| Ruta | `supervisor` | `admin` | Sin sesión |
|---|---|---|---|
| `/`, `/parcelas`, `/geovisor`, `/reportes`, `/fumigaciones` | ✅ | ✅ | → `/login` |
| `/fumigaciones/nueva` (registro manual) | ✅ | ✅ | → `/login` |
| `/admin/**` (parcelas, import, reglas) | ❌ | ✅ | → `/login` |
| Endpoints `/api/admin/**` | 403 | ✅ | 401 |

Patrón: `const session = await auth(); if (role !== "admin") notFound();` y
`requireRole([...])` en los handlers. Detalle: `docs/TDD.md`.

---

## 6. Design system

- **Tokens shadcn** sobre Tailwind v4 (`app/globals.css`, `@theme inline`): `--primary`,
  `--background`, `--card`, `--muted`, `--border`, `--destructive`, `--chart-1..5`, y
  semánticos propios: **`--warning`**, **`--orphan`**.
- **Tipografía**: **Manrope** (sans) + **JetBrains Mono** (mono).
- **Primitives propios** sobre `@base-ui/react` en `components/ui/` (button, card, badge,
  input, select, field-select, table, tabs, dialog, alert-dialog, sheet, collapsible,
  dropdown-menu, popover, scroll-area, skeleton, alert, empty, toggle(-group), tooltip,
  progress, separator, slider, loading).
- **Iconos**: `lucide-react` (una sola familia).
- **Simbología de mapas**: fuente única `lib/map-palette.ts`.
- **Layout**: `flex`/`grid`/`gap`, `min-w-0`/`min-h-0`, sin alturas mágicas; map-first
  en el geovisor. Reglas de proyecto: **`skills/aeroadmin-ui/SKILL.md`**.

---

## 7. Actualización de datos (referencia)

Ver **`docs/ACTUALIZACION-DATOS.md`** (documento dedicado). Resumen:

- **A. Sincronización DJI** — cliente Playwright → `djiag_exports/*.json`.
- **B. Pipeline** (`npm run pipeline:djiag`) — 10 steps idempotentes → PostGIS.
- **C. Reconstrucción de fumigaciones** — `import-flight-tracks` → `regroup-dbscan`
  (día + DBSCAN ~330 m + cobertura real) → `assign-orphan-parcels` → `create-auto-parcels`.
- **D. Cron** — `refresh:fumigations` (lunes 01:00 Bogotá) + watchdog.
- **E. Manual** — UI/API (`/api/admin/*`): fumigaciones, parcelas, ciclos, catálogos.
- **F. Backfills** — clients/farms, cycles, lands, tracks, seeds.

**Campo:** la fase/cadencia depende de `cycles.start_date` (fecha de siembra), que
**se asigna/actualiza en campo desde la plataforma**. Sin ese levantamiento, la cadencia
no se muestra como métrica de cumplimiento.

---

## 8. Cómo correrlo en dev

```bash
npm ci
npm run db:up            # Postgres/PostGIS en Docker
npm run db:migrate
npm run auth:seed        # admin inicial (AUTH_SEED_*)
npm run dev              # http://localhost:3000
# E2E local: requiere AUTH_TRUST_HOST=true en .env.local y una BD con datos.
npm run e2e
```

---

## 9. Glosario

- **Parcela / suerte**: unidad de terreno con geometría; jerarquía Cliente → Finca → Parcela.
- **Sortie** (vuelo): un vuelo individual del dron (`dji_flights`).
- **Fumigación**: evento de aplicación (puede comprender N vuelos) (`dji_fumigations`).
- **Cobertura real**: unión de los tracks del vuelo con buffer (2 m) — `coverage`.
- **Cadencia / fase**: días entre aplicaciones / etapa fenológica; derivadas del ciclo.
- **Huérfana**: fumigación sin parcela (`needs_parcel_assignment`); se asigna o se le crea
  parcela automática.
- **ICA / PCA**: registro del agroquímico / licencia del piloto (Aerocivil).
- **T40/T50/T70/T16/T20**: modelos DJI Agras (`dji_drone_models`).
- **mu (亩)**: unidad china de área (1 mu ≈ 666.67 m²); DJI reporta en mu, la UI en ha/m².
- **health / watchdog**: estado del pipeline DJI (`djiag_health` + `GET /api/admin/djiag-health`).

---

## 10. Documentos relacionados

`docs/SDD.md`, `docs/TDD.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`,
`docs/DATA-MODEL.md`, `docs/API-INVENTORY.md`, `docs/ACTUALIZACION-DATOS.md`,
`docs/FUMIGATION_CADENCE.md`, `docs/USER-FLOWS.md`, `docs/UI-AUDIT.md`,
`docs/PLAN-PRUEBAS-FUNCIONALIDAD-USABILIDAD.md`, `skills/aeroadmin-ui/SKILL.md`.

---

**Última actualización:** 2026-09-24 · **Mantenedor:** @agFab (single contributor)
