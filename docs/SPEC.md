# SPEC — AeroAdmin AFM Front-end Refactor

> Documento vivo. Define el "qué" y el "por qué" de cada decisión de UI.
> El "cómo" se valida con TDD (tests primero) en cada componente.

Fecha: 2026-06-17
Alcance: solo front-end. Back-end (scraper, importer, BD) queda intacto.

---

## 1. Concepto del producto

**AeroAdmin AFM** es un panel administrativo / GIS interno para que un
operador de fumigación con drones DJI Agras revise y rastree la operación.

- **NO** es una consola de piloto (no hay joystick, no hay "Despegue").
- **NO** es la app de DJI SmartFarm (no embebemos su UI).
- **SÍ** es: "qué parcela se fumigó, cuándo, con qué dron, y qué alertas
  hay que atender".

### Tono
- Profesional, agrícola, técnico.
- Información densa pero legible (operador conoce el dominio).
- Prioridad: **legibilidad sobre decoración**.

### Paleta (ya usada en `globals.css` y `app-shell.tsx`)
- Verde primario: `#0b5f2d` (botones, links, acentos)
- Verde activo: `#2c7f44` (nav activo)
- Verde claro: `#9fceb0` (textos sobre dark)
- Amarillo acento: `#FFD700` (vuelos en el mapa)
- Naranja decorativo: `#e2bfb0` (warning / hint cálido)
- Verde claro fondo: `#dbe7df` (chips, hover)
- Neutros cálidos: `#121815` texto, `#4a5b50` texto secundario, `#587064` label uppercase
- Bordes: `#cfd8d3` y `#d2ddd6` (cards), `#e2bfb0` (algunos borders cálidos)
- Fondo: `#f4f7f3` (cards internas), `#f7f9fb` (body), `#0f1713` (sidebar dark)

### Tipografía
- Inter (sans), pesos 400/500/600/700/800/900 (ya configurado en `layout.tsx`).
- Eyebrow / label uppercase: `text-[11px] font-bold uppercase tracking-[0.2em]`.
- Headings: 32–40px, peso 800-900, tracking tight.
- Body: 14–16px, peso 400-500.

### Layout
- Sidebar oscuro `#0f1713` a la izquierda, 288px ancho, fijo en `lg+`.
- Header sticky arriba, blanco con blur.
- Main area con max-w-7xl, padding 5 / 8.
- Cards: rounded-2xl, border sutil, sombra `0px 18px 40px rgba(15,23,42,0.08)`.
- Botones: rounded-full (chips) o rounded-lg (inputs).

---

## 2. Decisiones de producto (puntos de dolor)

### 2.1 Branding inconsistente
- `metadata.title = "AeroCrop Vital"` en `layout.tsx`
- Logo, sidebar, título de página, repo: **"AeroAdmin AFM"** en todos lados.
- **Decisión**: unificar a **AeroAdmin AFM**. Quitar "AeroCrop Vital".

### 2.2 Placeholders que confunden el producto
Hay elementos de UI que **no aportan al producto real** y dan impresión
incorrecta. Hay que removerlos:

| Elemento | Archivo | Razón para remover |
|---|---|---|
| Botón "Despegue" | `app-shell.tsx` | No hay control de vuelo real |
| Botón "Regresar" (home) | `app-shell.tsx` | Idem |
| Botón "Waypoints" | `app-shell.tsx` | Idem |
| Botón "Cámara" | `app-shell.tsx` | Idem |
| Botón "Emergencia" | `app-shell.tsx` | Idem — genera falsa sensación de control |
| Botón "Override Manual" | `app-shell.tsx` | No hay "override" en admin |
| Icono `notifications` | `app-shell.tsx` | No hay notificaciones implementadas |
| Icono `settings` | `app-shell.tsx` | No hay settings page |
| Iframe "DJI Mission Preview" | `app/map/page.tsx` | Es la app de DJI, no nuestro producto |
| Form "Agregar dispositivo" | `app/devices/page.tsx` | No persiste, genera falsa sensación de CRUD |
| Botón "Exportar CSV" en dashboard | `dashboard-panels.tsx` | Útil pero el filtro "Tipo" del select no se aplica — está roto |

