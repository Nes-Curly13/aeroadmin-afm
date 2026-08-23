# Audit log de fumigaciones

> Sprint: `feature/fumigation-audit-log` (2026-08-15).
> Cierra el pedido del operador fumigador (y del contador ICA) de
> tener trazabilidad de QUIÉN hizo QUÉ sobre una fumigación:
> cuándo se creó, qué campos se editaron, cuándo se soft-deleted,
> cuándo se restauró. Antes de este sprint, la BD solo guardaba
> los datos finales — un edit borraba la historia.

## TL;DR

- Tabla `fumigation_audit_log` (append-only) con FK CASCADE a `dji_fumigations`.
- 4 actions posibles: `created | edited | deleted | restored` (validados por CHECK de BD + código).
- Cada endpoint mutador (POST / PATCH / DELETE / POST /restore) inserta
  un evento via `lib/fumigation-audit.ts` después de la op exitosa.
- UI: panel "Historial" en `/fumigacion/[id]` con timeline vertical,
  icono por action, diff expandible para edits.
- 1504 tests verde, 0 violations de `arch:check`, build prod verde.

## Schema

```sql
CREATE TABLE fumigation_audit_log (
  id            SERIAL PRIMARY KEY,
  fumigation_id INT  NOT NULL REFERENCES dji_fumigations(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('created','edited','deleted','restored')),
  actor_email   TEXT NOT NULL,    -- denormalizado
  changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fumigation_audit_log_fumigation
  ON fumigation_audit_log(fumigation_id, created_at DESC);
```

**Decisiones clave:**

- **FK con CASCADE**: si en el futuro se hace un hard-delete de la
  fumigación, el audit log no sobrevive como fantasma sin contexto.
- **`actor_email` denormalizado** (no FK a `app_users`): si el user
  se borra, la auditoría persiste.
- **Sin trigger de BD**: el insert se hace desde código
  (`lib/fumigation-audit.ts`) para poder controlar el shape del
  JSON según el action.
- **Sin índice por action ni por actor_email**: la query canónica
  es "historia de esta fumigación, DESC". Las queries por actor
  se agregarán si se necesitan (no son hot path hoy).
- **JSONB y no JSON text**: permite queries futuras del estilo
  `WHERE changes->'diff' ? 'product_used'` sin parsear en el cliente.

## Shape del campo `changes`

El shape depende del `action`. Se valida por convención en código
(no ENUM) — la BD solo valida que `action` sea uno de los 4 valores.

### `created` (snapshot completo del evento creado)
```json
{
  "fields": {
    "parcel_id": 42,
    "fumigation_date": "2026-08-15",
    "product_used": "Glifosato 48%",
    "dose_l_per_ha": 2.5,
    "area_fumigated_m2": 12345,
    "drone_code_used": 201,
    "duration_minutes": 45,
    "notes": null,
    "product_registered_ica": "ICA-1234-PN",
    "pilot_license": "PCA-12345",
    "category_id": 1
  }
}
```

### `edited` (diff de los campos que efectivamente cambiaron)
```json
{
  "diff": {
    "product_used": { "from": "Roundup", "to": "Glifosato 48%" },
    "dose_l_per_ha": { "from": 2.0, "to": 2.5 },
    "notes": { "from": "old", "to": null }
  }
}
```

Si la diff está vacía (caller mandó un patch pero ningún campo
cambió), NO se inserta audit — la UI mostraría "0 campos cambiados"
que es ruido.

### `deleted` (snapshot del estado al momento de borrar)
```json
{
  "snapshot": { /* mismo shape que `created.fields` */ }
}
```

Solo se inserta si la fumigación REALMENTE pasó de activa a
soft-deleted (idempotencia del endpoint DELETE). Si ya estaba
soft-deleted y se llama DELETE de nuevo, NO se inserta un segundo
"deleted" — la BD ya tiene el original.

### `restored` (metadata del estado soft-deleted del que salió)
```json
{
  "restored_from": {
    "deleted_at": "2026-08-14T10:00:00.000Z",
    "deleted_by": "supervisor@afm.local"
  }
}
```

Solo se inserta si la fumigación REALMENTE pasó de soft-deleted a
activa. Si NO estaba soft-deleted y se llama /restore, NO se inserta
"restored" (no-op idempotente).

## Flujo de integración

```
endpoint POST/PATCH/DELETE/restore
  ↓
  repo: createFumigationEvent / updateFumigationEvent / softDelete / restore
  ↓ (éxito)
  endpoint: getFumigationById o getFumigationRawById (para "after")
  ↓
  endpoint: lib/fumigation-audit.recordFumigation{Create|Edit|Delete|Restore}
  ↓
    ├─ fire-and-forget (no rompe el response)
    ├─ safeAuditInsert (try/catch + console.warn si falla)
    └─ recordXxx helper (decide si fue cambio real o no-op idempotente)
        ↓
        insertFumigationAuditEvent (repo)
            ↓
            INSERT INTO fumigation_audit_log ...
```

