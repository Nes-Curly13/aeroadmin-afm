# DeepSeek — Tareas de UI/UX para agentes MiniMax (muy específicas)

> **Origen**: revisión visual (a nivel código/estructura) de todas las páginas
> y módulos, 2026-09-13, master `be0a994`.
> **Audiencia**: agentes MiniMax que ejecutan **una** tarea por vez.
> **Contexto**: `docs/DEEPSEEK-COORDINATION.md` §0 (protocolo) + §3.

---

## 0. Reglas DURAS para el agente (leer antes de tocar)

1. Editá **SOLO** los archivos del scope de tu tarea. Si necesitás otro archivo, PARÁ y reportá.
2. **NO** cambies lógica de datos, queries SQL, fetch, contratos de props, ni la firma de funciones. Estas tareas son **visuales/CSS/texto** salvo que digan explícitamente lo contrario.
3. **NO** renombres archivos, componentes, rutas, ni `data-testid`. **NO** muevas componentes de server a client ni al revés.
4. **NO** instales dependencias. **NO** agregues librerías.
5. **NO** cambies `components/ui/*` (primitives) salvo que la tarea lo pida.
6. **NO** toques `api/**`, `lib/db.ts`, `proxy.ts`, `lib/auth*` en tareas visuales.
7. **PROHIBIDO** `git reset --hard` / `git checkout -- .` / `git stash` / `git add -A`. Stageá solo tus archivos.
8. Gates: `npx tsc --noEmit` + `npx vitest run <test-de-tu-archivo>` (si existe). Si el archivo no tiene test, alcanza `tsc` + descripción de la verificación visual.
9. Un commit por tarea: `tipo(scope): UI-XX descripción`.
10. Si algo no cierra (no encontrás el string, el archivo cambió, etc.): **reportá bloqueado**, NO improvises.

> **Regla anti-rotura**: si dudás, hacé el cambio **mínimo** y agregá un
> comentario `// UI-XX: ...`. No refactorices "de paso".

---

## 1. P0 — Bugs funcionales (hacer primero, alto impacto)

### UI-P0-1 — `HealthPanel` crashea si `health.status === "unknown"` ✅ `d4ef40f`
- **Archivo**: `components/dashboard/health-panel.tsx` (y `components/dashboard/health-panel.tsx:14`)
- **Problema**: `const Ui = STATUS_UI[health.status]` donde `STATUS_UI` solo mapea `ok|partial|error`. `AppShell` sí contempla `unknown` → si el health viene `unknown`, `Ui.icon` revienta y tumbla el dashboard.
- **Cambio**: agregar una entrada `unknown` (y un fallback defensivo `STATUS_UI[health.status] ?? STATUS_UI.unknown`) con un icono neutro (`HelpCircle` o `Activity`) y clases `bg-muted text-muted-foreground`.
- **NO tocar**: la estructura del componente ni el resto de los estados.
- **Aceptación**: renderiza sin crashear para los 4 estados (`ok/partial/error/unknown`).
- **Verificación**: `npx tsc --noEmit` + test de health-panel si existe.

### UI-P0-2 — Link `import_excel` roto en `/admin/applications` ✅ `2f4169d`
- **Archivos**: `app/(auth)/admin/applications/page.tsx:115` (el `href="/fumigaciones?source=import_excel"`) + `lib/fumigaciones-filters.ts:61-66` (`parseSource`).
- **Problema**: `parseSource` solo acepta `dji|manual|import`; `import_excel` devuelve `null` → el link muestra TODAS las fumigaciones, no las importadas.
- **Cambio**: mapear `import_excel` → la fuente correcta que usa el data-loader (revisar cómo se guarda `source` de las importadas; probablemente `"import"`). Si el data-loader filtra por `source="import"`, el href debe ser `/fumigaciones?source=import`. Cambiar **solo el href** (no tocar `parseSource` salvo que sea necesario y esté claro).
- **NO tocar**: la tabla ni las KPIs.
- **Aceptación**: el link filtra correctamente las importadas del Excel.
- **Verificación**: `npx vitest run tests/lib-fumigaciones-filters.test.ts` (o el test existente) + click manual.

