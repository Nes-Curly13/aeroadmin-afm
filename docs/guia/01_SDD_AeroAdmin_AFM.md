# SDD — System Design Document
## AeroAdmin AFM (Panel SIG para fumigación con drones DJI Agras)

> Audiencia: agentes de IA (Claude Code y similares) que van a desarrollar sobre este repo.
> Este documento describe **qué es el sistema y cómo está construido**, no cómo probarlo
> (ver `02_TDD_AeroAdmin_AFM.md`) ni cómo comportarse trabajando en él (ver
> `03_MEJORES_PRACTICAS_AGENTES.md`).
> Fuente de verdad complementaria: `docs/STACK.md`, `ARCHITECTURE.md`, `docs/SPEC.md`.

---

## 1. Propósito y alcance

AeroAdmin AFM es un **SIG (Sistema de Información Geográfica) interno** para un operador
de fumigación con drones DJI Agras en el Valle del Cauca. Reemplaza la necesidad de
depender del panel nativo de DJI Farm (frontend coreano, poco visual, sin analítica)
ofreciendo:

- Visualización geoespacial de parcelas fumigadas y planes DJI sobre un mapa único.
- Historial de operación con rollups, KPIs y filtros (Task History).
- Sistema de alertas por sobre-explotación de parcela.
- Planificación de próximas fumigaciones basada en cadencia por cultivo.
- Ingesta automatizada (scraping) de los datos crudos de DJI, normalizados a un modelo
  propio en PostGIS.

**Fuera de alcance (explícito):**
- No es una consola de control de vuelo ni reemplaza la app DJI para pilotos.
- No embebe DJI Farm (se decidió explícitamente no usar iframe — ver `docs/SPEC.md` §2.4).
- No es SaaS multi-tenant todavía (hay una tabla `clients` pero solo existe 1 cliente hoy).

