# UX Review — AeroAdmin AFM (2026-07-22)

> **Lente**: diseñador UX senior, 1 pasada, sin cambios de código.
> **Audiencia del producto**: dueño + supervisor del operador de
> fumigación con drones DJI Agras en Valle del Cauca, Colombia.
> **Estado del sistema al 2026-07-22**: post-sprint v1.7 (bento dashboard,
> task-history sidebar, /parcels/overdue). El audit previo
> `docs/audit/ui-ux-2026-07.md` cubrió la foto del 2026-07-19. Esta
> review lee la foto de hoy y se enfoca en fricciones residuales.

---

## 1. Personas y journey principal

### Persona A — "Don Horacio" (dueño)

- Perfil: 50+, no técnico, opera el negocio. Abre el panel **desde la
  compu de la oficina** todas las mañanas, 7-8am, con café. A veces abre
  desde el celular cuando está en la finca.
- Necesita: "¿cómo vamos?", "¿hay algo urgente?", "¿vamos a facturar
  bien?". Le importa más el rollup que el detalle.
- Frecuencia: 1-2 veces al día, sesión corta (5-10 min).
- Dispositivo: 80% desktop, 20% mobile.

### Persona B — "Marleny" (supisora de campo)

- Perfil: 35-45, conoce el dominio cañero, no es dev. Está en la finca
  revisando lotes, abre el panel **desde el celular** varias veces al
  día, a veces con señal mala.
- Necesita: "¿qué fumigé esta semana?", "¿qué tengo que fumigar hoy?",
  "¿cuál parcela está vencida?". Drill-down frecuente desde
  /parcels/overdue → /parcels/[id] → /parcels/[id]/timeline.
- Frecuencia: 3-5 veces al día, sesión mediana (10-20 min), mucha
  navegación drill-down.
- Dispositivo: 50% mobile, 50% desktop.

### Personas fuera del panel (NO usar): pilotos DJI Agras. Siguen
trabajando en la app nativa de DJI. El panel es solo administrativo.

### Journey típico de Marleny un lunes 7am

1. Abre el celular → hamburger → "Faltan por fumigar" (1 click).
2. Ve la lista priorizada, clickea la primera vencida (1 click).
3. Revisa el detalle: última fumigación, área, cadencia (1 click en
   /parcels/[id]).
4. Quiere ver el histórico → click "Ver timeline" (1 click → /parcels/[id]/timeline).
5. Registra una fumigación manual del viernes que se le escapó → scroll
   → "Registrar fumigación" → form → Guardar (3-4 clicks + typing).
6. Vuelve al dashboard para confirmar el KPI de "Atrasadas" (2 clicks).
7. Va al mapa para ver visualmente qué lote falta (1 click → /map).

**Total: ~12-15 interacciones para registrar UNA fumigación retroactiva
y verificar que el sistema la reflejó.** El sistema **no le avisa** que
el KPI cambió — ella tiene que ir a buscarlo.

---

## 2. Flujos críticos evaluados

### Flujo A — "Revisar estado de una finca"

**Pasos actuales** (escenario Marleny en desktop, 7am):
1. Abre `/parcels` (lista de 1207 fincas, 1 click desde sidebar).
2. Busca por nombre o ID DJI en el `<input type="search">` (1-5 chars
   tipeados, ~1-3 seg).
3. Click en "Ver detalle →" de la fila correcta (1 click).
4. Llega a `/parcels/[id]` → ve la "hoja de vida" del lote
   (header + edit panel + mini-mapa + parámetros + área + plan + contexto + acciones).

**Tiempo total**: 5-15 seg si sabe el nombre, 30+ seg si solo recuerda
"el lote que está cerca del río".

**Fricciones detectadas**:
- **F1.1 (alta)**: la columna "Estado" del listado muestra "PENDIENTE"
  para **todas** las 1207 fincas sin excepción. El chip gris es
  información nula y miente visualmente — sugiere que **toda** la
  operación está pendiente. Ver `components/parcels/parcels-list.tsx:38`
  (comentario del propio código: *"marcar todas como 'Pendiente' y
  dejar la fuente de verdad del estado en /parcels/overdue y
  /parcels/[id]"*). El supervisor no puede escanear prioridades en la
  tabla; tiene que entrar a cada fila o cambiar a /parcels/overdue.
- **F1.2 (media)**: el input de búsqueda solo matchea `land_name` y
  `external_id`. No busca por `crop_type` (caña/maíz), por dron
  asignado, por propietario. Si Marleny dice "muéstrame las de Carlos
  Arboleda" no hay forma (tendría que abrir cada ficha y leer el campo
  "Propietario").
- **F1.3 (baja)**: el sort default es "Nombre ascendente". Para un
  supervisor que ya conoce los IDs DJI, sería más útil sort por "Última
  fumigación" o "Estado" (si se implementara F1.1). Hoy no se puede.

**Propuesta**:
- **P1.A1 (XS)**: sacar el chip "Pendiente" mentiroso. Reemplazarlo por
  un dot de 3 colores (verde = fumigada hace <14d, amarillo = 14-30d,
  rojo = >30d o sin historial). El cálculo es una sola query batch
  (`SELECT parcel_id, MAX(fumigation_date) FROM dji_fumigations GROUP BY
  parcel_id`) que cabe en el `Promise.all` del page (ver
  `app/parcels/page.tsx:24`). El `getParcelsNormalized` ya está
  cacheado (TTL 60s), agregar el join no rompe el cache pattern.
