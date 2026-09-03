# Critical Review — Parcels & Fumigaciones Management

> Reviewed 2026-09-03 against master `1731ef6` (S10 cerrado). Goal: cerrar el capítulo operativo e identificar qué retirar, refactorizar o arreglar antes de declarar esta superficie "lista". Review **read-only** — no se propusieron cambios de código, solo findings con el detalle suficiente para armar un plan.

## 0. Executive Summary

**Overall health**: el loop operativo funciona (parcel inventory → detail → timeline → register → bulk ops → reports → audit) y el V0 adapter se ha mantenido con 17k fumigaciones. Pero la implementación ha derivado en:

- **3 definiciones distintas de "vencida/overdue"** (thresholds de 1d vs 7d vs 10d en `lib/fumigation-cadence.ts`, `lib/overdue-parcels.ts`, `lib/data-constants.ts` + el doc que directamente contradice al código).
- **2 funciones `effectiveCadence` con el mismo nombre y contratos distintos** (una en `lib/fumigation-cadence.ts` con phase/season/crop, otra en `api/repositories.ts` con schedule-only).
- **Cap silencioso de 2,000 fumigaciones** que trunca timelines de parcelas con mucha actividad.
- **Audit log fire-and-forget** en el path regulatorio.

Ningún bloquea el uso diario, pero los 4 van a causar un incidente antes del próximo contrato.

- **P0 (correctness/data)**: 4
- **P1 (UX/architectura)**: 7
- **P2 (drift/polish)**: 8

**Top 3 a arreglar antes de declarar "capítulo operativo cerrado"**:
1. **CAD-001** — unificar las 3+ definiciones de status de cadencia.
2. **FUM-001** — quitar el cap silencioso de 2,000 fumigaciones o mostrar banner cuando trunca.
3. **CAD-002** — colapsar las 2 `effectiveCadence` en una sola con contrato claro.

## 1. Strengths (qué está funcionando bien)

- **Strict layering** (`api/repositories.ts` + `api/queries.ts` + `lib/data.ts` V0 adapter) se mantiene; `dependency-cruiser` lo enforce. Las pages no bypassean a `lib/db.ts` ni `pg`.
- **Audit trail append-only** con shape de diff claro (`{ from, to }` por campo), flag de backfill detection (`_backfill: true`), y componente dedicado.
- **PII hygiene** consistente: no actor emails en logs, fixture sanitization, mutations role-gated.
- **TZ discipline** mayormente buena: `toDateString` en el repo boundary, `getBogotaDateString` para "now", `Intl.DateTimeFormat` con `America/Bogota` explícito en `formatRelative` del audit-trail.
- **Bulk operations** (delete + category reassign) son correctamente idempotentes: no-ops se cuentan como `skipped`, el audit log no se llena con eventos no-change.
- **URL-driven filters** en `/fumigaciones` con `buildPageUrl` preserva correctamente todos los searchParams al paginar.
- **Soft-delete + restore** simétrico: `getFumigationRawById` (audit/restore) y `getFumigationById` (UI) están propiamente separados.
- El workaround S10.4 `proxy.ts + x-pathname` entrega el AppShell gating que los sprints anteriores venían pateando.

## 2. Critical Issues (P0 — fix antes de cerrar el capítulo)

### CAD-001 — Cadence status tiene 3 thresholds distintos + 2 sets de labels
- **Severity**: P0
- **Location**:
  - `lib/fumigation-cadence.ts:171-175` (timeline + interval chart)
  - `lib/overdue-parcels.ts:40-46` (vista /parcelas/overdue)
  - `lib/data-constants.ts:36-42` `complianceStatus` (V0 inventory table → `STATUS_META` → `al_dia/por_vencer/vencido/critico`)
  - `docs/FUMIGATION_CADENCE.md:165-168` (el doc mismo, derivado)
