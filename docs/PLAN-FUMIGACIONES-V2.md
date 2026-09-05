# Plan: Fumigaciones V2 — Refactor Arquitectónico Integral

> **Sprint**: S11+ (post-S10.5)
> **Origen**: feedback de UX/producto del dev nuevo (2026-09-04) + revisión de arquitectura con foco en ciclos productivos
> **Estado**: pendiente implementación. Fase 1 mergeada (PR #42, wizard UX). Fases 2-5 en diseño.
> **Owner**: TBD (sugerido: agFab)

## Contexto

El flujo actual de "Nueva fumigación" (`/fumigaciones/nueva`) tiene el mapa como protagonista desde el inicio. El usuario que va a registrar una fumigación no necesita explorar el territorio — necesita responder "en qué parcela voy a registrar esto". El feedback inicial lo resume bien:

> El mapa debería servir como confirmación espacial, no como punto de partida.

**Pero la conversación de diseño fue más profundo**: el data model no solo necesita mejor UX, también necesita representar correctamente los **ciclos productivos** de la caña de azúcar (siembra, aplicaciones, corte). Y por encima, necesita una **capa de gestión** que distinga datos importados, validados, vigentes e históricos.

La propuesta final no es "mejorar el form de fumigación". Es transformar el proyecto de:

> *"Sistema para gestionar operaciones de fumigación"*

a:

> *"Sistema de gestión de información geoespacial y operacional para el seguimiento de ciclos productivos y operaciones de aplicación con drones"*

Porque la unidad fundamental no es el vuelo, ni la fumigación, ni la parcela. Es la **parcela + su ciclo productivo + su historial operacional**.

## Decisiones arquitectónicas (2026-09-04)

1. **Cliente→Finca es Fase 3.x (bloqueante para tesis)** — va ANTES que ciclos porque es la base del modelo.
2. **Ciclos Productivos son el centro del modelo** — `Parcela → Cycle → Events` reemplaza `Parcela → Operacion`.
3. **Edad / fase / próxima aplicación son DERIVADOS, no datos** — se computan desde `cycle.start_date` + reglas.
4. **"Vigencia" es metadata de la fila** — columna `data_validity` (enum) + `last_validated_at` en cada tabla maestra, NO una tabla aparte.
5. **Backfill híbrido** para ciclos (no infiero del DJI automáticamente, pero ofrezco "ciclos virtuales" que el operador confirma).

## Estado actual (verificado en código 2026-09-04)

- **Página fumigaciones/nueva**: refactorizada en PR #42 con wizard 3 steps + map-after-selection.
- **Layout**: 2 columnas (form 60% + map 40%, mapa solo visible en step 2+).
- **Stepper visual** arriba, "Crear nueva parcela" prominente.
- **Header copy**: limpio, sin jerga técnica.
- **Form reusado**: `RegisterFumigationForm` intacto, dentro del step 2.
- **Tests**: 6 nuevos en `tests/components/admin/fumigations/new-fumigation-page-client.test.tsx`. Total: 1851/1851.

### Data model actual (resumido)

| Tabla | Rol | Notas |
|---|---|---|
| `dji_parcels` | Parcela (entidad central hoy) | `land_name`, `external_id`, `spray_geom`, `client_name`, `farm_name` (denormalizados) |
| `dji_fumigations` | Fumigación | `product_id` FK, `flight_ids` array, `vehicle_plate`, `category` |
| `dji_flights` | Vuelo DJI | `geom`, `start_at`, `duration_s`, `drone_model_code`, `pilot_id` |
| `products` | Catálogo curado | S8 (2026-08-29) |
| `dji_vehicles` | Drones | `plate`, `model` |
| `application_types` | Tipo de aplicación | enum libre |
| `dji_drone_models` | Lookup DJI | `code`, `name` |
| `app_users` | Usuarios internos | `role: admin | supervisor` |

**No hay** `clients`, `farms`, `cycles`, `cycle_events`, `phase_rules`.

### Refactor arquitectónico propuesto (conceptual)

```
                    CLIENTE (nuevo)
                       │
                     FINCA (nuevo)
                       │
                    PARCELA
                       │
              ┌────────┴────────┐
              │                 │
          GEOMETRÍA       CICLO PRODUCTIVO (nuevo, central)
                                │
                  ┌─────────────┼─────────────┐
                  │             │             │
              Siembra    Aplicaciones      Corte
                            │
                  ┌─────────┼─────────┐
                  │         │         │
                Vuelo     Dron    Producto
                 DJI

                  CAPA DE GESTIÓN (nuevo)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Vigencia       Calidad       Trazabilidad
          │              │              │
       Alertas      Invariantes    Historial
```

Cada tabla maestra gana columnas:
- `data_validity` ENUM (`fresh | needs_review | stale | unknown`)
- `last_validated_at` TIMESTAMPTZ
- `validated_by_email` TEXT (auditoría)

Los datos derivados (`edad`, `fase`, `próxima_aplicacion`, `retraso`) NO se persisten — se computan via views + función `get_phase(crop, variety, days_since_planting)`.

## Plan por fases

### Fase 1 — Wizard UX + map-after-selection ✅ COMPLETADA

- **PR #42** mergeado (`f2d59e5`).
- Wizard 3 steps con stepper visual, mapa condicional, "Crear nueva" prominente, copy limpio.
- 1851/1851 tests, arch:check 0 errors, build verde.
- Sin cambios al data model.

### Fase 2 — Branch "Importar vuelo DJI" (½ sprint, 2 PRs)

- **PR 2.1** — Step 0 con 2 cards: "Importar vuelo" / "Registro manual". Remover "manual" del header.
- **PR 2.2** — Componente `DjiFlightPicker` + ruta `GET /api/dji-flights/search?parcelId=X&dateFrom=Y`. Auto-fill: `applied_at`, `duration_min`, `area_ha`, `drone_model`, `pilot`, `geometry`.
- **Dependencia**: la fumigación importada crea un `cycle_event` (necesita la tabla en Fase 3.B, así que podría ser un stub al inicio).
- **Aceptación**: si hay vuelo DJI en la parcela/fecha, fumigación registrada con 4 clicks.

### Fase 3 — Cliente → Finca → Parcela (data model, bloqueante tesis)

> **Status**: pendiente. Esta fase se hace ANTES que Ciclos porque es la base de la jerarquía. Esquema + backfill + UI.

**Fase 3.A — Schema (1 sprint)**

```sql
-- 1. Tabla clients
CREATE TABLE clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL
);
CREATE INDEX idx_clients_name_trgm ON clients USING gin (name gin_trgm_ops);

-- 2. Tabla farms
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

-- 3. FKs en dji_parcels (NULLABLE para no romper data)
ALTER TABLE dji_parcels
  ADD COLUMN client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN farm_id BIGINT REFERENCES farms(id) ON DELETE SET NULL;
CREATE INDEX idx_dji_parcels_client_id ON dji_parcels(client_id);
CREATE INDEX idx_dji_parcels_farm_id ON dji_parcels(farm_id);

-- 4. Columnas de data_validity (aplican a Fase 4 también)
ALTER TABLE dji_parcels
  ADD COLUMN data_validity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  ADD COLUMN last_validated_at TIMESTAMPTZ,
  ADD COLUMN validated_by_email TEXT;

-- 5. Vista de compat (mantiene la API actual)
CREATE OR REPLACE VIEW vw_parcels AS
SELECT
  p.*,
  c.name AS client_name_vw,
  f.name AS farm_name_vw
FROM dji_parcels p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN farms f ON f.id = p.farm_id;
```

**Fase 3.B — Backfill manual-assisted (½ sprint)**

Estrategia: **no infiero** el cliente/finca del nombre de la parcela (ambiguo). En su lugar:
1. UI en `/admin/parcels` muestra banner: "Esta parcela no tiene cliente/finca. Asigná uno."
2. Operator asigna via dropdown (autocomplete + opción "+ Crear nuevo")
3. Script opcional `scripts/backfill-clients-farms.js` que matchea por patrón si el operador lo solicita

**Fase 3.C — UI updates (1 sprint)**

- Reemplazar inputs `client_name` / `farm_name` por selectores
- Breadcrumb: Cliente → Finca → Parcela en el parcel detail
- Reporting cruzado: "Fumigaciones por cliente", "Operaciones por finca"
- Migrar llamadas de `client_name` a `vw_parcels.client_name_vw` gradualmente

**Aceptación de Fase 3**:
- 100% de las parcelas con fumigaciones tienen `client_id` y `farm_id` asignados
- API sirve shape nuevo (cliente/finca como objetos)
- Tests de regresión siguen pasando
- Backwards-compat: código viejo que lee `client_name` desde `vw_parcels` sigue funcionando

**Riesgos**:
- R1: Backfill manual de 1200 parcelas es lento. Plan: priorizar parcelas con fumigaciones (las más operacionales).
- R2: Nombres duplicados ("Agro XYZ" vs "AGROPECUARIA XYZ S.A."). Decisión: pedir al operador que decida caso por caso.

### Fase 4 — Ciclos Productivos + Capa de Gestión (2-3 sprints, núcleo de tesis)

> **Status**: pendiente. Esta es la pieza más conceptual del refactor. Re-scopeada a partir del feedback del 2026-09-04.

**4.1 — Concepto clave**

La parcela es permanente. Los ciclos son temporales:

```
PARCELA
   │
   ├── Ciclo 2024
   │      ├── Siembra: 2024-03-15
   │      ├── Aplicaciones: [...]
   │      └── Corte: 2024-12-20
   │
   ├── Ciclo 2025
   │      ├── Siembra: 2025-03-10
   │      ├── Aplicaciones: [...]
   │      └── Corte: 2025-12-15
   │
   └── Ciclo actual (2026)
          ├── Siembra: 2026-03-12
          ├── Aplicaciones: [...]
          └── (sin corte todavía)
```

Cada fumigación se asocia a UN ciclo. Las queries operacionales (cadencia, próxima aplicación, fase) se hacen contra el ciclo actual, no contra la parcela.

**4.2 — Schema**

```sql
-- 1. Tabla cycles
CREATE TABLE cycles (
  id BIGSERIAL PRIMARY KEY,
  parcela_id BIGINT NOT NULL REFERENCES dji_parcels(id) ON DELETE RESTRICT,
  crop_type TEXT,                    -- 'cana', 'cafe', etc.
  variety TEXT,                      -- 'CC 85-92', etc. (nullable)
  start_date DATE NOT NULL,           -- fecha de siembra
  end_date DATE,                      -- fecha de corte (NULL mientras está activo)
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'dji_inferred', 'imported', 'system')),
  data_validity TEXT NOT NULL DEFAULT 'fresh',
  last_validated_at TIMESTAMPTZ,
  validated_by_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_cycles_parcela ON cycles(parcela_id);
CREATE INDEX idx_cycles_active ON cycles(parcela_id) WHERE end_date IS NULL;
CREATE INDEX idx_cycles_start_date ON cycles(start_date DESC);

-- 2. Tabla cycle_events (siembra/aplicaciones/corte)
CREATE TABLE cycle_events (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('planting', 'application', 'harvest', 'renovation')),
  event_date DATE NOT NULL,
  fumigation_id BIGINT REFERENCES dji_fumigations(id) ON DELETE SET NULL,  -- solo si type=application
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,                    -- id del vuelo DJI, fila del Excel, etc.
  data_validity TEXT NOT NULL DEFAULT 'fresh',
  last_validated_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cycle_events_cycle ON cycle_events(cycle_id);
CREATE INDEX idx_cycle_events_date ON cycle_events(event_date DESC);
CREATE INDEX idx_cycle_events_fumigation ON cycle_events(fumigation_id);

-- 3. Tabla phase_rules (reglas configurables de fases)
CREATE TABLE phase_rules (
  id BIGSERIAL PRIMARY KEY,
  crop_type TEXT NOT NULL,
  variety TEXT,                      -- NULL = aplica a todas las variedades del crop
  day_from INT NOT NULL CHECK (day_from >= 0),
  day_to INT NOT NULL CHECK (day_to >= day_from),
  phase_name TEXT NOT NULL,           -- 'Establecimiento', 'Desarrollo', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (crop_type, variety, day_from, day_to)
);

-- Seed inicial: cana de azucar (Valle del Cauca)
INSERT INTO phase_rules (crop_type, variety, day_from, day_to, phase_name) VALUES
  ('cana', NULL, 0,   30,  'Establecimiento'),
  ('cana', NULL, 31,  90,  'Desarrollo inicial'),
  ('cana', NULL, 91,  180, 'Desarrollo'),
  ('cana', NULL, 181, 300, 'Maduración'),
  ('cana', NULL, 301, 999, 'Próximo a cosecha');

-- 4. FK en dji_fumigations
ALTER TABLE dji_fumigations
  ADD COLUMN cycle_id BIGINT REFERENCES cycles(id) ON DELETE SET NULL;
CREATE INDEX idx_dji_fumigations_cycle ON dji_fumigations(cycle_id);

-- 5. Vista: ciclo actual de cada parcela
CREATE OR REPLACE VIEW vw_current_cycle AS
SELECT
  c.*,
  p.land_name AS parcela_name,
  p.client_id,
  p.farm_id,
  EXTRACT(DAY FROM (NOW() - c.start_date))::INT AS age_days,
  current_phase(c.crop_type, c.variety, c.start_date) AS current_phase_name
FROM cycles c
JOIN dji_parcels p ON p.id = c.parcela_id
WHERE c.end_date IS NULL;

-- 6. Función: fase actual
CREATE OR REPLACE FUNCTION current_phase(
  p_crop TEXT, p_variety TEXT, p_start DATE
) RETURNS TEXT AS $$
  SELECT phase_name FROM phase_rules
  WHERE crop_type = p_crop
    AND (variety = p_variety OR variety IS NULL)
    AND EXTRACT(DAY FROM (CURRENT_DATE - p_start))::INT BETWEEN day_from AND day_to
  ORDER BY (variety IS NULL) ASC  -- prefiere variedad específica
  LIMIT 1;
$$ LANGUAGE SQL STABLE;
```

**4.3 — Backfill híbrido**

El DJI no tiene información de ciclos. Backfill strategy:

```js
// scripts/backfill-cycles-from-fumigations.js
// Para cada parcela con fumigaciones:
//   1. Encontrar gaps temporales entre fumigaciones (>120 días = nuevo ciclo)
//   2. Asumir siembra = primera fumigación del cluster, corte = última
//   3. Crear cycle + cycle_events con source='dji_inferred'
//   4. Marcar data_validity='needs_review' para que el operador confirme
```

UI de revisión: `/admin/parcels/[id]` muestra banner "tenemos X ciclos inferidos del histórico DJI, revisalos". Botón "Confirmar" / "Editar" / "Eliminar".

**4.4 — Capa de Gestión**

**4.4.1 — Data quality**

Funciones PG que validan invariantes:
- `check_cycle_invariants(cycle_id)` — corte anterior a siembra, fumigaciones post-corte
- `check_parcela_invariants(parcela_id)` — geometría sin info de cultivo, sin ciclo activo
- `check_operational_invariants()` — fumigación con parcela sin ciclo

Endpoint: `GET /api/data-quality/invariants?parcela_id=X` → array de warnings.

UI: Banner en `/parcels/[id]` con los warnings. Tab en admin "Calidad de datos" con resumen global.

**4.4.2 — Vigencia**

Columna `data_validity` + `last_validated_at` en cada tabla maestra (ya en schema). UI: chips de color en cada registro.

**4.4.3 — Trazabilidad**

`cycle_events.source_ref` permite conectar fumigaciones a su origen (vuelo DJI batch_id, fila de Excel, registro manual). UI: en el detail de cada fumigación, mostrar "Origen: Vuelo DJI #12345 del 2026-08-15".

**4.5 — UI updates**

- `/parcels/[id]` muestra:
  - Header con ciclo actual: "Lote 24 · Ciclo 2026 · 176 días · Fase: Desarrollo"
  - Timeline vertical con los eventos del ciclo (siembra, aplicaciones, corte)
  - Banner de calidad de datos si hay warnings
  - Botón "Iniciar nuevo ciclo" (después de registrar un corte)
- `/geovisor` (opcional): tooltip en cada parcela con el ciclo actual

**Aceptación de Fase 4**:
- 100% de las fumigaciones con `cycle_id` asignado (backfill o manual)
- `vw_current_cycle` funciona como source-of-truth para queries operacionales
- Invariantes detectan: corte antes de siembra, fumigación post-corte, parcela sin ciclo
- UI muestra ciclo actual + fase derivada + alertas

**Riesgos**:
- R1: Heurística de "gap > 120 días" puede ser incorrecta (algunos cultivos no descansan en diciembre). Plan: ajustar threshold + revisión manual.
- R2: Variedad de caña tiene muchas opciones. Plan: empezar con crop='cana' variedad=NULL, refinar después.
- R3: Función `current_phase` se ejecuta por cada render. Plan: materialized view refrescada en cada INSERT a `cycles`.

### Fase 5 — Branch "Importar vuelo" + Auto-fill (½ sprint)

(Ya detallada como Fase 2 arriba — reubicada para orden lógico.)

**5.1 — Step 0 con 2 cards**

```tsx
<CardGroup>
  <Card>
    <Plane /> Importar vuelo
    <p>Usá los datos de un vuelo registrado por DJI</p>
  </Card>
  <Card>
    <Edit3 /> Registro manual
    <p>Registrá una operación que no tiene información de vuelo</p>
  </Card>
</CardGroup>
```

**5.2 — Componente DjiFlightPicker**

Nueva ruta: `GET /api/dji-flights/search?parcelaId=X&dateFrom=Y&dateTo=Z`
- Lista vuelos DJI en el rango
- Click en vuelo → auto-fill: `applied_at`, `duration_min`, `area_ha`, `drone_model`, `pilot`, `geometry`
- Pasa al wizard de Fase 1 con campos pre-llenados

## Orden de ejecución

```
Fase 1 ✅ ──► Fase 3 ──► Fase 4 ──► Fase 2/5 ──► Fase 1.3
(mergeado)   Cliente/    Ciclos +     Importar    Confirm
              Finca      Gestión       vuelo       step
```

**Dependencias**:
- Fase 3 no bloquea Fase 1 (siguen en paralelo)
- Fase 4 depende de Fase 3 (FKs de parcela)
- Fase 2/5 puede empezar en paralelo con Fase 3-4 (auto-fill no requiere el modelo nuevo, solo `cycle_id` se setea después)
- Fase 1.3 (Confirm step) es independiente

**Aproximación por sprint**:
- **S11+ sprint 1**: Fase 3.A (schema Cliente/Finca) + Fase 3.B (backfill) — bloqueante tesis
- **S11+ sprint 2**: Fase 3.C (UI Cliente/Finca) + Fase 4.1-4.3 (schema + backfill ciclos)
- **S11+ sprint 3**: Fase 4.4-4.5 (capa de gestión + UI) + Fase 1.3 (Confirm step)
- **S11+ sprint 4**: Fase 2/5 (Importar vuelo) + polish

## Criterios globales de aceptación

- [ ] `npx vitest run` verde (suite completa, no solo los nuevos)
- [ ] `npm run arch:check` 0 errors, 0 warnings
- [ ] `npm run build` verde
- [ ] Coverage de los componentes tocados no baja del nivel actual
- [ ] E2E test Playwright del happy path en cada fase
- [ ] Documentación actualizada (`docs/SPEC.md`, `docs/TDD.md` si hay patrón nuevo)

## Tracking

- **Fase 1**: PR #42 ✅ mergeado
- **Fase 3.A**: TBD
- **Fase 3.B**: TBD
- **Fase 3.C**: TBD
- **Fase 4.1-4.3**: TBD
- **Fase 4.4-4.5**: TBD
- **Fase 2/5**: TBD
- **Fase 1.3 (Confirm step)**: TBD

## Referencias

- [Feedback original del dev nuevo (UX wizard)](../HANDOFF-2026-09-02.md) — focus en UX del form
- [Feedback de diseño de data model (este doc, segunda vuelta)] — focus en ciclos
- [PR #40 — fix logging authorize](../PR-40.md)
- [PR #41 — visibility en authorized callback](../PR-41.md)
- [PR #42 — wizard UX V2](../PR-42.md)
- [Migrations de parcels](../db/migrations/20260617170000_add_dji_parcels_normalized.sql)
- [Migrations de products](../db/migrations/20260829000000_add_products_catalog.sql) (referencia de patrón catálogo)
- [Documentación existente de cadencia](../FUMIGATION_CADENCE.md) — input para Fase 4.4 (reglas de cadencia)

---

**Última actualización**: 2026-09-04 (revisión: Ciclos Productivos + Capa de Gestión)
**Mantenedor**: TBD