- **P1.A2 (S)**: ampliar el input de búsqueda a `crop_type`,
  `owner_name`, `drone_model_name`. Misma implementación que el filtro
  actual, solo extender el OR.

### Flujo B — "Encontrar fincas vencidas y priorizarlas"

**Pasos actuales**:
1. Click en sidebar "Faltan por fumigar" (1 click → /parcels/overdue).
2. Ve summary chips: Vencidas, Vencen esta semana, En fecha, Sin
   historial.
3. Click en chip "Vencidas" para filtrar (1 click, server-side reload).
4. Lee la lista priorizada (overdue > due_soon > ok, top 8 default).
5. Si hay más de 8, ve el chip "Ver todas (N) →" arriba (ver
   `components/dashboard/upcoming-fumigations.tsx:87`).

**Tiempo total**: 5-10 seg para llegar a la lista priorizada.

**Fricciones detectadas**:
- **F1.4 (alta)**: el chip "Vencen esta semana" es engañoso. La
  definición server-side es `days_until_next_due <= maxDaysAhead` (default
  14 — ver `app/parcels/overdue/page.tsx:69` y `app/parcels/overdue/page.tsx:90`).
  Si el supervisor cambia la URL `?maxDaysAhead=7`, "esta semana" se
  convierte en "próximos 7 días" pero el chip sigue diciendo "Vencen
  esta semana" — copy desalineada de la lógica.
- **F1.5 (media)**: el chip "En fecha" es clickeable (ver
  `components/overdue/overdue-list.tsx:152`). El supervisor clickea
  esperando "muéstrame las que están bien" y obtiene una lista que no
  necesita fumigar — gasta atención en data que no requiere acción. Los
  chips deberían ser **filtros de acción** (Vencidas, Vence pronto,
  Sin historial) más un **indicador pasivo** de "En fecha: N" (no
  clickeable).
- **F1.6 (media)**: la página /parcels/overdue NO tiene el sidebar
  item activo correctamente resaltado en algunos casos. Verifica
  `app/parcels/overdue/page.tsx:108` — usa `activeSection="faltan"` y
  el `app-shell.tsx:17` define `key: "faltan"`. Match correcto, pero el
  sidebar item "Faltan por fumigar" no muestra count de overdue en el
  bloque "Estado actual" (sidebar solo muestra `parcelsCount` y
  `highAlertsCount` — ver `app-shell.tsx:119-141`). El supervisor no ve
  "5 vencidas" en el sidebar — tiene que entrar a la página para
  enterarse.
- **F1.7 (baja)**: en mobile, el header chip "Ventana: 14 días" (ver
  `app/parcels/overdue/page.tsx:104`) se ve, pero no es actionable. Si
  el supervisor quiere cambiar a 7 días, tiene que editar la URL
  manualmente.

**Propuesta**:
- **P1.B1 (XS)**: renombrar el chip "Vencen esta semana" → "Vence
  pronto (≤14d)" y hacer el label dinámico al `maxDaysAhead` del URL
  param. 5 min de cambio de copy.
- **P1.B2 (XS)**: hacer el chip "En fecha" no-clickeable (cambiar
  `<button>` a `<div>` o `<button disabled>`). Solo los 3 estados que
  requieren acción quedan clickeables.
- **P1.B3 (S)**: agregar al sidebar un contador "Vencidas: N" abajo del
  "Alertas altas" existente. Necesita un query batch liviano
  (`getOverdueParcels` con `severity=overdue` ya existe — ver
  `app/page.tsx:31`).
- **P1.B4 (S)**: agregar popover en el chip "Ventana: 14 días" con
  selector 7/14/30/60 días. Mantiene el URL como source of truth.

### Flujo C — "Registrar fumigación manual"

**Pasos actuales** (escenario Marleny recuerda una fumigación del viernes):
1. Navega a /parcels/overdue (2 clicks) o busca en /parcels (3-4
   clicks).
2. Llega a /parcels/[id] (1 click).
3. Scroll abajo hasta la sección "Fumigación" (1-2 scrolls en mobile,
   0 en desktop si está visible).
4. Click "Registrar fumigación" (gateado por `RoleGate` — solo admin y
   supervisor, ver `components/parcels/parcel-fumigations.tsx:152`).
5. Llena el form: fecha (default hoy), producto, dosis, área, duración,
   operador, nota opcional. 7 campos, 4 obligatorios.
6. Click "Guardar fumigación" → POST /api/fumigations → `router.refresh()`.

**Tiempo total**: 60-90 seg si tiene todos los datos, 2-3 min si tiene
que consultar plan de vuelo o área fumigable.

**Fricciones detectadas**:
- **F1.8 (media)**: el form está en el medio de la página, no en un
  modal. En mobile, después de tipear 5 campos, el botón "Guardar" puede
  quedar fuera del viewport (no hay `sticky bottom-0` en el form —
  `components/parcels/parcel-fumigations.tsx:177-230`). El usuario
  scrollea para encontrar el botón, le pega a "Cancelar" por error.
- **F1.9 (baja)**: el form NO está pre-llenado con la cadencia ni con
  el último producto usado. Si la misma parcela siempre se fumiga con
  el mismo producto (típico en caña), el supervisor tiene que
  re-tipearlo. Memory: el `useEffect` no hidrata desde `events[0]`.
