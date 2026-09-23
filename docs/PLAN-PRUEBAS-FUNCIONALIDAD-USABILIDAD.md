# Plan de Pruebas de Funcionalidad y Usabilidad — AeroAdmin AFM

> **Propósito:** documento de evidencia para la **sustentación** del proyecto y para
> dejar formalizado cómo se valida la plataforma (funcional + usabilidad). Complementa
> `docs/UI-AUDIT.md` (auditoría de UI) y `docs/SDD.md`/`docs/TDD.md` (diseño).
>
> **Estado:** Release Candidate (post auditoría de UI + correcciones). Baseline técnico:
> `tsc` 0 · `arch:check` 0 · `npm test` 2340 verdes · `npm run build` ✓.

---

## 1. Objetivo y alcance

1. Verificar que **todas las funcionalidades** de AeroAdmin AFM operan según lo esperado
   (casos normales y bordes), con criterios de aceptación explícitos.
2. Evaluar la **usabilidad** con los perfiles reales (operador fumigador, supervisor,
   administrador/topógrafo), midiendo éxito de tarea, tiempo, errores y satisfacción (SUS).
3. Producir **evidencia trazable** (requisito → caso → resultado) para el documento de
   sustentación.

**En alcance:** login/roles, dashboard, parcelas, ciclos/fase (cadencia), fumigaciones
(listado + wizard + detalle), geovisor, reportes y administración.
**Fuera de alcance:** pipeline de scraping DJI (CLI en `scripts/`), migraciones de BD y
backfills operacionales (se prueban por separado, ver §9).

---

## 2. Contexto y supuestos

### 2.1 Supuesto clave — la cadencia/fase requiere **uso en campo**

La fase del ciclo y, por extensión, la **regla de cadencia** se derivan de
`cycles.start_date` (función `current_phase(crop, variety, start_date)`), es decir, de la
**fecha de siembra / renovación** de cada parcela.

En las fuentes de datos actuales (DJI SmartFarm y cargues legacy) la **fecha de siembra
suele faltar o estar desactualizada** (ver `components/admin/parcels/import-gis-wizard.tsx`
nota sobre `F.SIEMBRA/F.COSECHA` desactualizadas). Por lo tanto:

- **Se requiere uso en campo** para asignar y mantener la fecha de siembra/corte de cada
  parcela; no es un dato que la plataforma pueda inferir con confianza.
- La plataforma **permite actualizar estos valores**: `parcels/[id]` → "Iniciar nuevo
  ciclo" (`POST /api/admin/cycles`) y "Registrar corte"
  (`POST /api/admin/cycles/:id/close`); y `admin/parcels/new` → "Fecha de siembra".
- Hasta completar ese levantamiento en campo, la cadencia **no se muestra como métrica de
  cumplimiento**: el `CompliancePanel` se retiró del dashboard (Fase 6, deferred) y la
  regla formal de "vencido/crítico" queda pendiente de definir.

> **Consecuencia para las pruebas:** existe un **caso funcional de primera clase** (§5,
> bloque CICLO/FASE) y una **tarea de usabilidad específica** (§6, T5) para asignar/
> actualizar la fecha de siembra desde la plataforma en campo. También es un **riesgo
> abierto** (§9): sin este levantamiento, los KPIs de fase/cadencia no son representativos.

### 2.2 Otros supuestos

- Un único operador real (~1200 parcelas, ~16k vuelos, ~17k fumigaciones). Un solo tenant.
- Roles: `admin` y `supervisor` (el histórico `viewer` se normaliza a `supervisor`).
- Zona horaria de negocio: `America/Bogota`.

---

## 3. Niveles de prueba y estado actual

