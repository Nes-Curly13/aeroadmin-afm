# V0 Adaptation — Bitácora del sprint S5/S6

> Documento narrativo del sprint S5 (cerrado 2026-07-28) y S6 (en
> curso). Cubre **qué se copió** del mockup V0
> (`docs/fumigation-management-dashboard/`), **qué se omitió**, y
> **qué se decidió distinto**. Es la referencia histórica para
> futuros sprints de adaptación de mockups.
>
> Audiencia: un dev (humano o agente) que se pregunta "¿esto vino
> del V0 o es nuestro?" o "¿por qué no usamos shadcn como el V0?".
>
> Última actualización: 2026-07-29 (nota de archivo agregada: V0 movido
> a `docs/v0-2026-07-28/`).

---

## 1. Contexto

`docs/v0-2026-07-28/` (antes `docs/fumigation-management-dashboard/`,
**movido el 2026-07-29 al directorio de archivo**) es un **mockup
navegable** armado por el operador-cliente como referencia visual del
producto deseado. **No es producción: NO SE EJECUTA.** Es solo
referencia histórica. El `lib/data.ts` original del V0 usaba datos
mock deterministas (`mulberry32(20260728)`), no tenía auth, no tocaba
PostGIS. Pero el stack que eligió (Next 16, MapLibre 6, shadcn +
@base-ui, Tailwind 4, lucide-react) **sí es la dirección de producto**.

> **Nota de archivo 2026-07-29**: el directorio del V0 fue movido
> desde `docs/fumigation-management-dashboard/` a
> `docs/v0-2026-07-28/` para que `arch:check` (y cualquier dev
> nuevo) no confunda el mockup con código de producción. El
> `README.md` de `docs/v0-2026-07-28/` deja explícito que es
> referencia histórica y que no se ejecuta. **Las referencias a
> `docs/fumigation-management-dashboard/` en este doc y en el resto
> del repo se entienden como `docs/v0-2026-07-28/`.**

A partir del sprint S5 (2026-07-28) decidimos **portar el V0 al
proyecto real** con un método explícito (ver `docs/TDD.md` §1):

1. Primitives UI accesibles primero.
2. Port features 1:1, sin reinterpretar.
3. Cleanup, una vez verde.

Este doc es la bitácora de ese proceso. El **S5 está cerrado**; el
**S6 sigue copiando lógica del V0** al cierre de este doc.

---

## 2. Tabla de features: V0 → nuestra implementación

