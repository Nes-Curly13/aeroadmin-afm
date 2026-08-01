# Make.com Blueprints — REFERENCIA HISTÓRICA

> ⚠️ **ESTO ES REFERENCIA HISTÓRICA. NO EJECUTAR.**

Los archivos `*.make` en este directorio son **blueprints de
[Make.com](https://make.com)** que se usaron como prototipo del
scraper DJI antes de que el cliente Playwright estuviera maduro.
Vivían en `make/` a la raíz del repo; el 2026-07-29 se movieron
acá para:

1. Sacar de la raíz del repo un directorio que `arch:check` no
   podía analizar.
2. Evitar que un dev nuevo crea que estos blueprints son código
   de producción.
3. Dejar trazabilidad histórica: si el scraper Playwright falla
   y queremos volver a un approach low-code, el blueprint está
   disponible para inspiración.

## ¿Qué hay acá?

- `www_djiag_com_mission_1920w_default.make` — blueprint que
  scrapeaba la página de misión de DJI SmartFarm Web
  (1920w = ancho de viewport, default = escenario base).
- `www_djiag_com_records_1920w_default.make` — blueprint para
  la página de records (per-flight y fumigaciones).
- `records.txt` — placeholder vacío que vivía en `make/`.

## ¿Cuál es el código runtime?

El scraper runtime vive en `lib/djiag-*.js` (cliente Playwright
headless), con la re-implementación TypeScript de la lógica
original de los blueprints en `lib/djiag-from-make/*`:

- `lib/djiag-from-make/index.ts` — entrypoint y re-exports.
- `lib/djiag-from-make/field-management.ts` — equivalente al
  blueprint de gestión de lands/parcels.
- `lib/djiag-from-make/task-history.ts` — equivalente al
  blueprint de task history.

Los tests de esa re-implementación están en
`tests/djiag-from-make/`.

## Por qué se movieron (en vez de borrarse)

- El operador-cliente pagó tiempo de armado de los blueprints
  originales (varias horas de diseño y prueba contra la UI de
  DJI). Borrarlos sería perder ese trabajo.
- Aunque hoy el scraper Playwright es el camino feliz, los
  blueprints documentan un approach alternativo (no-headless,
  no-API) que puede ser útil si DJI cambia el schema de
  responses o si queremos un fallback low-code.
- La cantidad de espacio en disco es despreciable (~80KB).

## Si necesitás ejecutarlos

**No los ejecutes contra la UI de DJI directamente.** Si querés
revisitar el approach Make.com, primero entendé los blueprints
(son `.make` que Make.com abre en su editor visual), y después
re-implementá la lógica en TypeScript siguiendo el patrón de
`lib/djiag-from-make/`. No agregues un cliente Make.com al repo
runtime — el ciclo de vida de los `.make` es Make.com, no
este repo.

---

Movido el **2026-07-29** en el sprint de reconciliación de drift
(audit council). La decisión está documentada en
`docs/ARCHITECTURE.md` y `docs/V0_ADAPTATION.md` §9.
