# Plan — Cerrar Dashboard + Alertas (hoy)

> **Autor**: DeepSeek (coordinador) · 2026-09-13 · master `5c0706a`
> **Objetivo**: dejar el dashboard y el sistema de alertas coherentes y útiles,
> y cerrar en una sesión. Tareas ultra-específicas (aptas para MiniMax) + las
> de riesgo las hace el coordinador.

---

## 0. PIVOT 2026-09-15 — planificación MANUAL + dashboard interactivo

El operador pidió **dejar de marcar todo como "vencido"**. Decisión aplicada:

- La planificación **ya no se auto-deriva** de `phase_application_rules`.
  `getPhasePlanningOverview` quedó **deprecada** (el dashboard no la usa).
- Nueva tabla **`fumigation_plans`** (migration `20260915000000_add_fumigation_plans.sql`):
  el operador agenda planes a mano. El tablero arranca **vacío** y solo se
  marca "vencido" lo agendado explícitamente.
- Repo: `listFumigationPlans` / `createFumigationPlan` / `updateFumigationPlan`
  / `deleteFumigationPlan` (`api/repositories.ts`). API:
  `/api/admin/fumigation-plans` (+`/[id]`), auth `admin|supervisor`.
- UI: `components/dashboard/planning-board.tsx` (reemplaza a `planning-panel.tsx`,
  eliminado) — crear / marcar hecha / cancelar / borrar + link "Registrar".
- Dashboard reimaginado (`app/(auth)/page.tsx`): **filtros interactivos**
  (`components/dashboard/dashboard-filters.tsx`) por período y cliente vía
  `searchParams` (server-rendered), KPIs recalculados, `QuickActions` con gate
  admin (DASH-06), chart y actividad filtrados.

**Estado**: implementado + tests (repo/API/UI). `tsc` 0, `arch:check` 0,
suite completa verde, build de producción OK, migration aplicada a la BD y
SQL validado end-to-end. Los items DASH-01..08 originales quedan **superados**
por este pivot (salvo DASH-06, ya incluido).

---

## 1. Diagnóstico (revisión del dashboard + alertas)

### 1.1 Dashboard actual (`app/(auth)/page.tsx`)
Orden: `PageHeader` → 4 `KpiCard` → `PlanningPanel` → `QuickActions` + `HealthPanel` → `MonthlyChart` → `RecentActivity`.

Problemas:
1. **Las "alertas" legacy son código muerto.** `fetchAlertsCached` (lib/cache.ts:454) + `fetchAlertsFromFumigationsRaw` + `buildAlertsFromFumigations` + `aggregateFumigationsByParcelAndDay` + `buildAlertFromFumigation` + `getAlertLevelFromFumigations` + `DjiAlertRecord` **no los consume ninguna UI** (el viejo `AlertsPanel` se eliminó). El único sistema de alertas vivo es el `PlanningPanel`.
2. **`PlanningPanel` no es accionable**: lista parcelas con aplicaciones pendientes/vencidas, pero no permite registrar la aplicación desde ahí. Solo navega al detalle de la parcela.
3. **`PageHeader` muestra un timestamp falso**: `Datos al {fmtDateTime(NOW.toISOString())}` usa la constante `NOW` de `lib/data` (fija) → nunca cambia (page-header.tsx:21).
4. **`MonthlyChart` inaccesible**: los valores están `opacity-0 ... group-hover:opacity-100` (solo se ven con hover), sin eje/leyenda clara ni `title` (monthly-chart.tsx:26,34-38).
5. **`HealthPanel` (técnico) en el dashboard del operador**: es monitoreo del scraper DJI; el operador no lo necesita día a día (ya documentado en AGENTS.md § Dashboard).
6. **Perf**: el dashboard usa el V0 adapter (`getParcels()` 1213 + `getFlights()` ~10k + `getFumigations()`) y filtra en JS. Funciona pero carga miles de filas para 4 KPIs. (Mejora opcional, no bloqueante.)
7. **`QuickActions` "Nueva parcela"** apunta a `/admin/parcels/new` (admin-only): para un viewer el link queda muerto (quick-actions.tsx:53).

### 1.2 Decisión de producto
- **Un solo sistema de alertas**: el `PlanningPanel` (fase fitosanitaria). Se **elimina la cadena legacy de alertas** (dead code) para no confundir.
- **El PlanningPanel pasa a ser accionable** (registrar la aplicación desde el dashboard).
- **HealthPanel sale del dashboard del operador** → va a `/admin` (monitoreo).