### UI-P0-3 — `/admin/calidad` puede mostrar "dataset limpio" falso ✅ `bdc37c2`
- **Archivo**: `app/(auth)/admin/calidad/page.tsx:36-54` (`fetchAllWarnings`).
- **Problema**: usa `process.env.NEXTAUTH_URL ?? "http://localhost:3000"` para llamarse a sí mismo; en prod sin esa var falla y devuelve `[]` → la UI dice "Sin alertas — el dataset está limpio" (falso negativo).
- **Cambio**: en error, NO devolver `[]` silenciosamente. Reemplazar por `null`/flag `error` y renderizar un card de error ("No se pudo consultar la calidad de datos. Reintentá."). Mantener el caso "sin warnings" real como "Sin alertas".
- **NO tocar**: el render de la lista de warnings.
- **Aceptación**: distinguir "sin datos por error" de "dataset limpio".
- **Verificación**: `npx tsc --noEmit` + revisar que el estado vacío real siga funcionando.

### UI-P0-4 — Reportes: PDF/CSV con `href=""` para supervisor ✅ `9d8de48`
- **Archivos**: `app/(auth)/reportes/page.tsx:112-117` (`pdfHref`/`csvHref` vacíos) + `components/reports/reports-form.tsx:179,190`.
- **Problema**: para no-admin los hrefs son `""` y `<a href="">` recarga la página (no descarga).
- **Cambio**: si no hay href, **no renderizar** los botones de descarga (o renderizarlos `disabled` con `title="Solo admin"`). No dejar `<a href="">`.
- **NO tocar**: la lógica de tabs ni las queries.
- **Aceptación**: supervisor no ve links que recargan; admin sí descarga.
- **Verificación**: `npx tsc --noEmit` + revisar rol supervisor visualmente.

### UI-P0-5 — Búsqueda de `/admin/parcels` solo filtra la página actual ✅ `5746872`
- **Archivo**: `app/(auth)/admin/parcels/admin-parcels-client.tsx:199-213` (`filtered`).
- **Problema**: filtra las ~50 filas del `initialData` local; buscar "Palmira" no toca el resto de las 1213. El `?q=` del server nunca se actualiza al tipear.
- **Cambio**: ⚠️ **Tarea de mayor riesgo** — requiere revisar el contrato server (`app/(auth)/admin/parcels/page.tsx` + repo). Hacer que la búsqueda dispare una navegación server-side (`router.push` con `?q=` + debounce) **o** documentar por qué no se puede y escalar. **Si no está 100% claro, NO lo hagas: reportá bloqueado.**
- **NO tocar**: la edición inline ni los PATCH.
- **Aceptación**: buscar filtra sobre el dataset completo.
- **Verificación**: `npx vitest run tests/components/admin/parcels/*` (si existe) + prueba manual.

**Implementado en `5746872`**: `api/repositories.ts` agrega `q` a `DjiParcelsFilter` con ILIKE sobre 6 columnas (`land_name`, `external_id`, `client_name`, `farm_name`, `municipality`, `variety`); `hasFilter` trata `q` no-vacío como activador del camino uncached (el cache no soporta filtros). `page.tsx` pasa `q` al filter. `admin-parcels-client.tsx` agrega `useEffect` con debounce 300ms + `router.push("/admin/parcels?q=...&page=1")` cuando el local state cambia. Tests nuevos: `tests/api-repositories-parcels-q-filter.test.ts` (5 tests: ILIKE sobre 6 cols, q vacío cae al cache, whitespace treated as empty, combinación con `missingClientName`, verificación de que `q` activo va por uncached).

---

## 2. P1 — UX por página (bajo riesgo, alto valor)

### UI-01 — Dashboard: `RecentActivity` sin límite ni estado vacío ✅ `899951a`
- **Archivo**: `components/dashboard/recent-activity.tsx` + `app/(auth)/page.tsx:203-206`.
- **Cambio**: mostrar solo las **N=8 más recientes** (`.slice(0, 8)`) y agregar "Ver todas →" a `/fumigaciones`. Si `fumigations` está vacío, mostrar un párrafo "Sin aplicaciones registradas.".
- **NO tocar**: la estructura de la Card ni el mapeo de campos.
- **Verificación**: `npx vitest run tests/components/dashboard/*`.

**Cerrado en `899951a`**: `RECENT_LIMIT = 8`, slice antes del render, empty state "Sin aplicaciones registradas.", link "Ver todas" en CardHeader cuando `fumigations.length > RECENT_LIMIT`.