- **Description**: el mismo concepto físico (cadence status de una parcela) se computa con 3 reglas distintas:
  - `getFumigationStatus`: `overdue` = `diffDays >= 1` (cualquier 1+ día tarde), `due_soon` = dentro de 7 días de la fecha objetivo (pasada o futura).
  - `computeSeverity` (overdue-parcels): `overdue` = `daysUntilNextDue < 0`, `due_soon` = 0..7 future.
  - `complianceStatus` (V0): `critico` = `> 10` días tarde, `vencido` = 0..10 tarde, `por_vencer` = 0..5 future, `al_dia` = `> 5` future.
  - Docs (markdown): `overdue` = `>= 7` días tarde, `due_soon` = `0..6` días tarde. **Esto contradice al código desde S6.**
- **Impact**: una parcela con 3 días de atraso aparece como `Vencida` (rojo) en el inventory table pero `due_soon` (amarillo) en el timeline. Una con 8 días de atraso es `Vencida` en un lugar y `Crítico` en otro. La página `/parcelas/overdue` usa un tercer threshold.
- **Suggested fix**: elegir una regla (recomendado: `complianceStatus` — 4 niveles, lo que ya muestra el V0 inventory), hacerla la única source of truth, y que `getFumigationStatus` y `computeSeverity` deleguen a ella. Update `docs/FUMIGATION_CADENCE.md` y los inline docstrings.

### FUM-001 — V0 timeline + /fumigaciones capeado silenciosamente a 2,000 records
- **Severity**: P0
- **Location**:
  - `app/(auth)/fumigaciones/data-loader.tsx:90` — `getRecentFumigations(2000)`
  - `lib/data.ts:512` — `getRecentFumigations(2000)` dentro de `loadDataset()` (alimenta el V0 adapter usado por parcel detail page timeline + inventory)
- **Description**: el proyecto tiene ~17,000 fumigaciones. El Loader y `loadDataset` piden solo las 2,000 más recientes. Sin banner, sin count, sin warning. Consecuencias:
  - `/fumigaciones` filters/orders contra una ventana de 2,000 rows — una búsqueda de un producto usado en 2024 devuelve 0 resultados porque esa fumigación es más vieja que la 2,000ava más nueva.
  - El parcel detail page (`getFumigationsByParcel` en `lib/data.ts:741`) hereda el cap, así que una parcela con mucha actividad con 300 eventos en 3 años puede mostrar solo los últimos 80 si dominan eventos más nuevos. El "X aplicaciones registradas desde YYYY-MM-DD" en el timeline da un "desde" incorrecto.
  - El compliance percentage (`onTime / intervals.length` en `app/(auth)/parcelas/[id]/page.tsx:66`) se computa del mismo slice capeado, sesgándolo hacia actividad reciente.
- **Impact**: silent data loss para el operador. /fumigaciones search/filter es engañoso. El detail page timeline sub-cuenta eventos históricos.
- **Suggested fix**: corto plazo (1 PR) — bumpear el cap a 20,000 (cubre 5 años al growth rate actual) y agregar un flag `has_more` + banner: "Mostrando N de M fumigaciones. Use los filtros para acotar." Largo plazo — server-side filter+pagination en `/fumigaciones`.

### CAD-002 — Dos funciones `effectiveCadence` con el mismo nombre, distintos contratos
- **Severity**: P0
- **Location**:
  - `lib/fumigation-cadence.ts:102-124` — `effectiveCadence(baseCadence, phase, season, cropType)` → adjusted cadence days (la lógica "real" con phase×season×orchards-in-lluvias ×0.7).
  - `api/repositories.ts:1020-1026` — `effectiveCadence(sched)` → `sched?.recommended_cadence_days` o `DEFAULT_CADENCE_DAYS`.
  - Test coverage: `tests/api-repositories-effective-cadence.test.ts` solo testea la segunda, la más simple. La lógica phase/season/crop en la primera **no tiene test directo para el caso orchards-in-lluvias × 0.7** (el doc lo afirma; el código tiene el branch; nada lo assertea).