| Feature V0 | V0 (mockup) | Nuestra implementación | Estado |
|---|---|---|---|
| **Migración Leaflet → MapLibre** | `components/map/geo-map.tsx` | `components/map/maplibre-view.tsx` + `components/map-view.tsx` | ✅ S5 (commit `c476b0c`, `794cfcf`) |
| **Basemap toggle (sat / streets)** | inline en `geo-map.tsx` | `BasemapBadge` en `maplibre-view.tsx`, persistido en `localStorage` (`afm:map:basemap`) | ✅ S5 |
| **5 capas: parcels, waypoints, flight-plan, alerts, flight-points** | `geo-map.tsx` (`parcels-fill/line/label`, `events-circle`) | `maplibre-view.tsx` + `addLayersToExistingMap()` (re-add después de `setStyle`) | ✅ S5 |
| **Selección de parcela: highlight + flyTo** | `feature-state` en `geo-map.tsx` | `setFeatureState` + `flyTo({ zoom: 15 })` en `maplibre-view.tsx` | ✅ S5 |
| **KPI overlay pill sobre el mapa** | `kpis` en `geovisor-client.tsx` (Aplicaciones / Ha / Volumen / Vuelos) | `KpiPill` en `components/ui/kpi-pill.tsx`, montado en `MapPageClient` | ✅ S5 (commit `c7ef76c`) |
| **TimeRange slider con histograma** | `components/geovisor/time-range.tsx` | `components/map/time-range.tsx` | ✅ S5 (commit `a11a628`) |
| **Autoplay con `prefers-reduced-motion`** | sí (V0) | sí (nuestro) | ✅ S5 |
| **Slider doble accesible** | 1 `<Slider>` con dos thumbs (V0 via shadcn) | 2 `<input type="range">` HTML nativos (nuestro, scope reducido) | ⚠️ S5 — funcional, no equivalente accesible. Migrar a @base-ui Slider en S7 si hay pedido. |
| **Lista de parcelas (rail derecho)** | lista dentro de `geovisor-client.tsx` con status pills | `ParcelsList` en `components/map/parcels-list.tsx` | ✅ S5 (commit `daf8787`) |
| **Status de cadencia: overdue / due_soon / ok / no_history** | `STATUS_META` + `STATUS_ORDER` (V0) | mismo modelo, `lib/fumigation-cadence.ts#getFumigationStatus` | ✅ S5 |
| **Filtros: cliente / hacienda / dron / status / source** | `FieldSelect` + `aria-pressed` (V0) | `MapFilterSidebar` colapsable (drawer) en `map-filter-sidebar.tsx` | ✅ S5 |
| **Drawer colapsable con URL searchParams** | sidebar fija (V0) | `filterCollapsed` state, `router.push` con `scroll: false` | ✅ S5 (decisión distinta: drawer, no rail fija) |
| **Page header con eyebrow + actions** | `components/page-header.tsx` (V0) | `components/ui/page-header.tsx` (nuestro) | ✅ S5 |
| **FieldSelect accesible con `useId()`** | `components/ui/field-select.tsx` (V0) | `components/ui/field-select.tsx` (nuestro, con `hint` + `invalid` extras) | ✅ S5 |
| **ToggleButton (`aria-pressed`)** | inline en `geovisor-client.tsx` | `components/ui/toggle-button.tsx` con 3 variants (default / outline / pill) | ✅ S5 |
| **Switch (`role=switch` + `aria-checked`)** | inline en `geovisor-client.tsx` | `components/ui/switch.tsx` | ✅ S5 (primitivo que el V0 no tiene, lo extrajimos por claridad) |
| **FilterSidebar con secciones colapsables** | inline en `geovisor-client.tsx` (V0) | `components/ui/filter-sidebar.tsx` + `FilterSidebarSection` | ✅ S5 |
| **Búsqueda de parcelas (search box)** | `<Input>` con icono Search (V0) | `<input>` simple en `map-filter-sidebar.tsx` (todavía no migrado al primitive `Input`) | ⚠️ S5 — pendiente polish en S6 |
| **Popups HTML sanitizados** | vanilla HTML (V0) | `escapeHtml` en `maplibre-view.tsx` | ✅ S5 |
| **AppShell con sidebar y status del pipeline** | `components/app-shell.tsx` (V0) | `components/app-shell.tsx` (nuestro, preexistente) | ❌ NO migrado — el nuestro es anterior y suficiente |
| **Datos mock deterministas (`mulberry32`)** | `lib/data.ts` (V0) | NO se importó | ❌ NO migrado — el real lee de PostGIS |
| **`/parcelas` y `/parcelas/[id]` (V0)** | pages V0 | `/parcels` y `/parcels/[id]` (nuestras, con `ParcelDetail` propio) | ❌ No es 1:1 — el nuestro es preexistente y suficiente |
| **shadcn CLI** | sí (V0) | NO se adoptó | ❌ Decisión explícita (ver §4) |
| **@base-ui/react (en runtime)** | sí (V0: `Button` lo usa) | instalado `^1.6.0` pero NO usado en runtime todavía | ❌ Reservado para primitives no triviales |
| **Tabla de parcelas con sort + paginación** | `components/parcels/parcels-table.tsx` (V0) | NO migrado — el nuestro usa `ParcelsList` (más simple) | ❌ Diferente — la tabla del V0 no tiene contraparte acá todavía |
| **Page `geovisor` del V0** | `app/geovisor/page.tsx` | `app/map/page.tsx` con `MapPageClient` | ✅ Funcionalmente equivalente (no es 1:1 de nombre) |
| **Slope chart mensual (`monthly-chart.tsx`)** | V0 | NO migrado | ❌ Diferido — no estaba en scope S5 |
| **Health panel + Compliance panel del dashboard V0** | V0 `components/dashboard/*` | NO migrado | ❌ Diferido — el dashboard real ya tiene su propio `AlertsPanel` y `OperationsSummary` |

**Leyenda**: ✅ portado · ⚠️ port parcial · ❌ no migrado (decisión explícita o diferido).

---

## 3. Lecciones aprendidas (5 bullets)

### 3.1 El V0 es contrato, no spec

El V0 refleja un acuerdo visual con el operador-cliente. **Reinterpretar
un detalle antes de tener feedback** es trabajo gratis que después
molesta. El método fue: copiar 1:1, abrir issue si algo no cierra,
arreglar después. Resultado: cero retrabajo de UX en S5.

### 3.2 Primitives primero, features después

Si copiás un feature del V0 sin primitive (`FieldSelect`,
`ToggleButton`, etc.), terminás con un componente in-place que
después es caro de extraer. Empezar por los primitives —aunque no
tengan consumidores todavía— paga al segundo feature. Costo: 1
sprint de primitives antes que se vea un cambio visual. Beneficio:
los 4 features siguientes son composición pura.

### 3.3 NO adoptamos shadcn CLI — fue la decisión correcta (por ahora)

