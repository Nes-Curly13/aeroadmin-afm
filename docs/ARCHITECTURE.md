# AeroAdmin AFM — Architecture

> Documento vivo. Explica **de dónde vienen los datos** y **cómo fluyen** desde el dron físico hasta la pantalla del admin.
> Última actualización: 2026-07-22 (post-sprint de resiliencia DJIAG).

---

## TL;DR

AeroAdmin AFM **no es un scraper HTML** y **no está enlazado oficialmente a DJI**. Es un **cliente headless de Playwright** que opera sobre la UI web de DJI SmartFarm para capturar las responses de su API interna (GraphQL no documentado). Es más estable que un scraper tradicional porque no depende del HTML visible, sino de la misma API que la UI usa internamente. Los datos se persisten en PostGIS vía scripts idempotentes, y el frontend Next.js los lee con cache de Next.

---

## 1. Diagrama end-to-end (fuente de información)

```
   DRON FÍSICO (T50 / T40 / M3M)
          │
          │  El piloto vuela normal con su control remoto
          │  conectado a internet (SIM/wifi del control)
          ▼
   ┌─────────────────────────────┐
   │  DJI SmartFarm App          │  (app en el control remoto)
   │  + DJI SmartFarm Web        │  (sitio web que el piloto
   │                              │   usa desde la compu)
   └──────────┬──────────────────┘
              │
              │  Sync automático cuando el piloto hace login
              │  en su app SmartFarm
              │  Backend: kr-ag2-api.dji.com (coreano)
              │  Auth: HMAC firmado por el browser de DJI
              │  Locale trick: accept-language: zh-CN,zh
              │  para rutear al backend coreano (no regional)
              ▼
   ┌──────────────────────────────────────┐
   │  NUESTRO CLIENTE (Playwright headless)│
   │  ────────────────────────────────────│
   │  lib/djiag-korean-client.js         │
   │  • Login UI en DJI SmartFarm Web    │
   │  • Captura responses GraphQL firmadas│
   │  • Reusa el HMAC del browser de DJI │
   │    (NO reimplementa el signer)      │
   │  • Storage state cache (7d)         │
   │  • Backoff exponencial en login      │
   │    (XS3, audit 2026-07-22)          │
   │  • Circuit breaker 3 fails → 5min   │
   │    (S1, audit 2026-07-22)           │
   │  • Race fix: listener en launch,    │
   │    no en cada capture (S3)          │
   │  • Cursor injection via page.route()│
   │    para bypass del bug "DJI solo    │
   │    carga página 1"                  │
   └──────────┬───────────────────────────┘
              │
              │  Output: djiag_exports/*.json
              │  • perflight_records.json
              │  • fumigations.json
              │  • lands.json
              │  • _health.json (XS1)
              ▼
   ┌─────────────────────────────┐
   │  SCRIPTS PIPELINE           │
   │  scripts/run-pipeline.js    │
   │  ─────────────────────     │
   │  10 steps idempotentes:     │
   │   1. scrape per-flight      │
   │   2. scrape fumigations agg │
   │   3. upsert flights         │
   │   4. spatial join × parcels │
   │   5. upsert fumigations agg │
   │   6. backfill per-parcel    │
   │   7. update schedule        │
   │   8. fetch lands            │
   │   9. download assets        │
   │  10. upsert lands           │
   │                              │
   │  Cada step:                │
   │  • UPSERT (ON CONFLICT)     │
   │  • Idempotente              │
   │  • Escribible a djiag_exports/_health.json
   │    (XS1, health endpoint)   │
   └──────────┬──────────────────┘
              │
              │  SQL parametrizado vía `pg` driver
              ▼
   ┌─────────────────────────────┐
   │  POSTGRES + POSTGIS         │
   │  ─────────────────────     │
   │  Tablas principales:        │
   │   • dji_parcels (1207)      │
   │   • dji_flights (16,353)    │
   │   • dji_fumigations         │
   │   • dji_fumigation_schedule │
   │  Geometry: PostGIS SRID 4326│
   │  Soft delete: deleted_at    │
   │  Audit: created_at, etc.    │
   └──────────┬──────────────────┘
              │
              │  SQL queries con `unstable_cache` (Next)
              │  Streaming con `<Suspense>` (v1.2)
              ▼
   ┌─────────────────────────────┐
   │  NEXT.JS (AeroAdmin panel)  │
   │  ─────────────────────     │
   │  Server components:        │
   │   • app/dashboard/page.tsx  │
   │   • app/map/page.tsx        │
   │   • app/task-history/...    │
   │   • app/admin/auditoria/... │
   │  API routes:                │
   │   • /api/flights             │
   │   • /api/fumigations         │
   │   • /api/parcels            │
   │   • /api/admin/djiag-health │ ← NUEVO (XS1)
   │                              │
   │  Cliente (Turso Postgres local-style)│
   │   • RBAC: admin | supervisor │
   │   • NextAuth v5 con JWT     │
   │   • bcryptjs para passwords│
   │  UI components:            │
   │   • Bento dashboard         │
   │   • Leaflet map + filters   │
   │   • Mobile sidebar drawer   │
   │   • CSV export (Excel-es)   │
   │   • Empty state pattern     │
   │   • Atajos de teclado       │
   └─────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────┐
   │  USUARIO FINAL              │
   │  ─────────────────────     │
   │  Dueño + supervisor          │
   │  (pilotos NO usan el panel) │
   │  Acceso: navegador web      │
   │  Devices: compu + mobile    │
   │  (sidebar drawer mobile)    │
   └─────────────────────────────┘
```

