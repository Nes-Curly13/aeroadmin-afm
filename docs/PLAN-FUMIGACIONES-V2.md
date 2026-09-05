# Plan: Fumigaciones V2 — Wizard, Branch Importar Vuelo, Data Model Cliente→Finca

> **Sprint**: S11+ (post-S10.5)
> **Origen**: feedback de UX/producto del dev nuevo (2026-09-04)
> **Estado**: pendiente implementación
> **Owner**: TBD (sugerido: agFab)

## Contexto

El flujo actual de "Nueva fumigación" (`/fumigaciones/nueva`) tiene el mapa como protagonista desde el inicio (columna derecha 40%). El usuario que va a registrar una fumigación no necesita explorar el territorio — necesita responder "en qué parcela voy a registrar esto". El feedback recibido lo resume bien:

> El mapa debería servir como confirmación espacial, no como punto de partida.

El data model actual NO tiene tablas separadas de `clientes` ni `fincas` — están denormalizadas en `dji_parcels` como columnas (`client_name`, `farm_name`). Esto es suficiente para UI pero limita la capacidad de hacer reporting cruzado y mantener la entidad "operación" como centro del modelo.

## Estado actual (verificado en código 2026-09-04)

- **Página**: `app/(auth)/fumigaciones/nueva/page.tsx` (server) → `components/admin/fumigations/new-fumigation-page-client.tsx` (client, ~400 líneas).
- **Layout**: 2 columnas — form 60% (izquierda) + map 40% (derecha, sticky).
- **Phases**: `phase: "pick" | "form"` (solo 2 steps).
- **Map**: `FumigationMap` con Sentinel-2 2024 (EOX). Polígono de la parcela + vuelos (futuro).
- **Parcel picker**: `ParcelPickerRow[]` con `land_name`, `external_id`, `client_name`, `farm_name`, `municipality`, `source` ("manual" | "imported" | etc.). Server-side fetch con `getRecentParcelsForPicker(500, q)`.
- **"Crear nueva parcela"**: oculto en `<details>` colapsado, casi un afterthought.
- **"Importar vuelo"**: NO EXISTE en UI. La importación se hace vía `scripts/upsert-fumigations-from-djiag.js` (batch). El campo `dji_fumigations.flight_ids` ya soporta N-a-N, está listo.
- **Header actual**: "Nueva fumigación / Registra una fumigación manual. El mapa de la derecha usa Sentinel-2 cloudless 2024 (basemap satelital)..." — incluye jerga técnica al usuario final.
- **Form reusado**: `RegisterFumigationForm` (existente, completo) — no se reescribe, se reubica dentro del wizard.

### Data model actual (migrations leídas)

| Tabla | Rol | Notas |
|---|---|---|
| `dji_parcels` | Parcela (entidad central hoy) | `land_name`, `external_id`, `spray_geom`, `client_name`, `farm_name` (denormalizados) |
| `dji_fumigations` | Fumigación | `product_id` FK, `flight_ids` array, `vehicle_plate`, `category` |
| `dji_flights` | Vuelo DJI | `geom`, `start_at`, `duration_s`, `drone_model_code`, `pilot_id` |
| `products` | Catálogo curado de productos | agregado en S8 (2026-08-29) |
| `dji_vehicles` | Drones / vehículos | `plate`, `model` |
| `application_types` | Tipo de aplicación | enum libre |
| `dji_drone_models` | Lookup de modelos DJI | `code`, `name` |
| `app_users` | Usuarios internos | `role: admin | supervisor` |

**No hay** `clients` ni `farms` como tablas separadas.

## Decisión arquitectónica (2026-09-04)

**Data model Cliente→Finca→Parcela es requisito de tesis** → se hace bien, con FKs, migraciones de backfill, y tests de regresión. Esto es un proyecto aparte (Fase 3), NO mezclado con el refactor de UX (Fase 1).

**Justificación**: Mezclar UX refactor + data model migration en un solo sprint es la receta para romperse. El UX refactor da 80% del valor percibido por el usuario en 1 sprint. El data model migration es de 2-3 sprints. Hacerlos por separado = commits chicos, PRs revisables, rollback posible.

## Plan por fases

### Fase 1 — Wizard UX + map-after-selection (1 sprint, 2 PRs)

**PR 1.1 — Wizard 3 steps (Parcela → Detalles → Confirmar)**