- **Description**: dos funciones con nombre idéntico, inputs distintos, outputs distintos, callers distintos. La de `lib/fumigation-cadence.ts` es la "real". Un agent futuro leyendo `effectiveCadence` va a aterrizar en el archivo equivocado y el call site va a fallar silenciosamente.
- **Impact**: el ajuste orchards-in-lluvias × 0.7 (la afirmación agronómica más defendible del codebase) está **untested**.
- **Suggested fix**: renombrar la de `api/repositories.ts` a `resolveScheduleCadence(sched)`, y agregar un `tests/lib/fumigation-cadence.test.ts` case para orchards-in-lluvias → `Math.round(seasonAdjusted * 0.7)`.

### AUD-001 — Audit log es fire-and-forget en el path regulatorio
- **Severity**: P0
- **Location**: `lib/fumigation-audit.ts:138-150` (`safeAuditInsert`), llamado por `recordFumigationCreate`, `recordFumigationEdit`, `recordFumigationDelete`, `recordFumigationRestore`.
- **Description**: el docstring dice explícitamente "fire and forget: si la tabla de audit no existe o la BD se cae entre el op principal y el insert, el usuario NO ve un 500." Pero para compliance — y la FumigationDetail page llama la atención al audit ICA/Aerocivil explícitamente — el audit no es nice-to-have. Si el insert del audit falla, el operador no tiene ninguna señal in-band: el warning es un stderr line, la página muestra el estado de success, y el trail regulatorio está silenciosamente roto.
- **Impact**: en caso de falla parcial de BD (audit table locked, FK violation, replication lag), el operador podría soft-deleted o editar una fumigación y el sistema va a mostrar que la operación fue exitosa sin el audit record.
- **Suggested fix**: cuando el insert falla, marcar la respuesta con un field `audit_warning` que el route handler devuelve como header `X-Audit-Warning` y field de body. Los client components surface un banner amarillo: "Operación guardada, pero el log de auditoría falló. Contactá a soporte." Mínimo: dejar de swallow el error en producción.

## 3. Important Issues (P1)

### AUTH-001 — Roles en código (`admin | supervisor`) no matchean roles en docs (`admin | viewer`)
- **Location**: `lib/auth/role.ts:61` define `AppRole = "admin" | "supervisor"`. `docs/SDD.md:55-65` y `AGENTS.md` (R5) dicen "Roles: admin y viewer".
- **Impact**: onboarding confuso para un dev nuevo; el docstring de `getViewerRole` en `lib/auth/role.ts:140` explica el helper pero el nombre está mal. Los permission gates en UI están bien, pero cualquiera leyendo los docs primero va a buscar `viewer` y no lo va a encontrar.
- **Suggested fix**: renombrar `getViewerRole` → `getCurrentRole`, update SDD.md / AGENTS.md R5.

### UX-001 — `getViewerRole` se importa dinámicamente dentro del fumigation detail page
- **Location**: `app/(auth)/fumigacion/[id]/page.tsx:187` — `const { getViewerRole } = await import("@/lib/auth/role");`
- **Impact**: latency extra en la pantalla más transitada del operador, y un code smell que señala "esto es especial de alguna forma" (no lo es — mismo helper que en todos lados).
- **Suggested fix**: hoist a top-of-file static `import { getViewerRole } from "@/lib/auth/role";`.

### UX-002 — `EditFumigacionPage` docstring es misleading vs implementación
- **Location**: `app/(auth)/fumigacion/[id]/edit/page.tsx:44-55` (docstring + code).
- **Description**: el docstring dice "Simplificación: si NO es admin ni supervisor, mostrar el detail (read-only) con un banner 'no tenés permiso para editar'." Pero la implementación muestra un Card titulado "Sin permisos para editar" con un botón "Volver a fumigaciones" y NO renderiza el detail.
- **Suggested fix**: o (a) update del docstring para que matchee el código, o (b) implementar la promesa del docstring — render del detail como read-only con un banner. Opción (b) es más consistente con `app/(auth)/fumigacion/[id]/page.tsx` que ya tiene el banner `readOnlyReason`.