| Nivel | Herramienta | Comando | Estado |
|---|---|---|---|
| Unit + integración (lógica/API/tests de componentes) | Vitest | `npm test` | 2334+ verdes (172 archivos) |
| Cobertura | `@vitest/coverage-v8` | `npm run test:coverage` | gate 45% lines / 65% branches |
| Arquitectura (fitness function) | dependency-cruiser | `npm run arch:check` | 0 errores |
| E2E | Playwright | `npm run e2e` (`e2e:auth`, `e2e:map`) | requiere BD + seed |
| **Funcional guionado (manual)** | este documento (§5) | — | a ejecutar |
| **Usabilidad** | este documento (§6) | — | a ejecutar |

---

## 4. Entorno de prueba

**Requisitos:**
1. Node 22 + dependencias: `npm ci`.
2. Postgres/PostGIS: `npm run db:up` → `npm run db:migrate`.
3. Variables: `.env.local` con `DATABASE_URL`, `DATABASE_SSL=false`, `AUTH_SECRET`,
   `AUTH_URL=http://localhost:3000`.
4. Usuario de prueba: `npm run auth:seed` (crea admin; el operador/supervisor se seedean o
   se crean desde el panel).
5. Datos: importar un subconjunto real/anonimizado (parcelas + fumigaciones) o usar el
   dataset de staging.

**Notas de entorno:**
- `.env.local` presente hace que los **integration tests** (integridad post-import,
   `mv-fumigations-monthly`) se ejecuten y requieran BD alcanzable. Sin BD, remover
   `.env.local` para que se salteen.
- La app aplica validación de env al arrancar (`lib/env.ts`); el build de producción exige
  `AUTH_SECRET`.

---

## 5. Matriz de casos funcionales

Formato: **ID · Precondición · Pasos · Resultado esperado · Criterio de aceptación**.
Tipo: `H` happy path · `E` borde/edge · `N` negativo.

### AUTH / ROLES

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| AUTH-01 | H | Login con credenciales válidas (`/login`) | Redirige a `/`; sesión activa; header muestra email + rol |
| AUTH-02 | N | Login con password incorrecto | Mensaje de error claro; no inicia sesión; no filtra información |
| AUTH-03 | H | Logout | Cierra sesión y redirige a `/login` |
| AUTH-04 | E | Supervisor entra a `/admin/*` | Es bloqueado (403/redirect) por el gate de rol |
| AUTH-05 | E | Sin sesión entra a una ruta privada | Redirige a `/login` |
| AUTH-06 | E | Página `/login` no muestra el shell/sidebar | El chrome de la app no aparece en login |

### DASHBOARD (`/`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| DASH-01 | H | Carga inicial | KPIs, tendencias y planning board renderizan con datos del período |
| DASH-02 | H | Filtro por período | KPIs y gráficos reflejan el rango elegido |
| DASH-03 | E | Sin datos en el rango | Empty state claro; sin errores de render |
| DASH-04 | E | Error de datos | Estado de error con reintento; no rompe la página |
| DASH-05 | E | Planes vencidos | `PlanningBoard` lista vencidos de forma accionable |

### PARCELAS (`/parcelas`, `/parcelas/[id]`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| PARC-01 | H | Listado con ~1200 filas | Tabla con sort, filtros y paginación; sin bloqueos |
| PARC-02 | H | Búsqueda/filtro por texto, cliente, estado | Filtra correctamente; "Limpiar" resetea |
| PARC-03 | H | Detalle de parcela | Header, KPIs, mapa, timeline, ciclo y cadencia visibles |
| PARC-04 | H | Crear parcela (3 secciones) | Alta OK con geometría dibujada; cliente/finca desde catálogo |
| PARC-05 | E | Crear parcela sin geometría | Bloquea con mensaje; no crea registro inválido |
| PARC-06 | N | ID de parcela inexistente | `notFound()` (404), no 500 |
| PARC-07 | H | Export PDF/CSV de parcela (admin) | Descarga archivo correcto; supervisor no ve el link |
| PARC-08 | E | Nombre muy largo / coordenadas largas | Trunca sin romper layout |