- **F1.10 (baja)**: cuando se guarda, la copy del botón cambia a
  "Guardando..." pero el resto del form NO se desactiva (solo el botón
  submit). El supervisor puede doble-clickear y crear 2 fumigaciones
  duplicadas. Memory: el `disabled` solo se aplica al botón submit
  (`components/parcels/parcel-fumigations.tsx:228`), no a los inputs.

**Propuesta**:
- **P1.C1 (S)**: convertir el form a un `<dialog>` modal o un
  `Sheet` lateral (mobile: bottom sheet, desktop: side sheet). Botones
  primarios siempre visibles en el footer del modal.
- **P1.C2 (XS)**: deshabilitar todos los inputs del form cuando
  `submitting === true` (no solo el botón submit).
- **P1.C3 (XS)**: pre-llenar `product_used` con el último valor del
  historial (`events[0]?.product_used ?? ""`). Es la fumigación más
  reciente, casi siempre es la misma.

### Flujo D — "Generar reporte para el cañero"

**Estado actual**: NO EXISTE un flujo de "generar reporte". El
audit `docs/audit/ui-ux-2026-07.md` §5.2 lo lista como gap (esfuerzo
M, impacto medio). Sigue abierto.

**Lo que hay hoy**:
- `/parcels/[id]` tiene botón "Exportar fumigaciones CSV" dentro de
  `components/parcels/parcel-fumigations.tsx:147` (gateado por
  `events.length > 0`).
- `/task-history` tiene `<ScreenshotButton>` en el header del sidebar
  (ver `tests/components/task-history/screenshot-button.test.tsx`).
- `/parcels` no tiene export.
- `/parcels/overdue` no tiene export.

**Fricciones detectadas**:
- **F1.11 (alta)**: el supervisor que va al campo el lunes y quiere
  llevarse "qué parcelas fumigamos esta semana" tiene que: abrir
  /task-history, ajustar rango a "últimos 7 días", screenshot, mandar
  por WhatsApp. El botón screenshot no es discoverable en el
  dashboard, está enterrado en el sidebar del task-history.
- **F1.12 (media)**: el export CSV desde /parcels/[id] solo exporta las
  fumigaciones (sin metadata de cadencia ni contexto del lote). Si el
  cañero pide "dame el parte de la parcela X", Marleny tiene que
  copiar a mano el área, la cadencia, y los datos del header.

**Propuesta**:
- **P1.D1 (M)**: agregar botón "Reporte para el cañero" en /parcels/[id]
  que abra un `<dialog>` con preview + 3 botones: "Imprimir (PDF)",
  "Exportar CSV (parte completo)", "Copiar resumen a WhatsApp". El
  "Imprimir" usa el `window.print()` con un `@media print` stylesheet
  que ya existe en muchos dashboards. Esfuerzo M porque requiere
  diseño del template del parte.
- **P1.D2 (S)**: en /task-history, hacer que el "Screenshot" se
  descargue como PNG con marca de agua "AeroAdmin AFM" + fecha — más
  profesional para enviar al cañero.

### Flujo E — "Editar metadata del lote"

**Pasos actuales** (escenario supervisor edita cultivo y propietario):
1. Click en sidebar "Parcelas" (1 click → /parcels).
2. Buscar la parcela (typing).
3. Click "Ver detalle" (1 click → /parcels/[id]).
4. En la sección "Contexto del lote" (columna derecha), click
   "Editar" (1 click — ver `components/parcels/parcel-detail.tsx:434`).
5. O alternativamente, arriba en la sección "Editar metadata", click
   el botón "Editar metadata" (1 click — `parcel-detail.tsx:185`).
6. Ambos abren el mismo `<ParcelEditPanel>` (estado lifted, ver
   `components/parcels/parcel-edit-panel.tsx:14`).
7. Llena 9 campos (nombre, tipo, cultivo, siembra, propietario,
   contacto, áreas, notas). Solo 1 obligatorio lógico (nombre).
8. Click "Guardar" → PUT /api/parcels/[id] → `router.refresh()`.

**Tiempo total**: 30-60 seg si tiene los datos a mano.

