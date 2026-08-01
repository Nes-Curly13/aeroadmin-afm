# lib/_archive/djiag-from-make-2026-08/

> Módulo archivado el 2026-08-01 durante la limpieza del sprint S6.7.

## Qué es esto

`djiag-from-make` es un wrapper TypeScript que replica los blueprints de
Make.com (`make/www_djiag_com_mission_1920w_default.make` y
`make/www_djiag_com_records_1920w_default.make`). Fue diseñado durante
el sprint S5 para alimentar el port V0 del mockup de Figma.

Archivos:
- `index.ts` — re-exports
- `field-management.ts` — wrapper del blueprint `/mission` (lista de fincas)
- `task-history.ts` — wrapper del blueprint `/records` (rollup diario +
  sub-lista de vuelos por día)

Tests archivados con el código: `tests/_archive/djiag-from-make-2026-08/`.

## Por qué se archivó

- Fue planeado para el V0 port pero **nunca se integró al código de
  producción**. No hay imports desde `app/`, `components/`, `api/`, ni
  desde otros módulos de `lib/`.
- Los tests pasan (100% coverage del módulo) pero ningún componente/page
  los consume.
- AGENTS.md R2 lo mencionaba como excepción ("puede usarse desde
  `app/api/**/route.ts`") pero esa excepción quedó obsoleta cuando el
  V0 port optó por `lib/data.ts` en vez de este wrapper.
- `lib/format.ts:182` lo menciona en un comentario, pero la dependencia
  es solo referencial (formato `1Hour24min05s` coincide, no se importa).

## Cómo revertir el archivo (si se reactiva el V0 port)

1. `git mv lib/_archive/djiag-from-make-2026-08/* lib/djiag-from-make/`
2. `git mv tests/_archive/djiag-from-make-2026-08/* tests/djiag-from-make/`
3. `npm test -- djiag-from-make` — los tests deberían pasar sin cambios.
4. Crear un consumer (probablemente en `app/api/v0/.../route.ts`) y
   empezar a usar `fetchFieldManagementSnapshot` y
   `buildTaskHistorySnapshot`.

## Política de retención

- **6 meses desde archivo** (2026-02-01). Si para entonces no se
  reactivó el V0 port, evaluar borrar (los tests cubren la lógica pero
  no hay forma de saber si la API de DJI AG cambió en el medio).
- Si se reactiva el V0 port antes de esa fecha, reintegrar.

## Estado de los tests

Al archivar:
- `field-management.test.ts`: 13 tests (formatDjiDate, landToFieldCard, fetchFieldManagementSnapshot)
- `task-history.test.ts`: tests de muFromM2, formatDuration, computeTotals, aggregateNormalizedDays, aggregateNormalizedDaysWithFlights
- Ambos corren en ~50ms (sin red, fixtures locales)
- Vitest los descubre automáticamente en el directorio archive porque
  el exclude en `vitest.config.ts` solo excluye `tests/e2e/**`

## Referencias

- `docs/V0_ADAPTATION.md` — bitácora del sprint V0
- `docs/audit/figma-vs-bd.md` — matriz UI ↔ BD del Figma
- `AGENTS.md` R2 — la regla de djiag scraper (ya no aplica a este
  módulo pero el comentario del rule todavía lo menciona)
- `lib/format.ts:182` — referencia al formato `djiFormat` de task-history