### UI-02 — Dashboard: `PageHeader` con fecha "`Datos al {NOW}`" falsa
- **Archivo**: `components/page-header.tsx:21` (usa el constante `NOW`).
- **Cambio**: quitar esa línea o reemplazar `NOW` por un timestamp real del render (`new Date()`) formateado con `fmtDateTime`. **Ojo**: si `page-header` es server, `new Date()` es válido.
- **NO tocar**: el resto del header.

### UI-03 — AppShell: bloque "Pipeline DJI AG" nunca aparece
- **Archivos**: `app/(auth)/layout.tsx:28` (monta `<AppShell>` sin `health`) + `components/app-shell.tsx:109-124`.
- **Problema**: `health` es opcional y nadie lo pasa → el indicador es inalcanzable.
- **Cambio (mínimo)**: pasar `health` en `app/(auth)/layout.tsx` llamando a lo que ya usa el dashboard (revisar cómo obtiene `health` `app/(auth)/page.tsx`) **o** si eso implica queries pesadas en el layout, en su lugar **quitar** el bloque muerto y su JSDoc para no confundir. **Elegir la opción de menor riesgo y explicarla en el commit.**
- **NO tocar**: logout ni nav.

### UI-04 — Login: inputs nativos e inconsistencias ✅ `c72225c`
- **Archivo**: `app/(public)/login/page.tsx:144-171`.
- **Cambio**: reemplazar los `<input>` crudos por el primitive `Input` de `components/ui/input.tsx` (o igualar clases: `h-9` uniforme NO, usar el `h-8` del primitive). Corregir "Iniciar sesion" → "Iniciar sesión". No tocar la lógica de submit/CSRF.
- **Frágil**: NO cambiar el flujo de `fetch` a `/api/auth/*` ni `window.location.href = "/"`.
- **Verificación**: `npx vitest run tests/components/login-page.test.tsx`.

### UI-05 — Parcelas: columna "Eventos" confusa (`12 / 3 v`)
- **Archivo**: `components/parcels/parcels-table.tsx:250-253`.
- **Cambio**: aclarar el encabezado y el contenido, p. ej. header "Fumigaciones / Vuelos" y celda `12 / 3` con `title` explicativo. O separar en dos columnas. Mantener los valores.
- **NO tocar**: orden/filtros.

### UI-06 — Parcelas: filtros sin "Limpiar"
- **Archivo**: `components/parcels/parcels-table.tsx` (barra de filtros ~148-215).
- **Cambio**: agregar un botón "Limpiar" (variant outline, size sm) que resetee búsqueda + cliente + estado a default, visible solo si hay algún filtro activo.
- **NO tocar**: la lógica de filtrado.

### UI-07 — Fumigaciones: "Limpiar" aparece solo para algunos filtros
- **Archivo**: `app/(auth)/fumigaciones/fumigaciones-table.tsx:246`.
- **Cambio**: la condición debe incluir también `search`/`source`/tipo (hoy solo `from/to/parcel/drone`). Mostrar "Limpiar" si CUALQUIER filtro está activo.
- **NO tocar**: los filtros server-side ni `buildPageUrl`.

### UI-08 — Fumigaciones: reemplazar controles crudos por primitives
- **Archivo**: `app/(auth)/fumigaciones/page.tsx:116-245`.
- **Cambio**: usar `Input`/`FieldSelect`/`Button` del design system en la barra de filtros (hoy `<input>/<select>/<button>` con `h-8`). Agrupar los 8 controles en 2 filas legibles.
- **NO tocar**: los `name` de los inputs (el form es GET server-side) — si cambiás el markup, preservá `name`/`defaultValue`.
- **Verificación**: `npx vitest run tests/app-fumigaciones-data-loader.test.ts` + tsc.

### UI-09 — Wizard nueva fumigación: emoji de error y unidades ✅ `f350682`
- **Archivo**: `components/admin/fumigations/new-fumigation-page-client.tsx:348` (emoji ⚠️) y `:775` (área en m²).
- **Cambio**: reemplazar el emoji por `<AlertTriangle>` de lucide; mostrar el área del ConfirmStep en **hectáreas** (usar `fmtDec(area/10000)`), consistente con el resto.
- **NO tocar**: el handle imperativo del form ni los steps.

