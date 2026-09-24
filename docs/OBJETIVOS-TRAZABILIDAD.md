# Trazabilidad Objetivos ↔ Implementación ↔ Evidencia

> Documento de cierre (2026-09-13). Mapea cada objetivo del documento de
> trabajo del proyecto contra la implementación real y **cómo demostrarlo**.
> Sirve para la sustentación: cada objetivo tiene artefactos citables.
>
> Estado global: **Release Candidate**, `tsc` 0, `arch:check` 0, suite de
> tests verde, master `2cd15bf`.

---

## 3. Objetivo General

> Diseñar e implementar un SIG integrado que permita la **estructuración,
> gestión, visualización y análisis** de los datos espaciales generados por
> la empresa en sus actividades de campo, para facilitar la **planificación,
> registro, seguimiento y toma de decisiones**.

| Capacidad | Implementación | Evidencia |
|---|---|---|
| **Estructuración** | PostGIS 3.4 / SRID 4326; 47 migrations; tablas `dji_parcels` (geometrías `spray_geom`/`reference_point`/`waypoints_geometry`), `dji_flights`, `dji_fumigations`, `clients`/`farms`/`cycles`/`cycle_events`, catálogos, audit log | `db/migrations/`, `docs/DATA-MODEL.md` |
| **Gestión** | UI admin de parcelas (alta, edición, geometría), catálogos (clientes/fincas/productos/vehículos) | `app/(auth)/admin/**` |
| **Visualización** | Geovisor MapLibre 4.7.1 con parcelas y fumigaciones; mapas de detalle; reportes con mapa satelital | `app/(auth)/geovisor`, `components/map/geo-map.tsx` |
| **Análisis** | Cadencia/vencimiento, cobertura por período, volumen mensual, fases de ciclo | `lib/fumigation-cadence.ts`, `lib/overdue-parcels.ts`, `lib/crop-cycle.ts` |
| **Planificación** | Panel de planificación en el dashboard (vencidas / por vencer) + columna "Próxima" por parcela | `components/dashboard/planning-panel.tsx`, `docs/FUMIGATION_CADENCE.md` (regla ratificada) |
| **Registro** | Wizard de fumigación (3 pasos, importar vuelo DJI o manual), alta de parcela, import SIG | `app/(auth)/fumigaciones/nueva`, `app/(auth)/admin/parcels/**` |
| **Seguimiento / decisión** | Dashboard con KPIs, últimas aplicaciones, reportes PDF/CSV, audit log; salud del pipeline vía API/watchdog | `app/(auth)/page.tsx`, `app/(auth)/reportes`, `fumigation_audit_log`, `GET /api/admin/djiag-health` |

---

## 3.1 Objetivos Específicos

### OE1 — Base de datos geográfica que estructure los datos espaciales ✅
- **Hecho**: esquema PostGIS completo con jerarquía **Cliente → Finca → Parcela**,
  geometrías, índices espaciales (GIST), soft-delete, auditoría.
- **Evidencia**:
  - `docs/DATA-MODEL.md` (columnas, relaciones, índices, invariantes).
  - Migrations `db/migrations/*.sql` (47, en orden cronológico).
  - Índices: `dji_flights.point` (GIST), `dji_parcels.spray_geom` (GIST).
  - Link Cliente/Finca aplicado: `20260913000002_link_parcels_clients_farms.sql`.
- **Demo**: mostrar `docs/DATA-MODEL.md` + una query de parcelas con geometría
  (`SELECT id, land_name, ST_Area(spray_geom) FROM dji_parcels ...`).

### OE2 — Interfaz web de gestión y visualización (consulta, registro, planificación) ✅
- **Consulta/visualización**: `/geovisor` (mapa), `/parcelas` (inventario con
  filtros y búsqueda), `/parcelas/[id]` (ficha), `/reportes` (PDF/CSV).
- **Registro**: `/fumigaciones/nueva` (wizard), `/admin/parcels/new` (dibujo de
  polígono), `/admin/parcels/import` (KML/shapefile/GPKG), catálogos.