**Fricciones detectadas**:
- **F1.13 (media)**: hay **dos botones "Editar"** en la misma página
  que abren el mismo form (`parcel-detail.tsx:184` y
  `parcel-detail.tsx:434`). El supervisor se confunde: ¿son
  diferentes? ¿uno edita unas cosas y otro otras? La respuesta real
  es: son el mismo form, ambos abren el mismo `ParcelEditPanel`. Esto
  es deuda técnica del refactor (ver
  `components/parcels/parcel-detail.tsx:60-65`: "el botón "Editar" de
  la sección Contexto del lote pueda abrir el mismo editor que el
  botón "Editar metadata" del header"). **Decisión UX**: dejar UNO
  solo. Sugerencia: el del header (más visible), quitar el de la
  sección "Contexto del lote".
- **F1.14 (baja)**: el form no muestra el "DJI ID" (es readonly,
  viene de DJI), pero sí permite cambiar `land_name` — que es la
  identidad de la parcela. Riesgo: supervisor renombra "Suerte A-12"
  a "Lote del Río" y se pierde la referencia operativa original. El
  `land_name` debería ser readonly o requerir confirmación (es la
  clave operativa que el cañero usa para hablar de su finca).
- **F1.15 (baja)**: el form de edición es el mismo para 1 campo o 9.
  No hay modo "edición rápida" (solo nombre) vs "edición completa".
  El caso de uso más común ("solo completar el cultivo") obliga a
  abrir el form completo, scrollear, y guardar todo.

**Propuesta**:
- **P1.E1 (XS)**: dejar UN solo botón "Editar metadata" en el header
  de la sección "Contexto del lote" (no duplicado arriba). Mover el
  botón del header (línea 184) al footer de la sección "Contexto del
  lote" para que sea discoverable por contexto.
- **P1.E2 (S)**: separar `land_name` (readonly, o gateado por
  confirmación "el cañero conoce este nombre, ¿estás seguro?") del
  resto de metadata editable.
- **P1.E3 (M)**: agregar un "modo edición rápida" para los campos más
  comunes (cultivo, propietario, fecha de siembra) accesible inline en
  la sección "Contexto del lote", sin abrir el form completo.

---

## 3. Fricciones y dead ends (priorizadas)

### 🔴 Alta prioridad (impacto diario)

| # | Fricción | Dónde | Síntoma |
|---|---|---|---|
| F1.1 | Estado "PENDIENTE" mentiroso | `components/parcels/parcels-list.tsx:38` | Las 1207 fincas se ven iguales. Sin escaneo de prioridades. |
| F1.4 | Copy "Vencen esta semana" desalineada | `components/overdue/overdue-list.tsx:140` | Cambia la URL, no cambia el label. |
| F1.11 | Sin flujo "reporte para el cañero" | n/a (gap) | Marleny recurre a screenshot + WhatsApp. |
| F1.16 | Sidebar no muestra count de vencidas | `components/app-shell.tsx:119` | El supervisor no ve el "número que importa" sin entrar a /parcels/overdue. |

### 🟠 Media prioridad (impacto semanal)

| # | Fricción | Dónde | Síntoma |
|---|---|---|---|
| F1.2 | Búsqueda limitada a land_name/external_id | `components/parcels/parcels-list.tsx:80` | "Muérstrame las de caña de Carlos" no funciona. |
| F1.5 | Chip "En fecha" clickeable pero inútil | `components/overdue/overdue-list.tsx:152` | Gasta atención. |
| F1.6 | Sin contador de overdue en sidebar | `components/app-shell.tsx:119-141` | El bloque "Estado actual" solo tiene 2 contadores. |
| F1.8 | Form fumigación puede tapar el botón Guardar en mobile | `components/parcels/parcel-fumigations.tsx:177-230` | Doble submit, errores accidentales. |
| F1.9 | Form fumigación no pre-llena con último producto | `components/parcels/parcel-fumigations.tsx:177-230` | Re-tipeo innecesario. |
| F1.12 | Export CSV de /parcels/[id] no incluye metadata del lote | `components/parcels/export-fumigations-csv-button.tsx` | Marleny tiene que complementar a mano. |
| F1.13 | Dos botones "Editar" en la misma página | `components/parcels/parcel-detail.tsx:184,434` | Confusión sobre qué edita qué. |

### 🟡 Baja prioridad (impacto mensual / nice-to-have)

| # | Fricción | Dónde | Síntoma |
|---|---|---|---|
| F1.3 | Sort default por nombre (no por estado) | `components/parcels/parcels-list.tsx:62` | No optimiza para drill-down. |
| F1.7 | "Ventana: 14 días" no es accionable | `app/parcels/overdue/page.tsx:104` | URL-only. |
| F1.10 | Form fumigación no se bloquea al submit | `components/parcels/parcel-fumigations.tsx:177-230` | Doble submit posible. |
| F1.14 | `land_name` editable sin confirmación | `components/parcels/parcel-edit-panel.tsx:53` | Riesgo de romper identidad operativa. |
| F1.15 | Form único para 1 o 9 campos | `components/parcels/parcel-edit-panel.tsx:142-240` | Sobrecarga para edición simple. |

### ⚪ Dead ends (ya resueltos en sprint previo, NO reabrir)

- `app/history` está marcado deprecated y redirige a `/task-history` vía
  `next.config.js` (ver `app/history/page.tsx:8-12`). Pero el link
  "Ver historial operativo" en `/parcels/[id]` (`parcel-detail.tsx:476`)
  sigue apuntando a `/history` — **actualizar a `/task-history`**.
- Devices "+ Agregar dispositivo" sigue visible (ver
  `app/devices/page.tsx` — el audit 2026-07 §4.3 lo flageó, no veo
  fix aplicado). Re-confirmar y cerrar.
- Texto developer-facing en `parcel-detail.tsx` sección "Trazabilidad":
  YA fue removido (ahora es `ParcelFumigations` arriba). El
  `parcel-detail.tsx:188` ahora es un `<ParcelEditPanel>`, no la
  sección vieja. ✓ cerrado.

---

## 4. At-a-glance: ¿el dashboard cuenta la historia en 5 segundos?

**Test mental**: Don Horacio abre el panel el lunes 7am con café. Tiene
10 segundos antes de la primera llamada del día. ¿Qué se lleva?

**Lo que ve hoy** (orden de aparición, scroll down):

1. **Header sticky** — Logo "AeroAdmin AFM" + título "AeroAdmin AFM" +
   subtítulo del panel. ✓ Branding claro.
2. **Eyebrow + título + subtítulo del page** — "Panel de Control" /
   "AeroAdmin AFM" / "Resumen operativo de la fumigación con drones
   DJI Agras. Trazabilidad por día, alertas y cobertura por dron." ✓
   Dice qué es. Pero **no dice "qué pasó"**.
3. **Fila 1: 5 KPIs** (bento colSpan 2+2+2+3+3) — Registros, Área
   cubierta, Activos DJI, Alertas Altas, Atrasadas por cadencia.
   ✓ Visualmente prominentes. ✓ Los urgentes (Alertas, Atrasadas) son
   más anchos (colSpan 3). ✗ **No hay "Qué pasó ayer"**. El supervisor
   ve "Atrasadas: 5" pero no sabe si **ayer** fumigamos 0 ha o 50 ha.
4. **Filas 2-3: Upcoming + Alerts side-by-side** — Lista priorizada
   de próximas fumigaciones + panel de alertas paginado. ✓ Esta es la
   información accionable principal. ✓ El chip "Ver todas (N) →" en
   upcoming cubre el caso de más de 8 items.
5. **Fila 4: OperationsPanel** (full width) — Contiene:
   - **Reporte 2026** (panel oscuro): promedio área, promedio litros,
     mes más activo. ✓ Mismo color de fondo que el sidebar, buena
     jerarquía. ✗ **Es rollup del AÑO, no del día**. El supervisor que
     mira esto a las 7am está mirando datos agregados de meses.
   - **Acceso rápido**: 2 stats chicas (alerta dominante, activos
     renderizables) + botón "Ver mapa". ✓ Acceso rápido.
   - **Registro reciente**: filtro por alert level + export CSV.
     ✓ Pero son los mismos datos que el panel "Próximas fumigaciones"
     (filtrados por alert level vs por cadencia). Confuso.
   - **Sincronización DJI** (panel oscuro): totalAssets, maxAlertDays,
     work_time del último flight. ✗ **"Última operación: 2h 5min"** —
     eso es el **tiempo de vuelo** del último flight, no la fecha. El
     supervisor espera "ayer a las 3pm" y obtiene "2h 5min". Confuso.
   - **Resumen del periodo**: área acumulada, litros, días de riesgo.
     ✗ **Es OTRA repetición de los KPIs de la fila 1** (área y litros
     ya están arriba en "Área Cubierta" y en "Reporte 2026"). Triplicado.

**Diagnóstico**: el dashboard **no cuenta la historia del día**. Cuenta
tres historias agregadas (año, periodo, sync) y deja al usuario armar
el rompecabezas. Para un "7am con café", el dashboard necesita:

- **Bloque "Ayer"**: 1-2 fumigaciones, área total, "X ha fumigadas por
  N vuelos". Si no hay fumigaciones ayer: "Ayer no se fumigó" (empty
  state explícito, no silencio).