Tentación fuerte: "el V0 usa shadcn, instalemos shadcn". Lo
evitamos. Razón: shadcn CLI mete un registry externo implícito
(no auditable), rompe coherencia con `lib/ui-tokens.ts`, e infla
el bundle con `@radix-ui/*` que no necesitamos. Resultado:
bundle más liviano, primitives que podemos editar sin miedo a
"re-shadcn-izar" en cada update del registry, accesibilidad bajo
control. Si en el futuro aparece un primitive que demande
@radix-ui o Combobox, lo agregamos **explícitamente**, no por
shadcn.

### 3.4 MapLibre paint expressions inline son más legibles que helpers

Venia de Leaflet, donde `lib/map-styles.ts` exponía funciones
puras con `PathOptions`. En MapLibre, los paint expressions
inline (`["case", ["==", ["get", "x"], true], A, B]`) son
verborreicos pero **todas las reglas de estilo de un layer viven
juntas** en el mismo `addLayer()`. Para 5 layers con 3 properties
cada una, vale la pena. Si crecieran a 15+ layers, refactor a un
`getParcelFillExpression(props)` que devuelva el array.

### 3.5 El `prefers-reduced-motion` del autoplay es un detalle que el V0 no tiene (y debería)

`TimeRange` autoplay respeta `prefers-reduced-motion` (no inicia
si el usuario lo prefiere reducir). El V0 NO lo hace. Detalle
pequeño que mejora la accesibilidad del feature sin complicar el
código (5 líneas: `matchMedia` + early return en el `useEffect`).
Copiar con criterio, no en bloque.

---

## 4. Lo que NO se copió (y por qué)

### 4.1 shadcn CLI

- Registry externo no auditable.
- Rompe coherencia con `lib/ui-tokens.ts` y primitives preexistentes.
- Bundle: `@radix-ui/*` no aporta nada que HTML + WAI-ARIA no
  resuelva para los primitives que necesitamos hoy.
- Decisión: replicar **los patrones** (Tailwind 4 + `cn()` +
  `data-slot` + `useId()` + CVA cuando haga falta) con primitives
  **propios** en `components/ui/`. Si un primitive futuro no se
  puede resolver con HTML nativo, usar `@base-ui/react`
  (instalado, reservado).

### 4.2 `lib/data.ts` del V0 (datos mock deterministas)

- El proyecto real lee de PostGIS vía `api/repositories.ts`. El
  `mulberry32(20260728)` no tiene razón de existir en producción.
- Si en el futuro queremos datos de demo (e.g. CI sin DB), los
  mocks van en `tests/fixtures/`, no en `lib/`.

### 4.3 Pages `/parcelas` y `/parcelas/[id]` del V0

- Nuestras contrapartes (`/parcels`, `/parcels/[id]`) ya existen y
  son preexistentes al V0.
- Mapeamos 1:1 con nuestros nombres (no renombramos `/parcels` →
  `/parcelas` por copiar el V0).

### 4.4 Componentes dashboard del V0 (`health-panel`, `compliance-panel`, `monthly-chart`)

- El dashboard real (`/`) ya tiene `AlertsPanel`,
  `OperationsSummary`, `RecentFlightsList` y `UpcomingFumigations`.
- Estos componentes del V0 no aportan información que el dashboard
  real no exponga ya. Diferido a S7+ si el operador pide
  explícitamente "quiero el slope chart de productividad mensual".

### 4.5 `parcels-table.tsx` del V0 (tabla con sort + paginación)

- Nuestra lista (`ParcelsList` en el rail del mapa) es la
  representación principal de parcelas en el flujo actual.
- El V0 tiene una tabla densa con 8 columnas — útil si el
  operador quiere exportar a Excel, pero hoy no es prioritaria.
- Diferido. Si se pide, se puede agregar `/parcels/table` como
  view alternativo sin romper el flujo del mapa.

---

## 5. Próximo sprint (S6) — qué falta

El S6 sigue copiando lógica del V0. Lo que queda en el scope:

1. **ToggleButton ↔ Switch en el sidebar de filtros del mapa.**
   Hoy el sidebar de filtros del mapa (`map-filter-sidebar.tsx`)
   usa `FieldSelect` para drone/crop/fumigated. El V0 tiene
   toggles de "status" y "source" como `aria-pressed` pills.
   Migrar si el operador lo pide (no antes).

2. **Búsqueda de parcelas con primitive `Input`.** El search box
   del sidebar hoy es un `<input>` crudo. Moverlo a un primitive
   `Input` (estilo shadcn) cuando lo creemos — bloqueado en
   orden: si no usamos el input en otro lado, no lo creamos.

3. **Polish del `MapPageClient`.** Confirmar que el flujo
   filter-drawer + KpiPill + TimeRange + ParcelsList se ve y se
   comporta como el V0. Recoger feedback del operador.

