# Auditoría UI — AeroAdmin AFM

**Fecha:** 2026-09-20 · **Alcance:** arquitectura visual (layout, shell, sidebars, paneles, scroll, overflow, responsive, spacing, a11y).
**Método:** inspección del código con `file:line` + verificación en navegador (Playwright) + CSS compilado.
**Skills usadas:** `shadcn` (oficial), `ui-design`, `design-md`, `ui-verification` (ver `skills-lock.json`).

---

## 1. Arquitectura objetivo

```
AppShell                      flex, h-svh, overflow-hidden
├── Sidebar                   drawer <dialog> en mobile / fija en desktop
└── Main                      flex-col, min-h-0
    ├── Header                shrink-0
    └── Workspace             min-h-0 flex-1 overflow-y-auto (scroll ÚNICO)
        ├── Map               h-full min-h-0 (Panel redimensionable)
        └── Panels            Panel + PanelResizeHandle
```

Reglas de layout vigentes: priorizar `flex`/`grid`/`flex-1`/`grow`/`shrink-0`/`min-w-0`/`min-h-0`/`gap-*`/`overflow-auto`; evitar `overflow-hidden` como parche, `absolute` en lugar de flex/grid, alturas mágicas y soluciones duplicadas.

---

## 2. Hallazgos y estado

| # | Hallazgo | Evidencia | Estado |
|---|---|---|---|
| **A1** | Sidebar como `<aside>` custom: sin comportamiento mobile, ancho fijo, `lg:sticky` | `components/app-shell.tsx` (pre PR-2) | ✅ resuelto (PR-2/2b) |
| **A2** | 3 arquitecturas de sidebar conviviendo (shell + 2 `<aside>` del geovisor) | `geovisor-client.tsx:276` y `:516` | ✅ resuelto (PR-2 + PR-3b) |
| **A3** | `min-h-0`=0 con `flex-1`=34 → los hijos flex no encogen; `overflow-auto`=2 vs `overflow-hidden`=11 | grep global | ✅ resuelto (PR-1/3a) |
| **A4** | Tamaños mágicos (`min-w-[1400px]`, `h-[420px]`, `max-h-[32rem]`) | `admin-parcels-client.tsx:581`, `new-fumigation-page-client.tsx:372`, `parcelas/[id]/page.tsx:636` | ✅ evaluado (PR-4) |
| **A5** | Contrato de altura difuso: sin `h-screen`/`100dvh`; `h-svh` 1 sola vez; el geovisor usaba `h-svh` (viewport) en vez de la altura del contenedor | `app-shell.tsx`, `geovisor-client.tsx:274` | ✅ resuelto (PR-1/3a) |
| **A6** | **Tailwind v4 en este proyecto NO genera spacing numérico arbitrario para `h`/`max-h`**: `h-105`, `h-125`, `max-h-128` **no aparecen** en el CSS compilado (`h-80` sí) | `npm run build` + grep del CSS | 📌 documentado |
| **A7** | Las 3 tablas **ya** tenían `overflow-x-auto` correcto | `admin-parcels-client.tsx:580`, `fumigaciones-table.tsx:257`, `fumigaciones/[id]/page.tsx:742` | ✅ sin acción |

---

## 3. PRs