**Fire-and-forget**: el insert del audit NO rompe el response del
endpoint aunque la BD caiga entre el op principal y el audit. La
fumigación ya quedó persistida (o ya fue borrada); el audit log es
nice-to-have. Si el caller quiere insert estricto, llama
`insertFumigationAuditEvent` directo (no usado hoy).

## Endpoints consumidores

| Endpoint                                | Helper audit                          | Action registrada | Cuándo NO se inserta |
|-----------------------------------------|---------------------------------------|-------------------|----------------------|
| `POST /api/admin/fumigations`           | `recordFumigationCreate`              | `created`         | (siempre que 201)     |
| `PATCH /api/admin/fumigations/[id]`     | `recordFumigationEdit`                | `edited`          | diff vacía, 404, 400 |
| `DELETE /api/admin/fumigations/[id]`    | `recordFumigationDelete`              | `deleted`         | ya estaba soft-deleted (idempotent) |
| `POST /api/admin/fumigations/[id]/restore` | `recordFumigationRestore`         | `restored`        | ya estaba activa (idempotent) |

## UI (`/fumigacion/[id]`)

El detail page agrega una nueva Card al final: **Historial**.

- Empty state: mensaje explicando que fumigaciones creadas
  antes del 2026-08-15 no tienen eventos registrados.
- 1+ eventos: timeline vertical, ordenado DESC (más reciente
  primero). Cada item muestra:
  - Icono coloreado por action (verde/celeste/rojo/amber)
  - Label del action ("Fumigación creada" / "editada" / etc.)
  - "Por {actor_email}"
  - "Hace 2 h" / "Hace 3 d" / fecha absoluta si > 30 días
  - **Si action=edited**: botón "N campos cambiados" que al click
    expande la diff con valores formateados:
    - `null` → "—"
    - `YYYY-MM-DD` → "DD/MM/YYYY" (sin shift, Bogota-local)
    - integer → sin decimales
    - float → 2 decimales
  - **Si action=created o deleted**: snapshot inline con los
    campos no-vacíos.
  - **Si action=restored**: "Restaurada desde {fecha} (borrada por X)".

## Queries útiles

### Historia de una fumigación específica
```sql
SELECT id, action, actor_email, changes, created_at
  FROM fumigation_audit_log
 WHERE fumigation_id = $1
 ORDER BY created_at DESC, id DESC;
```

### "¿Quién borró fumigaciones en el último mes?"
```sql
SELECT actor_email, COUNT(*) AS n_deletes
  FROM fumigation_audit_log
 WHERE action = 'deleted'
   AND created_at >= NOW() - INTERVAL '30 days'
 GROUP BY actor_email
 ORDER BY n_deletes DESC;
```

### "¿Qué fumigaciones editó el supervisor X?"
```sql
SELECT fumigation_id, changes, created_at
  FROM fumigation_audit_log
 WHERE action = 'edited'
   AND actor_email = 'supervisor@afm.local'
   AND created_at >= NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;
```

(No hay índice por actor_email todavía — si esta query se vuelve
hot, agregar `CREATE INDEX ... ON fumigation_audit_log(actor_email, created_at DESC)`.
No es urgente para el v1.)

## Pruebas y verificación

| Capa | Tests | Archivo |
|------|-------|---------|
| Repository (insert + getTrail) | 11 | `tests/api-repositories-fumigation-audit.test.ts` |
| API POST (create) | +4 (audit block) | `tests/api-admin-fumigations.test.ts` |
| API PATCH (edit) | +5 (audit block) | `tests/api-admin-fumigations-patch.test.ts` |
| API DELETE | +3 (audit block) | `tests/api-admin-fumigations-delete.test.ts` |
| API POST /restore | +4 (audit block) | `tests/api-admin-fumigations-restore.test.ts` |
| Componente UI (FumigationAuditTrail) | 14 | `tests/components/fumigations/fumigation-audit-trail.test.tsx` |
| **Total nuevos** | **41** | |

Pre-sprint: 1463 tests. Post-sprint: 1504. **+41 nuevos**, 0
regresiones. `arch:check` 0 violations, `npm run build` verde.

## Backfill inicial (Sprint 2026-08-18)

El audit log solo registra eventos desde que se deployó (2026-08-15).
Las ~17k fumigaciones históricas no tenían eventos registrados, así
que el panel "Historial" de cada fumigación aparecía vacío.

**Solución**: `scripts/backfill-audit-log.js` popula la tabla con
eventos `created` y `deleted` reconstruidos desde los datos
históricos de `dji_fumigations`:

| Action | Fuente histórica | Limitación |
|---|---|---|
| `created` | `dji_fumigations.recorded_at` (timestamp) + `recorded_by` (actor) | `recorded_by` NULL → se marca como `system@dji-import` |
| `deleted` | `dji_fumigations.deleted_at` + `deleted_by` | `deleted_by` NULL → se marca como `unknown@aeroadmin.local` |
| `edited` | ❌ No backfillable | Antes del sprint, las ediciones eran SQL UPDATE directo, no hay historial |
| `restored` | ❌ No backfillable | El endpoint `/restore` es nuevo, no hay restores anteriores |