---

## 2. Decisiones de diseño

### 2.1 ¿Por qué Playwright (browser real) y no `fetch` directo?

**Razón**: DJI firma los POSTs a `kr-ag2-api.dji.com` con un **HMAC calculado client-side por su propio código JS** (interceptor Axios en `assets/sign.*.wasm`). Reimplementar el signer es trabajo ingrato y frágil — DJI cambia el algoritmo con cada release.

**Solución**: dejar que el browser de DJI firme los requests. Nuestro cliente Playwright solo:
1. Hace login UI
2. Captura las responses via `page.on('response')`
3. Persiste el JSON

**Limitación documentada**: si DJI hace polling activo de fondo, hay que filtrar las responses que matchean el `urlPattern` específico. Ver `lib/djiag-korean-client.js:_captureResponse`.

### 2.2 ¿Por qué no API REST oficial de DJI?

**DJI no expone una API REST oficial para Agras SmartFarm.** Las opciones evaluadas:

| Opción | Soporta Agras? | Costo | Decisión |
|---|---|---|---|
| **AirData UAV REST API** | ✅ (T10/T20/T25/T30/T40/T50) | HD 360 Pro $14.99/mes o Enterprise per-drone | ❌ Cliente no paga |
| **DJI Cloud API (MQTT + Pilot 2)** | ❌ Solo enterprise (M3E, M30, Dock) | — | ❌ No aplica |
| **DJI FlightHub 2 OpenAPI** | ❌ Requiere licencia de pago + drone enterprise | — | ❌ No aplica |
| **Agras Cloud API oficial** | ❌ DJI no expone REST público (solo GraphQL interno que scrapeamos) | — | ❌ No existe como pública |
| **dji-log-parser (oficial)** | ✅ Lee archivos `.txt` de vuelo del dron | Gratis | ⏳ Pendiente para M3M (no en MVP) |

Detalle completo en `docs/DJI_CLOUD_API.md`. **Decisión MVP**: profesionalizar el cliente Playwright actual, no reemplazarlo.

### 2.3 ¿Por qué no scraper HTML tradicional?

**Razón**: scraper HTML lee el DOM visible y extrae con regex/CSS selectors. Es frágil porque si DJI rediseña la UI, el scraper rompe.

**Nuestro cliente**: captura responses HTTP/GraphQL que la UI genera. Si DJI rediseña la UI mañana, la **UI puede cambiar** pero **la API interna del browser sigue siendo la misma** (porque el backend sirve a todas las versiones). Es más estable.

**Trade-off conocido**: dependemos de la UI funcionando igual aunque cambie visualmente.

### 2.4 ¿Por qué un cliente por separado (`lib/djiag-*.js`) y no embebido en Next?

**Razón**: el cliente se ejecuta en un **cron/CLI** (`scripts/run-pipeline.js`), NO en un route handler. Importa Playwright (no compatible con Edge runtime). El Next.js app es read-only contra PostGIS.

**Convención**:
- `lib/djiag-*.js` → scripts y clientes (escribe en BD)
- `app/api/...` → API routes de Next (lee de BD, expone al frontend)
- `app/.../page.tsx` → server components (leen de BD con cache)

### 2.5 ¿Por qué idempotencia en el pipeline?

**Razón**: el cron puede correr varias veces al día. Si falla a mitad, hay que poder re-correr sin duplicar. Solución: todos los UPSERTs con `ON CONFLICT DO UPDATE`. El `batch_id` se preserva del import original (no se pisa en re-scrape — ver `lib/djiag-lands-to-parcels.js:UPSERT_SQL`).

---

## 3. Contrato operacional

### 3.1 Cron / schedule

El pipeline se corre manualmente con `npm run pipeline:djiag -- --days 30` o via cron externo (no incluido en el repo). **No es parte del código de Next**.

### 3.2 Failure modes (qué pasa si algo rompe)

| Falla | Detección | Mitigación actual |
|---|---|---|
| Pipeline no corre hace 24h+ | `GET /api/admin/djiag-health` → `status: "stale"` | El admin ve el warning en el panel |
| Login falla 3+ veces (SmartFarm down) | Circuit breaker abre | Próximas corridas fallan rápido en 5min |
| Race condition en response capture | Era ~1 de cada 20 corridas | Fixed con S3 (listener en `launch()`) |
| Password DJI expirado | Backoff reintenta 3 veces | Falla clara en logs |
| DJI cambia schema GraphQL | Errores genéricos de parser | **Pendiente S2** (schema versioning) |
| Storage state corrupto | Fallback a login UI | Auto-recovery, reescribe state |
| URLs de assets expiradas (>12h) | 403 en downloads | **Pendiente XS4** (check edad) |

