# TDD — Technical Design Document

> Documento técnico. Cubre **cómo** está implementado el producto:
> patrones de código, convenciones de UI, data flow por feature, y
> decisiones de implementación no obvias. La separación con `SDD.md`
> (qué es el producto) y `AGENTS.md` (cómo trabaja un agente) es
> intencional.
>
> Audiencia: un dev que toma el repo por primera vez. Después de leer
> este doc + el mapa de `AGENTS.md`, debería poder encontrar dónde
> vive cada cosa y por qué se decidió así.
>
> Última actualización: 2026-07-29 (sprint de reconciliación de drift:
> route names actualizados a `/geovisor` + `/parcelas`, componentes a
> `GeovisorClient` + `components/map/geo-map.tsx`, V0 adapter
> `lib/data.ts` reconocido como propio, referencias a `MapPageClient` /
> `MapLibreView` corregidas a los nombres reales).

---

## 1. Metodología de adaptación V0 (sprint S5)

El sprint S5 cerró la primera fase de port del mockup V0
(`docs/v0-2026-07-28/`, antes `docs/fumigation-management-dashboard/`,
movido en 2026-07-29 al directorio de archivo) al proyecto real.
El método que usamos es **port 1:1 con cleanup**, en tres pasos:

1. **Primitives UI accesibles primero.** Antes de tocar features,
   creamos los primitives que el V0 usa (`PageHeader`, `FieldSelect`,
   `ToggleButton`, `Switch`, `KpiPill`, `FilterSidebar`). El orden
   importa: las features dependen de primitives estables. Si copiás
   un feature del V0 sin primitive, terminás con un componente
   in-place que después es caro de extraer.
2. **Port features 1:1, sin reinterpretar.** Copiamos la **lógica y
   el layout** del V0 primero, sin "mejorarlo". Las mejoras de UX
   van en commits separados, con su test. La razón: el V0 refleja
   un acuerdo visual con el operador-cliente; reinterpretarlo antes
   de tener el feedback es trabajo gratis.
3. **Cleanup, una vez que el feature está verde.** Recién cuando
   el feature es 1:1, lo conectamos con la data layer real (PostGIS)
   y limpiamos lo que el mockup no necesita (e.g. `lib/data.ts` con
   `mulberry32` no se importa — el server component hace las queries
   reales).

### 1.1 Lo que NO hicimos (decisión explícita)

- **NO adoptamos shadcn CLI.** El V0 lo usa; el proyecto real no.
  Razón: shadcn CLI baja components a `components/ui/` desde un
  registry externo y los customiza con CVA. Eso:
  - mete una dependencia implícita del registry (no auditable);
  - rompe la coherencia con `lib/ui-tokens.ts` y los primitives
    preexistentes (`metric-card.tsx`, `bento-grid.tsx`,
    `empty-state.tsx`);
  - infla el bundle con `@radix-ui/*` (shadcn default), que en
    este proyecto aún no necesitamos.

  En su lugar, **replicamos los patrones** (Tailwind 4 + `cn()` +
  `data-slot` + `useId()` + CVA cuando hace falta) con primitives
  **propios** en `components/ui/`. Si en el futuro hay un primitive
  no trivial (Combobox, Dialog con focus trap, Slider accesible),
  los implementamos con `@base-ui/react` (ya instalado) o con HTML
  nativo + WAI-ARIA, no vía shadcn.

- **NO copiamos `lib/data.ts` del V0 con mocks deterministas.** El V0
  tenía un `lib/data.ts` con `mulberry32(20260728)` y geometrías
  mock. Esas mocks **no entran al repo**. **Lo que SÍ escribimos** es
  un `lib/data.ts` **propio y nuevo** que sirve de **adapter entre
  los componentes V0 y `api/repositories.ts`**: mapea filas PostGIS a
  las shapes V0 (`DjiParcel`, `DjiFumigationV0`, `GeovisorPayload`,
  etc., tipadas en `lib/types.ts`) y re-exporta las constantes V0
  (`NOW`, `DRONE_MODELS`, `STATUS_META`, `droneModel`,
  `complianceStatus`) desde `lib/data-constants.ts` (seguro para
  client components). El archivo está marcado con
  `import "server-only"` y arranca con un header que documenta el
  contrato. La decisión de NO usar el V0 con mocks es firme; el
  adapter es nuestro y existe por una necesidad real (las pages
  `app/geovisor`, `app/parcelas`, `app/parcelas/[id]` consumen
  shapes V0 y necesitan un bridge al modelo nativo).

