# Review Synthesis — AeroAdmin AFM (2026-07-22)

> Síntesis cruzada de los 3 reviewers (negocio, software, UX).
> Cross-referenciado con sprints previos y scope confirmado.
> Decisión de producto: NO NDVI, NO prescripción, NO multi-tenant, NO auth nuevo, NO reescritura.

## Hallazgos individuales (por reviewer)

- **Business** (`docs/review/BUSINESS.md`): 8 mejoras priorizadas
- **Software** (`docs/review/SOFTWARE.md`): 8 items de deuda priorizados
- **UX** (`docs/review/UX.md`): 12 mejoras priorizadas

---

## Hallazgos cruzados: los que cruzan dominios

Estos son los hallazgos que **varios reviewers detectaron independientemente** o donde el fix de uno depende del otro. Son los de mayor impacto.

### 🔴 CX-1 — El "Ayer" del supervisor es invisible (UX F4.0 + Business H3)

**Lo que vieron:**
- **UX F4.0**: el dashboard cuenta la historia del **año**, no del **día**. El supervisor a las 7am necesita "¿qué pasó ayer?".
- **Business H3**: la fumigación REAL por parcela no se captura (depende 100% del supervisor cargarla a mano). El sistema de cadencia solo funciona para fincas que el supervisor se acuerda.

**Por qué importa:** si no resolvemos esto, **toda la feature de cadencia/alertas/vencidas es inútil para el 80% de las fincas** (las que el supervisor no carga a mano). El supervisor ve "vencida" pero no tiene acción porque la fumigación REAL está en el dron, no en la BD.

**Fix combinado (XS-M, combinado 4-6h):**
- **F4.0** (UX): card "Ayer" + "Hoy" en dashboard con `flights_count`, `area_fumigated`, `parcels_touched`
- **P8** (Business): backfill desde `dji_daily_summaries` con `ST_Intersects` sobre las geometrías que YA están en BD → genera `dji_fumigations` por parcela automáticamente

**Resultado:** el supervisor ve "ayer fumigaste 3 fincas (esto es real, no manual)" + "hoy te toca 2 más". Eso es **el producto** funcionando.

---

### 🔴 CX-2 — Sin "Reporte para el cañero" sigue siendo el gap #1 (UX F1.11 + Business implícito)

**Lo que vieron:**
- **UX F1.11**: bonus en el podio. Marleny recurre a screenshot + WhatsApp.
- **Business**: el producto no entrega valor tangible al cañero (el "wow" del panel es interno, no externo)

**Por qué importa:** sin esto, el producto es "panel para el dueño". Con esto, es "panel que produce entregables para el cliente final" — y el cliente final es quien paga.

**Fix (M, 3-5 días):**
- Botón "Reporte para el cañero" en `/parcels/[id]`
- 3 acciones: PDF (rendered server-side), CSV (ya existe el patrón), WhatsApp (link con texto prearmado)
- Template del PDF: header del operador, parcela, mapa miniatura, datos de vuelo, archivos adjuntos

**Esto era la recomendación #1 de la primera conversación.** Confirmado por los 3 reviewers como gap crítico.

---

### 🟠 CX-3 — El "Pendiente" en /parcels es falso (UX F1.1) + Drif de queries (Software H2)

**Lo que vieron:**
- **UX F1.1**: 1207 fincas todas marcadas "Pendiente" (literalmente `parcels-list.tsx:36-39`)
- **Software H2**: la query cached y la no-cached divergen → si el UI quiere usar `crop_type` en una lista, devuelve `undefined` silenciosamente

**Por qué importa:** la lista principal miente (mismo síntoma visual) Y va a mentir más cuando agreguemos features (drift acumulado).

**Fix combinado (XS, 2-3h):**
- **F1.1**: dot de 3 colores (verde/amarillo/rojo) basado en `days_since_last_fumigation`. Query batch que cabe en el `Promise.all` existente.
- **H2**: extraer `djiParcelsQuery` a `api/queries.ts`, eliminar la duplicación

**Esto es de las cosas más baratas y con más valor de la lista. Es un sprint mini de 1 día.**

---

### 🟠 CX-4 — Riesgo de perder todo (Software H3) + Compliance no modelado (Business H2)

**Lo que vieron:**
- **Software H3**: cero backup automatizado, cero watchdog del health endpoint
- **Business H2**: gap regulatorio ICA + Aerocivil. Una visita encuentra esto en 996/1000 fumigaciones.

**Por qué importa:** combinar lo operacional (backup) con lo legal (compliance) en UN solo sprint de "blindar el sistema". El dueño tiene que poder dormir tranquilo.