### 2.3 Duplicación visual
- `app/page.tsx` muestra 4 `MetricCard`s
- `OperationsPanel` muestra 4 cards con **la misma información** (Resumenes año, Area total, Dias de riesgo, Activos DJI)
- **Decisión**: consolidar. El header del dashboard muestra 4 KPIs limpios.
  El `OperationsPanel` arranca con su bloque "Reporte 2026" sin duplicar.

### 2.4 Mapa sobrecargado
- `map-view.tsx` tiene 3 paneles superpuestos: header con logo y stats
  (top-left), leyenda (bottom-left), sidebar detalle (right) — todo sobre
  el mismo `relative inset-0` con `z-[400]`.
- El selector de "Seleccionar activo" muestra `parcel.land_name - parcel.asset_kind`
  pero `asset_kind` es `geometry/parameter/waypoint` (interno del importer),
  no legible para el usuario.
- **Decisión**:
  - Reemplazar el dropdown de assets por lista de **parcelas normalizadas**
    (`DjiParcelRecord` con `field_type`, `declared_area_ha`, `drone_model_name`).
  - Panel detalle derecho más compacto (max-w-xs, no max-w-sm).
  - Leyenda separada en componente reutilizable.

### 2.5 Tabla plana en /history
- Solo una `<div class="divide-y">` con items. Sin orden, sin filtro, sin paginación.
- **Decisión**: tabla con columnas ordenables + filtro por categoría + paginación
  con `useState` (top 200 ya se piden, no se necesita más server-side).

### 2.6 Devices es una página decorativa
- Datos hardcodeados en el archivo.
- El form no persiste, no valida, no hace nada.
- **Decisión**: dejar el listado limpio de devices, mover el form a una
  sección con disabled state ("Próximamente") o removerlo. **Removerlo**.

---

## 3. Componentes y estructura

### 3.1 Nuevos archivos

| Archivo | Propósito | TDD |
|---|---|---|
| `lib/ui-tokens.ts` | Tokens de diseño (colores semánticos, spacing, surfaces) | ✓ |
| `components/ui/metric-card.tsx` | Tarjeta KPI con variantes `default`/`success`/`warning`/`danger` | ✓ |
| `components/ui/badge.tsx` | Chip de status reutilizable | ✓ |
| `components/ui/empty-state.tsx` | Estado vacío reutilizable | ✓ |
| `components/ui/section-card.tsx` | Card base con header/eyebrow/title/body | ✓ |
| `components/dashboard/operations-summary.tsx` | Bloque "Reporte 2026" (panel oscuro) | ✓ |
| `components/dashboard/recent-flights-list.tsx` | Lista de vuelos con filtro por alerta y CSV export | ✓ |
| `components/dashboard/alerts-panel.tsx` | Panel lateral de alertas con filtro | ✓ |
| `components/map/map-legend.tsx` | Leyenda de capas | ✓ |
| `components/map/parcel-detail-panel.tsx` | Panel de detalle de parcela seleccionada | ✓ |
| `components/map/parcel-selector.tsx` | Lista selectora de parcelas normalizadas | ✓ |
| `components/history/history-table.tsx` | Tabla ordenable con paginación | ✓ |
| `components/devices/device-grid.tsx` | Grid de devices | ✓ |

### 3.2 Archivos refactorizados

- `app/layout.tsx` — metadata corregida.
- `app/globals.css` — agregar tokens CSS semánticos (sin romper lo existente).
- `app/page.tsx` — usa los nuevos componentes.
- `app/map/page.tsx` — sin iframe, con `MapView` limpio.
- `app/history/page.tsx` — usa `HistoryTable`.
- `app/devices/page.tsx` — usa `DeviceGrid`, sin form.
- `components/app-shell.tsx` — sidebar limpio (sin placeholders).
- `components/dashboard-panels.tsx` — se reescribe como composición de los nuevos.
- `components/metric-card.tsx` — reemplazado por `components/ui/metric-card.tsx`
  (el original queda como shim de re-export para no romper imports viejos).