- **Bloque "Hoy"**: ¿hay fumigaciones programadas? Vinculo directo a
  /parcels/overdue filtrado por `next 24h`.

**Lo que SÍ funciona at-a-glance**:
- Los 5 KPIs de la fila 1 son excelentes: números grandes, tono de
  color correcto (verde/rojo), iconos claros. Marleny los lee sin
  esfuerzo.
- El chip "Atrasadas por cadencia" en rojo grande es la pregunta #1
  resuelta en un click.

---

## 5. Mobile: ¿qué se rompe?

### Lo que funciona en mobile (verificado por inspección de código)

- **Hamburger menu**: `components/mobile-sidebar-drawer.tsx` v1.2.
  Slide-in desde la izquierda, body overflow hidden al abrir, cierre
  por backdrop/Escape/navegación, foco vuelve al botón. ✓ Implementación
  correcta, accesibilidad básica presente.
- **Viewport meta tag**: `app/layout.tsx:18-22` — `width=device-width,
  initialScale: 1, viewportFit: cover`. ✓
- **/map en mobile**: `app/map/page.tsx:170-175` — `flex-col` con
  `min-h-[60vh]` para el mapa antes de apilar la sidebar. ✓ Patrón
  estándar.

### Lo que se rompe o se ve mal

- **F2.1 (alta)**: el header chip "actions" en mobile se renderiza
  (`app-shell.tsx:175` `<div className="sm:hidden">{actions}</div>`),
  pero en /parcels/[id] ese slot tiene los botones "Anterior" /
  "Siguiente" / "Ver timeline" (3 botones, ver
  `app/parcels/[id]/page.tsx:73-94`). En 360px de ancho, los 3 botones
  no entran sin wrap, y el header sticky los empuja fuera del viewport.
  Resultado: Marleny en mobile **no ve los botones de navegación entre
  parcelas** sin scrollear horizontal.
- **F2.2 (media)**: el form de "Registrar fumigación" en mobile no es
  un modal — es un bloque que aparece inline en la página. Después de
  tipear 5 campos, el botón "Guardar" puede quedar bajo el teclado
  virtual del celular. F1.8 (ya listada) + variante mobile.
- **F2.3 (media)**: el dashboard con 5 KPIs en bento `colSpan 2+2+2+3+3`
  en mobile colapsa a 1 columna (asumiendo que `BentoGrid` lo hace
  automáticamente — verificar `components/ui/bento-grid.tsx`). En mobile
  cada KPI ocupa el ancho completo, altura ~80px. **El bloque
  Upcoming + Alerts side-by-side en mobile se apila vertical**, lo que
  dobla el scroll. No es roto, pero el supervisor pierde el
  "alertas+y+upcoming en una mirada" — solo ve uno a la vez.
