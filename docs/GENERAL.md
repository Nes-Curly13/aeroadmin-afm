# AeroAdmin AFM — Documentación general

> **Fecha:** 2026-09-24 · **Versión:** 2.0 · **Estado:** Release Candidate.
> Reactualizado al `master` vigente (pipeline de fumigaciones reconstruido, geovisor
> Inspector, auditoría+mejora de UI).

## ¿Qué es AeroAdmin AFM?

Plataforma de gestión para un operador de drones de fumigación en el Valle del Cauca,
Colombia. **Single-tenant** (un cliente), **~1.200 parcelas**, **~16k vuelos** y
**~500 fumigaciones** reconstruidas (día + DBSCAN sobre los tracks).

**Funcionalidades core:**

- Inventario de parcelas con geometría PostGIS (EPSG:4326) + ficha/hoja de vida.
- Geovisor **map-first** (MapLibre + EOX Sentinel-2 / MapTiler) con **Inspector**
  unificado (parcela + fumigaciones) y **cobertura real** de cada aplicación.
- Registro de fumigaciones: **wizard de 3 pasos** (importar vuelo DJI o manual).
- **Ciclos productivos y fase** del cultivo (siembra/corte) → base de la cadencia.
- **Reportes PDF/CSV** por parcela y agregados por hacienda.
- **Importación GIS** de parcelas (KML/SHP/GPKG) + alta manual con dibujo de polígono.
- **Audit log** de fumigaciones (quién creó/editó/eliminó/restauró).
- **Planificación** de fumigaciones (agenda manual) en el dashboard.

**Stack:** Next.js 16 + React 19 + TypeScript 5 + Tailwind v4 + PostGIS + NextAuth v5 +
Playwright (scraper + E2E) + Vitest.

**Single-contributor** (@agFab). El cliente (operador cañero) consume la plataforma y
descarga reportes PDF/CSV para sus clientes y para auditoría ICA.

---

## Interfaz — capturas de pantalla

> Capturas ilustrativas de sprints previos (`screenshots/`). La UI evolucionó; validar
> contra la app corriendo.

### Dashboard (`/`)

KPIs (Fumigaciones, Área aplicada, Cobertura real, Volumen, Vuelos) con filtros por
período/hacienda/dron/estado, tendencia, cumplimiento de planificación, flota, mix por
categoría y agenda de fumigaciones.

![Dashboard cargado](../screenshots/32-dashboard-loaded.png)

### Inventario de parcelas (`/parcelas`)

Lista de parcelas con búsqueda y filtros (cliente, estado); botones admin de importar/crear.

![Listado de parcelas](../screenshots/32-parcelas-loaded.png)

### Ficha de parcela (`/parcelas/[id]`)

Ficha técnica: mapa, KPIs, ciclo/fase, historial de fumigaciones (timeline), cadencia y
sus cambios, manejo fitosanitario, form de fumigación y reportes PDF/CSV.

![Detalle de parcela](../screenshots/04-parcela-detail.png)

### Geovisor (`/geovisor`)

Mapa como **capa base** + **Inspector** (Contexto / Parcelas / Fumigaciones) + filtros
overlay (búsqueda, rango de fechas, capas, leyenda, basemap).

![Geovisor](../screenshots/32-geovisor-loaded.png)

### Listado de fumigaciones (`/fumigaciones`)

Registro unificado (DJI + manual) con filtros server-side y operaciones en bulk.

![Listado de fumigaciones](../screenshots/03-fumigaciones.png)

### Wizard de nueva fumigación (`/fumigaciones/nueva`)

Wizard 3 pasos: "¿Qué se fumigó?" → "¿Con qué se fumigó?" → "Confirmar".

![Nueva fumigación](../screenshots/28-fumigaciones-nueva-top.png)

### Importación GIS y alta manual de parcela

`/admin/parcels/import` (upload → preview → commit) y `/admin/parcels/new` (dibujo de
polígono con terra-draw).

![Import GIS — preview](../screenshots/16-import-preview.png)

### Panel admin (`/admin/parcels`)

Edición inline de Cliente/Finca (FK), municipio y variedad; búsqueda server-side.

![Panel admin de parcelas](../screenshots/30-fix-_admin_parcels.png)

---

## Reportes PDF/CSV

- **Por parcela**: botones PDF/CSV en la ficha; el PDF incluye imagen satelital real
  (EOX Sentinel-2) con el polígono.
- **Agregados**: página `/reportes` (2 tabs) con filtros de rango; PDF/CSV por hacienda.
- **Audit log**: panel "Historial" en `/fumigaciones/[id]` (timeline + diff por campo).

Detalle: `docs/features/reports/README.md`, `docs/audit/AUDIT_LOG.md`.

---

## Stack técnico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js | 16.2.4 |
| UI | React / Tailwind CSS / @base-ui/react | 19.2.5 / 4.2.4 / 1.6 |
| Mapas | MapLibre GL JS (+ EOX Sentinel-2 / MapTiler) | 4.7.1 |
| Auth | NextAuth v5 (beta.31) + bcryptjs | — |
| DB | Postgres 16 + PostGIS 3.4 (Docker local / Supabase prod) | — |
| Data access | `pg` puro + SQL (api/repositories + api/queries) | 8.20.0 |
| Reportes | Playwright + @sparticuz/chromium (PDF) | — |
| Tests | Vitest 3.2.4 + coverage-v8 + Playwright 1.61.1 | — |
| Scraper DJI | Playwright headless (`accept-language: zh-CN,zh`) | — |
| Deploy | Vercel | — |