- `components/map-view.tsx` — refactor con `MapView` + subcomponentes.
- `components/map-client.tsx` — sin cambios significativos (mapa Leaflet).

### 3.3 Archivos de test nuevos

- `tests/lib/ui-tokens.test.ts`
- `tests/components/metric-card.test.tsx`
- `tests/components/app-shell.test.tsx`
- `tests/components/dashboard/operations-summary.test.tsx`
- `tests/components/dashboard/recent-flights-list.test.tsx`
- `tests/components/dashboard/alerts-panel.test.tsx`
- `tests/components/map/parcel-detail-panel.test.tsx`
- `tests/components/map/parcel-selector.test.tsx`
- `tests/components/map/map-legend.test.tsx`
- `tests/components/history/history-table.test.tsx`
- `tests/components/devices/device-grid.test.tsx`
- `tests/components/empty-state.test.tsx`
- `tests/components/section-card.test.tsx`
- `tests/components/badge.test.tsx`

---

## 4. Convenciones de implementación

### 4.1 Naming
- Componentes: `PascalCase`, export named (no default).
- Props: `interface ComponentNameProps`, exportado solo si lo usan otros.
- Helpers: `camelCase` exportado desde `lib/`.

### 4.2 Styling
- Tailwind 4 con `border-[#hex]` se sigue usando, pero los **tokens** viven
  en `lib/ui-tokens.ts` para referencia y validación. La decisión es: **el
  código sigue usando hex inline** (estilo actual del repo) pero los nuevos
  componentes referencian las constantes de `ui-tokens.ts` para garantizar
  consistencia. El bundler de Tailwind 4 hace tree-shaking con hex inline
  igual que con clases.
- No agregar CSS modules, no styled-components, no Emotion.

### 4.3 Estado
- Server components para fetching (`app/page.tsx`, `app/map/page.tsx`,
  `app/history/page.tsx`, `app/devices/page.tsx`).
- Client components (`"use client"`) solo cuando hay interactividad:
  `OperationsPanel` (filtros), `MapView` (selección), `HistoryTable`
  (orden + paginación).

### 4.4 Type safety
- Todos los componentes tipados, no `any`.
- Props de los records vienen de `@/lib/types` (`DjiAssetRecord`,
  `DjiDailySummaryRecord`, `DjiAlertRecord`, `DjiParcelRecord`).

### 4.5 Testing
- Vitest + jsdom + `@testing-library/react` + `@testing-library/jest-dom`.
- `npm test` corre unit + componentes.
- Cada componente nuevo trae al menos:
  - render con datos típicos
  - render con datos vacíos (`empty-state` o equivalente)
  - render con datos extremos (sin flights, con 1000 flights, etc.)
  - accesibilidad básica (role, label)

---

## 5. No-objetivos (out of scope para este PR)

- Cambios al scraper / importer / BD.
- Agregar nuevas páginas (login, settings, notifications).
- Reemplazar Leaflet por Mapbox/MapLibre.
- Internacionalización (queda en español con algunos strings en-US por
  consistencia con lo existente).
- Tests E2E (Playwright).
- Tema oscuro/claro toggle.
- Animaciones o transiciones elaboradas.

---

## 6. Criterios de aceptación

1. `npm test` pasa con **47 tests previos + nuevos tests verdes**.
2. `npm run build` compila sin errores.
3. `tsc --noEmit` no reporta errores.
4. No hay placeholders visuales sin funcionalidad clara:
   - El sidebar no tiene "Despegue" / "Regresar" / "Waypoints" / "Cámara"
     / "Emergencia" / "Override Manual".
   - `/map` no embebe iframe de DJI.
   - `/devices` no tiene form vacío.
5. La metadata dice "AeroAdmin AFM".
6. El dashboard no duplica las 4 KPIs.
7. El `MetricCard` tiene variantes funcionales.
8. El selector de parcelas en `/map` muestra `land_name` + `field_type`
   en vez de `asset_kind`.
9. La tabla de `/history` tiene al menos 3 columnas con orden.