### CICLO / FASE (cadencia — uso en campo)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| CIC-01 | H | **Asignar fecha de siembra** en parcela sin ciclo (`parcels/[id]` → "Iniciar nuevo ciclo") | Crea ciclo con `start_date`; la fase se calcula y se muestra |
| CIC-02 | H | **Registrar corte** | Cierra el ciclo activo (`end_date`) + evento harvest; la parcela queda sin ciclo activo |
| CIC-03 | E | `end_date < start_date` | La API rechaza con error claro (validación) |
| CIC-04 | E | **Actualizar** fecha de siembra/corte en campo (corrección del dato levantado) | El cambio persiste; fase/cadencia reflejan el nuevo valor |
| CIC-05 | E | Ciclo sin `phase_rule` que aplique | La UI lo indica; no rompe; queda como invariante de calidad de datos |
| CIC-06 | E | Fumigación registrada en ciclo cerrado | Se señala (invariante "fumigación en ciclo cerrado") |
| CIC-07 | H | `/admin/reglas-fitosanitarias`: editar ventana/cadencia | Reglas se persisten y aplican a la planificación |

> **Observación de sustentación:** CIC-01/02/04 son el soporte técnico del supuesto §2.1: el
> valor de fecha de siembra se **asigna y mantiene desde la plataforma durante el trabajo de
> campo**, no se asume disponible en los datos DJI.

### FUMIGACIONES (`/fumigaciones`, `/nueva`, `/[id]`, `/[id]/editar`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| FUM-01 | H | Listado con filtros server-side (fecha, parcela, fuente, categoría) | Filtra sobre el dataset completo; paginación consistente |
| FUM-02 | H | **Wizard 3 pasos — modo Importar** (elegir parcela → vuelo DJI → datos → confirmar) | Auto-fill del vuelo; "Confirmar y registrar" **crea** la fumigación y navega a `/fumigaciones` |
| FUM-03 | H | **Wizard — modo Manual** | Registra sin vuelo DJI; validación zod antes de avanzar |
| FUM-04 | H | Volver desde Confirm | **Los datos tipeados se preservan** (no se resetea el form) |
| FUM-05 | N | Submit del wizard sin campos requeridos | Banner de validación con campo faltante; no envía |
| FUM-06 | H | Detalle de fumigación | Datos, vuelos, mapa, facturas y audit trail visibles |
| FUM-07 | H | Editar fumigación (PATCH sparse) | Solo envía campos modificados; refleja cambios |
| FUM-08 | H | Eliminar (soft-delete) | `AlertDialog` de confirmación; desaparece del listado; queda en BD |
| FUM-09 | H | Bulk borrar / bulk categoría | `AlertDialog`; POST correcto; mensaje de resultado; refresh |
| FUM-10 | H | Facturas: crear / cancelar | Alta inline; cancelar con `AlertDialog`; totales actualizados |
| FUM-11 | E | Asignar parcela a fumigación **huérfana** | Busca parcela; asigna; el badge "Sin asignar" desaparece |
| FUM-12 | E | Huérfana mostrada en listado y geovisor | Badge "Sin asignar" (magenta) + acción de asignar (admin/supervisor) |

### GEOVISOR (`/geovisor`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| GEO-01 | H | Carga map-first | El mapa ocupa todo el espacio; filtros/eventos son **overlays** flotantes |
| GEO-02 | H | Búsqueda de parcela | Filtra parcelas y eventos por texto |
| GEO-03 | H | Rango temporal (Desde/Hasta) | Solo eventos en rango en mapa y listas |
| GEO-04 | H | Capas y basemap | Toggles operan; basemap cambia (satélite/híbrido/calles) |
| GEO-05 | H | Click en evento | Centra el mapa + abre popup + card de detalle |
| GEO-06 | H | Toggles "Filtros"/"Eventos" | Abren/cierran overlays; en mobile arrancan cerrados |
| GEO-07 | E | Parcela seleccionada | Muestra `ParcelPanel` con datos y link a hoja de vida |
| GEO-08 | E | Persistencia de boxes | Orden/visibilidad del sidebar derecho persisten en `localStorage` |
| GEO-09 | E | Falla de carga del mapa | Estado de error (no spinner infinito) — a verificar/implementar |