- **F2.4 (baja)**: el mini-mapa en /parcels/[id] carga con
  `dynamic(..., { ssr: false, loading: () => skeleton })` (ver
  `components/parcels/parcel-detail.tsx:12-19`). En mobile con señal
  mala, el skeleton puede persistir >5 seg. No hay timeout ni
  reintento visible.
- **F2.5 (baja)**: la tabla de /parcels en mobile se wrappea con
  `overflow-x-auto` (ver `parcels-list.tsx:142`). **El scroll
  horizontal dentro de una card es UX hostil en mobile** — el
  supervisor no sabe que la tabla sigue a la derecha. Mejor
  transformación a cards/list en mobile (responsive table pattern).
- **F2.6 (baja)**: el sidebar dark con 6 items + el bloque "Estado
  actual" tiene ~600px de alto en mobile drawer. Si Marleny abre el
  drawer en un celular de 6" (~700px viewport), tiene que scrollear
  dentro del drawer. No es roto, pero la primera impresión es
  "menú incompleto".

### Lo que falta para mobile

- **Sin gestos de swipe**: no hay swipe-right para abrir el drawer, ni
  swipe-left para cerrar. Sería un nice-to-have estándar en apps
  mobile.
- **Sin "Agregar a inicio" (PWA)**: el audit 2026-07 §4.8 lo marca
  como backlog (L). No se hace acá.

---

## 6. Empty states / loading / errores

### Empty states (auditados uno por uno)

| Vista | Estado vacío | Componente | Copy | OK? |
|---|---|---|---|---|
| /parcels | Sin parcelas | `<EmptyState>` en `parcels-list.tsx:107` | "Aún no hay parcelas para mostrar" + CTA "Ir al mapa" | ⚠️ El CTA lleva a /map que también está vacío. Dead end. |
| /parcels (con parcelas) | Sin matches de búsqueda | inline en `parcels-list.tsx:188` | "No hay parcelas que coincidan con la búsqueda." | ✓ |
| /parcels/overdue | 0 parcelas en la ventana | `overdue-list.tsx:175` | "No hay parcelas con cadencia vencida o próxima a vencer en los próximos 14 días." | ✓ Mensaje claro. |
| /parcels/overdue | 0 con filtro severity | `overdue-list.tsx:178` | "Ninguna parcela coincide con el filtro de severidad activo. Limpiá el filtro para ver todas." | ✓ |
| /parcels/[id] | Sin schedule | `parcel-fumigations.tsx:114` | "Esta parcela no tiene schedule de fumigación." (rojo) | ✓ |
| /parcels/[id] | Sin geometría | `parcel-detail.tsx:265` | "Esta parcela no tiene geometría cargada." | ✓ |
| /parcels/[id] | Sin fumigaciones (admin) | `<EmptyState>` con CTA en `parcel-fumigations.tsx:265` | "Esta parcela aún no tiene fumigaciones" + CTA "Registrar fumigación" | ✓ |
| /parcels/[id] | Sin fumigaciones (viewer) | `<EmptyState>` sin CTA en `parcel-fumigations.tsx:255` | "Esta parcela aún no tiene fumigaciones" | ✓ |
| /parcels/[id]/timeline | Sin eventos | (no leí el componente, verificar `parcel-timeline.tsx`) | probable inline | ⚠️ |
| /task-history | Sin días en rango | (TaskHistoryClient) | probable inline | ⚠️ |
| /map | Sin parcelas | `<EmptyState>` en `map-view.tsx:75` | "Aún no hay parcelas para mostrar" + CTA "Ver listado de parcelas" | ✓ (mejor que /parcels porque el CTA lleva a algo poblado eventualmente) |
| /map | Sin fumigadas en 6m | (no aplica, siempre hay polígonos) | n/a | n/a |
| /dashboard | Sin fumigaciones en el sistema | NO TIENE empty state global | El dashboard renderiza KPIs en 0s sin contexto | ❌ |
| /devices | n/a (datos hardcoded) | "Próximamente" banner | "Módulo en construcción. Volvé pronto." | ⚠️ No es empty state, es banner decorativo |
| /history | Sin datos | "Sin fumigaciones en este rango" (probable) | probable | ⚠️ |

**Diagnóstico empty states**:
- ✓ Hay patrón `<EmptyState>` reutilizable (`components/ui/empty-state.tsx`)
  y se usa bien en 7 lugares.
- ❌ El dashboard es la única página con datos críticos que **no tiene
  empty state global**. Si el supervisor nuevo abre el panel con BD
  vacía, ve 5 KPIs en 0 + "Sin alertas activas" + "Sin fumigaciones
  próximas" + "Reporte 2026" con N/A — **no sabe que tiene que
  importar datos primero**.
- ⚠️ /parcels empty CTA "Ir al mapa" es un dead end (el mapa también
  está vacío). Cambiar CTA a "Cómo importar datos" que abre un modal
  o link a docs/guia.

### Loading states

