# DeepSeek — Mini-tasks para agentes en paralelo (MiniMax)

> **Origen**: derivado de la auditoría 2026-09-10 y del estado en
> `docs/DEEPSEEK-COORDINATION.md`. Pensado para que **varios agentes
> (MiniMax) trabajen en paralelo** sin pisarse.
>
> **Cómo usar**:
> 1. Leé `docs/DEEPSEEK-COORDINATION.md` §0 (protocolo anti-colisión).
> 2. Elegí **una** tarea `⬜`, marcala `🟡 en progreso (agente)` acá.
> 3. Cambiá **solo** los archivos del scope de la tarea (columna "Archivos").
> 4. Cerrá con los gates verdes + commit scoped.
> 5. Pasá la tarea a `✅ hecho (<commit>)` acá.
>
> **Regla de paralelización**: dos tareas en una misma "Lane" **NO** van
> en paralelo (comparten archivo). Lanes distintas sí.

---

## 0. Gates obligatorios (antes de commitear)

```bash
npx tsc --noEmit            # 0 errores
npm run arch:check          # 0 errores
npx vitest run <test-file>  # si tocaste código con tests
```

Cualquier tarea que toque `lib/**` o `api/**` debe traer/actualizar test.
Commits: `tipo(scope): descripción` en presente.

---

## 1. Resumen (marcá el estado acá)

| ID | Tarea | Sev | Lane (archivo compartido) | Estado |
|---|---|---|---|---|
| MT-01 | #33 `trustHost` condicional | BAJO | `lib/auth.config.ts` | ✅ hecho (`086112c`) |
| MT-02 | #27 rol fresco en endpoints destructivos | MEDIO | `lib/auth/role.ts` + 2 routes | ✅ hecho (`ef93b41`) |
| MT-03 | #54 documentar invariante `dji_flights` sin `deleted_at` | BAJO | `docs/DATA-MODEL.md` | ✅ hecho (`31df9f9`) |
| MT-04 | #55 índice para el scan del dashboard | BAJO | `db/migrations/*` (nuevo) | ✅ hecho (`54b34b6`) |
| MT-05 | #23 quitar proyección redundante en farms report | BAJO | `api/repositories.ts` | 🚫 descartado (§3 mini-tasks) |
| MT-06 | #37 import GIS: inglés→español + colores | BAJO | `components/admin/parcels/import-gis-wizard.tsx` | ✅ hecho (`4a08925`) |
| MT-07 | Resolver TODOs de `map-filter-types.ts` | BAJO | `lib/map-filter-types.ts` | ✅ hecho (`b9ebc82`) |
| MT-08 | #36 restos: identifiers internos en `new-parcel-form` | BAJO | `components/admin/parcels/new-parcel-form.tsx` | ✅ hecho (`b9ebc82` + `53ab9ce` atribución) |
| MT-09 | #60 limpiar scratch del root | BAJO | raíz (gitignored) | ⬜ abierto |
| MT-10 | Tests de `lib/map-filter-types.ts` | BAJO | `tests/lib-map-filter-types.test.ts` (nuevo) | ✅ hecho (`b9ebc82`) |
| MT-11 | Sincronizar `README.md` con el estado actual | BAJO | `README.md` | ✅ hecho (consolidado en `b9ebc82`) |
| MT-12 | Cobertura de `api/queries.ts` | BAJO | `tests/api-queries.test.ts` (nuevo) | ✅ hecho (`2a0e12f`) |
| MT-13 | #40 branding unificado | BAJO | varios (**REQUIERE DECISIÓN**) | ⛔ bloqueada |
| MT-14 | #32 shape de error 400 consistente | MEDIO | varios handlers (**ÉPICO**, no mini) | ⛔ épico |
| MT-15 | #50 `product_used` vs `product_id` | MEDIO | `api/repositories.ts` (**ÉPICO** chico) | ⛔ épico |
| MT-16 | #52 tabla `fumigation_flights` | MEDIO | schema (**ÉPICO**) | ⛔ épico |

`⛔` = no es mini; requiere decisión/diseño (ver §3).

---

## 2. Detalle de cada mini-task

### MT-01 — #33 `trustHost` condicional
- **Lane**: `lib/auth.config.ts`
- **Contexto**: `trustHost: true` incondicional habilita host-header injection
  si se despliega fuera de un proxy de confianza. En Vercel es necesario.
- **Cambio**: reemplazar `trustHost: true` por:
  ```ts
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    Boolean(process.env.VERCEL) ||
    process.env.NODE_ENV !== "production"
  ```