4. **Migrar Task History a MapLibre.** El V0 tiene un
   `task-history-map-view` que no migramos en S5 (se quedó en
   `react-leaflet`). El S6 puede migrarlo. Bajo riesgo: es una
   vista read-only, no interactiva.

5. **Sidebar de salud del pipeline DJI** (M3 del roadmap). No es
   del V0, es propio. S6 lo arranca como beta, S7 lo cierra.

### 5.1 Lo que NO va al S6

- Gherkin / BDD (fase 3 del Gauntlet).
- Subir coverage a 80/75 (fase 2).
- Migrar más pages del V0 que no usamos.
- Adoptar shadcn CLI (decisión cerrada).

---

## 6. Riesgos abiertos

- **`@base-ui/react` sin usar.** Está instalado (`^1.6.0`) pero
  no en runtime. Si S6 no lo usa, hay que decidir: o se usa en
  un primitive (e.g. Combobox de búsqueda de parcela), o se
  desinstala para no inflar `package.json` con deps no usadas.
  Decisión: dejar instalado hasta S7; si S7 tampoco lo usa,
  remover.

- **MapLibre setStyle race condition.** Si el caller cambia
  `basemap` antes de que el mapa termine de cargar, el
  `style.load` puede no dispararse y los sources se pierden.
  Mitigación actual: `if (!map || !ready) return` en el effect.
  Caso edge en practice testing del S6.

- **Datos de cadencia desincronizados.** `ParcelsList` usa
  `defaultCadenceDays` porque `getParcelsNormalized()` no joinea
  con `dji_fumigation_schedule`. Si dos parcelas tienen cadencias
  distintas (e.g. una en fase vegetativa, otra en establecimiento),
  hoy muestran la misma cadencia. Fix en S7 (migration de query).

- **Cobertura global en 75/70.** Es el piso de la fase 1 del
  Gauntlet. Subir a 80/75 es fase 2 — pendiente. No bloquea S5/S6
  pero es visible en el reporte de coverage.

---

## 7. Cómo extender este doc (futuros sprints)

Si en un sprint futuro se vuelve a adaptar un mockup o un
spec externo:

1. Crear `docs/<feature>_ADAPTATION.md` siguiendo la estructura
   de este doc (contexto → tabla → lecciones → no copiado →
   próximo sprint → riesgos).
2. Referenciarlo desde `AGENTS.md` y desde el SDD/TDD si afecta
   la spec o el design.
3. Cerrar con un commit `docs: <feature> adaptation — sprint SX`.
4. Si la adaptación cambia reglas arquitectónicas, abrir ADR en
   `docs/audit/BITACORA.md` y subir el `dependency-cruiser` config
   con la nueva regla.

---

## 8. Referencias

- `docs/v0-2026-07-28/` — el V0 original (archivado, NO se ejecuta).
  Antes vivía en `docs/fumigation-management-dashboard/`.
- `docs/SDD.md` §8 — la decisión de adaptación (S5/S6).
- `docs/TDD.md` §1 — la metodología de port 1:1.
- `docs/ARCHITECTURE.md` — data flow del proyecto real, sección 2.6
  documenta la decisión de mantener `api/queries.ts` como single
  source of truth para la proyección de `dji_parcels`.
- `docs/STACK.md` — stack vigente después del S5.
- `docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md` — las 7 compuertas
  que aplican a este sprint.
- `docs/audit/BITACORA.md` — bitácora viva, incluye QW1/S1-S7.

---

## 9. Nota post-sprint S5 — reconciliación 2026-07-29

El 2026-07-29 (sprint de reconciliación de drift) se hicieron tres
cambios que afectan este doc:

1. **V0 mockup movido**: `docs/fumigation-management-dashboard/`
   → `docs/v0-2026-07-28/`. Razón: confundir a `arch:check` y a
   nuevos devs. El nuevo `README.md` del directorio deja explícito
   que es referencia histórica y que no se ejecuta. Este doc sigue
   siendo válido pero las referencias a la ruta vieja ahora
   apuntan a la nueva.
2. **Migrations consolidadas**: los 25 archivos en
   `supabase/migrations/` se movieron a `db/migrations/`.
   `scripts/apply-pending-migrations.js` ahora lee de
   `db/migrations/`. `supabase/` queda solo para `config.toml` y
   `seed.sql`.
3. **Blueprints de Make.com archivados**: los 2 archivos en
   `make/*.make` (más `records.txt`) se movieron a
   `docs/make-blueprints/` con un `README.md` que documenta que el
   código runtime vive en `lib/djiag-from-make/`.

Estos cambios son de housekeeping, no cambian ni la decisión de
adaptación ni la metodología. El sprint S6 sigue trabajando sobre
la base descrita en este doc.
