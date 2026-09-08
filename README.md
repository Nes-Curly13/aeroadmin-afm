# AeroAdmin AFM

> **Admin panel** para un operador de drones cañero en Valle del Cauca, Colombia.
> Single-tenant, single-user. ~1,213 fincas, ~16k vuelos, ~17k fumigaciones.

Captura datos de DJI SmartFarm (vía Playwright headless), los persiste en PostGIS, y los expone vía Next.js con un panel admin para que el operador fumigador registre fumigaciones manuales, vea cadencia esperada vs observada, y exporte reportes ICA/Aerocivil.

**Stack**: Next.js 16.2.4 + React 19 + TypeScript 5.9 + MapLibre GL 4.7.1 + NextAuth v5 (beta.31) + PostGIS 3.4 + Supabase + Tailwind v4 + Vitest 3.2.4 + Playwright 1.61.1 + zod 4.5.4.

---

## 🚀 Setup

```powershell
# 1. Clonar e instalar
cd C:\dev\DroneFlightAFM
npm install

# 2. Configurar variables de entorno
Copy-Item .env.example .env.local
# Editar .env.local con tu DATABASE_URL (Supabase pooled URL, puerto 6543)
# y AUTH_SECRET (openssl rand -base64 32)

# 3. Levantar DB local (opcional, solo si querés desarrollar contra docker en vez de Supabase)
npm run db:up
npm run db:migrate

# 4. Sembrar usuario admin (necesario para login)
$env:AUTH_SEED_EMAIL = "admin@aeroadmin.local"
$env:AUTH_SEED_PASSWORD = "AFM-admin-2026!"
npm run auth:seed

# 5. Dev server
npm run dev
# → http://localhost:3000
```

### Variables de entorno mínimas

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Supabase pooled URL (`postgresql://...pooler.supabase.com:6543/postgres`) |
| `DATABASE_URL_DIRECT` | (opcional) URL directa (puerto 5432, IPv6) para tareas admin |
| `DATABASE_SSL` | `true` para Supabase |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` (dev) / `https://aeroadmin-afm.vercel.app` (prod) |

---

## 🗺️ Rutas principales

### UI (AppShell, requieren auth)
| Path | Vista |
|---|---|
| `/` | Dashboard con KPIs (parcelas, vuelos, fumigaciones, cadencia, salud pipeline) |
| `/geovisor` | Mapa MapLibre con fumigaciones, lista lateral de eventos, date range |
| `/parcelas` | Inventario con búsqueda, filtros, sort, admin buttons |
| `/parcelas/[id]` | Detalle de finca (timeline, cadencia, intervalo, mapa) |
| `/fumigaciones` | Lista unificada DJI + manuales con filtros URL-driven + bulk ops |
| `/fumigaciones/nueva` | Wizard 4 steps (mode/pick/form/confirm) |
| `/fumigacion/[id]` | Detalle de fumigación (singular) con audit trail + invoices |
| `/fumigacion/[id]/edit` | Editar fumigación |
| `/reportes` | 3 tabs (Resumen / Por hacienda / Detalle) + exports CSV/PDF |
| `/admin/calidad` | 5 patrones de data quality (admin) |
| `/admin/parcels/new` | Crear parcela manual con mapa (admin) |
| `/admin/parcels/import` | Wizard 3 steps de import GIS KML/SHP/GPKG (admin) |

### UI (público)
| Path | Vista |
|---|---|
| `/login` | Login con `admin@aeroadmin.local` / `AFM-admin-2026!` |

### API
32 route handlers en `app/api/`. Ver **[`docs/API-INVENTORY.md`](docs/API-INVENTORY.md)** para inventario completo con auth y shapes.

---

## 🛠️ Comandos principales

| Acción | Comando |
|---|---|
| Dev server | `npm run dev` (puerto 3000) |
| Tests | `npm test` |
| Tests con coverage | `npm run test:coverage` (gate 45/65) |
| Build | `npm run build` |
| Architecture check | `npm run arch:check` (dep-cruiser) |
| TypeScript check | `npx tsc --noEmit` |
| E2E (Playwright) | `npm run e2e` (puerto 3001) |
| DB up | `npm run db:up` (docker compose) |
| DB migrate | `npm run db:migrate` (aplica `db/migrations/*.sql`) |
| Seed admin user | `npm run auth:seed` |
| Pipeline DJI | `npm run pipeline:djiag -- --days 30` |
| Health check scraper | `npm run health:watchdog` |

---

