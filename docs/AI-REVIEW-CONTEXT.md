# AeroAdmin AFM — AI Review Context

> **Snapshot 2026-09-08**, master `3414c05` + working tree (parcel-drawer fixes in progress).
> **Purpose**: give Claude (or any AI reviewer) a complete context dump of the project so it can review and implement recommendations from `docs/REVIEW-PARCELAS-FUMIGACIONES.md` without having to grep through 40 migrations and 80+ pages.

---

## 0. TL;DR

**AeroAdmin AFM** is a Next.js 16 + React 19 admin panel for a sugarcane drone fumigation operator in Valle del Cauca, Colombia. Single-tenant, single-user (the operator). ~1,213 fincas, ~16k flights, ~17k fumigaciones.

**Stack**: Next.js 16.2.4, React 19, TypeScript 5.9, MapLibre GL 4.7.1, NextAuth v5 (beta.31), PostGIS 3.4 + Supabase, Tailwind v4, Vitest 3.2.4, Playwright 1.61.1, zod 4.5.4.

**Goal of this doc**: a reviewer (human or AI) can read this top-level index + the 3 reference docs (DATA-MODEL, API-INVENTORY, USER-FLOWS) + the critical review, and be ready to plan and implement the next sprint.

## 1. The 4 reference docs (read in this order)

1. **[`docs/AEROADMIN-AFM-OVERVIEW.md`](AEROADMIN-AFM-OVERVIEW.md)** — Product overview (V0, data model, roles, use cases). The "what & why" doc.
2. **[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)** — Data flow (dron → DJI SmartFarm → Playwright scraper → Postgres → Next.js). The "how it works" doc.
3. **[`docs/SDD.md`](SDD.md)** — Software design (modules, conventions, layout, primitives). The "code organization" doc.
4. **[`docs/TDD.md`](TDD.md)** — Technical design (UI patterns, MapLibre setup, derived state). The "code patterns" doc.

**Then** (for full review context):
5. **[`docs/DATA-MODEL.md`](DATA-MODEL.md)** — PostGIS schema with all tables, FKs, indices, business rules. The "DB truth" doc.
6. **[`docs/API-INVENTORY.md`](API-INVENTORY.md)** — 32 route handlers with auth, purpose, shapes. The "API truth" doc.
7. **[`docs/USER-FLOWS.md`](USER-FLOWS.md)** — 15 user flows (login, dashboard, geovisor, parcels, fumigaciones, reports, admin). The "what the operator does" doc.
8. **[`docs/REVIEW-PARCELAS-FUMIGACIONES.md`](REVIEW-PARCELAS-FUMIGACIONES.md)** — **THE CRITICAL REVIEW** with 4 P0, 7 P1, 8 P2 + 4-step plan to close the operational chapter.

## 2. The critical review in 30 seconds

| Severity | Count | Top examples |
|---|---|---|
| **P0 (correctness/data)** | 4 | **CAD-001**: 3+ definitions of "vencida" with thresholds 1d vs 7d vs 10d. **FUM-001**: 2,000-fumigation cap silently truncates timelines. **CAD-002**: 2 `effectiveCadence` functions with same name, different contracts. **AUD-001**: audit log is fire-and-forget on regulatory hot path. |
| **P1 (UX/architecture)** | 7 | `/fumigaciones` no auth gate; double data fetch; misleading docstring; 13-field form; bulk select on current page; ISO timestamp silently misbehaves; interval slice off-by-one. |
| **P2 (drift/polish)** | 8 | Doc drift, role naming, legacy code, scope drift, etc. |

**Plan to close the chapter** (4 steps, ~3.5 days, 4-6 PRs):
1. Unify cadence (CAD-001 + CAD-002 + DOC-001) — 0.5d
2. Remove silent 2,000 cap (FUM-001) — 0.5d
3. Audit log integrity (AUD-001) — 1d
4. Refactor for scale (TECH-001, TECH-002, UX-003, UX-005) — 1.5d

## 3. The data model in 60 seconds

**Postgres 16 + PostGIS 3.4**. Single-tenant.

**Core tables** (in `dji_*` namespace, legacy from scraper):
- `dji_parcels` (~1,213) — fincas, with PostGIS polygon + supervisor metadata + FK to clients/farms
- `dji_flights` (~16k) — individual drone flights, with PostGIS point + GIST index
- `dji_fumigations` (~17k, soft-delete aware) — sprayings, manual or aggregated from DJI flights
- `dji_fumigation_schedule` (1:1 with parcels) — expected cadence per parcela

**Catalogs**: `fumigation_categories`, `application_types`, `dji_vehicles`, `products`, `clients`, `farms`, `cycles`, `cycle_events`, `phase_rules`.

**Audit**: `fumigation_audit_log` (append-only, JSONB `changes` with `created`/`edited`/`deleted`/`restored` actions).