### 3.3 Health endpoint

**`GET /api/admin/djiag-health`** (admin only) devuelve:
```json
{
  "status": "ok" | "partial" | "stale" | "failed" | "unknown",
  "lastRunAt": "2026-07-22T15:32:18Z",
  "lastSuccessfulSyncAt": "2026-07-22T15:32:18Z",
  "hoursSinceLastSync": 2.4,
  "flightsLastSync": 152,
  "fumigationsLastSync": 12,
  "landsLastSync": 1207,
  "warnings": [],
  "steps": [
    { "order": 1, "name": "scrape per-flight", "status": "ok", "durationMs": 45230 },
    ...
  ]
}
```

Lógica en `lib/djiag-health.ts`, route en `app/api/admin/djiag-health/route.ts`. Tests: `tests/api-admin-djiag-health.test.ts` (11 tests).

### 3.4 Si DJI cierra SmartFarm Web mañana

**Escenario**: DJI descontinúa SmartFarm Web. Pierde la fuente de datos.

**Impacto**:
- El pipeline no puede sincronizar
- El panel muestra data con `hoursSinceLastSync` creciendo
- El admin ve `status: "stale"` y sabe que algo está mal
- Pero no hay data nueva

**Plan B** (no implementado):
1. **dji-log-parser** sobre los `.txt` del dron (descargar del control remoto). Cubre el ~80% de la data de vuelo, falta la de planificación.
2. **Agras T50 + export manual CSV** desde SmartFarm App.
3. **AirData Enterprise** si vale la pena pagar (cliente decide).

---

## 4. Stack técnico (resumen)

| Capa | Tech | Versión |
|---|---|---|
| Frontend | Next.js + React | 16.2.4 + 19.2.5 |
| Map | Leaflet + react-leaflet | 1.9.4 + 5.0.0 |
| DB driver | pg | 8.20.0 |
| Auth | NextAuth v5 (beta) | 5.0.0-beta.31 |
| Passwords | bcryptjs (puro JS) | 3.0.3 |
| Scraper | Playwright | 1.49.0 |
| BD | PostgreSQL + PostGIS | local en Docker |
| Estilos | Tailwind v4 | 4.2.4 |
| Tests | Vitest + jsdom + RTL | 3.2.4 |
| CSV | Custom (sin deps) | `lib/csv.ts` |
| E2E | Playwright | 1.61.1 |

Patrones documented in:
- `docs/DJIAG_AUDIT.md` — auditoría del cliente DJIAG (jul 2026)
- `docs/DJI_CLOUD_API.md` — reference de DJI Cloud API
- `docs/DJI_SCRAPER.md` — notas operacionales del scraper
- `SCRAPER_DEFECTS.md` — histórico de bugs y fixes
- `docs/SPEC.md` — decisiones de UI
- `docs/STACK.md` — stack detallado
- `docs/audit/BITACORA.md` — bitácora de auditoría UI/UX
- `docs/guia/01_SDD_AeroAdmin_AFM.md` — design doc
- `docs/guia/02_TDD_AeroAdmin_AFM.md` — technical design
- `docs/guia/03_MEJORES_PRACTICAS_AGENTES.md` — para coordinar agentes

---

## 5. Roadmap (próximas mejoras posibles)

### 5.1 Corto plazo (1-2 sprints)

- **S2 schema versioning** + field-type validation (audit H3) — solo si DJI cambia el schema al menos 2-3 veces
- **XS4 check edad `lands.json`** en `download-land-assets.js` (audit H5) — 15 min, preventorio
- **XS6 tests de tipos** en parsers — baja prioridad, los parsers ya tienen tests

### 5.2 Mediano plazo (cuando escale)

- **M1 multi-page client** con `context.newPage()` por request (audit) — 1 día. Solo si hay fetches concurrentes
- **M2 supervisor worker** con auto-detección de schema (audit) — 2 días. Solo si pagamos Sentry
- **dji-log-parser integration** para M3M (CSV-fallback si falla Playwright) — 1-2 días

### 5.3 Largo plazo (si la empresa crece)

- **AirData Enterprise** si la empresa tiene 5+ drones y SLA con cañeros
- **DJI Cloud API** si compran un drone enterprise (M3E, M350, Dock)
- **Multi-tenant** si se ofrecen como SaaS a otras empresas de fumigación

---

## 6. Changelog interno

- **2026-07-22** — Compilado por Mavis. Cubre la pregunta del PO "¿es un scraper o un sistema enlazado a DJI?". Diagrama end-to-end, decisiones de diseño, contrato operacional, failure modes, plan B. Vinculado a `docs/DJIAG_AUDIT.md` y `docs/DJI_CLOUD_API.md`.