| PR | Commit | Cambio | Verificación |
|---|---|---|---|
| PR-1 | `56d96c4` | AppShell `h-svh` + `overflow-hidden`; `main` `flex min-h-0 min-w-0 flex-1 flex-col`; header `shrink-0`; children en `min-h-0 flex-1 overflow-y-auto` | Playwright: `documentElement.scrollHeight == innerHeight` en `/`, `/parcelas`, `/geovisor` |
| PR-2 | `d5619b5` | Nuevo `components/shell-layout.tsx` (client): **única** arquitectura de sidebar (desktop fija / mobile drawer); `app-shell.tsx` queda como wrapper server. Fix a11y: `aria-label` del aside ya no duplica el del `<nav>` | Playwright mobile 390 / desktop 1400 |
| PR-2b | `32a08f7` | Drawer = `<dialog>` **nativo** (`showModal()`): focus trap, Escape, backdrop e inercia del fondo sin deps; desktop con `lg:flex!` + `lg:static` | Playwright: foco dentro del dialog, Escape cierra |
| PR-3a | `28f29b9` | Geovisor `h-svh` → `h-full min-h-0`; page `flex h-full flex-col` | `mainScroll == mainClient` (813), canvas 691px |
| PR-3b | `3a1c42f` | Paneles redimensionables (`react-resizable-panels@^3`): filtros \| mapa \| eventos; horizontal desktop / vertical mobile; `autoSaveId` persiste en localStorage; el toggle "Ocultar filtros" colapsa el Panel | Playwright: 3 paneles, 2 handles, drag 342→476px |
| PR-4 | `7d84f52` | `h-[320px]` → `h-80` (único mapeo a token existente) | CSS compilado verificado |

Todos con `tsc` 0 · 2313/2313 tests · `arch:check` 0 errors.

---

## 4. Decisiones tomadas

- **`react-resizable-panels@^3`**, no v4: la v4 cambió la API a `Group`/`Separator`/`panelRef`/`defaultLayout`; la v3 estable expone `PanelGroup`/`PanelResizeHandle`/`autoSaveId`.
- **`<dialog>` nativo** para el drawer mobile en vez de construir un `Sheet`: da focus trap + Escape + backdrop + inercia del fondo provistos por el navegador (0 deps, 0 bugs propios).
- **`defaultSize` independiente de la dirección** (`defaultSize={22}`): se lee al montar, así que no puede depender de un `isDesktop` que arranca en `false`.
- **No convertir a tokens** los px de tablas ni alturas sin token (ver A6).

---

## 5. Deuda restante

1. **PR-2c — `Sheet` primitivo**: migrar el `<dialog>` a un primitivo propio (patrón shadcn sobre `@base-ui/react`) cuando se estandaricen los overlays. El nativo ya cumple a11y.
2. **Scroll anidado en `parcelas/[id]`** (`max-h-[32rem] overflow-y-auto`, línea 636): intencional (timeline), pero conviven dos scrollers (main + card). Revisar UX.
3. **`min-h-[60svh]`** eliminado del mapa en PR-3b; revisar si quedan alturas `svh` sueltas.
4. **`next-env.d.ts`**: autogenerado por `next build`; no versionar cambios.

---

## 6. Cómo reproducir la verificación

```bash
npm run dev            # localhost:3000
# Playwright (login demo@afm.local / DemoAfm2026!) verificando:
#   - doc.scrollHeight == window.innerHeight  (la página no scrollea)
#   - main[.overflow-y-auto].scrollHeight == clientHeight en /geovisor
#   - mobile 390x844: dialog abre con foco adentro y cierra con Escape
#   - desktop 1400x850: sidebar visible, sin botón de menú
npm run arch:check && npx vitest run
```

---

## 7. UI-M1 (2026-09-21) — Geovisor map-first (supersede PR-3b)

El geovisor dejó de repartir el ancho en 3 paneles redimensionables
(22% filtros / 52% mapa / 26% eventos, PR-3b). Ahora el **mapa es la capa
base full-bleed** (`absolute inset-0`) y los filtros/eventos son
**overlays flotantes** (`absolute`, `z-20`):

- `components/geovisor/geovisor-client.tsx`: removido
  `react-resizable-panels` y `ImperativePanelHandle`. Filtros = `<aside>`
  izquierdo; eventos = `<aside>` derecho (conserva
  `data-testid="geovisor-events-panel"`). KPIs + toggles ("Filtros",
  "Eventos") en un overlay superior `z-30`.
- Defaults por breakpoint: en `lg+` ambos overlays abiertos; en mobile
  cerrados (mapa limpio) y se abren desde los toggles.
- `react-resizable-panels` queda **sin uso** en el repo (candidato a
  remover en un cleanup de deps / knip).

Verificación: `tsc` 0 · `arch:check` 0 · `geovisor-client.test.tsx` 19/19
· suite completa 2340 passed · `npm run build` ✓.

