# Diagramas del sistema — Handoff para otro agente

> Documento de traspaso. Si estás leyendo esto, otro agente construyó
> los diagramas de este directorio. Esta nota te dice **qué dejó**,
> **por qué tomó cada decisión**, y **cómo extender el set** sin
> romper el sistema visual establecido.
>
> Audiencia: futuras instancias de Mavis u otro coding agent que
> necesite mantener/agregar/quitar diagramas. Asumo que no conoces
> el proyecto.

---

## 1. TL;DR (60 segundos)

Se construyeron **7 diagramas editoriales** del sistema AeroAdmin AFM con
la skill [`cathrynlavery/diagram-design`](https://github.com/cathrynlavery/diagram-design)
(v2.2), todos en `docs/diagrams/*.html`, con una **brand skin
customizada a AeroAdmin** (verde DJI Agras como accent, alert red como
concern per-node). Son HTML self-contained con inline SVG — no
necesitan build step, se abren en cualquier browser.

Estructura del directorio:

```
docs/diagrams/
├── HANDOFF.md                      ← este archivo
├── README.md                       ← catálogo + instrucciones para agregar más
├── style-guide.md                  ← brand skin project-owned
├── 01-system-architecture.html     ← overview: dron → DB → Next.js
├── 02-dji-data-pipeline.html       ← overview: 9 pasos del pipeline DJI
├── 03-fumigation-cadence-state.html ← overview: state machine de cadencia
├── 04-data-model-er.html           ← detail: 5 tablas PostGIS + FKs
├── 05-auth-flow-sequence.html      ← detail: NextAuth v5 login + RBAC check
├── 06-rbac-matrix.html             ← detail: 9 páginas × 3 roles
└── 07-page-hierarchy-tree.html     ← detail: jerarquía app/ con timeline nieto

scripts/
└── render-diagram.js               ← utilidad: HTML → PNG via Playwright
```

Y en el `.gitignore`:

```
/.skills/                           ← clone local de la skill (~38 MB), nunca commitea
```

---

## 2. Lo que el agente anterior dejó

| Archivo | Líneas | Qué hace |
|---|---|---|
| `docs/diagrams/01-system-architecture.html` | ~300 | Reemplaza el ASCII art de `ARCHITECTURE.md §1` |
| `docs/diagrams/02-dji-data-pipeline.html` | ~285 | Visualiza los 9 pasos de `scripts/run-pipeline.js` |
| `docs/diagrams/03-fumigation-cadence-state.html` | ~232 | State machine de `lib/fumigation-cadence.ts` |
| `docs/diagrams/04-data-model-er.html` | ~300 | 5 tablas PostGIS con PKs/FKs/cardinalidades |
| `docs/diagrams/05-auth-flow-sequence.html` | ~315 | Login + alt fragment error/success + role check |
| `docs/diagrams/06-rbac-matrix.html` | ~410 | Grilla RBAC con acción semántica por celda |
| `docs/diagrams/07-page-hierarchy-tree.html` | ~330 | Jerarquía 3 niveles del app/ |
| `docs/diagrams/README.md` | ~80 | Catálogo + procedimiento para agregar más |
| `docs/diagrams/style-guide.md` | ~85 | Brand skin project-owned (paleta, tipografía, rationale) |
| `scripts/render-diagram.js` | ~20 | Playwright headless: HTML → PNG |

Commits: 2 (`fd9e1b0` para 01-03, `15b68f3` para 04-07 + wirings + README).

**Total: 7 HTMLs + 2 docs + 1 script + 1 gitignore line = ~2,400 líneas.**

---

## 3. Decisiones de skin que NO debes romper

La skill original tiene una paleta tangerine/white-smoke. La overrideamos
a la marca AeroAdmin. Las decisiones (con rationale completo en
`docs/diagrams/style-guide.md`):

| Token | Hex | Por qué |
|---|---|---|
| `paper` | `#f0f4f1` | Verde hueso de la marca. No blanco puro (queda estéril). |
| `ink` | `#1a2e22` | Dark forest neutro. Verde brand es para focal, no para body. |
| `accent` | `#0b5f2d` | Verde DJI Agras. **1-2 elementos focales max por diagrama.** |
| `concern` | `#a93232` | Alert red. **Per-node override para error/danger, NO accent global.** |
| `link` | `#2e5aa8` | Azul default. Convención universal para HTTPS/API externa. |
| `muted`, `soft` | blue-slate | Roles neutrales (texto técnico, sublabels). No tocar. |

**Regla de oro:** el verde DJI Agras es focal. El rojo es para estados
de error (`overdue` en la state machine, `notFound()` en RBAC, etc).
Nunca los mezcles como si fueran lo mismo.

**Dónde vive el override:** el archivo en el proyecto es
`docs/diagrams/style-guide.md`. La skill clonada en `.skills/` tiene
su propia copia (la que se editó para customizar); si re-clonas la
skill, ese override se pierde y hay que volver a aplicarlo siguiendo
las instrucciones de `style-guide.md`.

---

## 4. El patrón que usé para construir cada diagrama

1. **Leí el type reference** de la skill (`references/type-<tipo>.md`)
   antes de tocar SVG. Las 5 que usé:
   - `type-architecture.md` → para 01, 02
   - `type-state.md` → para 03
   - `type-er.md` → para 04
   - `type-sequence.md` → para 05
   - `type-tree.md` → para 07
   - **06 (RBAC matrix) NO usa un type de la skill** — es un grid custom
     armado con la misma design system. Si quieres replicarlo, mira
     la estructura: `<rect>` por celda + badge interno (✓ / → / 404) +
     color de fondo semántico.

2. **Copié la estructura HTML** de un diagrama existente (los 7
   comparten CSS variables, fonts de Google, y marker definitions).
   El viewBox cambia por diagrama (1200x720, 1200x560, 1200x760, etc.)
   según el contenido.

3. **Dibujé flechas ANTES de nodos** (z-order rule de la skill). Las
   flechas cruzan zonas con un bus horizontal a la altura del primer
   nivel, y bajan verticalmente a cada nodo.

4. **Conectores ortogonales** con codo redondeado `r=8`. SVG path:
   ```
   M x1,y1 H mid-8 Q mid,y1 mid,y1+8 V y2-8 Q mid,y2 mid+8,y2 H x2
   ```
   (con números literales, NO `mid-8` — SVG no evalúa expresiones).

5. **Labels con mask opaco** (color `paper`) y **6-10px de gap** sobre
   la línea. Nunca labels sobre la flecha (la skill dice hard fail).

6. **Focal = 1-2 elementos max.** Verde para "el momento importante de
   la historia" (DB como corazón, paso que resuelve una alerta, etc).
   Rojo concern per-node para estados/nodos de error (≤3 por
   diagrama).

7. **Rendericé con Playwright headless** y verifiqué visualmente antes
   de commitear:
   ```bash
   node scripts/render-diagram.js docs/diagrams/NN-name.html .skills/NN-preview.png
   ```
   El script está en `scripts/render-diagram.js`. Lee el PNG resultante
   y verifica que:
   - No hay overlap de nodos ni de flechas.
   - Los labels no pisan las flechas.
   - El focal se ve claramente destacado.
   - El viewBox no recorta contenido.

8. **Wireé en los docs fuente** con un callout HTML/markdown al
   inicio de la sección relevante:
   ```markdown
   > 📐 **Diagrama editorial:** [`docs/diagrams/04-data-model-er.html`](diagrams/04-data-model-er.html) — descripción corta.
   ```
   Y agregué la entrada correspondiente en la tabla del
   `docs/diagrams/README.md`.

9. **Commitear con scope** y mensaje en español siguiendo el patrón
   del repo:
   ```
   docs(diagrams): N diagramas [breve descripción del scope]
   ```

---

## 5. Errores que ya pagué (no los repitas)

| Error | Cómo lo arreglé | Cómo evitarlo |
|---|---|---|
| Paths SVG con `H mid-8` (SVG no evalúa) | Reemplacé con números literales en cada path | **Calcula los números ANTES de escribir el path**, o usa una calculadora inline. |
| Labels cortos entre cajas adyacentes pisando la flecha | Saqué los labels (layout es claro) | **Para flechas verticales cortas, poné el label a un lado con 6-10px de gap horizontal** — o no le pongas label. |
| Texto largo en output badges que se sale del rect | Acorté ("→ dji_fumigations" en vez de "→ dji_fumigations (aggr)") | **Probá el texto a 9px Geist Mono: ~5.4px por char.** 131px de badge = ~24 chars. |
| Overlap entre nodos (e.g. dji_flights y dji_fumigations ambos en x=820) | Reposicioné uno (movido a x=900), ajusté el viewBox | **Antes de escribir el primer nodo, dibujá el grid en papel** y verifica que las cajas no se pisan. |
| Foco en RBAC matrix (admin) que no se distinguía del resto | Borde accent (1.4px) en lugar de 1px + tint de fondo | **El focal necesita 2强化 (border reforzado + color de fill)**, no solo uno. |
| El `.skills/` se intentó commitear (38MB) | Lo agregué a `.gitignore` y dejé los archivos en disco para re-clonar | **Cualquier clone de skill, .venv, o .tool-cache va a .gitignore**. El skin overrideado vive en el proyecto (no en el clone). |
| Preview PNGs y archivos temporales quedaron en `.skills/` | El gitignore los cubre, no se commitean. Si querés limpiar: `mavis-trash .skills/*.png` (o el `Remove-Item` que prefieras — está bloqueado por safety por default) | **No commitees PNGs de preview** — son artefactos locales. Si los necesitas en docs, exportalos a `docs/diagrams/assets/` con nombre deliberado. |

---

## 6. Cómo agregar el diagrama 8 (o N)

**Caso de uso:** el equipo necesita un nuevo diagrama. Por ejemplo, un
`type-medallion` para los tiers de la DB (raw → cleaned → marts), o
un `type-flowchart` para la decisión de role-gate.

**Pasos:**

1. **Decidí el tipo.** Lee `SKILL.md` §3 (selection guide) y el
   `type-<X>.md` correspondiente. Si ninguno encaja, fijate los 27
   tipos disponibles en la skill — no inventes tipos nuevos.

2. **Re-cloná la skill** si no la tenés:
   ```bash
   git clone --depth 1 https://github.com/cathrynlavery/diagram-design.git .skills/diagram-design
   ```
   El `.skills/` ya está en `.gitignore`, no se commitea.

3. **Re-aplicá el brand skin.** El override está en
   `docs/diagrams/style-guide.md`. La sección "Decisiones de skin
   (rationale)" te dice qué cambiar en la tabla "Semantic roles" del
   archivo `style-guide.md` de la skill clonada
   (`.skills/diagram-design/skills/diagram-design/references/style-guide.md`).

4. **Copiá la estructura HTML** del diagrama existente más similar al
   tipo que vas a hacer (01 o 02 para architecture, 04 para ER, 05
   para sequence, etc). Cambiá viewBox y contenido.

5. **Renderizá y verificá** con `node scripts/render-diagram.js <input> <output>`.

6. **Actualizá el catálogo** en `docs/diagrams/README.md` (agregá una
   fila a la tabla).

7. **Wireé en el doc fuente** que justifique el diagrama. Si no
   encontrás un doc, dejá el callout en `AEROADMIN-AFM-OVERVIEW.md` o
   en un `docs/<subsystem>.md` nuevo.

8. **Commit con scope claro:**
   ```
   docs(diagrams): <tipo> para <subsystem> — <resumen en 1 línea>
   ```

---

## 7. Cosas que NO están en los diagramas (y por qué)

- **Diagramas del frontend (componentes, hooks, state).** El sistema
  es chico (single contributor), los componentes están en
  `components/` y son leídos con grep. Un diagram de árbol de
  componentes agrega poco valor hasta que la base de código crezca
  2-3x.

- **Diagrams de CI/CD.** No hay pipeline de CI/CD significativo — los
  commits se pushean a master y Vercel despliega. Un `type-flowchart`
  sería: `git push → Vercel build → preview URL`. No vale la pena.

- **Loop / flywheel del producto.** El sistema no tiene un flywheel
  visible (el usuario no retroalimenta el scraper). Si en algún
  sprint aparece un loop del estilo "fumigación real → ajusta cadencia
  → próxima fumigación", un `type-loop` lo captura. Hoy no aplica.

- **Quadrant de cadencia × estación.** El cálculo de cadencia efectiva
  por fase de cultivo × estación está documentado en
  `docs/FUMIGATION_CADENCE.md` con tablas. Un `type-quadrant` lo
  visualizaría, pero la tabla funciona. Decidí no hacerlo hasta que
  el equipo lo pida.

---

## 8. Anchors rápidos (para navegación)

| Necesito... | Voy a... |
|---|---|
| Ver el catálogo completo | `docs/diagrams/README.md` |
| Entender la skin y por qué | `docs/diagrams/style-guide.md` |
| Re-aplicar la skin tras re-clonar la skill | `docs/diagrams/style-guide.md` §"Decisiones de skin" |
| Renderizar un HTML a PNG | `node scripts/render-diagram.js <in> <out>` |
| Ver dónde está wired un diagrama | `grep -l "diagrams/NN-" docs/ -r` |
| Cambiar el focal de un diagrama | Editá el SVG del HTML — buscá `accent` y `accent-tint` |
| Agregar/modificar un diagrama | §6 arriba |

---

## 9. Si algo se rompe

1. **El SVG no renderiza bien:** abrí el HTML en un browser y mirá la
   consola. Casi siempre es un path malformado o un atributo mal
   escapado.

2. **Los labels se superponen con las flechas:** el mask opaco está
   mal posicionado. Recalculá: mask `y = line_y - 12 - 6` (8px texto +
   6px gap mínimo).

3. **El focal no se ve:** está en 1px stroke en vez de 1.4. O está
   con el color de concern (rojo) en vez de accent (verde).

4. **El brand skin se ve mal:** estás renderizando con la skill
   default (tangerine). Re-aplicá los tokens de `style-guide.md` a
   `.skills/diagram-design/skills/diagram-design/references/style-guide.md`.

5. **El usuario no quiere el diagrama N:** marcalo como histórico en
   el README (no lo borres — el historial queda en git) y mové el
   HTML a `docs/diagrams/_archive/`. No rompas los wirings hasta que
   el doc fuente también se actualice.

---

**Última actualización:** 2026-08-13, sprint S6 (polish MapPageClient).
**Mantenedor actual:** @agFab (single contributor).
**Próximo agente probable:** cuando llegue un cambio de schema
significativo (más tablas, cadencia con más fases, multi-tenant) o un
nuevo subsystem con UI propia.