---

## 2. Tareas

> Reglas para agentes: ver `docs/DEEPSEEK-UI-TASKS.md` §0. Scope exacto, cambio
> mínimo, no refactor, no tocar `components/ui/*`/`api/**`, gates `tsc` + test.

### DASH-01 — Eliminar las alertas legacy (dead code) ⚠️ coordinador
- **Archivos**: `lib/cache.ts`, `lib/dji-fumigations-aggregate.ts`, `lib/types.ts`, `lib/map-parcel-content.ts`, `lib/cache.ts` (tags/TTL).
- **Qué borrar** (verificando que no tenga consumidores de runtime):
  - `lib/cache.ts`: `fetchAlertsFromFumigationsRaw`, `fetchAlertsCached`, `CACHE_TAGS.alerts`, `CACHE_TTL.alerts`, `invalidateTagImmediate(CACHE_TAGS.alerts)` (línea ~934), y el import de `buildAlertsFromFumigations`/`DjiAlertRecord` si quedan sin uso.
  - `lib/dji-fumigations-aggregate.ts`: `buildAlertsFromFumigations`, `buildAlertFromFumigation`, `getAlertLevelFromFumigations`, `aggregateFumigationsByParcelAndDay` **solo si** ningún otro módulo los usa (grep primero). Mantener los helpers que sí se usan (`m2ToMu`, etc.).
  - `lib/types.ts`: `DjiAlertRecord` (solo si no lo referencia nada de runtime; el comentario en `lib/map-parcel-content.ts:54` se actualiza).
  - Tests: `tests/lib-cache-alerts-fetch.test.ts`, `tests/dji-fumigations-aggregate.test.ts` (borrar los `describe` de alertas; si el archivo testea otras cosas que quedan, dejar solo esas).
- **NO tocar**: el `PlanningPanel` ni el dashboard.
- **Verificación**: `npx tsc --noEmit` + `npm test` (que no queden imports rotos). Si algo depende y no está claro → reportar bloqueado.
- **Riesgo**: medio (borrado transversal). Por eso lo hace el coordinador.

### DASH-02 — `PlanningPanel` accionable
- **Archivo**: `components/dashboard/planning-panel.tsx`.
- **Cambios** (sin cambiar props ni data):
  1. En cada fila, agregar un link **"Registrar"** a
     `/fumigaciones/nueva?parcel=${p.parcel_id}` (el wizard ya acepta `?parcel=`;
     ver `app/(auth)/fumigaciones/nueva/page.tsx:41-46`).
  2. Mostrar la **fecha de vencimiento** de la aplicación cuando exista:
     `p.nextApplication?.window_end` (formatear con `fmtDate` de `lib/format`).
  3. Mantener el badge de estado y el contador de vencidas/pendientes.
- **NO tocar**: `PhasePlanningItem` ni `page.tsx`.
- **Verificación**: `npx vitest run tests/components/dashboard/planning-panel.test.tsx`.

### DASH-03 — `PageHeader`: timestamp real
- **Archivo**: `components/page-header.tsx`.
- **Cambio**: reemplazar la constante `NOW` por la fecha del render. Opciones: quitar la línea ("Datos al …") o usar `fmtDateTime(new Date().toISOString())`. **Ojo**: `PageHeader` es server component; `new Date()` es válido. Si tests asertan el texto exacto, ajustarlos.
- **NO tocar**: el resto del header.
- **Verificación**: `npx tsc --noEmit` + `npx vitest run tests/components/page-header.test.tsx` (si existe).

### DASH-04 — `MonthlyChart` accesible
- **Archivo**: `components/dashboard/monthly-chart.tsx`.
- **Cambios**:
  1. Los valores (`{fmtInt(d.ha)}`) hoy son `opacity-0 group-hover:opacity-100` → mostrar siempe `opacity-100` (o quitar la opacidad) para que se lean en touch/teclado.
  2. Agregar `title`/`aria-label` a cada barra con `mes, ha, vuelos` (ej. `title="mar 2026 · 120 ha · 45 vuelos"`).
  3. Agregar una leyenda simple arriba del chart: "Barra = ha · Punto = vuelos".
- **NO tocar**: `MonthlyBar` (la shape) ni `page.tsx`.
- **Verificación**: `npx tsc --noEmit`.