### UX-003 — `RegisterFumigationForm` tiene 13 fields en una sola pantalla sin grouping visual
- **Location**: `components/parcels/register-fumigation-form.tsx`.
- **Description**: un muro plano de inputs. No hay jerarquía visual entre "qué fumigaste" (producto, dosis, área) y "con qué compliance" (ICA, licencia, tipo aplicación).
- **Suggested fix**: split del form en 2-3 secciones visualmente distintas usando el primitive `<Card>` existente.

### UX-004 — El entry "Ingresar" / "Nueva fumigación" está split en tres páginas
- **Location**: `/fumigaciones/nueva` (standalone), `/parcelas/[id]` (inline), `/parcelas/[id]?action=fumigar` (auto-focus).
- **Impact**: un operador nuevo tiene que aprender tres lugares. El form inline es el más pulido pero no es obvio.
- **Suggested fix**: deprecar la página standalone una vez cerrado el capítulo operativo, o surface el form inline como un one-click button desde /fumigaciones.

### UX-005 — Bulk operations en /fumigaciones operan sobre la página actual, no sobre el filtro
- **Location**: `app/(auth)/fumigaciones/fumigaciones-table.tsx:148-158` (toggleAll).
- **Description**: "Select all" solo selecciona las filas de la página actual (50 de N). Combinado con FUM-001 (cap de 2000), el operador podría estar mirando un subset chico de los datos reales. El user clickea "Select all", piensa que seleccionó todo lo que matchea el filtro, pero el toast dice "Borradas 50".
- **Suggested fix**: renombrar a "Select page" + agregar una acción "Select all N matching" que mande el filtro completo a un endpoint bulk server-side.

### TECH-001 — `lib/format.ts#daysBetween` silently misbehaves si el input es un ISO timestamp
- **Location**: `lib/format.ts:231-237` (el helper) y `lib/fumigation-timeline.ts:119,131` (callers).
- **Description**: `daysBetween` valida que `from` y `to` sean YYYY-MM-DD. Si el caller pasa un ISO timestamp (e.g. `2026-08-01T00:00:00Z` — que es exactamente lo que `adaptFumigation` produce en `lib/data.ts:354`), el regex falla, y la función devuelve `null`. El fumigation timeline (V0 adapter) usa `events[i].date` que es el V0 `executed_at` string (`2026-08-01T00:00:00Z`), no el raw BD `fumigation_date`. Así que `daysBetween` devuelve `null` para cada interval, el observed cadence es `null`, y el "gaps > 60 days" array queda vacío — silenciosamente.
- **Impact**: el "cadencia observada" del timeline y la sección de gaps están muertos. El operador no tiene señal de que están muertos (no error, solo null).
- **Suggested fix**: en el call site, strip del time component antes de pasar a `daysBetween`, O cambiar `daysBetween` para aceptar ambos formatos. Agregar test para el caso ISO-timestamp.

### TECH-002 — `app/(auth)/parcelas/[id]/page.tsx` interval slice off-by-one e inconsistente con el timeline
- **Location**: `app/(auth)/parcelas/[id]/page.tsx:51-62`.
- **Description**: `fumigations.slice(0, 13).map(...)` produce 12 intervals. El `IntervalChart` muestra esos 12 points. Pero el componente `FumigationTimeline` (rendered abajo) muestra todos los eventos. Entonces una parcela con 60 eventos tiene 12 intervals en el chart pero 59 en el timeline.
- **Suggested fix**: render el mismo dataset (compute intervals una vez y pasar a ambos) o documentar "mostrando los últimos 12 intervals" en el chart card.

## 4. Minor Issues (P2)