| Vista | Loading | Archivo | OK? |
|---|---|---|---|
| /parcels/overdue | `<loading.tsx>` skeleton | `app/parcels/overdue/loading.tsx` (1311 bytes) | ✓ |
| /parcels/[id]/timeline | `<loading.tsx>` skeleton | `app/parcels/[id]/timeline/loading.tsx` (1204 bytes) | ✓ |
| /map | `<loading.tsx>` skeleton | `app/map/loading.tsx` (1337 bytes) | ✓ |
| /task-history | `<loading.tsx>` skeleton | `app/task-history/loading.tsx` (911 bytes) | ✓ |
| /parcels | NO TIENE loading.tsx | n/a | ❌ Server component, igual requiere loading en navegación cliente |
| /history | NO TIENE loading.tsx | n/a | ❌ Igual |
| /parcels/[id] | NO TIENE loading.tsx | n/a | ❌ |
| /devices | NO TIENE loading.tsx | n/a | ❌ |
| Mini-mapa en /parcels/[id] | dynamic import con skeleton | `parcel-detail.tsx:13-19` | ✓ |
| Mapa principal en /map | dynamic import con skeleton | `map-view.tsx:9-17` | ✓ |

**Diagnóstico loading**:
- ✓ 4/9 páginas tienen `<loading.tsx>` (los layouts complejos: map,
  timeline, overdue, task-history).
- ❌ 5/9 páginas NO tienen `<loading.tsx>`. La inconsistencia es visible
  cuando Marleny navega de /parcels/overdue (con skeleton) a /parcels
  (sin skeleton): la primera se siente "más rápida" porque comunica
  progreso, la segunda se siente "colgada" aunque sea igual de rápida.
- **P3.1 (XS)**: agregar `<loading.tsx>` skeletons a /parcels, /history,
  /parcels/[id], /devices. Reutilizar el patrón de
  `app/parcels/overdue/loading.tsx` (cards de 2-3 líneas con shimmer).

### Error states

| Vista | Error | Comportamiento | OK? |
|---|---|---|---|
| Cualquier page | Error de query / DB | `<error.tsx>` global | `app/error.tsx` (2138 bytes) | ✓ existe, no leí contenido |
| Auth (login) | Credenciales inválidas | `app/login/actions.ts` (no leído) | probable: mensaje user-friendly | ⚠️ |
| POST /api/fumigations | Error validación | `components/parcels/parcel-fumigations.tsx:99-102` | "Error: {error}" inline | ✓ |
| PUT /api/parcels/[id] | Error | `components/parcels/parcel-edit-panel.tsx:91-95` | "Error: {error}" inline | ✓ |
| 404 parcela | `notFound()` | `app/parcels/[id]/page.tsx:30` | renderiza `app/not-found.tsx` | ✓ existe (1248 bytes) |
| DJI sync (stale URL, expired S3) | No hay UI de error en el panel | el sistema depende del backend sync | ⚠️ Si el sync falla por 24h+, no hay forma visible en el panel |

**Diagnóstico error states**:
- ✓ Hay manejo de errores uniforme en formularios (inline rojo con el
  mensaje del backend).
- ❌ No hay un banner global "DJI Sync está fallando" si el último
  fetch tiene >24h. El supervisor asume que todo está actualizado.
  Memory: hay un memory entry "DJI AG signed S3 URLs have ~12h TTL" —
  el sistema **ya sabe** que el sync puede romperse, pero no comunica
  al usuario cuándo.

---

## 7. Mejoras priorizadas (con esfuerzo y valor)

| # | Mejora | Esfuerzo | Valor | Problema que resuelve |
|---|---|---|---|---|
| **M1** | Reemplazar chip "PENDIENTE" mentiroso en /parcels por dot de color (verde/amarillo/rojo) basado en `days_since_last_fumigation` | **S** | Alto | F1.1: las 1207 fincas se ven iguales. |
| **M2** | Agregar "Qué pasó ayer" como card propia en el dashboard (1-3 fumigaciones + área total del día anterior) | **S** | Alto | F4.0: el dashboard no cuenta la historia del día. |
| **M3** | Empty state global del dashboard cuando totalFlights=0 + overdue=0 + highAlerts=0 (banner grande con CTA "Cómo importar datos") | **XS** | Alto | F12: usuario nuevo no sabe cómo empezar. |
| **M4** | Agregar contador "Vencidas: N" en el sidebar (debajo de "Alertas altas") | **S** | Alto | F1.16: el número que importa no está visible desde el sidebar. |
| **M5** | Convertir "Registrar fumigación" de inline form a modal/bottom-sheet (mobile-friendly) | **M** | Alto | F1.8 + F2.2: el form actual se rompe en mobile. |
| **M6** | Botón "Reporte para el cañero" en /parcels/[id] con preview + 3 acciones (PDF/CSV/WhatsApp) | **M** | Alto | F1.11 + F1.12: gap documentado desde audit 2026-07. |
| **M7** | Renombrar chip "Vencen esta semana" → "Vence pronto (≤Nd)" dinámico, y hacer "En fecha" no-clickeable | **XS** | Medio | F1.4 + F1.5: copy desalineada y chip confuso. |
| **M8** | Quitar el botón duplicado "Editar metadata" del header de /parcels/[id] (dejar solo el de la sección "Contexto del lote") | **XS** | Medio | F1.13: 2 botones = confusión. |
| **M9** | Cambiar "Ver historial operativo" en /parcels/[id] → /task-history (no /history deprecado) | **XS** | Bajo | link roto a página deprecated. |
| **M10** | Pre-llenar form fumigación con `product_used` del último evento (default si no hay) | **XS** | Medio | F1.9: re-tipeo innecesario del mismo producto. |
| **M11** | Agregar `<loading.tsx>` skeletons a /parcels, /history, /parcels/[id], /devices | **XS** | Medio | F3.1: inconsistencia de loading. |
| **M12** | Banner "Última sync DJI: hace Xh" en el header (si >24h, en rojo) | **S** | Alto | Error state de sync roto no se comunica. |