Refactor de `new-fumigation-page-client.tsx`:
- State: `phase: "pick" | "form" | "confirm"` (3 steps, no 2)
- Stepper visual arriba (`<Stepper currentStep={phase} steps={["Parcela", "Detalles", "Confirmar"]} />`)
- Step 1 "pick": parcel picker actual (sin cambios significativos, refactor de copy)
- Step 2 "form": reuso de `RegisterFumigationForm` (mover adentro de un wrapper de step)
- Step 3 "confirm": resumen de los datos elegidos antes del POST
- Botones de navegación: `[← Atrás] [Continuar →]` / `[← Editar] [✓ Registrar]`
- Validación al avanzar: step 1 → step 2 requiere parcela elegida; step 2 → step 3 requiere form válido
- Header copy: "Nueva fumigación" + "Registra una fumigación seleccionando la parcela y completando los datos. El mapa confirma la ubicación."

**PR 1.2 — Map aparece DESPUÉS de seleccionar parcela**

- Map se renderiza solo cuando `chosenParcel != null` (state `mapVisible`)
- Sin map inicial → screen real estate para el parcel picker (más cards visibles)
- Map se mueve a step 2/3 como confirmación visual, no como herramienta de búsqueda
- Stepper copy ajusta: step 2 "Detalles" muestra parcel summary card + map en grid 50/50
- Remover copy técnica "Sentinel-2 cloudless 2024" del user-facing text (queda en atribución del map)

**Aceptación de Fase 1**:
- Operador completa una fumigación en <60s cuando la parcela ya existe
- Stepper visible en todo momento con step activo destacado
- Map solo visible en steps 2 y 3
- Mobile-friendly (layout de 2 columnas colapsa a 1 en <768px)
- Coverage del nuevo componente: ≥80% lines (umbral aspiracional)
- `arch:check` 0 errors
- E2E test Playwright: happy path + parcel no existe (usa "Crear nueva")

**Riesgos**:
- R1: `RegisterFumigationForm` podría no exponer callback de validación → workaround: usar `formRef` o exponer `isValid` por props
- R2: Stepper visual debe ser accesible (a11y) → usar `aria-current="step"` + `<ol>` semántico
- R3: El back de "Atrás" en step 2 puede perder datos del form → preservar state en step 2 al volver

### Fase 2 — Branch "Importar vuelo DJI" (½ sprint, 2 PRs)

**PR 2.1 — Pantalla inicial con 2 cards (Importar / Manual)**

- Remover "manual" del header copy
- Step 0: dos cards grandes con icono (`<Plane />` y `<Edit3 />`)
  - "Importar vuelo" → "Usá los datos de un vuelo registrado por DJI"
  - "Registro manual" → "Registrá una operación que no tiene información de vuelo"
- Click en "Importar" → branch con search de `dji_flights` por parcela + fecha
- Click en "Manual" → wizard de Fase 1 con copy actualizado

**PR 2.2 — "Importar vuelo" auto-fill**

- Nueva ruta API: `GET /api/dji-flights/search?parcelId=X&dateFrom=Y&dateTo=Z`
- Componente `DjiFlightPicker` — muestra vuelos del rango con fecha, hora, duración, área, dron, piloto
- Click en vuelo → auto-fill de los campos del form:
  - `applied_at` ← `dji_flights.start_at`
  - `duration_min` ← `dji_flights.duration_s / 60`
  - `area_ha` ← `dji_flights.area_ha` (suma de polígonos)
  - `drone_model` ← `dji_drone_models.name` (JOIN por code)
  - `pilot` ← `app_users.email` (JOIN por pilot_id)
  - `geometry` ← para mostrar en el map
- Pasa al wizard de Fase 1 con esos campos pre-llenados, queda en step 2 con map visible

**Aceptación de Fase 2**:
- Si hay vuelo DJI en `dji_flights` para la parcela/fecha: fumigación registrada con 4 clicks
- Si no hay: mensaje claro "No hay vuelos DJI en este rango" + CTA a "Registro manual"
- `dji_fumigations.flight_ids` se popula con el array del vuelo (FK N-a-N, ya existe)
- Fumigaciones importadas y manuales son indistinguibles en la tabla (mismo shape)

**Riesgos**:
- R1: Performance del search de vuelos — usar `EXPLAIN` antes, agregar índice si hace falta
- R2: Auto-fill puede pisar datos que el operador quería editar → mostrar preview del form antes del submit (step 3 de Fase 1 cubre esto)
- R3: `dji_flights` puede tener muchos vuelos para la misma parcela → paginar server-side

### Fase 3 — Data model Cliente → Finca → Parcela → Operación (proyecto aparte, 2-3 sprints)

> **Status**: pendiente definición de scope exacto. Se arranca DESPUÉS de cerrar Fase 1 y Fase 2.

**Fase 3.A — Schema (1 sprint)**

