# `docs/diagrams/` — Diagramas del sistema

> Diagramas editoriales del sistema AeroAdmin AFM, generados con la skill
> [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
> (v2.2). Son HTML self-contained con inline SVG, sin build step.

## Catálogo actual

| Archivo | Tipo | Qué muestra | Reemplaza / complementa |
|---|---|---|---|
| [`01-system-architecture.html`](./01-system-architecture.html) | `architecture` | Flujo end-to-end: dron → DJI SmartFarm → cliente Playwright → scripts pipeline → Postgres+PostGIS → V0 adapter → Next.js → usuario. | Reemplaza el ASCII art de `docs/ARCHITECTURE.md §1`. |
| [`02-dji-data-pipeline.html`](./02-dji-data-pipeline.html) | `architecture` (process-style) | 9 pasos idempotentes de `scripts/run-pipeline.js` en 2 filas (5+4). Foco en paso 4 (spatial join). | Reemplaza la lista de 9/10 pasos de `docs/ARCHITECTURE.md §1` y la descripción operativa de `docs/DJI_SCRAPER.md`. |
| [`03-fumigation-cadence-state.html`](./03-fumigation-cadence-state.html) | `state` | Máquina de estados de cadencia (`no_history → ok → due_soon → overdue`) con flecha de recovery (`overdue → ok`). | Reemplaza el bloque de código de `lib/fumigation-cadence.ts` documentado en `docs/FUMIGATION_CADENCE.md`. |
| [`04-data-model-er.html`](./04-data-model-er.html) | `er` | Las 5 tablas núcleo de PostGIS con sus campos y FKs. `dji_parcels` es el aggregate root (focal). | Complementa `docs/AEROADMIN-AFM-OVERVIEW.md §2` (modelo de datos). |
| [`05-auth-flow-sequence.html`](./05-auth-flow-sequence.html) | `sequence` | Login con NextAuth v5 + RBAC check en cada request. 4 actores, 1 `alt` fragment (error vs success). Set-Cookie focal. | Complementa `docs/AEROADMIN-AFM-OVERVIEW.md §6` (auth). |
| [`06-rbac-matrix.html`](./06-rbac-matrix.html) | custom grid (RBAC matrix) | Grilla 9 páginas × 3 roles con la acción semántica por celda (`view` / `notFound()` / `redirect("/")` / `→ /login`). | Reemplaza la tabla de `docs/AEROADMIN-AFM-OVERVIEW.md §6`. |
| [`07-page-hierarchy-tree.html`](./07-page-hierarchy-tree.html) | `tree` | Jerarquía 3 niveles de `app/` (root → 5 grupos → 10 páginas → 1 nieto). `/parcelas/[id]` es el focal. | Complementa `docs/AEROADMIN-AFM-OVERVIEW.md §3` (mapa de páginas). |

## Brand skin

La paleta de los diagramas está customizada a la marca AeroAdmin:

| Token | Hex | Uso |
|---|---|---|
| `paper` | `#f0f4f1` | Fondo (verde hueso de la marca) |
| `ink` | `#1a2e22` | Texto y trazos principales (dark forest) |
| `accent` | `#0b5f2d` | Nodos focales (verde DJI Agras) |
| `concern` | `#a93232` | Estados/nodos de error (alerta, por-nodo) |
| `link` | `#2e5aa8` | Flechas externas / HTTPS |

Skin completa en `.skills/diagram-design/skills/diagram-design/references/style-guide.md`.

## Cómo agregar un diagrama nuevo

1. Leé `SKILL.md` de la skill en `.skills/diagram-design/`. La sección §3
   tiene el selection guide — elegí el tipo según lo que querés mostrar.
2. Leé la referencia del tipo elegido
   (`references/type-<tipo>.md`). Ahí están los layout conventions,
   connector rules, y el anti-patterns.
3. Copiá la estructura HTML de uno de los diagramas existentes (los 3
   comparten CSS variables, fuentes, y markers). Cambiá el viewBox y los
   nodos.
4. **Reglas duras** (no negociables, tomadas del `SKILL.md §6`):
   - Conectores ortogonales con codo redondeado `r=8` (nunca diagonales).
   - Labels con mask opaco y **6-10px de gap** sobre la línea (nunca
     encima de la línea).
   - Sin overlap de conectores; si se cruzan, aplicar bridge/hop.
   - Fan-out de attach points en el mismo edge (≥12px entre puntos).
   - 1-2 elementos focales max por diagrama.
5. Renderizá con `node .skills/render-diagram.js docs/diagrams/<file>.html .skills/<name>-preview.png`
   y verificá visualmente antes de commitear.
6. Agregá una fila a la tabla de catálogo de este README.
7. Si el diagrama complementa o reemplaza un doc existente, agregá un
   link al HTML en ese doc.

## Convenciones de nombres

- `NN-<slug>.html` — numeración secuencial (01, 02, 03, …) para que el
  orden de lectura sea explícito al listarlos.
- `<slug>` en kebab-case, en español o inglés según el doc que apunta.
- Si un diagrama queda obsoleto por un cambio de schema o de pipeline,
  **no lo borres**: marcalo como histórico en este README y mové el
  archivo a `docs/diagrams/_archive/`. El historial queda en git.