- **DOC-001**: `docs/FUMIGATION_CADENCE.md:165-168` es la regla de threshold VIEJA. El doc debe regenerarse después de que CAD-001 aterrice.
- **DOC-002**: `app/(auth)/parcelas/[id]/page.tsx:432` tiene la card "Geometría — re-dibujo manual" que se muestra para TODAS las parcelas, incluyendo las que no tienen geometry todavía. Copy "Corregí el polígono si la forma de DJI no coincide" no aplica a parcelas manuales nuevas.
- **DOC-003**: `lib/map-parcel-content.ts:212-257` tiene un comment que se refiere a `Leaflet` y `PathOptions` y "Track A/B/C" — pero el archivo usa MapLibre (comment data de la migration S5, nunca se limpió).
- **TEST-001**: `tests/components/parcels/register-fumigation-form.test.tsx` tiene 22 tests. Los "2 flakies" que mencionaste probablemente viven en el async effect de `ProductPicker` (`components/fumigations/product-picker.tsx:91-117` — el value-sync effect hace `fetch` con `search=""` y compite con el debounce effect). Correr con `--repeat=5` para confirmar.
- **TEST-002**: `tests/api-repositories-effective-cadence.test.ts` no testea la `effectiveCadence` de `lib/fumigation-cadence.ts`. Solo la de `api/repositories.ts` (ver CAD-002).
- **TEST-003**: El audit log es fire-and-forget (AUD-001) pero no hay integration test que simule una falla.
- **TECH-003**: `api/repositories.ts:75-119` todavía tiene `loadLocalSummaryRecords` + `parseSummaryRecord` + `withLocalFallback` para legacy `djiag_exports/records_history.json` (pre-Opción B). El comment en línea 121-126 dice que las legacy tables se dropearon — pero el code path sigue.
- **TECH-004**: `lib/fumigation-cadence.ts:74-100` tiene un docstring largo para `effectiveCadence` que duplica el cuerpo de la función línea por línea.
- **UX-006**: `app/(auth)/parcelas/[id]/page.tsx` re-implementa la interval computation en JS en vez de usar el `lib/fumigation-timeline.ts` existente. Los dos divergen (TECH-002).
- **UX-007**: `components/fumigations/fumigation-audit-trail.tsx:66-68` re-define `isBackfillEvent` localmente porque importarlo de `lib/fumigation-audit.ts` arrastraría `pg` al bundle del cliente. Un shared `lib/types/audit-helpers.ts` sería más limpio.
- **UX-008**: `lib/data.ts#adaptFumigation` en línea 355: `(e.source ?? "manual") as "manual" | "import" | "djiscraper"` — si el source es "dji" (no "djiscraper"), el cast no normaliza. El V0 type dice `"manual" | "import" | "djiscraper"` pero el source enum también incluye "dji".
- **UX-009**: `app/(auth)/parcelas/[id]/page.tsx:431-450` muestra la card "Geometría — re-dibujo manual" siempre. Mismo fix que DOC-002: check `parcel.geom` y hide o reword.
- **UX-010**: `components/parcels/parcels-table.tsx:91-96` filtra por search pero los filtros Cliente/Estado no se resetean cuando el user limpia el input de search.
- **UX-011**: `app/(auth)/fumigaciones/page.tsx:67` tiene el filter `source` como `"dji" | "manual" | "all" | string` — el `| string` defeats type safety. Un operador que tipea `?source=djiscraper` directamente va a obtener `parseSource("djiscraper")` que devuelve `null`.

## 5. Inconsistencies & Drift

- **3 definiciones de cadence status** (CAD-001) — el peor offender.
- **2 definiciones de `effectiveCadence`** (CAD-002) — name collision silenciosa.
- **Roles** `admin/supervisor` (código) vs `admin/viewer` (docs) (AUTH-001).
- **Naming**:
  - URL paths en español plural (`/parcelas`, `/fumigaciones`) pero nombres de archivos/componentes en inglés (`ParcelMap`, `FumigationTimeline`).
  - Una página usa `/fumigacion/[id]` (singular) y otra usa `/fumigaciones` (plural). `app/(auth)/parcelas/[id]` y `app/(auth)/fumigacion/[id]` son inconsistentes: uno nidea bajo plural, el otro bajo singular.
  - DB column `parcel_id` vs V0 field `parcel_id` (string vs number).