### REPORTES (`/reportes`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| REP-01 | H | Dos tabs (Operativo / Resumen por parcela) | Cambian contenido; `role=tab`/`tabpanel` correctos |
| REP-02 | H | Filtros de rango | Tablas reflejan el rango; conteo y cap (200) correctos |
| REP-03 | H | Export CSV/PDF (admin) | Descarga; supervisor no ve botones que recargan |

### ADMINISTRACIÓN (`/admin/*`)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| ADM-01 | H | `/admin` landing | Tarjetas a submódulos; sin `href` crudos |
| ADM-02 | H | `/admin/parcels`: búsqueda server-side | Filtra sobre el dataset completo (no solo la página) |
| ADM-03 | H | `/admin/parcels`: edición inline + guardar | Persiste por fila; feedback de guardado/error |
| ADM-04 | H | `/admin/parcels/new` + `/import` (wizard GIS) | Preview → commit; validaciones; estado vacío/errores |
| ADM-05 | H | `/admin/calidad` | Distingue "dataset limpio" de error de consulta |
| ADM-06 | H | `/admin/pipeline` | Health del pipeline DJI visible |
| ADM-07 | H | `/admin/reglas-fitosanitarias` | CRUD + "Restaurar recomendados" con confirmación |

### Transversales (a11y / estados / responsive)

| ID | Tipo | Caso | Criterio de aceptación |
|---|---|---|---|
| X-01 | H | Navegación por teclado | Foco visible en todo control; orden lógico; overlays cierran con Escape |
| X-02 | H | Estados loading/empty/error | Presentes en cada vista con datos; skeleton ≈ layout final |
| X-03 | H | Responsive 320 / 768 / 1024 / 1440 | Sin overflow horizontal de página; sidebar → drawer en mobile |
| X-04 | H | Overlays accesibles | `Dialog`/`AlertDialog`/`Sheet` con título, focus trap y restauración |
| X-05 | E | Color no como único indicador | Estados con ícono/texto además de color |

---

## 6. Guion de pruebas de usabilidad

### 6.1 Participantes (mínimo sugerido: 4–6)

- **Operador fumigador** (usuario principal; registra aplicaciones y consulta histórico).
- **Supervisor** (consulta, asigna parcelas huérfanas, exporta).
- **Administrador/topógrafo** (parcelas, reglas, ciclos, importación).

### 6.2 Tareas (escenario real, sin guiar la UI)

| ID | Tarea | Escenario | Métrica principal |
|---|---|---|---|
| T1 | Registrar fumigación desde un vuelo DJI | "Tenés un vuelo reciente; registralo en la parcela Lote X" | Éxito, tiempo, errores |
| T2 | Registrar fumigación manual | "Aplicaste un producto sin vuelo DJI; registralo" | Éxito, tiempo |
| T3 | Asignar parcela a una fumigación huérfana | "Hay aplicaciones sin parcela; asignales la correcta" | Éxito, errores |
| T4 | Consultar histórico en el geovisor | "Mostrame las aplicaciones de los últimos 90 días y su detalle en el mapa" | Éxito, tiempo |
| **T5** | **Actualizar la fecha de siembra/corte de una parcela en campo** | "Este lote se sembró/renovó recién; actualizá su fecha para que la fase quede correcta" | **Éxito, errores, comprensión del modelo** |
| T6 | Crear una parcela nueva dibujando el polígono | "Alta de parcela con su geometría y cliente/hacienda" | Éxito, errores |
| T7 | Generar un reporte (operativo) | "Exportá el reporte del último mes" | Éxito, tiempo |
| T8 | Registrar corte y cerrar el ciclo | "Se cosechó el lote; cerrá el ciclo" | Éxito, comprensión |

### 6.3 Protocolo