Cualquier feature nueva debe evaluarse contra este alcance antes de implementarse.
Si un agente detecta que una tarea empuja el sistema hacia algo fuera de este alcance
(ej. multi-tenant real, control de vuelo), debe señalarlo explícitamente antes de construir.

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│  DJI Agras Cloud (kr-ag2-api.dji.com, locale zh-CN)          │
└───────────────────────────┬───────────────────────────────────┘
                             │ scraping (Playwright) + GraphQL/HMAC
                             ▼
                 ┌───────────────────────┐
                 │  Pipeline (scripts/)   │  9 pasos, idempotente,
                 │  run-pipeline.js       │  --skip-* / --start-from
                 └───────────┬────────────┘
                             │ upsert
                             ▼
        ┌────────────────────────────────────────┐
        │  PostgreSQL 16 + PostGIS 3.4             │
        │  (Docker local / Supabase gestionado)    │
        │  dji_* (crudo normalizado) + parcels/    │
        │  flights (demo) + app_users               │
        └───────────────────┬───────────────────────┘
                             │ pg (node-postgres), SQL parametrizado
                             ▼
        ┌────────────────────────────────────────┐
        │  api/repositories.ts (data-access único) │
        └───────────────────┬───────────────────────┘
                             │
             ┌───────────────┴────────────────┐
             ▼                                 ▼
   Route Handlers (app/api/*)          Server Components (app/*)
   NextResponse.json + cache tags       fetch directo a repositories
             │                                 │
             └───────────────┬─────────────────┘
                             ▼
                  Client Components ("use client")
                  Leaflet map, tablas, formularios
```

**Principio rector:** los Server Components y los Route Handlers **nunca** acceden a la
base de datos por caminos distintos — todo pasa por `api/repositories.ts`. Esto evita
lógica de negocio duplicada entre página, API y scripts CLI.

---

## 3. Capas y responsabilidades

| Capa | Responsabilidad | No debe hacer |
|---|---|---|
| `app/*/page.tsx` (Server Components) | Orquestar data fetching + pasar props a client components | Contener lógica de negocio compleja ni queries SQL directas |
| `app/api/*/route.ts` (Route Handlers) | Exponer contratos HTTP, validar input, invalidar cache | Duplicar reglas que ya viven en `lib/` |
| `api/repositories.ts` | Único punto de acceso a datos (compartido por pages, routes y scripts CLI) | Tener conocimiento de React/Next |
| `lib/*.ts` | Reglas de negocio puras (alertas, cadencia, agregaciones, caching) | Hacer I/O de red directo a DJI |
| `lib/djiag-*` | Cliente HTTP/GraphQL hacia DJI, parsers, storage de sesión | Escribir en la base de datos directamente |
| `scripts/*.js` | Pipeline CLI (scrape → upsert → spatial-join → backfill → schedule) | Contener lógica de UI |
| `components/*` | Presentación. Server por defecto, `"use client"` solo con interactividad | Hacer fetch de datos que no les pasaron por props |

---

## 4. Modelo de datos geoespacial

### 4.1 Convenciones obligatorias
- **SRID 4326 (WGS84)** en toda geometría, sin excepción.
- **TZ `America/Bogota`** para toda fecha operativa (fumigaciones, vuelos). Conversión
  centralizada en `lib/format.ts` — nunca usar `new Date()` sin pasar por ahí en código
  de producto.
- **Unidades**: DJI reporta área en **MU** (unidad china de superficie).
  `1 MU = 666.67 m²`. Toda conversión MU↔ha↔m² debe usar los helpers documentados en
  `docs/DJI_AREA_UNITS.md`, nunca recalcular el factor inline.

### 4.2 Tablas principales

**Modelo operativo (demo/legacy)**: `clients`, `parcels`, `flights`.

**Modelo importado de DJI (fuente de verdad actual)**:
- `dji_parcels` (~1207 filas): 1 fila por campo fumigable. Contiene geometría
  (`spray_geom` MultiPolygon, `reference_point` Point, `waypoints` MultiPoint) +
  parámetros de vuelo (velocidad, altura de radar, dirección óptima, offsets).
- `dji_fumigation_schedule`: cadencia esperada por parcela, con `next_due_date`.
- `dji_fumigations`: eventos de fumigación reales, con `source` en
  `('manual'|'djiscraper'|'import')`.
- `dji_flights` (~7050 en 30 días): sorties individuales georreferenciadas.
- `dji_import_batches`, `dji_drone_models`: metadatos del scraper.

**Índices espaciales**: GIST en `spray_geom`, `waypoints`, `reference_point`,
`dji_flights.parcel_id`/`location`, `parcels.geom`, `flights.footprint`. Cualquier
query espacial nueva debe apoyarse en estos índices — evitar `ST_*` sin filtro de
bounding box previo en tablas de miles de filas.

**Spatial join flights↔parcels**: usa `ST_DWithin(geom, point, tolerance)` con
tolerancia de 10 km (matching permisivo, ver `scripts/spatial-join-flights-parcels.js`).
Cualquier cambio a esta tolerancia debe justificarse y documentarse — afecta la
integridad de todo el historial.

### 4.3 Tablas legacy removidas
`dji_field_catalog`, `dji_land_assets`, `dji_daily_summaries` fueron droppeadas
(snapshot en `dji_legacy_snapshot`). `dji_daily_summaries` fue reemplazada por rollup
on-the-fly desde `dji_flights` (`lib/dji-flights-aggregate.ts`). **No reintroducir
estas tablas** sin revisar por qué se eliminaron (`docs/audit/BITACORA.md`).

---

## 5. Flujo de datos end-to-end (pipeline DJI)

9 pasos secuenciales, cada uno reanudable e idempotente (`scripts/run-pipeline.js`):

1. Scrape per-flight → `djiag_exports/perflight_records.json`
2. Scrape fumigations aggregate → `djiag_exports/fumigations.json`
3. Upsert flights → `dji_flights`
4. Spatial join flights × parcels → `dji_flights.parcel_id`
5. Upsert fumigations aggregate → `dji_fumigations` (parcel_id NULL)
6. Backfill per-parcel → `dji_fumigations` (parcel_id NOT NULL)
7. Update schedule → `dji_fumigation_schedule.next_due_date`
8. Fetch lands → `djiag_exports/lands.json`
9. Upsert lands → `dji_parcels`

Un agente que modifique un paso debe verificar que los pasos posteriores siguen siendo
consistentes con el output nuevo (ej. si cambia el shape de `lands.json`, el paso 9 y
cualquier consumidor de `dji_parcels.raw_*` deben revisarse).

---

## 6. Contratos de API (resumen)

| Ruta | Método | Propósito |
|---|---|---|
| `/api/parcels/[id]` | GET/PUT | Detalle y edición de parcela |
| `/api/parcels/normalized` | GET | Lista normalizada para selector de mapa |
| `/api/flights` | GET | Lista de vuelos |
| `/api/fumigations` | GET/POST | CRUD eventos de fumigación (recalcula cadencia) |
| `/api/fumigations/upcoming` | GET | Próximas fumigaciones según cadencia |
| `/api/fumigation-schedule/[parcelId]` | GET | Cadencia de una parcela |
| `/api/task-history` | GET | Rollup por día + polígonos en rango (feature estrella) |
| `/api/alerts` | GET | Alertas por severidad |

Todas las mutaciones invalidan cache por tag (`lib/cache.ts`) y todas las rutas exigen
sesión salvo `/login` y `/api/auth/*` (middleware Edge en `proxy.ts`).

**Contrato de Task History** (`/api/task-history`), por ser la feature más compleja:
```ts
{
  totals: { areaMu, times, liters, duration: { hours, minutes, seconds, djiFormat } },
  days: DayCard[],
  polygons: { parcelId, landName, areaHa, datesFumigated[] }[],
  dateRange: { from, to }
}
```
Estrategia de resolución de datos: si hay filtros de vuelo (parcela/dron/piloto) →
agrega desde `dji_flights` directo; si no, lee la tabla materializada de rollup; si no
existe (CI en frío) → fallback a `dji_flights`. Cualquier cambio a esta lógica de
fallback debe mantenerse cubierto por `verifier-contract-adversarial.test.tsx`.

---

## 7. Decisiones de arquitectura (ADRs resumidos)

| Decisión | Razón | Alternativa descartada |
|---|---|---|
| Next.js App Router + RSC por defecto | Menos JS al cliente, data fetching colocado | Pages Router / SPA pura |
| PostGIS sobre Postgres | Necesidad de tipos geométricos, GIST, ST_* nativos | Guardar GeoJSON en columnas JSON |
| `pg` (node-postgres) directo, sin ORM | Control fino sobre SQL espacial, evita abstracciones que rompen con PostGIS | Prisma/Drizzle (soporte geo limitado) |
| Sin Zod, validación manual (`parseIntParam`) | Decisión histórica, mantenida por consistencia | Zod/Valibot |
| Split `auth.config.ts` (edge) / `auth.ts` (node) | `bcrypt`/`bcryptjs` rompe el bundle de Edge | Un solo archivo de auth |
| Cache por tags (`unstable_cache`) en vez de revalidate por tiempo | Los datos cambian por eventos (nueva fumigación), no por reloj | ISR con tiempo fijo |
| Sin iframe de DJI en `/map` | Requisito de producto explícito — visualización propia, no wrapper | Embeber DJI Farm |
| Task History NO cachea | El caller controla frecuencia; datos usados para decisiones operativas frescas | Cache agresivo con invalidación compleja |

Un agente que quiera revertir alguna de estas decisiones debe primero leer
`docs/SPEC.md` y `docs/audit/BITACORA.md` para entender si ya fue evaluada y descartada.

---

## 8. Requisitos no funcionales

- **Seguridad**: SQL siempre parametrizado; regex de validación en `parcelId`,
  `droneSerial`, `pilot` antes de query; secrets en `.env.local` (nunca commiteados);
  headers de seguridad en `next.config.ts` (HSTS, nosniff, frame-options, referrer-policy,
  permissions-policy). **CSP pendiente** — no asumir que ya existe.
- **Rendimiento**: pool de conexiones `max: 5`, `idleTimeoutMillis: 30_000`. Cualquier
  query nueva sobre `dji_flights` (miles de filas) debe usar los índices existentes o
  añadir uno nuevo con migración explícita.
- **Consistencia horaria**: toda fecha visible al usuario en `America/Bogota`.
- **Auditabilidad**: cada evento de fumigación registra `source` y `recorded_by`.
- **Extensibilidad multi-tenant**: existe `clients` pero el sistema asume 1 solo cliente
  hoy — cualquier feature que toque esto debe evaluarse como cambio arquitectónico mayor.

---

## 9. Riesgos y deuda técnica conocidos (snapshot)

- **Crítico**: el repositorio **no tiene remote configurado**. Si se pierde `.git/`
  local se pierde todo el historial. Cualquier agente debe tratar esto como bloqueante
  antes de hacer cambios grandes (ver guía de mejores prácticas, sección de Git).
- CSP pendiente de implementar.
- 16 tests DB-dependientes se saltan si Docker está apagado (588/604 verdes es la
  baseline esperada, no 604/604, salvo que Docker esté arriba).
- Roadmap abierto documentado en `docs/audit/BITACORA.md` (S5-S7 corto plazo, M1-M7
  mediano, L1-L5 largo plazo) — consultar antes de proponer trabajo nuevo para evitar
  duplicar esfuerzo ya planificado.

---

## 10. Cómo usar este documento

Este SDD es la referencia de **arquitectura**. Antes de escribir código, un agente debe:
1. Confirmar en qué capa cae su tarea (sección 3).
2. Verificar si toca geometría/tiempo/unidades (sección 4) — estas reglas no son opcionales.
3. Revisar si su cambio contradice un ADR (sección 7) antes de proceder.
4. Cruzar con `docs/audit/BITACORA.md` por si el trabajo ya está en el roadmap con
   contexto adicional.