- **Imports**:
  - `app/(auth)/parcelas/[id]/page.tsx:19-22` importa de `lib/data` (V0 adapter). `app/(auth)/fumigacion/[id]/page.tsx:3-34` importa de `api/repositories` (raw). Las dos pantallas usan distintos patrones de data access intencionalmente, pero el boundary no está documentado.
  - `getFumigationById` se llama desde tres lugares, todos usando el mismo pattern `Number(id)` + `notFound()`. Boilerplate duplicado.
- **Doc drift**:
  - `docs/FUMIGATION_CADENCE.md` dice que el threshold es `>= 7` para overdue; el código dice `>= 1` (CAD-001).
  - `docs/SPEC.md` (línea 3-14) está explícitamente marcado como histórico.
  - `docs/SDD.md:82` dice que el mapa es "MapLibre GL JS 6.0.0" pero AGENTS.md correctamente nota que es 4.7.1. La línea de SDD está mal.
- **`/parcelas` vs `/parcelas/[id]` vs `/admin/parcels`**: tres prefijos distintos para la misma entidad conceptual. S10 trató de consolidar agregando admin buttons a `/parcelas` (los botones "Importar GIS" y "Crear parcela" arriba en `components/parcels/parcels-table.tsx:185-211`) pero las tres URLs persisten.

## 6. Test Coverage Gaps

- **CAD-002's orchards-in-lluvias × 0.7** está documentado y codedeado pero ningún test lo assertea.
- **AUD-001** no tiene failure-mode test.
- **TECH-001 (daysBetween con ISO timestamp)** no tiene test, por eso se slipped.
- **Bulk operations** tienen integration tests en `tests/api-admin-fumigaciones-bulk.test.ts` pero no hay UI test para el selection state de `/fumigaciones` across filter changes (UX-005).
- **FUM-001** (el cap de 2000) no tiene test. Un test que assertea "loader returns N events" sin "loader trunca" sería un regression catcher.
- **Soft-delete semantics en el timeline**: hay test para `getFumigationById` (filters `deleted_at IS NULL`) y para `getRecentFumigations` (también filtra), pero el **V0 adapter's `getFumigationsByParcel` NO filtra por `deleted_at`** (línea 744 en `lib/data.ts` solo filtra por `parcel_id === parcelIdNum`). Una fumigación soft-deleted va a aparecer en el parcel detail timeline. ¿Bug? ¿Feature? De cualquier forma, necesita un test que assertee el comportamiento.
- **Pre-existing flakes** en `register-fumigation-form.test.tsx`. El ProductPicker effect en `components/fumigations/product-picker.tsx:91-117` hace un `fetch` con `search=""` en cada cambio de valor para buscar el nombre. Esto puede competir con el debounced search effect.

## 7. Plan to Close the Operational Chapter

Plan de 4 steps. Cada step es un PR-sized chunk con un clear "done" criterion. Estimates asumen la cadencia de S10 (1 dev, half-day a 1 day por PR).

### Step 1 — Unificar cadencia (CAD-001 + CAD-002 + DOC-001)
**Effort**: 0.5 day. **PR**: 1.
- Elegir una regla (recomendado: la 4-level de `complianceStatus` — ya la que usa el V0 inventory).
- Mover la regla a `lib/fumigation-cadence.ts` (o nuevo `lib/cadence-status.ts`), hacerla la única implementación.
- `getFumigationStatus` y `computeSeverity` delegan a ella.
- Renombrar `api/repositories.ts#effectiveCadence` → `resolveScheduleCadence`.
- Update `docs/FUMIGATION_CADENCE.md` para que matchee la regla elegida.
- Agregar tests para: overdue threshold (1d), due_soon threshold, no_history, los 4-level cutoffs, y el branch orchards-in-lluvias × 0.7.
- **Done**: 1 archivo con 1 regla, 1 test file con todas las branches green, 1 doc actualizado. Sin cambios en call sites (todos los wrappers siguen funcionando).