## 📦 Modelo de datos (PostGIS + catálogos)

40 migrations en `db/migrations/`. Tablas núcleo:

- **`dji_parcels`** (1,213) — fincas con polígono PostGIS + metadata supervisor + FK clients/farms
- **`dji_flights`** (16k) — vuelos individuales con centroide PostGIS (GIST index)
- **`dji_fumigations`** (17k, soft-delete) — fumigaciones (DJI + manuales + multi-parcela)
- **`dji_fumigation_schedule`** (1:1 con parcels) — cadencia esperada
- **`products`** — catálogo curado de fumigación (Sprint S8 Bloque E)
- **`clients` + `farms`** — normalización S11+
- **`cycles` + `cycle_events` + `phase_rules`** — capa de gestión de ciclos
- **`fumigation_audit_log`** — append-only, JSONB `changes`, 4 actions (created/edited/deleted/restored)

Ver **[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)** para el schema completo con FKs, indices, business rules.

---

## 🔄 Pipeline DJI (scraping → DB)

```powershell
# Full pipeline, últimos 30 días (login + scrape + ingestión):
npm run pipeline:djiag -- --days 30

# Solo ingestión (usar exports existentes):
npm run pipeline:djiag -- --skip-scrape --skip-fetch-lands

# Dry-run (ver qué comandos correría):
npm run pipeline:djiag:dry
```

### Pasos ejecutados (en orden)

| # | Paso | Qué hace | Comando manual |
|---|---|---|---|
| 1 | scrape per-flight | Playwright → `djiag_exports/perflight_records.json` | `node scrape_djiag_perflight.js --days 30` |
| 2 | scrape fumigations | Playwright → `djiag_exports/fumigations.json` | `node scrape_djiag_records.js --days 30` |
| 3 | upsert flights | → DB `dji_flights` | `node scripts/upsert-flights-from-djiag.js` |
| 4 | spatial join | `dji_flights.parcel_id` ← `dji_parcels.spray_geom` | `node scripts/spatial-join-flights-parcels.js --tolerance 10000` |
| 5 | upsert fumigations | → DB `dji_fumigations` (parcel_id NULL) | `node scripts/upsert-fumigations-from-djiag.js` |
| 6 | backfill per-parcel | `dji_flights` → `dji_fumigations` (parcel_id NOT NULL) | `node scripts/backfill-fumigations-from-flights.js` |
| 7 | update schedule | `dji_fumigation_schedule.last/next_due_date` | `node scripts/update-fumigation-schedule.js` |
| 8 | fetch lands | Playwright + GraphQL → `djiag_exports/lands.json` | `node scripts/fetch-lands-from-djiag.js` |
| 9 | upsert lands | → DB `dji_parcels` (columnas API) | `node scripts/upsert-lands-from-djiag.js` |

### Flags del pipeline

- `--days N` — ventana de scraping (default 30)
- `--tolerance M` — distancia máx en metros para spatial join (default 500; 10000 = ~10 km permisivo)
- `--skip-scrape` — no re-scrapear; usar `djiag_exports/`
- `--skip-fetch-lands` — solo fumigations + flights
- `--start-from STEP` / `--stop-at STEP` — sub-set (número o substring del nombre)
- `--dry-run` — loguea sin ejecutar

---

## 🔐 Auth + roles

NextAuth v5 (beta.31) con Credentials provider contra `app_users.password_hash` (bcrypt). Middleware en `proxy.ts` (Next.js 16, antes `middleware.ts`) checkea `authConfig.callbacks.authorized`.

- **admin**: full access. Ve botones de import GIS, crear parcela, bulk ops, audit.
- **supervisor**: read-only + puede registrar fumigaciones manuales.

**5 usuarios** sembrados en `app_users`:
- `admin@aeroadmin.local` / `AFM-admin-2026!` (admin, recién reseedeado)
- 4 supervisores (passwords desconocidas — reseed con `AUTH_SEED_EMAIL=... npm run auth:seed`)

---

## ✅ Compuertas (CI enforces)

| Compuerta | Comando | Esperado |
|---|---|---|
| Architecture | `npm run arch:check` | 0 errors, 0 warnings |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Tests | `npm run test:coverage` | verde, gate 45/65 |
| Build | `npm run build` | verde |
| Docs | docs consistency check | verde |

---

## 📚 Documentación