**Cerrado en `f350682`**: span emoji ⚠️ → `<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />`; SummaryRow área: `${area} m²` → `${(Number(area) / 10000).toFixed(2)} ha` con fallback `—` si vacío/0.

### UI-10 — Geovisor: sin título y filtros no colapsables en mobile
- **Archivos**: `app/(auth)/geovisor/page.tsx` + `components/geovisor/geovisor-client.tsx:276,493`.
- **Cambio**: agregar `PageHeader` (título "Geovisor") **o** al menos un título visible; y hacer que el botón mostrar/ocultar filtros sea visible también en mobile (quitar `hidden ... lg:inline-flex` y aplicar el estado a todos los breakpoints).
- **Frágil**: NO tocar el contrato `payload: GeovisorPayload` ni el mapa (`geo-map.tsx`).

### UI-11 — Reportes: header inconsistente y `fmtDec2` duplicado
- **Archivos**: `app/(auth)/reportes/page.tsx:50` + `components/reports/fumigations-table.tsx:32` + `components/reports/farms-table.tsx:13`.
- **Cambio**: usar `fmtDec` de `lib/format` en lugar de los `fmtDec2` locales (eliminar los 3 helpers duplicados). No cambiar el header propio si eso implica riesgo; **opcional**.
- **NO tocar**: las queries ni las tabs.

### UI-12 — Admin landing: no mostrar el `href` crudo ✅ `87b582c`
- **Archivo**: `app/(auth)/admin/page.tsx:97-100`.
- **Cambio**: quitar el `<p>{href}</p>` (mostrar solo título + descripción) y suavizar textos técnicos ("source='import_excel'" → "del Excel"; "5 patrones de data quality" → "problemas de calidad de datos").
- **NO tocar**: los `href` de los links.

**Cerrado en `87b582c`**: removido el `<p>{href}</p>`; "5 patrones de data quality" → "Problemas de calidad de datos en el dataset"; "source='import_excel'" → "del Excel". Test `app-auth-admin-landing.test.tsx` actualizado en `869d6b7` para reflejar la nueva shape (queryByText NOT toBeInTheDocument).

### UI-13 — Admin/parcels: sin estado vacío y error truncado
- **Archivo**: `app/(auth)/admin/parcels/admin-parcels-client.tsx` (tbody ~570-774; error `:740-745`).
- **Cambio**: si `filtered.length === 0`, renderizar una fila `<td colSpan={N}>Sin parcelas que coincidan.</td>`; mostrar el error completo en `title` y no truncar el texto visible a 32 chars (o mostrar "Error" + title).
- **NO tocar**: la edición inline ni los PATCH.

### UI-14 — Nueva parcela: label "Tipo" duplicado (bug QA-10) ✅ `41c5b22`
- **Archivo**: `components/admin/parcels/new-parcel-form.tsx:442-457`.
- **Problema**: el `<label>` externo con `<span>Tipo *</span>` envuelve un `FieldSelect label="Tipo"` que ya renderiza su label → "Tipo" dos veces.
- **Cambio**: quitar el `<span>Tipo *</span>` externo (dejar el label del `FieldSelect`). Mismo patrón que se corrigió en `register-fumigation-form`.
- **Verificación**: `npx vitest run tests/components/admin/parcels/new-parcel-form.test.tsx`.

**Cerrado en `41c5b22`**: removido el `<label>` externo; `FieldSelect` queda como label nativo. `required` se pasa al FieldSelect para preservar el asterisco de requerido.

### UI-15 — Importador GIS: límite de tamaño y drop zone
- **Archivo**: `components/admin/parcels/import-gis-wizard.tsx:311` (texto "hasta 100 MB") + drop zone ~284-295.
- **Cambio**: aclarar el límite real por formato en el texto (o un tooltip). Agregar highlight visual al arrastrar (`onDragOver` → set state) y `tabIndex={0}` a la drop zone. No tocar el parsing.
- **Verificación**: `npx tsc --noEmit`.