### DASH-05 — Sacar `HealthPanel` del dashboard del operador
- **Archivos**: `app/(auth)/page.tsx` (quitar `<HealthPanel>` del grid) + `app/(auth)/admin/page.tsx` (agregar una card/link a un lugar donde se vea el health).
- **Implementación mínima y segura**:
  1. En `app/(auth)/page.tsx`: el grid `lg:grid-cols-2` con `QuickActions` + `HealthPanel` pasa a tener **solo `QuickActions`** (full width). Dejar `health`/`batches` sin usar → quitarlos del `Promise.all` para no cargar al pedo.
  2. Crear `app/(auth)/admin/pipeline/page.tsx` (server) que renderice `<HealthPanel health={...} batches={...} />` (mover la carga de `getHealth`/`getImportBatches` ahí). Agregar el link en `app/(auth)/admin/page.tsx`.
- **NO tocar**: el componente `HealthPanel` (se reusa).
- **Verificación**: `npx tsc --noEmit`.
- **Alternativa más rápida** (si hay poco tiempo): dejar `HealthPanel` pero envolverlo en un `<details>` "Estado del pipeline (técnico)". Elegir una y documentarla en el commit.

### DASH-06 — `QuickActions`: ocultar acciones admin a no-admin
- **Archivos**: `components/dashboard/quick-actions.tsx` + `app/(auth)/page.tsx`.
- **Cambio**: `QuickActions` acepta una prop `isAdmin?: boolean`; la acción "Nueva parcela" (`/admin/parcels/new`) solo se renderiza si `isAdmin`. `page.tsx` pasa `isAdmin` usando `getViewerRole()` (ya hay patrón en `parcelas/[id]/page.tsx`).
- **NO tocar**: el resto de las acciones.
- **Verificación**: `npx vitest run tests/components/dashboard/quick-actions.test.tsx`.

### DASH-07 (opcional / si sobra tiempo) — KPI accionable de pendientes
- **Archivo**: `app/(auth)/page.tsx`.
- **Cambio**: reemplazar el 4º KPI o agregar un resumen clickeable "Aplicaciones pendientes: N" (N = suma de `pending+overdue` del planning) que linkee a `/parcelas`. Mantener el grid de 4 KPIs.
- **NO tocar**: la lógica de `getPhasePlanningOverview`.

### DASH-08 (deferred, NO hoy) — Perf del dashboard
- El dashboard carga el dataset completo vía V0 adapter. Mejora: usar queries agregadas (`fetchDashboardMetricsCached` ya existe para métricas). **Documentar como deuda**, no hacer hoy.

---

## 3. Tandas

- **Tanda 1 (rápida, paralelizable)**: DASH-02, DASH-03, DASH-04, DASH-06 (cada uno = 1–2 archivos, lanes disjuntas).
  - Colisión: DASH-05 y DASH-06 y DASH-07 tocan `app/(auth)/page.tsx` → **no en paralelo**.
- **Tanda 2**: DASH-05 (toca `page.tsx` + `admin/page.tsx` + page nueva) y DASH-07 (toca `page.tsx`) → **secuencial entre sí**.
- **Tanda 3 (coordinador)**: DASH-01 (dead code removal) al final, cuando las otras estén mergeadas, para no chocar con `lib/cache.ts`.

---

## 4. Definición de "terminado"

- [ ] No queda la cadena legacy de alertas (DASH-01).
- [ ] El `PlanningPanel` permite registrar la aplicación desde el dashboard (DASH-02).
- [ ] `PageHeader` no muestra un timestamp falso (DASH-03).
- [ ] `MonthlyChart` se lee sin hover (DASH-04).
- [ ] `HealthPanel` no está en el dashboard del operador (DASH-05).
- [ ] "Nueva parcela" no aparece a viewers (DASH-06).
- [ ] `tsc` 0 + `arch:check` 0 + suite verde.
- [ ] Actualizar `docs/DEEPSEEK-COORDINATION.md` (§ estado + historial).

---

## 5. Riesgos / notas
- **DASH-01** es el único de riesgo (borrado transversal). Grep de consumidores antes de cada borrado; correr el suite completo.
- **DASH-03** puede romper un test que asertara el texto "Datos al …". Revisar.
- **DASH-05** cambia layout del dashboard; verificar visualmente (2 cards → 1 full width).
- No introducir dependencias ni librerías de charts.