| Doc | Para qué |
|---|---|
| **[`AGENTS.md`](AGENTS.md)** | Index, R1-R6, comandos. **LEER PRIMERO** |
| **[`docs/AI-REVIEW-CONTEXT.md`](docs/AI-REVIEW-CONTEXT.md)** | Master index para AI review (Claude, etc.) |
| **[`docs/REVIEW-PARCELAS-FUMIGACIONES.md`](docs/REVIEW-PARCELAS-FUMIGACIONES.md)** | Review crítico: 4 P0 + 7 P1 + 8 P2 + plan de cierre |
| **[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)** | Schema PostGIS completo |
| **[`docs/API-INVENTORY.md`](docs/API-INVENTORY.md)** | 32 route handlers |
| **[`docs/USER-FLOWS.md`](docs/USER-FLOWS.md)** | 15 flujos del operador |
| [`docs/AEROADMIN-AFM-OVERVIEW.md`](docs/AEROADMIN-AFM-OVERVIEW.md) | Overview del producto |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Data flow end-to-end |
| [`docs/SDD.md`](docs/SDD.md) | Software design |
| [`docs/TDD.md`](docs/TDD.md) | Technical design (UI patterns) |
| [`docs/STACK.md`](docs/STACK.md) | Stack y gotchas |
| [`docs/FUMIGATION_CADENCE.md`](docs/FUMIGATION_CADENCE.md) | Regla de cadencia (**drift**, ver review) |
| [`docs/QUALITY_GAUNTLET.md`](docs/QUALITY_GAUNTLET.md) | 7 compuertas de calidad |
| [`docs/HANDOFF-2026-09-02.md`](docs/HANDOFF-2026-09-02.md) | Handoff del operador |
| [`docs/PLAN-FUMIGACIONES-V2.md`](docs/PLAN-FUMIGACIONES-V2.md) | S11+ V2 plan cerrado |
| [`docs/BUG-2-AUTH-DIAGNOSTIC.md`](docs/BUG-2-AUTH-DIAGNOSTIC.md) | Bug 2 (resuelto en PR #67) |
| [`docs/DJI_SCRAPER.md`](docs/DJI_SCRAPER.md) + `docs/DJI_CLOUD_API.md` | Scraper DJI |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Vercel deploy |
| [`docs/TEST-PLAN-V2.md`](docs/TEST-PLAN-V2.md) | Test plan manual del operador |

---

## 🛡️ Reglas duras (CI enforces)

- **R1**: `pg` NUNCA se importa desde `app/` ni `components/`. Data access pasa por `api/repositories.ts` + `api/queries.ts`. `lib/data.ts` (V0 adapter) es el único punto que re-exporta mapeado a shapes V0.
- **R2**: Scraping DJI NUNCA desde `app/**`. Excepción: lógica pura (`lib/djiag-spatial-aggregator.ts`, `lib/djiag-health.ts`, `lib/djiag-from-make/*`) puede usarse desde `app/api/**/route.ts`.
- **R3**: Tests obligatorios para código nuevo en `lib/`. Coverage global gate 45% lines / 65% branches.
- **R4**: Fechas siempre via `lib/format.ts`. TZ `America/Bogota`. Tests con `toLocaleDateString` o `new Date` son TZ-fragiles.
- **R5**: Roles: `admin` y `supervisor`. `getViewerRole()` en `lib/auth/role.ts`. PII y secrets NUNCA en logs.
- **R6**: Migrations en `db/migrations/` con timestamp `YYYYMMDDHHMMSS_*.sql`. Aplicar con `npm run db:migrate`.

---

## 🚧 Trabajo en curso (S10.5)

- PR #39 abierto: rename `idx_fumigations_product_id` → `idx_dji_fumigaciones_product_id` (cosmético)
- 3 PRs mergeados: #36 (auth route group), #37 → #68 (SVG 400), #38 → #59 (cache coalescing)
- **Plan inmediato** (4 steps del review crítico): unificar cadencia, quitar cap silencioso de 2000 fumigaciones, audit log integrity, refactor para escala

---

## 📊 Métricas actuales (master `b6f0358`)

- **Parcelas**: 1,213
- **Vuelos DJI**: 16,353
- **Fumigaciones** (activas): ~17,000
- **PRs mergeados**: 68+ (10 S7 + 7 S8 + 4 S9 + 5 S10 + 14 S11+ + 4 S10.5 + Quality Gauntlet zod 3)
- **Tests**: 1,840+ verde
- **Migrations**: 40 SQL files
- **Coverage**: 45% lines / 65% branches (gate)

---

**Mantenedor**: @agFab (single contributor)
**Última actualización**: 2026-09-08