---

## Arquitectura

```
[ DJI SmartFarm Web ] →(Playwright)→ djiag_exports/*.json →(scripts/pipeline)→ PostGIS
[ Operador ] →(UI: wizard/alta/ciclos) → /api/admin/* ────────────────────→ PostGIS
PostGIS → api/repositories+queries (cache) → app/ (server) → components/ (UI)
                                      └→ lib/reports (PDF/CSV)
```

**Capas:**

- `app/` — pages (server) + route handlers (`/api/**`). Auth + fetching.
- `api/` — data access (`repositories.ts`, `queries.ts`).
- `lib/` — lógica pura: `fumigation-cadence.ts` (CAD-001), `crop-cycle.ts`,
  `overdue-parcels.ts`, `format.ts`, `reports/`.
- `components/` — React; reciben datos por props; **no** importan `api/**` ni `lib/db.ts`.
- `scripts/` — CLI del pipeline DJI + mantenimiento.
- `db/migrations/` — migrations SQL.

**Convenciones:** `pg` nunca desde `app/`/`components/`; componentes por props; auth con
`requireRole(...)`; fechas al usuario por `lib/format.ts` (TZ `America/Bogota`); map-first.

Ver `docs/ARCHITECTURE.md`, `docs/TDD.md`, `docs/STACK.md`, `docs/ACTUALIZACION-DATOS.md`.

---

## Estado actual (Release Candidate)

| Métrica | Valor |
|---|---|
| Tests (Vitest) | **2371 verde** (175 archivos, con BD) |
| Arch:check | 0 errors |
| Build | ✅ verde |
| E2E (Playwright) | 50 passed / 3 skipped (env) / 1 fixme |
| Pages | `/`, `/parcelas`, `/parcelas/[id]`, `/fumigaciones`, `/fumigaciones/nueva`, `/fumigaciones/[id]`, `/fumigaciones/[id]/editar`, `/geovisor`, `/reportes`, `/login`, `/admin/**` |
| Migrations | `db/migrations/` (54+) |
| Parcelas | ~1.200 |
| Fumigaciones | ~500 reconstruidas (día + DBSCAN) |
| Vuelos | ~16k (`dji_flights`) |
| Cobertura | gate global 45% lines / 65% branches |

**Sprints recientes (2026-09):** pipeline de fumigaciones reconstruido (tracks KML →
cobertura real + regroup día+DBSCAN), geovisor con Inspector unificado, cadencia
unificada (CAD-001), **auditoría y mejora de UI** (shadcn, P0 del wizard, overlays,
map-first, tokens), plan de pruebas.

---

## Cómo correrlo en dev

```bash
npm ci
npm run db:up            # Postgres/PostGIS (Docker)
npm run db:migrate
npm run auth:seed        # admin inicial (AUTH_SEED_*)
npm run dev              # http://localhost:3000
```

Producción: deploy a Vercel con las env vars del template (`.env.example`). E2E local
requiere `.env.local` con `AUTH_TRUST_HOST=true` y una BD con datos.

Pipeline DJI:

```bash
npm run pipeline:djiag
npm run refresh:fumigations
npm run health:watchdog
```

---

## Roadmap

### 🟡 Backlog cercano

1. Regla de cadencia **formal** (umbral vencido/crítico) antes de reintroducir un panel de cumplimiento de cadencia.
2. Re-validar el **dibujo de polígono** (terra-draw) tras el rediseño de la toolbar (E2E `fixme`).
3. **Estado de error del mapa** en el geovisor (hoy solo loading).
4. Migración de tablas a `ui/table` + **card mobile** (responsive de datos densos).
5. `Sheets` reales en mobile para el geovisor (hoy rebalanceo por `minSize`).

### 🔵 Refinamiento (con data de campo)

6. Cadencias reales por parcela y **fecha de siembra** levantada en campo (base de la fase).
7. Productos comerciales por parcela (catálogo `products`).

---

## Deuda técnica documentada

- **`product_used` / `dose_l_per_ha`**: el scraper DJI no los trae; el catálogo `products`
  y el form manual los cubren parcialmente. Ver `docs/audit/DOSE_FIELDS_BACKFILL.md`.
- **Backfills operacionales** (una vez por ambiente): `scripts/backfill-clients-farms.js`
  y `POST /api/admin/cycles/backfill`.
- **Tracks**: 258 tracks sin vuelo y 452 vuelos sin track (completar si se re-scrapea).
- **Cadencia**: defaults conservadores hasta confirmar cadencias reales con el cliente
  (`docs/FUMIGATION_CADENCE.md`).

---

## Contacto

- **Repo**: `https://github.com/Nes-Curly13/aeroadmin-afm`
- **Operador fumigador**: cliente del Valle del Cauca, Colombia.
- **Dev**: @agFab (single-contributor).
- **Última actualización**: 2026-09-24.