**40 migrations** in `db/migrations/` with `YYYYMMDDHHMMSS_*.sql` naming. NEVER in `supabase/migrations/`.

See `docs/DATA-MODEL.md` for full schema.

## 4. The API in 60 seconds

**32 route handlers** under `app/api/`. NextAuth v5 (beta.31) cookie-based session. **All mutating endpoints** validate with zod 4.5.4 (Sprint Quality Gauntlet #1). **All mutating endpoints** write to `fumigation_audit_log` (fire-and-forget — see AUD-001).

Categories:
- **Auth** (1): `/api/auth/[...nextauth]`
- **Parcels** (8): CRUD + GIS import + reports
- **Fumigaciones** (9): CRUD + bulk ops + invoices + reports + restore
- **Catalogs** (8): clients, farms, cycles, vehicles, products, djiag-health
- **Reports** (3): farms/flights CSV+PDF
- **Data quality** (1): invariants check
- **DJI** (1): flight search for wizard
- **Internal** (1): print-map (no auth, local only)

See `docs/API-INVENTORY.md` for full inventory with auth requirements.

## 5. The flows in 60 seconds

**15 key flows** the operator does day-to-day:

1. **Login** → `/login` (no AppShell, public)
2. **Dashboard** → `/` (KPIs, cadencia, health)
3. **Geovisor** → `/geovisor` (mapa con eventos recientes, 90d default)
4. **Parcelas** → `/parcelas` (inventario con search + filters)
5. **Detalle de finca** → `/parcelas/[id]` (timeline + cadencia + intervalo)
6. **Nueva fumigación** → `/fumigaciones/nueva` (wizard 4 steps)
7. **Lista fumigaciones** → `/fumigaciones` (URL-driven filters + bulk ops)
8. **Detalle fumigación** → `/fumigaciones/[id]`
9. **Editar fumigación** → `/fumigaciones/[id]/editar`
10. **Reportes** → `/reportes` (3 tabs + exports)
11. **Data quality** → `/admin/calidad` (5 invariant patterns)
12. **Admin GIS import** → `/admin/parcels/import` (wizard 3 steps)
13. **Crear parcela manual** → `/admin/parcels/new` (form + mapa)
14. **Auth + roles** (cross-cutting: admin / supervisor)
15. **Resumen de paths** (table with all paths + auth)

See `docs/USER-FLOWS.md` for full step-by-step.

## 6. The team's working agreements (R1-R6 from AGENTS.md)

These are enforced by CI. Don't break them.

- **R1**: `pg` NUNCA se importa desde `app/` ni `components/`. Data access pasa por `api/repositories.ts` + `api/queries.ts`. `lib/data.ts` (V0 adapter) es el único punto que re-exporta mapeado a shapes V0.
- **R2**: Scraping DJI (`lib/djiag-korean-client.js`, fetchers) NUNCA desde `app/**`. Excepción: `lib/djiag-spatial-aggregator.ts`, `lib/djiag-health.ts`, `lib/djiag-from-make/*` (lógica pura) sí pueden usarse desde `app/api/**/route.ts`.
- **R3**: Tests obligatorios para código nuevo en `lib/`. Coverage global gate: 45% lines / 65% branches.
- **R4**: Fechas siempre via `lib/format.ts` (`toDateString`, `formatToDateString`, `fmtTime`). TZ `America/Bogota`.
- **R5**: Roles: `admin` y `supervisor`. `getViewerRole()` en `lib/auth/role.ts`. PII y secrets NUNCA en logs, comments, fixtures de test.
- **R6**: Migrations en `db/migrations/` con timestamp `YYYYMMDDHHMMSS_*.sql`.

## 7. The key docs (full list, in priority order)

| Doc | Purpose |
|---|---|
| `AGENTS.md` (root) | Index, R1-R6, comandos. **LEER PRIMERO** |
| `docs/AEROADMIN-AFM-OVERVIEW.md` | Product overview (V0, data model, roles) |
| `docs/ARCHITECTURE.md` | Data flow (dron → DB) |
| `docs/SDD.md` | Software design |
| `docs/TDD.md` | Technical design (UI patterns) |
| `docs/STACK.md` | Stack y gotchas |
| `docs/SPEC.md` | Historical product spec (V0 mockup) |
| `docs/DATA-MODEL.md` | **PostGIS schema completo** |
| `docs/API-INVENTORY.md` | **32 endpoints** |
| `docs/USER-FLOWS.md` | **15 flujos del operador** |
| `docs/REVIEW-PARCELAS-FUMIGACIONES.md` | **THE CRITICAL REVIEW** (4 P0 + 7 P1 + 8 P2) |
| `docs/FUMIGATION_CADENCE.md` | Regla de cadencia (DRIFT — está mal, ver CAD-001) |
| `docs/QUALITY_GAUNTLET.md` | 7 compuertas de calidad (4 cerradas: zod; 3 pendientes: StrykerJS, Gherkin, smoke DB) |
| `docs/PLAN-FUMIGACIONES-V2.md` | S11+ V2 plan cerrado (wizard UX + Cliente/Finca + Ciclos) |
| `docs/HANDOFF-2026-09-02.md` | Handoff del 2026-09-02 (estado del proyecto al ausentarse) |
| `docs/BUG-2-AUTH-DIAGNOSTIC.md` | Diagnóstico de Bug 2 (geovisor sin login) — RESUELTO en PR #67 |
| `docs/V0_ADAPTATION.md` | Bitácora S5/S6 (port del mockup V0) |
| `docs/DJI_SCRAPER.md` + `docs/DJI_CLOUD_API.md` | Scraper DJI (la parte más frágil) |
| `docs/DEPLOY.md` | Vercel deploy |
| `docs/HEALTH-WATCHDOG.md` + `docs/HEALTH-WATCHDOG-NGROK-SETUP.md` | Health check del scraper |
| `docs/ICA-COMPLIANCE.md` | Compliance ICA/Aerocivil |
| `docs/QA_REPORT_2026-08-11.md` | QA pass del 2026-08-11 (9 findings, todos resueltos) |
| `docs/TEST-PLAN-V2.md` | Test plan manual del operador |
| `docs/S10-5-FINALIZACION.md` | Plan de cierre S10.5 |
| `docs/KNIP_INVENTORY.md` | Inventario de dead code (knip) |
| `docs/BACKUP.md` | Snapshot antes de migrations masivas |

## 8. Quick reference: how to run

```powershell
# Levantar dev
cd C:\dev\DroneFlightAFM
npm install
npm run dev                  # puerto 3000

# Compuertas
npm run arch:check           # 0 errors esperado
npm run test:coverage        # verde, gate 45/65
npx tsc --noEmit             # 0 errors
npm run build                # verde

# DB
npm run db:up                # docker compose
npm run db:migrate           # corre migrations

# E2E
npm run e2e                  # Playwright (puerto 3001)
npm run e2e:auth             # solo auth
npm run e2e:map              # solo map

# Pipeline DJI (NO correr si el agente paralelo está activo)
npm run pipeline:djiag
```

## 9. Open work (current state)

- **PRs abiertos**: PR #39 (rename index — cosmético)
- **In flight**: parcel-drawer QA fixes in `components/admin/parcels/` (working tree, no commit)
- **3 PRs S10.5 mergeables**: #36 (auth route group, MERGED), #37 (SVG, MERGED as #68), #38 (cache, MERGED as #59? verificar)
- **Sprint queue (post-S10.5)**: implementar el plan de 4 steps del review crítico

## 10. The recommendation (concrete)

**Si vas a implementar las recomendaciones del review crítico, en este orden**:

1. **Step 1 — Unify cadence** (`Step 1` en REVIEW-PARCELAS-FUMIGACIONES.md §7). 0.5d. PR simple. Resuelve CAD-001 + CAD-002 + DOC-001. Antes de empezar, leer:
   - `lib/fumigation-cadence.ts` (la lógica real con phase/season/crop)
   - `lib/overdue-parcels.ts` (la duplicación)
   - `lib/data-constants.ts#complianceStatus` (la regla 4-level)
   - `docs/FUMIGATION_CADENCE.md` (el doc a actualizar)
   - `tests/lib/fumigation-cadence.test.ts` (los tests existentes)
   - `tests/api-repositories-effective-cadence.test.ts` (testea la función equivocada, hay que actualizar)

2. **Step 2 — Remove silent 2,000 cap**. 0.5d. PR simple. Resuelve FUM-001. Antes de empezar, leer:
   - `lib/data.ts:512` (el cap en `loadDataset`)
   - `app/(auth)/fumigaciones/data-loader.tsx:90` (el cap en el loader)
   - `components/parcels/parcels-table.tsx:91-96` (cómo se muestra el cap actual)

3. **Step 3 — Audit log integrity**. 1d. PR medio. Resuelve AUD-001 + UX-002 + UX-007. Antes de empezar, leer:
   - `lib/fumigation-audit.ts` (el fire-and-forget wrapper)
   - `lib/fumigation-audit-trail.tsx` (cómo se muestra al usuario)
   - Los 4 route handlers que llaman a `recordFumigation*`

4. **Step 4 — Refactor for scale**. 1.5d. 2-3 PRs. Resuelve TECH-001, TECH-002, UX-003, UX-005. Más invasivo — leer el review §3 P1 + §4 P2.

---

**Si todo esto está OK, el equipo puede declarar "capítulo operativo cerrado" y arrancar S10.6 (Quality Gauntlet compuertas 5-7, wire-up CSV/PDF con date range, refactor a `app/(auth)/` route group).**