- **Planificación**: panel `PlanningPanel` + regla de cadencia formalizada.
- **Evidencia**: rutas listadas + `docs/USER-FLOWS.md` + tests de componentes.
- **Demo**: login → dashboard (KPIs + planificación) → registrar fumigación →
  geovisor → exportar reporte.

### OE3 — Flujo de recolección/carga/actualización campo → sistema ✅
- **Recolección de campo**: el piloto vuela DJI Agras; SmartFarm sincroniza a
  la nube; el cliente headless (Playwright) captura la API interna.
- **Carga**: pipeline idempotente (scrape → upsert → spatial join → fumigaciones
  → lands) + import SIG para datos espaciales + carga manual.
- **Actualización**: `POST`/`PATCH` de fumigaciones, `refresh:fumigations`
  (cron semanal), watchdog de salud del pipeline.
- **Evidencia**: `docs/ARCHITECTURE.md`, `docs/DJI_SCRAPER.md`,
  `scripts/run-pipeline.js`, `scripts/refresh-fumigations.js`,
  `app/api/admin/djiag-health`.
- **Demo**: `npm run pipeline:djiag:dry`, `npm run refresh:fumigations`.

### OE4 — Documentar y capacitar al personal ✅ (documentación lista; falta el walkthrough)
- **Documentación técnica**: ✅ `docs/SDD.md`, `TDD.md`, `DATA-MODEL.md`,
  `ARCHITECTURE.md`, `STACK.md`, `DEPLOY.md`, `API-INVENTORY.md`.
- **Documentación del operador**: ✅ **hecha** (commit `220c691`):
  - `docs/manual-operador/**` (índice, login, dashboard, parcelas,
    fumigaciones, geovisor, reportes, administración, FAQ + glosario).
  - `docs/onboarding-operador.md` (Día 1 → Mes 1, checklist).
  - `docs/mantenimiento-operador.md` (6 casos "qué hacer cuando...").
  - `docs/disaster-recovery-operador.md` (5 casos de falla + contacto).
- **Capacitación efectiva**: ⏳ requiere el **walkthrough real** con el operador
  (seguir el onboarding sin ayuda). Meta: día 1 en <2h.

---

## Cómo demostrar cada objetivo en la sustentación

| Objetivo | Ruta / comando | Qué se ve |
|---|---|---|
| OE1 | `docs/DATA-MODEL.md` + query a `dji_parcels` | schema PostGIS, jerarquía, geometrías |
| OE2 consulta | `/geovisor`, `/parcelas`, `/reportes` | mapa, inventario, exportes |
| OE2 registro | `/fumigaciones/nueva`, `/admin/parcels/new`, `/admin/parcels/import` | wizard, dibujo de polígono, import SIG |
| OE2 planificación | `/` (dashboard) | panel vencidas / por vencer |
| OE3 | `docs/ARCHITECTURE.md` + `npm run refresh:fumigations` | flujo DJI → BD, cron |
| OE4 | `docs/manual-operador/00-indice.md` + walkthrough | manual + onboarding |

---

## Notas de alcance (decisiones registradas)

- **Planificación**: se implementó como **panel operativo** (vencidas/por
  vencer) sobre la cadencia real. No se hizo un módulo de calendario/tareas
  (fuera de alcance). Ver `docs/DEEPSEEK-PLAN-CIERRE.md` §0 (D3).
- **Análisis**: se cubrió el análisis **operativo** (cadencia, cobertura,
  volumen, fases, calidad). No incluye análisis GIS avanzado (buffers,
  intersecciones) — no requerido por el OG operativo (D5).
- **Flujo de campo**: DJI sync + import SIG + carga manual. Sin app móvil
  offline (D6).

---

## Pendiente para cerrar OE4 hoy

1. Ejecutar T-CAP-01 (4 agentes en paralelo) → `docs/manual-operador/**` +
   3 archivos de guía.
2. Walkthrough real con el operador (después del build de docs).
3. Capturas de pantalla (T-CAP-02, opcional).