```sql
-- 1. Crear tabla clients
CREATE TABLE clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL
);
CREATE INDEX idx_clients_name_trgm ON clients USING gin (name gin_trgm_ops);

-- 2. Crear tabla farms
CREATE TABLE farms (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  municipality TEXT,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, name)
);
CREATE INDEX idx_farms_client_id ON farms(client_id);
CREATE INDEX idx_farms_municipality ON farms(municipality);

-- 3. Agregar FKs a dji_parcels (NULLABLE para no romper data existente)
ALTER TABLE dji_parcels
  ADD COLUMN client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN farm_id BIGINT REFERENCES farms(id) ON DELETE SET NULL;

CREATE INDEX idx_dji_parcels_client_id ON dji_parcels(client_id);
CREATE INDEX idx_dji_parcels_farm_id ON dji_parcels(farm_id);

-- 4. Vista de compat (mantiene la API actual sin cambios)
CREATE OR REPLACE VIEW vw_parcels AS
SELECT
  p.*,
  c.name AS client_name_vw,
  f.name AS farm_name_vw,
  f.municipality AS municipality_vw
FROM dji_parcels p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN farms f ON f.id = p.farm_id;
```

**Fase 3.B — Backfill (½ sprint, manual-assisted)**

Estrategia: **no infieres** el cliente/finca de `land_name` (ambiguo). En su lugar:
1. UI en `/admin/parcels` muestra banner: "Esta parcela no tiene cliente/finca asignado. Asigná uno para mejorar el reporting."
2. Operator asigna via dropdown (autocomplete con opción "+ Crear nuevo")
3. Script de backfill opcional: `scripts/backfill-clients-farms.js` que matchea por patrón si el operador lo solicita

**Fase 3.C — UI updates (1 sprint)**

- Reemplazar inputs de texto libre `client_name` / `farm_name` por selectores
- Mostrar breadcrumb: Cliente → Finca → Parcela en el parcel detail
- Reporting cruzado: "Fumigaciones por cliente", "Operaciones por finca"
- Dejar `vw_parcels` activo para mantener compat con código viejo; deprecate gradualmente

**Aceptación de Fase 3**:
- 100% de las parcelas con fumigaciones tienen `client_id` y `farm_id` asignados
- API sirve el shape nuevo (cliente/finca como objetos, no strings)
- Tests de regresión del auto-fill de Fase 2 siguen pasando
- Backwards-compat: el código viejo que lee `client_name` / `farm_name` desde `vw_parcels` sigue funcionando
- Reporting por cliente y por finca disponible

**Riesgos**:
- R1: Migración de datos — puede haber miles de parcelas sin asignar. Plan: empezar por parcelas con fumigaciones (las más importantes operativamente)
- R2: Nombres duplicados o variantes ("Agropecuaria XYZ" vs "AGROPECUARIA XYZ S.A.") — usar normalización con `LOWER(TRIM(name))` o pedir al operador que decida
- R3: Si la tesis requiere 3NF estricta, `vw_parcels` puede NO ser aceptable → deprecate en lugar de compat

## Dependencias y orden

```
Fase 1 ─────► Fase 2 ─────► Fase 3
  │              │              │
  ▼              ▼              ▼
1 sprint     ½ sprint       2-3 sprints
  │              │              │
  └─ paralelo con Bug 2
     (siguen tracks independientes)
```

- **Fase 1 no bloquea Fase 2** (Fase 2 reutiliza el wizard de Fase 1)
- **Fase 2 no bloquea Fase 3** (Fase 3 es schema, no UX)
- **Fase 1 + Fase 2 se pueden hacer en el mismo sprint** si hay bandwidth (1 sprint largo)
- **Fase 3.A se puede arrancar en paralelo con Fase 1+2** (track de backend independiente)

## Criterios globales de aceptación

- [ ] `npx vitest run` verde (suite completa, no solo los nuevos)
- [ ] `npm run arch:check` 0 errors, 0 warnings
- [ ] `npm run build` verde
- [ ] Coverage de los componentes tocados no baja del nivel actual
- [ ] E2E test Playwright del happy path en cada fase
- [ ] Documentación actualizada (`docs/SPEC.md`, `docs/TDD.md` si hay patrón nuevo)

## Tracking

- **Fase 1**: PRs #42, #43 (estimado)
- **Fase 2**: PRs #44, #45 (estimado)
- **Fase 3**: PRs #46+ (estimado)

## Referencias

- [Feedback original del dev nuevo](../HANDOFF-2026-09-02.md)
- [Sprint S10.5.1 — fix logging authorize](../PR-40.md) (referencia de patrón visibility)
- [Migration de parcels](../db/migrations/20260617170000_add_dji_parcels_normalized.sql)
- [Migration de products](../db/migrations/20260829000000_add_products_catalog.sql) (referencia de patrón catálogo)

---

**Última actualización**: 2026-09-04 (creación)
**Mantenedor**: TBD