- **Aceptación**: login funciona en dev (localhost) y en Vercel.
- **Verificación**: `npx tsc --noEmit` + `npx vitest run tests/api-admin-djiag-health.test.ts`.
- **Riesgo**: si self-host en prod sin proxy, habría que setear `AUTH_TRUST_HOST=true`.

### MT-02 — #27 rol fresco (BD) en endpoints destructivos
- **Lane**: `lib/auth/role.ts` + `app/api/admin/cycles/backfill/route.ts` + `app/api/admin/fumigations/bulk-delete/route.ts`
- **Contexto**: `requireRole` lee el rol del JWT (TTL 12h). Un usuario degradado
  conserva permisos hasta 12h. `getCurrentUserRole()` (BD-fresh) no lo usa nadie.
- **Cambio**: agregar en `lib/auth/role.ts` un helper `requireFreshRole(required)`
  que: (1) llama a `requireRole(required)`, (2) revalida con
  `getCurrentUserRole()` y lanza 403 si no matchea. **No bloquear si la BD falla**
  (getCurrentUserRole devuelve null en error) → degradar al rol del JWT y
  loguear. Aplicarlo solo a los 2 endpoints destructivos.
- **Aceptación**: los endpoints siguen funcionando para admins; un rol degradado
  en BD es rechazado sin esperar el TTL.
- **Verificación**: test del endpoint + `npx tsc --noEmit`.

### MT-03 — #54 documentar invariante `dji_flights` sin `deleted_at`
- **Lane**: `docs/DATA-MODEL.md`
- **Contexto**: `dji_flights` no tiene `deleted_at` (a diferencia de
  `dji_parcels`/`dji_fumigations`). Es intencional pero no está documentado y
  confunde en queries mixtas.
- **Cambio**: en la sección `dji_flights`, agregar una nota: "sin soft-delete
  por diseño; las queries que joinean con parcelas/fumigaciones deben filtrar el
  `deleted_at` de esas tablas, no de flights". Agregar a §7 (invariantes).
- **Aceptación**: doc actualizada; no toca código.
- **Verificación**: revisión visual.

### MT-04 — #55 índice para el scan del dashboard
- **Lane**: `db/migrations/20260910000003_idx_dji_flights_alert.sql` (nuevo)
- **Contexto**: `fetchDashboardMetricsRaw` (lib/cache.ts) filtra
  `WHERE area_m2 >= 40000 OR duration_seconds >= 28800` sin índice → seq scan.