### Plan de aplicación recomendado (3 sprints de 1 día cada uno)

- **Sprint "Quick Wins" (1 día)**: M3, M7, M8, M9, M10, M11. Todo XS,
  cierra 6 fricciones de baja-media con cambios puramente de copy /
  layout. Estimado: 3-4 horas.
- **Sprint "Diario" (2-3 días)**: M1, M2, M4, M12. Cambios S que
  atacan las 3 preguntas principales del supervisor: "¿qué pasó ayer?",
  "¿qué está vencido?", "¿qué parcelas necesitan atención?". Requieren
  queries nuevas o cambios de layout.
- **Sprint "Mobile + Reportes" (3-5 días)**: M5, M6. Los 2 cambios M
  que cierran los gaps mobile y de reportes al cañero.

---

## 8. Lo que NO se debe hacer (tentaciones a evitar)

- **No construir NDVI / imágenes satelitales / prescripción** (audit
  2026-07 §8 marca como "out of scope"). El usuario lo pidió en algún
  momento pero el sprint actual no lo incluye. El sistema es admin /
  GIS, no agronomía. La tentación de meter un toggle de capas
  satelitales es real (M3-M5 ya metió flight plans) — pero cada capa
  nueva agrega complejidad de UI sin valor inmediato para el caso de uso
  primario.
- **No hacer multi-tenant / auth nuevo** (decisión PO 2026-07-21
  confirmada: single-tenant, 2 roles admin/supervisor, ver
  `docs/audit/BITACORA.md` Q4 v1.4). El RBAC actual es suficiente.
  Cualquier propuesta de "agregar rol X" o "aislar datos por
  organización" es scope creep.
- **No construir vista móvil nativa (PWA / React Native / Capacitor)**.
  El responsive actual cubre 80% del caso. El operador en campo ya tiene
  un atajo: la app nativa de DJI. El panel admin no necesita offline.
  Audit 2026-07 §4.8 confirma: prioridad baja.
- **No agregar notificaciones push / email / SMS**. La spec lo lista
  como M2 (notificaciones) y no está en este sprint. El "estado actual"
  en el sidebar es la única notificación pasiva que necesita el
  supervisor.
- **No construir dashboard personalizable (drag-and-drop de cards)**.
  El layout bento actual es deliberado: KPIs urgentes arriba, upcoming
  + alerts al medio, rollup del año abajo. Personalizar lo rompe y
  agrega 2-3 sprints de UI sin valor.
- **No agregar "filtros guardados" ni "vistas personalizadas"** en /parcels.
  La búsqueda + sort + paginación cubren 95% del uso. Los filtros
  guardados los piden los power users, no los operadores diarios.
- **No construir editor visual de polígonos / spray zones**. La
  geometría viene de DJI, no se edita. El botón "Editar" de
  /parcels/[id] es para metadata textual, no espacial.
- **No agregar telemetría de dron en vivo (lat/lng/altura actual)**.
  El panel es admin, no consola de piloto. Si el dueño quiere saber
  "qué está haciendo el dron ahora", mira la app de DJI. El panel
  muestra **resultado** (qué se fumigó), no **proceso** (qué está
  volando).
- **No expandir el sidebar a >6 items**. Hoy tiene 6 (Panel, Mapa,
  Historial, Parcelas, Faltan, Dispositivos). Cualquier nueva sección
  (e.g. "Clientes", "Inventario de productos", "Reportes") debe
  ganarse su lugar en el menú — y hoy no hay demanda real. La
  proliferación de items mata la jerarquía visual.

---

## 9. Una observación meta (no parte del review original)

Esta review cubre la foto del 2026-07-22, 3 días después del audit
2026-07-19. De los 13 hallazgos del audit anterior:

- **Cerrados en sprints recientes** (v1.4 → v1.7): #1, #2, #4, #6, #7,
  #9 (AppShell en /task-history, Próximas fumigaciones visibles,
  unificar KPI alertas, redirect /history, texto dev-facing en parcel
  detail, sidebar expone Parcelas y Faltan, búsqueda de cadencia).
- **Sigue abiertos** (este review los re-flaguea): #8 (filtro
  Agriculture), #10 (export CSV desde /parcels/[id]), #11 (campo
  notes en fumigaciones — CERRADO en v1.4, verificado en
  `parcel-fumigations.tsx:151`), #12 (dark mode — backlog), #13
  (devices "+ Agregar" — sigue ahí, no veo fix).

**Tasa de cierre del audit anterior**: ~70%. **Hallazgos residuales**:
3-4 de los 13 originales, más 15 nuevos descubiertos en este review.
El sprint velocity es alto; el back-log de UX es chico y manejable.

La próxima review (post-v1.8 o post-v2.0) debería auditar:
- (a) si el dashboard cuenta la historia del día (M2 de este review).
- (b) si el flow mobile mejoró con el form modal (M5).
- (c) si hay nuevas fricciones descubiertas en el flow del reporte al
  cañero (M6).