- **NO renombramos rutas a `/parcelas` para "ser 1:1 con el V0".**
  El V0 tiene `/parcelas` y `/parcelas/[id]`. En el estado actual
  del proyecto, **esas URLs SÍ existen y vienen del V0** — el
  operador-cliente las vio, las pidió, y se implementaron
  directamente. La sección 8.5 del SDD explica la decisión. Las
  pages son `app/parcelas/page.tsx` (inventario) y
  `app/parcelas/[id]/page.tsx` (detalle). No hay contraparte en
  `/parcels`.

---

## 2. Patrón shadcn-style primitives

Todos los primitives viven en `components/ui/` con naming en kebab-case.
Convención:

- **Named export** (no default). El caller importa como
  `import { FieldSelect } from "@/components/ui/field-select"`.
- **Props tipados con `interface XxxProps`** exportado, para que
  el caller pueda extender.
- **`forwardRef`** cuando el primitive envuelve un elemento HTML
  real (e.g. `FieldSelect` envuelve `<select>`, `Switch` envuelve
  `<button>`).
- **Sin estado interno** (controlled). El caller maneja el state
  vía `value`/`onChange` (o `pressed`/`onPressedChange`).
- **Cero magic** — sin `useContext` ni providers propios. Si un
  primitive necesita contexto, es señal de que debería partirse.

### 2.1 `cn()` — utility estándar

`lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- `clsx` resuelve condicionales (`active && "bg-primary"`).
- `twMerge` resuelve conflictos Tailwind (`p-2 p-4` → `p-4`).

### 2.2 `data-slot` para utility targeting

Convención shadcn-style: cada primitive setea un `data-slot` en su
root para que los callers puedan targetear el primitive desde CSS
o desde un wrapper component sin selectores frágiles. Ejemplo:

```tsx
// Switch.tsx
<button data-slot="switch" ...>
```

Hoy no usamos el atributo desde CSS, pero queda la convención para
cuando haga falta (e.g. `data-[slot=button-group]:rounded-lg`).

### 2.3 `useId()` para ids autogenerados

Todos los primitives que tienen `htmlFor`/`id` usan `useId()` de
React para generar ids estables por instancia. Ejemplo
(`FieldSelect`):

```tsx
const auto = React.useId();
const selectId = id ?? `field-${auto}`;
```

Razón: el caller puede omitir `id` y aún así tener un par
`<label htmlFor>`/`<input id>` válido, sin colisiones entre
instancias.

### 2.4 Variants con CVA (opcional)

Usamos `class-variance-authority` (CVA) **solo** en primitives con
múltiples variants reales. Hoy no tenemos ningún primitive con
CVA instalado todavía (los primitives nuevos del S5 son
single-variant). Si un primitive futuro lo necesita (e.g. `Button`
con `variant`/`size`), se agrega CVA siguiendo el patrón del V0
(`docs/v0-2026-07-28/components/ui/button.tsx`).

### 2.5 Inventario de primitives actuales

| Primitive | Archivo | Patrón clave | Notas |
|---|---|---|---|
| `PageHeader` | `components/ui/page-header.tsx` | server-renderable, sin `use client` | Patrón copiado del V0 |
| `FieldSelect` | `components/ui/field-select.tsx` | `useId()` + `aria-describedby` | Patrón V0 + extras (hint, invalid) |
| `ToggleButton` | `components/ui/toggle-button.tsx` | `aria-pressed` + 3 variants | Patrón V0 (default / outline / pill) |
| `Switch` | `components/ui/switch.tsx` | `role=switch` + `aria-checked` | Distinto de `ToggleButton` (ver §3.1) |
| `KpiPill` | `components/ui/kpi-pill.tsx` | `role=group` + `aria-label`, iconos lucide | Patrón V0 con `gap-px` para divider wrap-safe |
| `FilterSidebar` + `FilterSidebarSection` | `components/ui/filter-sidebar.tsx` | collapsable sections + active count badge | Patrón V0 (filter rail) |
| `MetricCard` | `components/ui/metric-card.tsx` | (preexistente, sin cambios) | — |
| `BentoGrid` | `components/ui/bento-grid.tsx` | (preexistente, sin cambios) | — |
| `EmptyState` | `components/ui/empty-state.tsx` | (preexistente, sin cambios) | — |
| `Pagination` | `components/ui/pagination.tsx` | (preexistente, sin cambios) | — |
| `ScrollablePanel` | `components/ui/scrollable-panel.tsx` | (preexistente, sin cambios) | — |

---

## 3. Convenciones de UI / accesibilidad

Estas son las convenciones de UI accesibles que el V0 introdujo y
que adoptamos en el sprint S5. Cualquier primitive nuevo debe
cumplirlas.

### 3.1 Toggle vs Switch

- **`ToggleButton`** con `aria-pressed`: para filtros on/off en
  toolbars (e.g. "Estado de cadencia: crítico / vencido / por vencer
  / al día"). El label visual es siempre presente.
- **`Switch`** con `role="switch"` + `aria-checked`: para toggles
  binarios persistentes (e.g. settings, pref de capas del mapa,
  "Mostrar etiquetas"). El label es opcional, puede vivir en un
  `<label>` adyacente o en `aria-label`.
- **Regla**: si el toggle es "filtro multi-select" → `ToggleButton`
  con `variant="pill"`. Si es "setting binario persistente" →
  `Switch`. Si tenés dudas, empezá con `ToggleButton`.

### 3.2 Nav links

- `aria-current="page"` en el link activo del sidebar. Ver patrón
  en `components/app-shell.tsx`.

### 3.3 Iconos decorativos

- Todo icono de `lucide-react` recibe `aria-hidden` (true). Si
  el icono es el único contenido visible, el primitive debe
  recibir un `aria-label` que describa la acción.
- Iconos no se usan como label único sin texto.

### 3.4 Texto solo para screen reader

- `sr-only` para texto invisible visualmente pero que screen readers
  deben anunciar (e.g. "Estado del pipeline: OK" en el status dot
  del sidebar).

### 3.5 Listas de definición

- Fichas técnicas (parcela, evento, vuelo) usan `<dl>` con `<dt>`
  para el label y `<dd>` para el valor. Patrón en
  `components/parcels/parcels-table.tsx` (fila expandida de la parcela
  seleccionada).

### 3.6 Grupos de filtros

- Filtros relacionados van en `<fieldset>` con `<legend>` (no en
  un `<div>` con texto). Patrón en
  `components/geovisor/geovisor-client.tsx` (cada section del
  drawer de filtros).

### 3.7 Mapa

- El contenedor del mapa es `<div role="application" tabIndex={0}>`
  con `aria-label="Mapa de parcelas de caña"`. Esto le dice al screen
  reader que es una región interactiva y que el usuario puede
  focus-earla. Ver `components/map/geo-map.tsx`.

### 3.8 Formularios

- `<label htmlFor>` correctamente asociado al `<input id>`. El
  primitive `FieldSelect` ya lo hace via `useId()`.
- `aria-invalid` + `aria-describedby` para errores y hints.
- Mensaje de error debajo del campo, no en `title=` ni en
  `placeholder=`.

---

## 4. Patrón de state derivado (V0 → `GeovisorClient`)

El V0 tiene un patrón limpio en `geovisor-client.tsx`: **estado de
inputs en `useState`, estado derivado en `useMemo`**. Replicamos ese
patrón en `components/geovisor/geovisor-client.tsx`.

### 4.1 Inputs (useState)

```tsx
// Estado de UI: el operador interactúa con esto.
const [filterCollapsed, setFilterCollapsed] = useState(true);
const [timeRange, setTimeRange] = useState<[number, number]>([0, months.length - 1]);
const [playing, setPlaying] = useState(false);
const [liveSummary, setLiveSummary] = useState<FumigationsSummary | null>(null);
const [selectedParcelId, setSelectedParcelId] = useState<number | null>(null);
```

Reglas:
- Si el estado es **input del operador** → `useState`.
- Si el estado es **derivado** de otros → `useMemo` (no state).
- Si el estado **se fetcha** → `useState` + `useEffect`, con cleanup.

### 4.2 Derivados (useMemo)

Cada derivado está documentado en el componente. El patrón es:

```tsx
// v2.0 — histograma de fumigaciones por mes en el rango visible.
const [filteredParcels, eventsByParcel, kpis, sortedList] = useMemo(() => {
  // ...
}, [parcels, timeRange, fumigatedParcelIds]);
```

En el V0 son `useMemo` separados; en el nuestro, los consolidamos
donde el costo de re-cómputo es despreciable. El rationale
completo está en el JSDoc de `GeovisorClient`.

### 4.3 Resumen reactivo al TimeRange

Cuando el `timeRange` cambia, el `KpiPill` necesita un nuevo
`FumigationsSummary`. En vez de calcularlo en el cliente (que
requeriría descargar todos los eventos), se hace **roundtrip al
endpoint de summary** con debounce de 200ms. La
`fumigationsSummary` base que `getGeovisorPayload()` ya cocinó se
reusa cuando el rango es el completo (sin roundtrip extra).

---

## 5. Patrón MapLibre

`MapLibre GL JS 4.7.1` (la versión efectiva del package; el V0
referenciaba 6.0) reemplaza a Leaflet/react-leaflet desde el
sprint S5. Los archivos migrados son:

- `components/map/geo-map.tsx` — vista principal del mapa
  (`/geovisor`). Único wrapper activo en `components/map/`.
- `components/parcels/parcel-map.tsx` — mini-mapa del detalle
  de parcela (`/parcelas/[id]`).
- La vista interactiva del geovisor vive en
  `components/geovisor/geovisor-client.tsx` (cliente), que
  consume `geo-map.tsx` para el render de MapLibre.

### 5.1 Setup (referencia — el código real vive en `components/map/geo-map.tsx`)

```tsx
useEffect(() => {
  const mod = await import("maplibre-gl");
  const maplibregl = (mod as any).default ?? mod;
  map = new maplibregl.Map({
    container: containerRef.current,
    style: BASEMAPS[initial].style,
    center: DEFAULT_CENTER, // [lng, lat]
    zoom: DEFAULT_ZOOM,
    attributionControl: { compact: true }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

  map.on("load", () => {
    addSourcesAndLayers(map);
    bindInteractions(map);
    setReady(true);
  });
}, []);
```

> El bloque de arriba es la **forma canónica** que el código sigue
> (ver `components/map/geo-map.tsx`). Si lo editás acá y en el código
> divergen, el código gana — este doc es referencia, no spec.

Notas operativas:
- **Import dinámico** de `maplibre-gl` para evitar el bundle en
  SSR (MapLibre usa `window`).
- **Coordinate system**: `[lng, lat]` (no `[lat, lng]` como
  Leaflet). El adapter `lngLat` resuelve esto para los popups.
- **Cleanup**: `map?.remove()` en el return del `useEffect` —
  MapLibre no libera el canvas automáticamente.

### 5.2 setStyle y re-add de layers

`map.setStyle(newStyle)` borra todos los sources y layers que se
agregaron manualmente. Para recuperarlos, escuchar `style.load`:

```tsx
useEffect(() => {
  if (!map || !ready) return;
  map.setStyle(BASEMAPS[basemap].style);
  map.once("style.load", () => {
    addLayersToExistingMap(map); // re-add sources/layers
  });
}, [basemap, ready]);
```

`addLayersToExistingMap` y `addSourcesAndLayers` (en el init) son
**la misma función** — solo cambia cuándo se llaman. Por eso la
extrajimos a un helper (`components/map/geo-map.tsx`).

### 5.3 feature-state para selección

Para resaltar una parcela seleccionada sin re-renderizar el source:

```tsx
map.setFeatureState({ source: "parcels", id: parcelId }, { selected: true });
```

Y en el paint expression:

```ts
"line-width": [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  4,  // seleccionado
  2   // default
]
```

Para limpiar antes de re-setear:

```ts
map.removeFeatureState({ source: "parcels" });
```

### 5.4 Paint expressions inline (sin helper)

A diferencia de Leaflet (donde teníamos `lib/map-styles.ts` con — ahora
borrado/archivado)
funciones puras que devolvían `PathOptions`), en MapLibre los
paint expressions son **inline en el `addLayer`**:

```ts
map.addLayer({
  id: "parcels-fill",
  type: "fill",
  source: "parcels",
  paint: {
    "fill-color": [
      "case",
      ["==", ["get", "is_orchard"], true],
      COLORS.warning,
      COLORS.success
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      0.55,
      ["==", ["get", "fumigated"], false],
      0.15,
      ["==", ["get", "is_orchard"], true],
      0.25,
      0.35
    ]
  }
});
```

Trade-off: más verboso, pero todas las reglas de estilo viven
juntas en el component, no dispersas en un helper. Para 5 layers
y ~3 properties cada una, vale la pena. Si crecieran a 15+ layers
con variantes por feature, conviene refactorizar a una función
`getParcelFillExpression(props)`.

### 5.5 Popups HTML sanitizado

MapLibre no sanitiza el HTML de los popups. Cualquier propiedad que
venga del feature (que viene de la BD) se pasa por
`escapeHtml(value)` antes de meterla al `setHTML`. Patrón en
`components/map/geo-map.tsx` (alerts, flight points, parcel popup).

---

## 6. Caching y mutaciones

`lib/cache.ts` define `unstable_cache` con tags por dominio:
`parcels`, `flights`, `alerts`, `dashboard`, `fumigations`,
`task-history`. Las mutaciones invalidan con helpers:

- `invalidateAfterFumigationMutation()`
- `invalidateAfterParcelMutation()`
- `invalidateAfterFlightMutation()`
- `invalidateAll()`

Las pages de **Task History** no cachean (el caller controla la
frecuencia vía el slider). El mapa sí cachea el summary inicial
(SSR) y se re-fetchea al cambiar el TimeRange (roundtrip al
endpoint `/api/map/summary`).

---

## 7. Decisiones operativas (convención, no regla dura)

- **Español en strings de UI, comentarios y mensajes.** Identifiers
  (archivos, funciones, columnas SQL, variables) en inglés.
- **Path alias `@/*`** apunta a la raíz del repo.
- **Cobertura**: el umbral global es 75/70 (líneas/branches). El
  umbral solo sube, nunca baja, salvo excepción documentada en
  `docs/files_TDD/ADOPTION.md`.
- **Tests TZ-fragiles** con `toLocaleDateString` o `new Date()`:
  evitar asserting en strings exactos. Patrones en
  `lib/format.test.ts`.
- **Migrations SQL** en `db/migrations/YYYYMMDDHHMMSS_*.sql`,
  aplicada con `npm run db:migrate`.

---

## 8. Riesgos conocidos / deuda

- **`@base-ui/react`** adoptado en runtime desde S5 por 10 primitives en
  `components/ui/` (badge, button, input, progress, select, separator, slider,
  tabs, tooltip + helpers `merge-props`/`use-render`). Reemplaza shadcn CLI
  como capa de primitivos. Para primitives triviales seguimos usando HTML
  nativo + WAI-ARIA sin `@base-ui/react`.
- **MapLibre setStyle race**: si el caller cambia `basemap` antes
  de que el mapa termine de cargar, el `style.load` puede no
  dispararse. Mitigación actual: `if (!map || !ready) return` en
  el effect. Caso edge en practice testing del S6.
- **Datos de producción aún con `cadence_days` en otra tabla**:
  `dji_fumigation_schedule` no se joinea hoy en el query de
  `getParcelsNormalized()`. `ParcelsList` usa `defaultCadenceDays`
  como fallback. Migración S7: incluir el join.
- **Slider doble accesible** en `TimeRange` es 2 inputs HTML
  nativos (no doble-thumb). Decisión de scope del S5. Migración
  a `@base-ui/react` `Slider` (single-thumb accesible) queda
  evaluada para S7 si aparece el pedido de UX.

Detalle histórico en `docs/audit/BITACORA.md`.

---

## 9. Documentos relacionados

| Doc | Contenido |
|---|---|
| `docs/SDD.md` | Producto (qué es) |
| `docs/V0_ADAPTATION.md` | Bitácora del sprint S5/S6 (qué se copió) |
| `docs/ARCHITECTURE.md` | Data flow DJI → BD → UI, decisiones de scraping |
| `docs/STACK.md` | Versiones, gotchas, decisiones de stack |
| `docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md` | Las 7 compuertas de calidad |
| `docs/files_TDD/ADOPTION.md` | Estado de adopción de las compuertas |
| `AGENTS.md` | Índice canónico, reglas operativas, prácticas |