- **Cambio**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_dji_flights_area_m2
    ON dji_flights (area_m2) WHERE area_m2 IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_dji_flights_duration_seconds
    ON dji_flights (duration_seconds) WHERE duration_seconds IS NOT NULL;
  ```
  Comentario: el cuello es el `OR` (bitmap OR de 2 índices), no la fecha.
- **Aceptación**: migration aplicable e idempotente.
- **Verificación**: `npm run db:migrate` en local + `EXPLAIN` (opcional).

### MT-05 — #23 quitar proyección redundante en farms report
- **Lane**: `api/repositories.ts` (⚠ SHARED — una sola tarea por vez)
- **Contexto**: `getFarmsReportFumigations` proyecta `p.land_name AS parcel_name`
  **y** `p.land_name` (misma data); además `f.product_id` no está en
  `FarmsReportFumigationRow`.
- **Cambio**: si `land_name` no se consume (grep en `lib/reports/**` y
  componentes), quitar la columna del SELECT y del tipo. Si se consume, dejar.
  Idem `product_id`.
- **Aceptación**: no romper `farms-table.tsx` / `fetch-farms-report-data.ts`.
- **Verificación**: `npx vitest run tests/lib-reports-*`.

### MT-06 — #37 import GIS: inglés → español
- **Lane**: `components/admin/parcels/import-gis-wizard.tsx`
- **Contexto**: quedan strings en inglés y colores fuera del design system.
- **Cambio**: "Preview" → "Vista previa"; "Click 'Crear N parcelas'" →
  "Tocá «Crear N parcelas»"; "shapefile" → "archivo SIG"; reemplazar
  `border-green-300 bg-green-50 text-green-900` y `border-amber-300 bg-amber-50`
  por tokens (`border-chart-1/40 bg-chart-1/5`, etc.) si hay equivalente.
- **Aceptación**: textos en español; sin regresión visual grave.
- **Verificación**: `npx tsc --noEmit` (+ test del wizard si existe).

### MT-07 — resolver TODOs de `lib/map-filter-types.ts`
- **Lane**: `lib/map-filter-types.ts`
- **Contexto**: 4 `TODO:` sobre campos que `DjiParcelRecord` no tiene
  (`farm_name`, `client_name`, `municipality`, `variety`).
- **Cambio**: reemplazar los TODO por un comentario explicativo (por qué se
  mapean/omiten) o eliminarlos si ya no aplican. No cambiar comportamiento.
- **Aceptación**: sin TODOs huérfanos; `npx vitest run tests/lib/map-filter-logic.test.ts`.

### MT-08 — #36 restos: `new-parcel-form`
- **Lane**: `components/admin/parcels/new-parcel-form.tsx`
- **Contexto**: `aria-label="Nombre del cliente (texto libre, fallback)"` usa
  "fallback" (jerga). Verificar si quedan identificadores internos.
- **Cambio**: "fallback" → "opcional"; revisar otros strings técnicos.
- **Verificación**: `npx vitest run tests/components/admin/parcels/new-parcel-form.test.tsx`.

### MT-09 — #60 limpiar scratch del root
- **Lane**: raíz (`gh-pr-body-*.md`, `git-commit-msg-*.txt`, `dev-server-bg.log`)
- **Contexto**: 61 archivos de scratch gitignored.
- **Cambio**: borrarlos del disco (`Remove-Item`). **NO** están trackeados; no
  aparece en git. Coordinar antes: pueden ser de otra sesión.
- **Verificación**: `git status` sigue limpio.

### MT-10 — tests de `lib/map-filter-types.ts`
- **Lane**: `tests/lib-map-filter-types.test.ts` (nuevo)
- **Contexto**: `lib/map-filter-types.ts` no tiene test directo (la heurística lo
  marca como sin cobertura).
- **Cambio**: agregar tests que cubran el mapeo de filtros y sus defaults.
  Complementa MT-07 (misma lane → **no** en paralelo con MT-07).
- **Verificación**: `npx vitest run tests/lib-map-filter-types.test.ts`.

### MT-11 — sincronizar `README.md` con el estado actual
- **Lane**: `README.md`
- **Contexto**: el README quedó de sprints viejos; el estado real está en
  `AGENTS.md` + `docs/DEEPSEEK-COORDINATION.md`.
- **Cambio**: actualizar comandos, rutas y stack (Next 16, MapLibre 4.7.1,
  Vitest 3) y agregar un puntero a `docs/DEEPSEEK-COORDINATION.md`. No tocar
  código.
- **Verificación**: revisión visual.

### MT-12 — cobertura de `api/queries.ts` (proyección compartida)
- **Lane**: `tests/api-queries.test.ts` (nuevo)
- **Contexto**: `api/queries.ts` figura "sin datos" de coverage en
  `vitest.config.ts`. Exporta `djiParcelsQuery` y `djiParcelsMetadataQuery`
  (SQL template).
- **Cambio**: test que valide que las queries contienen las columnas/joins
  esperados (id, land_name, crop_type, FK cliente/finca, `deleted_at IS NULL`,
  LEFT JOIN de cadencia). No ejecuta BD.
- **Verificación**: `npx vitest run tests/api-queries.test.ts`.

---

## 3. Épicos (NO asignar como "mini") — requieren decisión/diseño

| ID | Tema | Por qué no es mini |
|---|---|---|
| MT-13 | #40 branding "AFM Geovisor" vs "AeroAdmin AFM" | **Decisión de producto** del operador. Unificar en todos los metadata/sidebar/login. |
| MT-14 | #32 shape de error 400 (`{error, issues}` vs `{error}`) | Toca ~10 handlers; definir contrato primero. |
| MT-15 | #50 `product_used` (texto) vs `product_id` (FK) | Decidir source of truth (vista/trigger/denormalizado). |
| MT-16 | #52 tabla de unión `fumigation_flights` | Migración + backfill + refactor de consumidores. |
| — | #58 paginación server-side `/fumigaciones` | Cambio de contrato cliente/servidor. |

> Antes de tomar un épico: escribir la propuesta de approach en
> `docs/DEEPSEEK-COORDINATION.md` §3 y esperar OK del coordinador (DeepSeek).

---

## 4. Plantilla de reporte (al cerrar una tarea)

```
- Tarea: MT-XX
- Commit: <hash>
- Archivos: <lista>
- Cambio: <1-2 líneas>
- Gates: tsc ✅ / arch ✅ / tests <N> ✅
- Notas / riesgo: <...>
```

Actualizá la fila en §1 (`✅ hecho (<hash>)`) y, si agregaste un hallazgo nuevo,
sumá una fila a `docs/DEEPSEEK-COORDINATION.md` §3.