### Snapshot de los eventos backfilled

A diferencia de los eventos reales (donde el snapshot refleja el estado
al momento del evento), los backfilled usan el **estado actual** de la
fumigación como snapshot. Esto es honesto y útil — el operador ve qué
campos tiene hoy ese registro, aún si la fumigación fue editada
después del deploy.

Para que la UI pueda diferenciar eventos backfilled de eventos reales
en el futuro, el payload `changes` incluye un tag:

```json
{
  "_backfill": true,
  "_note": "Reconstruido del estado actual de la BD…",
  "fields": { ... }  // o "snapshot": { ... }
}
```

### Identificación en la UI (sprint 2026-08-22)

El componente `FumigationAuditTrail` (`components/fumigations/fumigation-audit-trail.tsx`)
usa el helper `isBackfillEvent()` de `lib/fumigation-audit.ts` para detectar
el tag y mostrar un badge "Reconstruido" al lado del label del evento:

- **Color**: outline amber (`#d97706` border, fondo amber-50)
- **Posición**: al lado del label del action (`Fumigación creada`, `Fumigación editada`, etc.)
- **a11y**: el `aria-label` del `<li>` incluye "(reconstruido)" para screen readers
- **Tooltip**: `title="Reconstruido a partir del estado actual de la BD por el script de backfill. No es un evento registrado cuando el operador hizo click en Guardar."`

Cuando lleguen eventos reales futuros, NO tendrán el tag `_backfill` y se
mostrarán sin badge. El operador puede así distinguir "esto pasó cuando
hice click en Guardar" de "esto fue reconstruido por el backfill inicial".

### Uso

```bash
# Previsualizar sin tocar la BD
node scripts/backfill-audit-log.js --dry-run

# Ejecutar de verdad (idempotente — re-ejecutable)
node scripts/backfill-audit-log.js

# Smoke test con 100 fumigaciones
node scripts/backfill-audit-log.js --limit=100
```

### Output esperado

```
[backfill-audit-log] Stats:
  total fumigations processed: 17000
  created:  17000 inserted, 0 already existed
  deleted:  847 inserted, 0 already existed, 16153 not soft-deleted
  elapsed:  2.34s
```

### Tests (17 nuevos, todos verde)

`tests/scripts-backfill-audit-log.test.ts` cubre:
- `parseArgs` (8 casos): default, --dry-run, --limit válido/inválido, --help, flag desconocido, posicional
- `backfillSnapshot` (3 casos): shape de fields vs snapshot, normalización undefined→null
- `backfillAuditLog` (6 casos): happy path con 3 fumigaciones, idempotencia (2 corridas), --dry-run no inserta, --limit N solo procesa N, fallback de actor cuando NULL

## Limitaciones conocidas (v1)

1. **No hay query "todos los eventos de un usuario" con índice**.
   Full scan eventual. Si se vuelve hot, agregar índice compuesto
   `(actor_email, created_at DESC)`.
2. **No hay UI de "historial global por actor"** (solo por fumigación).
   El operador fumigador hoy pide "quién editó qué" caso por caso
   en la ficha de la fumigación. Si se vuelve común, se puede agregar
   un endpoint `GET /api/admin/audit?actor=X&action=Y&from=...&to=...`.
3. **El audit NO cubre fumigaciones scrapeadas de DJI** (imports).
   Esos vienen de `scripts/upsert-fumigations-from-djiag.js` y
   `scripts/batch-upsert-fumigations.js` que no llaman al endpoint
   POST. Para cubrirlos habría que insertar "created" desde el script
   con un `actor_email` tipo `"system@dji-import"`. No es necesario
   para v1 — el operador fumigador ya sabe que esos vienen de DJI.
4. **No hay retention policy**. La tabla crece linealmente con
   fumigaciones + edits + deletes. Sobre los volúmenes actuales
   (~17k fumigaciones), el crecimiento es despreciable (< 1MB/mes).
   Si en el futuro se vuelve un tema, se puede hacer partitioning
   por mes en `created_at`.

## Rollback

Si algo rompe en prod:

1. **Revertir el código**: `git revert <merge-commit>` del sprint.
2. **Borrar la tabla**: `DROP TABLE fumigation_audit_log;` (no
   afecta a `dji_fumigations` — la FK es CASCADE solo del lado
   audit, no de fumigaciones).
3. **Revertir la migration**: `npm run db:migrate:down` con el
   archivo `20260815000000_add_fumigation_audit_log.sql` (si se
   agregó el DOWN equivalente — verificar antes).

La fumigación sigue funcionando sin el audit log (los endpoints
solo insertan al lado). No es un feature crítico-path.