### Step 2 — Quitar el cap silencioso de 2000 fumigaciones (FUM-001)
**Effort**: 0.5 day. **PR**: 1.
- Bumpear el cap en `lib/data.ts:512` y `app/(auth)/fumigaciones/data-loader.tsx:90` a 20,000 (cubre growth proyectado).
- Agregar flag `has_more` al dataset/loader return; la página /fumigaciones muestra banner amarillo: "Mostrando 20,000 de N fumigaciones — usá los filtros para acotar."
- La página /fumigaciones mantiene client-side filtering por ahora.
- **Done**: no silent truncation; el operador siempre ve un count y un banner cuando trunca.

### Step 3 — Audit log integrity (AUD-001 + UX-002 + UX-007)
**Effort**: 1 day. **PR**: 1.
- Cambiar `safeAuditInsert` para retry una vez en transient failures y surface un `audit_warning` al route handler.
- Route handlers devuelven el warning como header (`X-Audit-Warning`) y como field de body.
- Los client components (edit form, delete button, bulk operations) muestran un banner amarillo: "Operación guardada, pero el log de auditoría falló. Contactá a soporte." alongside del success state.
- Update `EditFumigacionPage` docstring para que matchee el código (UX-002), O implementar la promesa read-only-detail-with-banner — elegir una.
- Mover `isBackfillEvent` a un pure shared module (UX-007).
- **Done**: audit failures son visibles al operador.

### Step 4 — Refactor para las próximas 10k fumigaciones (TECH-001 + TECH-002 + UX-003 + UX-005)
**Effort**: 1.5 days. **PR**: 2-3.
- Fix `daysBetween` para manejar ISO timestamps O strip del time en los call sites (TECH-001). Agregar tests.
- Unificar interval computation entre parcel detail page y `FumigationTimeline` component (TECH-002). Una pure function, llamada una vez server-side, pasada a ambos.
- Split `RegisterFumigationForm` en 2-3 secciones visuales (UX-003).
- "Select all" semantics: renombrar a "Select page" + agregar "Select all N matching" action (UX-005). Refactor más grande, podría ser su propio sprint.
- **Done**: las 4 pantallas de mayor tráfico del operador son correctas bajo carga y agrupadas lógicamente.

**Total**: ~3.5 días de dev work, 4-6 PRs.

## 8. Out of Scope (no arreglar acá)

- **DOSE_FIELDS_BACKFILL**: deuda conocida (640/642 fumigaciones con `dose_l_per_ha = NULL`). Atado a la DJI API que no expone el field.
- **SVG 400 en `/_next/image?url=%2Fafm-logo-mark.svg`** (deuda S10.4). Cosmético.
- **Refactor a `app/(auth)/` route group** (deuda S10.4). El workaround `proxy.ts + x-pathname` es funcional.
- **FK index en `dji_fumigaciones.product_id`** (AGENTS.md "S10.5 candidates #2"). Performance, no correctness.
- **Geovisor (`/geovisor`)**, **dashboard (`/`)**, **reports (`/reportes`)**, **admin/parcels** screens.
- **Scraper reliability** (`docs/DJI_SCRAPER.md`).

---

**Reviewer notes**:
- Review conducted read-only via read/grep/glob tools. No code modified, no commits, no tests run.
- Branch verified: master at `1731ef6` per user context (no independently re-verified — agent context no expuso `git rev-parse`).
- Files **not** read in full porque la sección relevante estaba más allá de la parte truncada: `app/(auth)/parcelas/[id]/page.tsx` (líneas 417-456 only), `components/parcels/register-fumigation-form.tsx` (líneas 495-end truncated), y `app/(auth)/fumigacion/[id]/page.tsx` (full read completed).
- Tests **not** executed. Los "2 flakies en register-fumigation-form" son hipótesis a verificar, no finding confirmado.