### UI-16 — Reglas fitosanitarias: labels legibles y confirmación
- **Archivo**: `components/admin/phase-rules-editor.tsx:19-29` (slugs) + `:92-111`.
- **Cambio**: mostrar etiquetas en español en los `<option>` (value = slug, label = texto: "Establecimiento", "Herbicida", "Pre-emergente", etc.). Agregar `window.confirm` en `onDelete`. Reemplazar `window.location.reload()` por `router.refresh()`.
- **NO tocar**: las llamadas a la API ni los campos.

---

## 3. Transversales (una por vez, scope acotado)

### UI-T1 — Contraseña: mostrar/ocultar en login (optativo)
- **Archivo**: `app/(public)/login/page.tsx`. Agregar un botón de tipo `button` con `Eye`/`EyeOff` que togglea `type` del input. Sin librerías.

### UI-T2 — Textos sin tildes / jerga dev
- **Archivos**: `app/(public)/login/page.tsx:139` ("sesion"), `app/(auth)/admin/applications/page.tsx:75` ("pagina..."), `app/(auth)/parcelas/[id]/page.tsx:458-464` (tip `POST /api/admin/cycles/backfill`), `app/(auth)/admin/applications/page.tsx:122` (`scripts/...js`).
- **Cambio**: tildes correctas y reemplazar jerga por texto de usuario ("el sistema calculará el ciclo automáticamente"). **No cambiar comportamiento.**

### UI-T3 — `PageSpinner` con "A" de texto en vez del logo
- **Archivo**: `components/ui/loading.tsx` (~239).
- **Cambio**: reemplazar la "A" por `<AfmMark variant="mark" size={32} />` (importar de `@/components/brand/afm-mark`). **Verificar** que `loading.tsx` sea server-safe (AfmMark usa `next/image`, OK). Si `PageSpinner` es client, `AfmMark` también se puede usar.

### UI-T4 — Confirmaciones destructivas unificadas
- **Archivos**: `app/(auth)/fumigaciones/fumigaciones-table.tsx:172,215`, `components/fumigations/delete-fumigation-button.tsx:54`, `components/fumigations/invoices-card.tsx:92`.
- **Cambio**: dejar `window.confirm` si ya está (NO introducir modales nuevos sin diseño). Solo mejorar el **texto** de confirmación para que sea claro en español. Bajo riesgo.

### UI-T5 — `fmtDec2` duplicado
- **Archivos**: `app/(auth)/reportes/page.tsx:50`, `components/reports/fumigations-table.tsx:32`, `components/reports/farms-table.tsx:13`.
- **Cambio**: eliminar y usar `fmtDec`/`fmtInt` de `lib/format` (locale `es-CO`). Cuidado con decimales: verificar que el output visual no empeore.

---

## 4. Cómo verificar (obligatorio)

```bash
npx tsc --noEmit
npx vitest run <test-de-tu-archivo>   # si existe
# Verificación visual: describí en el commit qué viste (antes/después)
```

- Si la tarea toca un `page.tsx` server, corré además el test de la página si existe.
- Si NO hay test del archivo, igual corré `tsc` y **describí** la verificación visual en el reporte.
- Reportá con el formato de `docs/DEEPSEEK-AGENT-PROMPT.md`.

---

## 5. Orden sugerido (tandas)

- **Tanda 1 (P0)**: ✅ cerradas — UI-P0-1 (`d4ef40f`), UI-P0-2 (`2f4169d`), UI-P0-3 (`bdc37c2`), UI-P0-4 (`9d8de48`), UI-P0-5 (`5746872`).
- **Tanda 2 (UX)**: ✅ cerradas (sesión 2026-09-13) — UI-01 (`899951a`), UI-04 (`c72225c`), UI-05+UI-06 (`2e172ac`), UI-07 (`3fa7148`), UI-09 (`f350682`), UI-12 (`87b582c`), UI-14 (`41c5b22`). Test fix de UI-12 en `869d6b7`.
- **Tanda 3 (UX)**: ✅ cerradas (sesión 2026-09-13) — UI-08 (`c475159`), UI-10 (`23033a5`), UI-11 (`d774b43` + test fix `00d6172`), UI-13 (`369a82a`), UI-15 (`d620c79`), UI-16 (`5c0706a`).
- **Tanda 4 (transversal)**: ⬜ abiertas — UI-T1, UI-T2, UI-T3, UI-T4, UI-T5.

> Las lanes son por archivo. Dos tareas que tocan el MISMO archivo van en
> tandas distintas (no en paralelo).
