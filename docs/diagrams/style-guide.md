# AeroAdmin AFM — Diagram Skin Override

> **Este archivo es la brand skin de los diagramas del proyecto.**
> El skill `cathrynlavery/diagram-design` (clonado en `.skills/`) trae una
> paleta default tangerine sobre white-smoke. La overrideamos con la
> marca AeroAdmin (verde DJI Agras + alert red para estados de error).
>
> Si en algún sprint necesitás regenerar los diagramas:
>
> 1. Re-cloná la skill: `git clone --depth 1 https://github.com/cathrynlavery/diagram-design.git .skills/diagram-design`
> 2. Copiá los tokens de este archivo a
>    `.skills/diagram-design/skills/diagram-design/references/style-guide.md`
>    (reemplazá la tabla "Semantic roles" — el resto de la guía queda igual).
> 3. Re-generá los HTMLs de `docs/diagrams/` siguiendo el patrón existente.
> 4. Renderizá con `node scripts/render-diagram.js <input> <output>` para
>    verificar visualmente.

## Tokens (light mode)

| Rol | Hex | Uso |
|---|---|---|
| `paper` | `#f0f4f1` | Fondo de página (verde hueso de la marca) |
| `paper-2` | `#e6ede8` | Fondo secundario (containers, swimlanes) |
| `ink` | `#1a2e22` | Texto y trazos principales (dark forest, WCAG AA sobre paper) |
| `muted` | `#4f5d75` | Texto secundario, flechas internas, bordes de store |
| `soft` | `#7a8399` | Sublabels, eyebrow tags |
| `rule` | `rgba(26,46,34,0.12)` | Hairlines (zonas, separadores) |
| `rule-solid` | `#d2ddd6` | Bordes más fuertes (cards, baselines) — coincide con border de cards de UI |
| `accent` | **`#0b5f2d`** | Nodo focal — verde DJI Agras (1-2 max por diagrama) |
| `accent-tint` | `rgba(11,95,45,0.08)` | Fill de nodos con borde accent |
| `link` | `#2e5aa8` | Flechas externas / HTTPS / API calls |
| `concern` | **`#a93232`** | Per-node color override — error/danger only (no es global accent) |

## Decisiones de skin (rationale)

- **`accent` = verde DJI Agras.** El verde de la marca es el color más
  identitario del sistema; úsalo cuando un nodo/flecha es "el momento
  focal" de la historia (DB como corazón, paso que resuelve una alerta,
  etc.). El rojo NUNCA es accent global.
- **`concern` = alert red.** Limitado a nodos/estados que representan
  riesgo: `overdue` en cadencia, alertas HIGH, fallos. Máximo 3 elementos
  con `concern` por diagrama (regla de focal + 3 colores custom).
- **`ink` oscuro neutro (no verde).** El verde es para focal; usar
  `#0b5f2d` como body text cansa la vista. `#1a2e22` (dark forest) lee
  neutral y contrasta AA sobre `#f0f4f1`.
- **`muted` y `soft` se quedan en blue-slate.** Son roles semánticos
  neutrales (texto técnico, sublabels). Cambiarlos a tonos verdes rompe
  la legibilidad.
- **`link` se queda en azul.** Convención universal para HTTP/external.
  Cambiarlo confunde al lector.

## Tipografía (sin cambios del default)

| Rol | Familia | Tamaño |
|---|---|---|
| `title` (H1) | Instrument Serif | 1.75rem, 400 |
| `node-name` | Geist (sans) | 12px, 600 |
| `sublabel` | Geist Mono | 9px, 400 |
| `eyebrow` | Geist Mono | 7-8px, tracked 0.18em, uppercase |
| `arrow-label` | Geist Mono | 8px, tracked 0.06em |
| `callout` | Instrument Serif *italic* | 14px, 400 |

Font stack (link en cada HTML):
```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Treatment de nodos (mismo que el skill default)

| Tipo | Fill | Stroke |
|---|---|---|
| `focal` (1-2 max) | `accent-tint` | `accent` |
| `backend` | `#ffffff` | `ink` |
| `store` | `ink @ 0.05` | `muted` |
| `external` | `ink @ 0.03` | `ink @ 0.30` |
| `input` | `muted @ 0.10` | `soft` |
| `concern` (per-node) | `concern @ 0.08` | `concern` |

## Reglas duras (del skill SKILL.md §6 — no negociables)

1. Conectores ortogonales con codo redondeado `r=8`. Nunca diagonales.
2. Labels con mask opaco (color `paper`) y 6-10px de gap sobre la línea.
3. Sin overlap de conectores. Si se cruzan, usar bridge/hop (arco `r=8`).
4. Fan attach points: ≥12px entre attach points en el mismo edge.
5. 1-2 elementos focales max. `concern` cuenta como focal-color.