**Fix combinado (M, 1 día):**
- **H3**: cron semanal con `pg_dump` → `backups/`, GitHub Action que llame `/api/admin/djiag-health` y falle si stale >24h
- **H2 complemento**: agregar `product_registered_ica` (catálogo, no texto libre), `pilot_license`, `drone_registration` (matrícula) — 3 columnas + UI mínima. No resuelve todo el gap ICA, pero pone las bases.

**Esto deja al sistema con: backup automático, health alert, y la metadata mínima regulatoria.**

---

## Hallazgos únicos por reviewer (no cruzados)

### Solo Business
- **Sin visibilidad financiera** (clientes con precio/ha, catálogo de agroquímicos con costo, hourly_cost). P1+P3 del review.
- **Multi-tenant** marcado como NO se debe hacer (consistente con decisión de scope).
- **App para cañeros** marcado como NO se debe hacer (consistente).

### Solo Software
- **Soft delete zombie** — columna `deleted_at` agregada pero nadie la usa. Drop o implementar de verdad. XS.
- **Test gaps** en cosas que el audit UI/UX previo no cubría (carga concurrente del pipeline, health bajo carga, etc.)
- **Performance 10x** — qué pasa con 12k fincas. Hoy no es problema, pero la decisión arquitectural importante es: ¿postGIS-only o引入 caché más agresivo?

### Solo UX
- **Empty state global del dashboard** (F3.0) — banner "Cómo importar datos" cuando todo está en 0. XS.
- **Mobile drawer** funciona pero el caso real (supervisor en el lote mirando una finca) no está validado.
- **Fricción F2.x** (menores): scroll, jerarquía visual, "vencida hace 12d" sin contexto.

---

## Plan propuesto: 3 sprints de 1-2 días cada uno

### Sprint A — "Verdades del producto" (2 días, alto impacto)
Resuelve CX-1 (parcial: F4.0) + CX-3 completo.
- **F4.0** (UX, S): cards "Ayer" + "Hoy" en dashboard
- **F1.1** (UX, S): dots de color en `/parcels`
- **H2** (Software, XS): extraer `djiParcelsQuery` a `api/queries.ts`
- **F3.0** (UX, XS): empty state banner del dashboard

**Output esperado:** el dashboard cuenta la historia del día, /parcels muestra prioridades, las queries no divergen más.

### Sprint B — "Real value" (3-5 días, alto impacto externo)
Resuelve CX-1 (resto: P8) + CX-2.
- **P8** (Business, M): backfill desde `dji_daily_summaries` con `ST_Intersects` para fumigaciones por parcela
- **F1.11** (UX, M): botón "Reporte para el cañero" con PDF/CSV/WhatsApp
- **H1** (Software, XS): drop o implementar soft delete (decisión a tomar)

**Output esperado:** el sistema sabe qué pasó ayer **real**, no solo lo que el supervisor cargó. Y puede generar un entregable para el cañero.

### Sprint C — "Blindar el sistema" (1 día, bajo esfuerzo, alto valor de tranquilidad)
Resuelve CX-4.
- **H3a** (Software, XS): cron `pg_dump` semanal
- **H3b** (Software, XS): GitHub Action watchdog del health endpoint
- **H2 base regulatoria** (Business, M): 3 columnas mínimas + UI (`product_registered_ica`, `pilot_license`, `drone_registration`)

**Output esperado:** el dueño puede irse de vacaciones tranquilo. Si algo se rompe, se entera en <24h.

### Lo que NO está en estos 3 sprints (intencional)

- **Multi-tenant** (Business P5): NO. Single-tenant.
- **App para cañeros** (Business P7): NO. Login sigue siendo solo empresa.
- **NDVI / prescripción / Pix4Dfields / ODM**: NO. Decisión de scope cerrada.
- **Visibilidad financiera completa** (Business P1, P3): NO en estos 3. Es un sprint propio (P-financial, ~1 semana) que requiere diseño de modelo de datos desde cero.
- **Soft delete si no se dropea** (Software H1): no urgente. Esperar a que alguien lo pida.
- **Performance 10x** (Software §6): no urgente. Hoy 1207 fincas escala OK.

---

## Riesgos a destacar

1. **Riesgo de perder data** (CX-4): cero backup. El dev machine muere = se acabó. **Esto se arregla en Sprint C, no postergar.**
2. **Riesgo regulatorio** (CX-4): visita del ICA o Aerocivil encuentra el sistema sin metadata. **Sprint C pone las bases, no resuelve todo.**
3. **Riesgo de drift de schema** (Software H2): las queries divergen. Va a pasar de nuevo la próxima vez que se agreguen campos. **Sprint A lo arregla estructuralmente.**

---

## Changelog

- **2026-07-22** — Síntesis cruzada de los 3 reviewers. Plan de 3 sprints. Riesgos priorizados.