- Think-aloud; moderador que **no** indica pasos; consentimiento informado.
- Registro: video/pantalla + notas; entorno con datos reales anonimizados o de prueba.
- Tras las tareas: **SUS** (10 ítems, escala 1–5) + 3–4 preguntas abiertas
  (¿qué fue confuso?, ¿qué faltó?, ¿lo usarías en campo?).

### 6.4 Métricas y umbrales

| Métrica | Umbral objetivo |
|---|---|
| Éxito en tareas críticas (T1, T2, T4, T5) | ≥ 90% sin asistencia |
| Tiempo por tarea | Comparable a la línea base acordada con el operador |
| Errores recuperables | Tendencias decrecientes entre sesiones |
| SUS | ≥ 68 (promedio aceptable) |
| Bugs P0/P1 detectados | 0 abiertos al cierre |

---

## 7. Criterios de aceptación y salida

- 100% de casos **H** (§5) ejecutados y aprobados.
- Casos **E/N** ejecutados con comportamiento documentado (aprobado o con issue).
- Gate técnico verde: `tsc` 0 · `arch:check` 0 · `npm test` verde · `npm run build` ✓.
- Usabilidad: umbrales de §6.4 cumplidos.
- Sin bugs **P0/P1** abiertos; los P2/P3 quedan en backlog priorizado.

---

## 8. Evidencia y formato para la sustentación

1. **Matriz de trazabilidad**: `Requisito (SDD/SPEC) → Caso (ID) → Resultado (Pasa/Falla/Issue)`.
2. **Tabla de resultados funcionales** por caso (fecha, ejecutor, entorno, evidencia).
3. **Resultados de usabilidad**: tabla por participante/tarea (éxito, tiempo, errores) +
   puntajes SUS + síntesis cualitativa.
4. **Anexos**: capturas de pantalla por flujo (login, wizard, geovisor, ciclo), y video de
   la sesión de usabilidad.
5. **Registro de issues** encontrados con severidad y estado.

---

## 9. Riesgos y pendientes

| # | Riesgo / pendiente | Impacto | Mitigación |
|---|---|---|---|
| R1 | **Fecha de siembra incompleta/desactualizada** en las fuentes | Fase y cadencia no confiables | Levantamiento en campo vía CIC-01/02/04; documentar cobertura de datos antes de mostrar KPIs de cadencia |
| R2 | Regla de cadencia formal sin definir (Fase 6 deferred) | No hay umbral "vencido/crítico" oficial | Definir con el operador antes de reintroducir el `CompliancePanel` |
| R3 | Backfills operacionales pendientes por ambiente | Datos de cliente/finca y ciclos incompletos | Correr `scripts/backfill-clients-farms.js` y `POST /api/admin/cycles/backfill` una vez por ambiente |
| R4 | Geovisor sin estado de error de mapa (GEO-09) | Spinner eterno si falla MapLibre | Implementar estado de error + retry |
| R5 | Tablas con scroll horizontal en mobile (deuda UI-TB1) | Legibilidad en pantallas chicas | Migrar a `ui/table` + card transform (backlog) |

---

## 10. Anexos

- **Comandos:** `npm run db:up`, `db:migrate`, `auth:seed`, `dev`, `test`, `test:coverage`,
  `e2e`, `arch:check`, `build`, `backfill:clients-farms`, `refresh:fumigations`.
- **Docs relacionados:** `docs/SDD.md`, `docs/TDD.md`, `docs/SPEC.md`,
  `docs/FUMIGATION_CADENCE.md`, `docs/UI-AUDIT.md`, `docs/PLAN-FUMIGACIONES-V2.md`.
- **Rutas de la app:** `/`, `/parcelas`, `/parcelas/[id]`, `/fumigaciones`,
  `/fumigaciones/nueva`, `/fumigaciones/[id]`, `/fumigaciones/[id]/editar`, `/geovisor`,
  `/reportes`, `/login`, `/admin`, `/admin/parcels`, `/admin/parcels/new`,
  `/admin/parcels/import`, `/admin/applications`, `/admin/calidad`, `/admin/pipeline`,
  `/admin/reglas-fitosanitarias`.
