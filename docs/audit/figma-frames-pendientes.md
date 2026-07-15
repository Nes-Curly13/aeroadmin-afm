# Frames Figma faltantes — Solicitud de export + plan tentativo

> **Estado**: ⏳ Pendiente de entrega del usuario (operador / cliente).
> **Cierra el gap**: #13 del audit `figma-vs-bd.md` ("Frames Figma faltantes").
> **Fecha de apertura**: 2026-07-14.
> **Agente siguiente**: cualquiera que reciba los frames exportados.

---

## 1. Contexto

### 1.1 Por qué faltan estos frames

El audit `docs/audit/figma-vs-bd.md` cubre **2 de ~8 frames** del archivo Figma
`AFM_SIG` (file_key `MJv8IgOcvKt5suscRzIIEQ`):

- ✅ **Frame A — Field Management** (cubierto, gap cerrado).
- ✅ **Frame B — Task History** (cubierto, gap cerrado en `0b32e71` + `3b307f3`).
- ❌ **Cloud Reconstruction** (falta)
- ❌ **Data Analysis** (falta)
- ❌ **Device Management** (falta)
- ❌ **Settings** (falta)
- ❌ **Afm Drone** (falta)
- ❌ **Other Regions** (falta)

Sin esos 6 frames, no podemos:

1. Auditar campos UI vs BD campo-por-campo (mismo patrón que `figma-vs-bd.md`).
2. Especificar las páginas correspondientes en `app/` (qué rutas, qué componentes).
3. Hacer TDD primero (no hay UI target para escribir el test que falle — `02_TDD_AeroAdmin_AFM.md` §1).

### 1.2 Qué bloquea al agente

| Bloqueo | Por qué | Alternativa descartada |
|---|---|---|
| El archivo Figma es **UI autenticada** del cliente | El operador tiene la cuenta `djiag.com`; el agente no tiene credenciales y el archivo no es público | Crear cuenta propia — fuera de alcance, involucra datos operativos reales |
| Sin **Figma API token** del workspace del operador | La API REST de Figma requiere token personal con scope `files:read` | Pedir al cliente que genere un token — no es un blocker de negocio, el cliente prefiere exportar manualmente porque ya conoce la UI |
| El scraper `lib/djiag-korean-client.js` solo scrapa la **app DJI SmartFarm** (no Figma) | Es para datos de parcelas/vuelos, no para inspeccionar el archivo de diseño | Reutilizar el scraper — no aplica |

**Conclusión**: la extracción la tiene que hacer el humano que ya tiene abierto Figma.
La estructura de este documento está diseñada para que esa entrega sea lo más
masticada posible.

### 1.3 Qué se necesita del usuario

1. **Exportar los 6 frames** (instrucciones paso a paso en §3).
2. **Responder el cuestionario de producto** de §4 (6 preguntas, 1 BLOQUEANTE).
3. **Pegar el resultado** en `docs/audit/figma-frames/<nombre-frame>/` (o avisar
   por el canal habitual para que el siguiente agente lo levante).

Cuando esos 3 puntos estén resueltos, el siguiente sprint puede arrancar con
auditoría campo-por-campo + spec de implementación sin re-pensar el approach
(§5 tiene el plan tentativo ya cocinado).

---

## 2. Frames a entregar

Los nombres a continuación son los **exactos** de la sidebar del archivo Figma
`AFM_SIG`, documentados en `figma-vs-bd.md` §"Sidebar". **No renombrar** al
exportar — la carpeta destino usa esos mismos slugs.

### 2.1 Cloud Reconstruction

- **Nombre exacto**: `Cloud Reconstruction`
- **URL probable DJI**: `https://www.djiag.com/cloud-reconstruction`
- **Propósito inferido**: visualización/gestión de reconstrucciones 3D del
  terreno post-vuelo (nubes de puntos LiDAR / fotogrametría). En DJI esto se
  hace típicamente con DJI Terra y se sincroniza a la nube de DJI Agras.

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `name` (lista) | string | `Reconstruction-2026-07-04-Gertrudis` | ¿El nombre lo pone el operador o lo genera DJI automáticamente? |
| 2 | `parcel_linked` | string (parcela) | `Gertrudis STE 116C` | ¿Una reconstrucción se asocia a 1 parcela o puede ser multi-parcela? |
| 3 | `created_at` | datetime | `2026/07/04 14:23` | ¿Es la fecha de captura o la fecha de subida a la nube? |
| 4 | `point_count` | integer | `12,450,000` | ¿Viene del JSON de DJI Terra o lo calcula la nube? ¿Hay tope de quota? |
| 5 | `file_size_mb` | float | `2,348 MB` | ¿Es metadata de la nube o cálculo del front? |
| 6 | `status` | chip enum | `Processing` / `Ready` / `Failed` | ¿Cuántos estados? ¿Hay estado "Archived"? |
| 7 | `thumbnail` | image | (preview 3D) | ¿Es estático o rotable? (cambia el componente) |
| 8 | `actions` | buttons | `View` / `Download` / `Delete` | ¿Los botones son por fila o detail panel? ¿"Delete" es soft o hard? |
| 9 | `format` | enum | `LAS` / `LAZ` / `PLY` | ¿Se filtra por formato? ¿Se permite descargar el raw? |
| 10 | `coverage_area_ha` | float + unidad | `7.75 ha` | ¿Lo calculamos nosotros o viene de DJI? (afecta si necesitamos nueva columna) |
| 11 | `drone_used` | string | `DJI Mavic 3 Enterprise` | ¿Es la fuente de la captura o metadata de proceso? |
| 12 | `processing_time` | duration | `1h 23min` | ¿Mostrar al usuario o es solo interno? |

**Métricas / gráficos esperados (a confirmar):**
- Filtro por parcela, por rango de fechas, por estado.
- Counter superior: `Total reconstructions: N` / `Storage used: X GB`.
- Si hay analytics: tiempo promedio de procesamiento por Ha.

**Patrones de interacción conocidos (a confirmar):**
- Visor 3D embebido (¿three.js / potree / cesium / viewer nativo de DJI?).
- Upload de `.las`/`.laz` o solo lectura.
- Compartición por link / export.

### 2.2 Data Analysis

- **Nombre exacto**: `Data Analysis`
- **URL probable DJI**: `https://www.djiag.com/data-analysis`
- **Propósito inferido**: analítica histórica agregada — más rica que Task
  History, probablemente con comparaciones entre parcelas, tendencias
  multi-mes, y reportes exportables.

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `date_range` (top) | date range | `2026-01-01 → 2026-07-08` | ¿Default range? ¿Quick filters (7d / 30d / YTD / custom)? |
| 2 | `parcel_selector` (multi) | multi-select | `Gertrudis STE 116C, ...` | ¿Multi-selección o solo 1 parcela a la vez? |
| 3 | `metric_primary` (KPI header) | enum + value | `Total area fumigada: 5462.23 mu` | ¿Qué métricas son "del análisis" vs las de Task History? |
| 4 | `metric_liters` (KPI header) | float + unidad | `100,884.1 L` | ¿Es sum, avg, o ambos con toggle? |
| 5 | `metric_drone_hours` (KPI header) | duration | `631h 11min 23s` | Mismo formato `XHourYminZs` que Task History? |
| 6 | `metric_efficiency` (KPI header) | float + unidad | `1.2 L/ha` (consumo) | ¿Es L/ha o mu? ¿Es KPI de "eficiencia" en general? |
| 7 | `chart_type` (toggle) | enum | `Bar` / `Line` / `Area` | ¿Toggle de tipo de chart o chart fijo por métrica? |
| 8 | `chart_x_axis` | enum | `Día` / `Semana` / `Mes` | ¿Hay drill-down temporal (mes → semana → día)? |
| 9 | `chart_y_axis` | enum | `Area` / `Litros` / `Horas` / `Eficiencia` | ¿Multi-métrica simultánea o una a la vez? |
| 10 | `comparison_mode` (toggle) | boolean | `Comparar vs período anterior` | ¿Hay comparación YoY? ¿PoP? |
| 11 | `export_button` | button | `Exportar CSV` / `Exportar PDF` | ¿CSV o PDF? (decide si usamos jsPDF — fuera de scope actual) |
| 12 | `filter_by_drone` | multi-select | `T40, T50` | ¿Lista de drones del operador o input libre? |
| 13 | `filter_by_pilot` | multi-select | `Juan, Pedro` | Idem |
| 14 | `filter_by_cadence_compliance` | enum | `Cumplida` / `Atrasada` / `Todas` | ¿Esta vista cruza con cadencia? (toca `dji_fumigation_schedule`) |
| 15 | `data_table` (drill-down) | tabla | (lista de eventos del período) | ¿Tabla debajo del chart o ruta separada? |

**Métricas / gráficos esperados (a confirmar):**
- Bar chart de area fumigada por mes.
- Line chart de litros consumidos en el tiempo.
- Heatmap parcela × mes (si hay vista geoespacial).
- Ranking top-N parcelas por consumo.

**Patrones de interacción conocidos (a confirmar):**
- Tabs (¿Área / Litros / Horas / Eficiencia?).
- Drill-down: click en barra del chart → tabla de eventos.
- Compartir vista: ¿URL con query params codificando filtros?

### 2.3 Device Management

- **Nombre exacto**: `Device Management`
- **URL probable DJI**: `https://www.djiag.com/device`
- **Propósito inferido**: registro de los drones del operador (chassis,
  modelo, fecha de compra, horas de vuelo acumuladas, estado de garantía).

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `nickname` (título card) | string | `T50-Caña-01` | ¿Es el nickname del operador o el de DJI? (el `drone_nickname` que ya scrapeamos) |
| 2 | `model` (chip) | enum | `DJI Agras T50` | ¿De dónde viene — `dji_drone_models` (ya existe) o se scrapea del panel? |
| 3 | `serial_number` / `chassis` | string | `1581F5BKD2310001` | **Crítico**: ¿`serial_number` real (hardware) o session-id de DJI? (gotcha §5.4 de la guía) |
| 4 | `firmware_version` | string | `v04.01.0035` | ¿Lo scrapeamos o lo ingresa el operador manualmente? |
| 5 | `purchase_date` | date | `2024-03-15` | ¿Input manual? (no viene de DJI) |
| 6 | `total_flight_hours` | duration | `487h 23min` | ¿Calculado de `dji_flights` o lo trae DJI? (afecta lógica de rollup) |
| 7 | `last_flight_at` | datetime | `2026/07/08 16:42` | `max(dji_flights.start_at)` agrupado por `drone_nickname` |
| 8 | `status` (chip) | enum | `Active` / `Maintenance` / `Retired` | ¿Input manual o derivado de "last_flight_at > N días"? |
| 9 | `next_maintenance_due` | date | `2026/08/15` | ¿Es regla fija (cada X horas) o input manual? |
| 10 | `assigned_pilot` (default) | string | `Juan Pérez` | ¿Un drone tiene 1 piloto default? (toca `app_users` o un nuevo mapping) |
| 11 | `battery_serial` (lista) | string[] | `Bat-001, Bat-002` | ¿El modelo T50 tiene 2 baterías? ¿Se trackean por separado? |
| 12 | `warranty_expires_at` | date | `2027/03/15` | ¿Input manual? |
| 13 | `actions` | buttons | `Detail` / `Edit` / `Archive` | ¿CRUD completo? ¿Hay "Transfer ownership"? |
| 14 | `add_device_button` | button | `+ Agregar dispositivo` | **BLOQUEANTE** — en el SPEC §2.6 actual este form se removió por ser decorativo. ¿Revertir esa decisión? |

**Métricas / gráficos esperados (a confirmar):**
- Counter: `Total devices: N` / `Active: M` / `In maintenance: K`.
- Lista con filtro por status, modelo.
- Si hay analytics: horas de vuelo por dron en el último mes (mini chart en card).

**Patrones de interacción conocidos (a confirmar):**
- Detail panel lateral al click (mismo patrón que `/map` con `parcel-detail-panel`).
- Modal de "Add device" (multistep wizard o single form?).
- Empty state: "No tenés devices registrados, agregá el primero".

### 2.4 Settings

- **Nombre exacto**: `Settings`
- **URL probable DJI**: `https://www.djiag.com/settings`
- **Propósito inferido**: preferencias de la cuenta y de la app. **Ámbito
  incierto** — puede ser solo UI o incluir gestión de usuarios (ver §4.3).

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `account_section` (header) | section | (Cuenta) | ¿Hay "Mi cuenta" (perfil propio) o multi-usuario? |
| 2 | `name` (input) | string | `Juan Pérez` | ¿Editable? ¿Sincronizado con `app_users`? |
| 3 | `email` (input) | string | `juan@operador.com` | ¿Readonly (viene del login) o editable? |
| 4 | `password` (button) | button | `Cambiar contraseña` | Si sí, ¿reusa el endpoint `change-password` que ya existe? |
| 5 | `theme` (toggle) | enum | `Claro` / `Oscuro` / `Sistema` | **Decisión de producto** — el SPEC actual tiene solo tema claro. ¿Lo ampliamos? |
| 6 | `language` (select) | enum | `es-CO` / `en-US` | ¿Multi-idioma real o solo español? (afecta `next-intl` o i18n routing) |
| 7 | `units` (select) | enum | `Métrico (ha, L, km)` / `Imperial (ac, gal, mi)` | ¿Toggle de unidades? (afecta TODOS los formateadores — alto riesgo) |
| 8 | `date_format` | select | `YYYY/MM/DD` / `DD/MM/YYYY` | Idem — `Intl.DateTimeFormat` con TZ `America/Bogota` |
| 9 | `notifications_section` (header) | section | (Notificaciones) | ¿Hay notificaciones? (SPEC §2.2 dice que no — ¿se revierte?) |
| 10 | `email_notifications` (toggle) | boolean | `Recibir resumen semanal` | Si sí, requiere servicio de email (Resend / SendGrid) — fuera de scope |
| 11 | `team_section` (header) | section | (Equipo) | **BLOQUEANTE** — ver §4.3 |
| 12 | `users_list` (tabla) | tabla | (Lista de usuarios con rol) | Si multi-tenant, requiere CRUD nuevo en `app_users` |
| 13 | `invite_user_button` | button | `+ Invitar usuario` | Si sí, flujo de email + token |
| 14 | `roles_legend` | text | `Admin: ..., Viewer: ...` | ¿Hay más roles que `admin`/`viewer`? |
| 15 | `audit_log` (link) | link | `Ver log de actividad` | Si sí, requiere tabla `audit_log` nueva |

**Métricas / gráficos esperados:** N/A (es página de configuración).

**Patrones de interacción conocidos (a confirmar):**
- Form con `Save` global o auto-save por sección.
- `Discard changes` si auto-save.
- Confirm modal para acciones destructivas (cambiar unidades, eliminar usuario).

### 2.5 Afm Drone

- **Nombre exacto**: `Afm Drone`
- **URL probable DJI**: `https://www.djiag.com/afm-drone` (ruta tentativa — el
  "Afm" sugiere que es branding propio del operador, no estándar de DJI)
- **Propósito inferido**: vista del **estado en vivo** del dron del operador
  — DJI cuenta, batería, próximas inspecciones, último vuelo. Ver §4.2.

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `drone_selector` (top) | single-select | `T50-Caña-01` | ¿Vista single-drone o multi-drone? |
| 2 | `live_status` (badge) | enum | `Online` / `Offline` / `In flight` | ¿Live = qué — conectado a DJI cloud o solo derivado de último flight? |
| 3 | `battery_level` (gauge) | int % | `87%` | ¿Lo scrapeamos en tiempo real? (no factible sin push DJI) |
| 4 | `battery_health` | enum | `Good` / `Degraded` / `Replace` | ¿De dónde viene? |
| 5 | `gps_signal` | enum | `Strong` / `Weak` / `No signal` | Idem |
| 6 | `last_flight_summary` (card) | mixed | `2026/07/08 — 22 vuelos — 365.2 L` | ¿Calculado de `dji_flights`? |
| 7 | `next_inspection_due` | date | `2026/08/01` | ¿Regla de negocio del operador o input? |
| 8 | `flight_hours_total` | duration | `487h 23min` | `sum(dji_flights.duration_seconds)` por drone_nickname |
| 9 | `flight_hours_since_maintenance` | duration | `42h 15min` | ¿Reset manual tras mantenimiento? |
| 10 | `last_maintenance_at` | date | `2026/06/01` | Si no hay tabla de mantenimiento, requiere una nueva |
| 11 | `maintenance_log` (timeline) | lista | (entradas con fecha + nota) | Si sí, tabla `drone_maintenance` nueva |
| 12 | `add_maintenance_button` | button | `+ Registrar mantenimiento` | |
| 13 | `component_status` (cards grid) | mixed | `Brazos: OK, Boquillas: OK, ...` | ¿Lista fija de componentes o custom? |
| 14 | `telemetry_section` (chart) | line chart | (altitud / velocidad / batería en último vuelo) | **Implica integración con telemetría cruda DJI — alto costo** |
| 15 | `share_status` (button) | button | `Compartir estado con técnico` | Si sí, link público temporal |

**Métricas / gráficos esperados (a confirmar):**
- Gauge grande de batería en el centro.
- Timeline vertical de maintenance events.
- Si hay telemetría: chart con altitud/velocidad del último vuelo.

**Patrones de interacción conocidos (a confirmar):**
- Single-page con secciones colapsables.
- "Last updated X min ago" en el header (refresco manual o auto?).
- Drill-down en maintenance log → detalle de la intervención.

### 2.6 Other Regions

- **Nombre exacto**: `Other Regions`
- **URL probable DJI**: `https://www.djiag.com/regions`
- **Propósito inferido**: gestión de múltiples zonas geográficas de operación
  (ej. Valle del Cauca + Cauca + Risaralda). Ver §4.1 — **BLOQUEANTE**.

| # | Campo UI (label probable) | Tipo | Ejemplo | Pregunta para el usuario |
|---|---|---|---|---|
| 1 | `region_name` (título) | string | `Valle del Cauca — Norte` | ¿Es la geografía (departamento/vereda) o la unidad de negocio del operador? |
| 2 | `center_point` | geom Point | (lat, lng) | Si es single-tenant con selector, es solo metadata. Si es multi-tenant, es el centroide del polígono regional |
| 3 | `bbox` | geom Polygon | (rectángulo envolvente) | |
| 4 | `parcel_count` | integer | `438` | `count(*) FROM dji_parcels WHERE region_id = ?` |
| 5 | `total_area_ha` | float | `1,240 ha` | `sum(dji_parcels.declared_area_ha) WHERE region_id = ?` |
| 6 | `active_clients` | integer | `3` | **Si multi-tenant, cuántos clientes activos hay en la región** |
| 7 | `operator_name` | string | `Caña del Valle S.A.S` | **Si multi-tenant, este es el campo que rompe el ADR single-tenant** |
| 8 | `contact` | string | `+57 315 555 1234` | |
| 9 | `data_isolation_mode` | enum | `Shared` / `Isolated` | Si `Isolated`, requiere `region_id` en TODAS las queries — refactor mayor |
| 10 | `created_at` | date | `2024-08-15` | |
| 11 | `status` | enum | `Active` / `Paused` / `Archived` | |
| 12 | `actions` | buttons | `View parcels` / `Edit` / `Deactivate` | |
| 13 | `add_region_button` | button | `+ Agregar región` | |
| 14 | `region_map_preview` | map | (mini-mapa con bbox) | Si es single-tenant con selector, solo visual. Si multi-tenant, requiere scope de PostGIS por región |
| 15 | `client_visibility_toggle` | boolean | `Visible para otros clientes` | Si multi-tenant, permisos cruzados — modelo de seguridad nuevo |

**Métricas / gráficos esperados (a confirmar):**
- Lista de regiones con stats por región.
- Mapa overview con bboxes (zoom-out).
- Si multi-tenant: métricas segregadas por cliente.

**Patrones de interacción conocidos (a confirmar):**
- Selector global en el header (cambiar de región = cambiar contexto).
- Si multi-tenant: switcher de cliente activo.
- Permisos: ¿un `viewer` ve todas las regiones o solo las suyas?

---

## 3. Instrucciones de export para el usuario

> Audiencia: operador cañero en el Valle del Cauca que usa Figma a nivel
> básico (ver, comentar). Las instrucciones son **paso a paso y masticadas**.

### 3.1 Antes de empezar — qué necesitás

- [ ] Acceso a Figma con permisos de **view** sobre el archivo `AFM_SIG`
      (file_key `MJv8IgOcvKt5suscRzIIEQ`).
- [ ] Un cliente Figma de escritorio o el browser. La versión de escritorio
      es más cómoda para exportar muchos frames.
- [ ] (Opcional pero recomendado) el plugin **"Figma to JSON"** o
      **"Inspector"** instalado desde la Figma Community.

### 3.2 Paso a paso

#### Paso 1 — Abrir el archivo

1. Abrí Figma.
2. En el menú **"Recent files"** debería aparecer `AFM_SIG`. Si no, pegá
   la file_key en la URL: `https://www.figma.com/file/MJv8IgOcvKt5suscRzIIEQ/AFM_SIG`.
3. Navegá al **page** que tiene la sidebar principal (típicamente se llama
   `Main` o `01 — Sidebar`).

#### Paso 2 — Para cada uno de los 6 frames faltantes

> Los nombres exactos están en §2. La carpeta destino ya está creada en
> `docs/audit/figma-frames/<nombre-frame>/`.

Para **Cloud Reconstruction** (repetir el bloque para los otros 5):

1. En el panel izquierdo de Figma, buscá el frame llamado
   `Cloud Reconstruction` (clic en el nombre → Figma hace zoom al frame).
2. **Exportar PNG**:
   - Seleccioná el frame (clic en él, no en un elemento interno).
   - En el panel derecho, sección **"Export"**, picá **"+ Export"**.
   - Formato: **PNG**. Resolución: **@1x** y **@2x** (si el frame es
     detalle con texto pequeño, mandá también **@3x**).
   - Guardá con el nombre `<nombre-frame>.png` y `<nombre-frame>@2x.png`
     en la carpeta `docs/audit/figma-frames/cloud-reconstruction/`.
3. **Si el frame es muy largo** (scroll infinito en el original):
   - Exportá **el viewport visible** como `cloud-reconstruction-top.png`.
   - Hacé scroll down con la rueda del mouse, exportá como
     `cloud-reconstruction-mid.png` y `cloud-reconstruction-bottom.png`.
4. **Extraer metadata estructurada** (más útil que solo screenshots):
   - **Opción A (recomendada)**: usá el plugin **"Figma to JSON"** o
     **"Inspector"** (los dos hacen lo mismo con UI distinta). Seleccioná
     el frame completo → botón derecho → **Plugins → Figma to JSON →
     Export**. Guardá el archivo como
     `docs/audit/figma-frames/cloud-reconstruction/cloud-reconstruction.json`.
   - **Opción B (manual, sin plugin)**: en el panel derecho, sección
     **"Design"**, abrí cada nodo de texto y copialo a un archivo de texto
     con la estructura:
     ```
     Frame: Cloud Reconstruction
       Section: Header
         Text: "Reconstrucciones en la nube"
         Button: "Nueva reconstrucción"
       Section: List
         Card 1:
           Title: "Rec-2026-07-04-Gertrudis"
           Status: "Ready"
           ...
     ```
     Guardá como `cloud-restructure-layout.md` en la misma carpeta.

#### Paso 3 — Repetir para los otros 5 frames

Hacé el Paso 2 con cada uno:

| # | Frame (nombre exacto) | Carpeta destino |
|---|---|---|
| 1 | Cloud Reconstruction | `docs/audit/figma-frames/cloud-reconstruction/` |
| 2 | Data Analysis | `docs/audit/figma-frames/data-analysis/` |
| 3 | Device Management | `docs/audit/figma-frames/device-management/` |
| 4 | Settings | `docs/audit/figma-frames/settings/` |
| 5 | Afm Drone | `docs/audit/figma-frames/afm-drone/` |
| 6 | Other Regions | `docs/audit/figma-frames/other-regions/` |

> **Nota de naming**: el nombre de la **carpeta** está en `kebab-case`
> (con guión), pero el **nombre del archivo dentro** debe mantener el
> nombre exacto del frame Figma (con mayúsculas y espacios). Ejemplo:
> `docs/audit/figma-frames/afm-drone/Afm Drone.png` o
> `docs/audit/figma-frames/afm-drone/afm-drone.png` — cualquiera de las
> dos sirve, el agente las va a matchear por carpeta.

#### Paso 4 — Confirmar

Cuando termines, dejá un comentario en este archivo (o donde te coordinaste
con el equipo) confirmando:

- [ ] Carpeta `docs/audit/figma-frames/cloud-reconstruction/` poblada.
- [ ] Carpeta `docs/audit/figma-frames/data-analysis/` poblada.
- [ ] Carpeta `docs/audit/figma-frames/device-management/` poblada.
- [ ] Carpeta `docs/audit/figma-frames/settings/` poblada.
- [ ] Carpeta `docs/audit/figma-frames/afm-drone/` poblada.
- [ ] Carpeta `docs/audit/figma-frames/other-regions/` poblada.
- [ ] Cuestionario de §4 respondido.

---

## 4. Cuestionario de producto

> **Este cuestionario NO se puede inferir del Figma.** Aunque tengamos los
> frames exportados, las preguntas de abajo afectan **arquitectura** y deben
> resolverse ANTES de empezar a implementar.
>
> Responder en el chat con el agente (o donde coordinen) — no requiere editar
> este archivo.

### Pregunta 1 — Other Regions

> **Nivel de impacto**: 🔴 **BLOQUEANTE — discutir con equipo antes de implementar.**

**¿"Other Regions" es multi-cliente real (varios operadores en zonas
distintas con data aislada) o single-tenant con un selector de zona
geográfica?**

- **Si la respuesta es multi-cliente real**: esto **rompe el ADR de
  single-tenant** documentado en `01_SDD_AeroAdmin_AFM.md` §1 ("No es SaaS
  multi-tenant todavía") y §7 (decisiones de arquitectura). Es un cambio
  arquitectónico mayor que requiere:
  - Refactor de `api/repositories.ts` para filtrar por `client_id` en TODAS
    las queries.
  - Nuevo modelo de permisos en `app_users` (¿`admin` global vs
    `admin` por cliente?).
  - Aislamiento de datos en PostGIS (`region_id` en cada fila).
  - Probable migración: `add_region_id_to_dji_parcels.sql`,
    `add_client_id_to_flights.sql`, etc.
  - Auditoría de seguridad: ¿un `viewer` del cliente A puede ver
    accidentalmente datos del cliente B?
  - Multiplicación de tests de aislamiento (matriz cliente × endpoint).

- **Si la respuesta es single-tenant con selector de zona**: implementación
  mucho más liviana. Solo se agrega:
  - Tabla `regions` con `name`, `bbox`, `parcel_count` (agregable).
  - Columna opcional `region_id` en `dji_parcels` (nullable, no rompe
    queries existentes).
  - UI: dropdown en el header de `/map` y `/dashboard` que filtra
    polígonos por `region_id`.

**Recomendación del agente**: arrancar con la **opción single-tenant con
selector** y postergar multi-tenant real al roadmap L (L1 del roadmap macro
ya está identificado para esto). Si el cliente confirma multi-tenant,
tratarlo como sprint dedicado de varias sesiones — no se hace de paso.

### Pregunta 2 — Afm Drone

> **Nivel de impacto**: 🟠 **ALTO**.

**¿"Afm Drone" es una vista del estado del propio dron del operador (cuenta
DJI, batería, próximas inspecciones, último vuelo) o un panel de
configuración del modelo de dron?**

- **Si es estado del dron propio (live status)**: la info de batería / GPS
  en tiempo real requiere integración con DJI Cloud API o push notifications
  — **fuera del scraper actual**. Hay que evaluar el API oficial de DJI Agras
  (ver roadmap L3 — "API oficial DJI") o un SDK de telemetría. Si no hay
  esa integración, podemos degradar a "último vuelo conocido" (lo que ya
  scrapeamos) + un form de `next_maintenance_due` (input manual).
- **Si es panel de configuración del modelo de dron**: la info ya existe en
  `dji_drone_models` y `dji_flights`. Es más cercano a Device Management
  que a Cloud Reconstruction. Bajo costo de implementación.

**Recomendación del agente**: si la respuesta es "estado del dron" sin
integración oficial DJI, **construir la vista degradada primero** (lo que
tenemos hoy) y dejar la parte live como toggle deshabilitado con tooltip
"Próximamente: requiere DJI Cloud API". No inventar telemetría.

### Pregunta 3 — Settings

> **Nivel de impacto**: 🟠 **ALTO** (toca NextAuth si incluye gestión de
> usuarios).

**¿"Settings" incluye gestión de usuarios/roles (extensión de NextAuth) o
solo preferencias de UI (tema, idioma, unidades)?**

- **Si incluye gestión de usuarios**: ya tenemos la base con
  `app_users` + NextAuth v5 (commit `b478f72`). Habría que agregar:
  - Endpoints CRUD: `POST /api/users`, `PATCH /api/users/[id]/role`,
    `DELETE /api/users/[id]`.
  - Página `/admin/users` con tabla + invite flow.
  - Permisos: solo `admin` puede invitar; `viewer` se auto-solo-ve.
  - Tabla `audit_log` para registrar cambios de rol (compliance).
- **Si es solo preferencias de UI**: implementación liviana. Las
  preferencias se guardan en `localStorage` o una nueva tabla
  `user_preferences (user_id, key, value)`. Cero cambios de auth.

**Recomendación del agente**: si la respuesta es "incluye gestión de
usuarios", tratarlo como **sprint aparte** (no mezclar con los 6 frames —
es alcance distinto y toca el módulo de auth, que es crítico). Si es solo
preferencias, se puede hacer en 1-2 sesiones con tests.

### Pregunta 4 — Cloud Reconstruction

> **Nivel de impacto**: 🟡 **MEDIO**.

**¿Es la visualización 3D de la nube de puntos del terreno (post-vuelo) o
la gestión de reconstrucciones guardadas? ¿Hay upload de assets o solo
lectura?**

- **Si es visualización 3D embebida**: requiere un viewer (three.js,
  potree, cesium). **Es alcance grande** — viewer de potrice para
  nubes LiDAR puede ser 200+ MB de bundle, requiere WebGL tuning, y los
  assets de nubes de puntos se sirven desde object storage (S3 / Supabase
  Storage). Evaluar si tiene ROI para el operador.
- **Si es gestión de reconstrucciones (lista + metadata)**: mucho más
  accesible. Lista de reconstrucciones con filtros, status, link al
  visor externo de DJI. Bajo costo.

**Recomendación del agente**: si es visualización 3D, **empezar por la
lista + metadata + link externo** y dejar el viewer embebido como
"Próximamente". Si el operador lo pide explícitamente, evaluarlo como
sprint dedicado con presupuesto de tiempo.

### Pregunta 5 — Data Analysis

> **Nivel de impacto**: 🟡 **MEDIO**.

**¿Es analítica histórica agregada (similar a Task History pero con
gráficos más ricos) o comparación entre parcelas? ¿Qué métricas son las
del "análisis" vs el "monitoreo" del Task History?**

- **Si es histórico agregado con gráficos**: es una extensión de Task
  History con charts. Reusar la API `/api/task-history` y agregar
  endpoints de rollup (`/api/data-analysis/area-by-month`,
  `/api/data-analysis/efficiency-by-parcel`). Componentes nuevos:
  `BarChart`, `LineChart` (puros SVG o recharts — recharts es la opción
  más alineada al stack actual).
- **Si es comparación entre parcelas**: requiere una vista de tipo
  "leaderboard" + scatter plot (area vs liters vs hours). Más nuevo,
  pero factible en 2-3 sprints.

**Recomendación del agente**: arrancar con la **opción histórica
agregada** (reusar Task History es alto valor), y dejar la comparación
entre parcelas como v2.

### Pregunta 6 — Device Management

> **Nivel de impacto**: 🟢 **BAJO** (es read-model sobre lo que ya scrapeamos).

**¿Es el registro de los drones del operador (chassis, modelo, fecha de
compra) o la conexión en vivo con el dron activo?**

- **Si es registro de drones**: el SPEC §2.6 actual **removió** el form
  "Agregar dispositivo" por ser decorativo. Si este frame dice lo
  contrario, hay que revertir esa decisión del SPEC (no es problema,
  es una decisión de producto que se puede actualizar — abrir ADR
  primero).
- **Si es conexión en vivo**: es la misma pregunta que Afm Drone
  Pregunta 2. Si la respuesta es "live", fusionar Afm Drone y Device
  Management en una sola feature (probablemente es lo que DJI hace).

**Recomendación del agente**: si es registro, **reabrir el SPEC §2.6**
y agregar CRUD de `dji_drone_models` + tabla `operator_drones` (la
diferencia entre el modelo DJI y la unidad física del operador). Tests
de contrato contra el endpoint nuevo.

---

## 5. Plan de implementación tentativo (post-entrega del usuario)

> Este plan asume que el usuario entregó los 6 frames + respondió el
> cuestionario. **Es tentativo** — el siguiente sprint debe re-evaluarlo
> contra los frames reales y contra las respuestas del cuestionario.
>
> Convención: las capas se referencian por nombre de SDD §3
> (`app/page`, `app/api/route`, `api/repositories`, `lib`, `components`).

### 5.1 Orden sugerido de implementación

Si el tiempo es limitado (1 sprint = 1-2 semanas), este es el orden
recomendado de **menor riesgo → mayor riesgo**:

| # | Frame | Esfuerzo | Riesgo | Dependencias | Razón del orden |
|---|---|---|---|---|---|
| 1 | **Device Management** | 🟢 Bajo | 🟢 Bajo | `dji_drone_models` (ya existe) | Reusa modelo existente; reversión de SPEC §2.6 es decisión chica |
| 2 | **Settings (solo UI)** | 🟢 Bajo | 🟢 Bajo | `localStorage` o `user_preferences` nueva | No toca auth; lo más aislado de los 6 |
| 3 | **Data Analysis (histórico)** | 🟡 Medio | 🟡 Medio | Reusa `/api/task-history` | Extensión de feature ya validada |
| 4 | **Afm Drone (degradado)** | 🟡 Medio | 🟡 Medio | `dji_flights` aggregate por `drone_nickname` | Vista read-model pura, sin telemetría |
| 5 | **Cloud Reconstruction (lista)** | 🟡 Medio | 🟠 Alto | Requiere nueva tabla o nueva fuente de datos | Depende de la respuesta a Pregunta 4 |
| 6 | **Other Regions** | 🔴 Alto | 🔴 Bloqueante | Toca `dji_parcels.region_id` + ADR | **Solo si respuesta a Pregunta 1 es single-tenant con selector** |
| 7 | **Settings (multi-usuario)** | 🟡 Medio | 🟠 Alto | Toca NextAuth | Sprint aparte (ver Pregunta 3) |
| 8 | **Cloud Reconstruction (viewer 3D)** | 🔴 Alto | 🔴 Alto | Bundle + storage | Solo si operador lo pide |
| 9 | **Other Regions multi-tenant** | 🔴 Muy alto | 🔴 Bloqueante | Refactor de TODO el data layer | Roadmap L, no sprint |

### 5.2 Detalle por frame

#### 5.2.1 Device Management

- **Capas SDD §3 tocadas**:
  - `app/devices/page.tsx` (Server Component) — refactor del placeholder
    actual (que según SPEC §2.6 es decorativo).
  - `app/devices/device-detail-panel.tsx` (Client Component) — detail lateral.
  - `app/api/devices/route.ts` — GET lista, POST crea.
  - `app/api/devices/[id]/route.ts` — GET/PATCH/DELETE uno.
  - `api/repositories.ts` — `getDevices`, `createDevice`, `updateDevice`,
    `archiveDevice`.
  - `lib/types.ts` — interface `OperatorDrone` con chassis, model_id,
    purchase_date, etc.
  - `components/devices/device-grid.tsx` (Client) — grid de cards.
  - `components/devices/device-form.tsx` (Client) — form con validación.

- **Tablas BD**:
  - Nueva `operator_drones (id, drone_nickname FK?, chassis, model_id FK,
    purchase_date, status, warranty_expires_at, assigned_pilot FK?,
    last_maintenance_at, created_at, updated_at)`.
  - Migración: `add_operator_drones.sql` con FK a `dji_drone_models` y
    `app_users` (piloto).
  - Reversión de SPEC §2.6: el form pasa de "removido" a "implementado".

- **Endpoints**:
  - `GET /api/devices?status=active&model=t50` — paginado.
  - `POST /api/devices` — admin only.
  - `PATCH /api/devices/[id]` — admin only.
  - `DELETE /api/devices/[id]` — soft delete (`status='archived'`).

- **Componentes UI**:
  - Reusar: `components/ui/section-card.tsx`, `components/ui/badge.tsx`,
    `components/ui/empty-state.tsx` (todos del refactor §3.1 de SPEC).
  - Crear: `device-grid`, `device-form`, `device-status-chip`.

- **Riesgos**:
  - "chassis vs serial_number": la guía §5.4 advierte que `serial_number`
    en DJI es session-id, no hardware. Confirmar con el cliente si la
    Figma usa "serial" o "chassis" — si es "serial", estamos scrapeando
    el dato incorrecto hoy.
  - FK a `app_users` para `assigned_pilot`: solo si el frame lo pide. Si
    no, string libre.

- **TDD**:
  - `tests/api-devices.test.ts` (list, create, archive, validation).
  - `tests/components/devices/device-grid.test.tsx` (render típico,
    render vacío, render con muchos devices).
  - `tests/components/devices/device-form.test.tsx` (submit, validation).

#### 5.2.2 Settings (solo UI)

- **Capas SDD §3 tocadas**:
  - `app/settings/page.tsx` (Server Component).
  - `app/settings/PreferencesForm.tsx` (Client Component).
  - `app/api/user-preferences/route.ts` — GET/PUT por user.
  - `lib/format.ts` — extender si agregamos toggle de unidades.
  - `lib/types.ts` — `UserPreferences`.

- **Tablas BD**:
  - Nueva `user_preferences (user_id FK, key TEXT, value JSONB, PRIMARY
    KEY (user_id, key))` — o usar `localStorage` si el operador no
    quiere persistencia cloud.
  - Migración: `add_user_preferences.sql`.

- **Endpoints**:
  - `GET /api/user-preferences` — devuelve map de prefs.
  - `PUT /api/user-preferences` — bulk update.

- **Componentes UI**:
  - Reusar todo de `components/ui/`.
  - Crear: `PreferencesForm` con secciones colapsables.

- **Riesgos**:
  - **Toggle de unidades es alto riesgo**: si cambiamos de `ha` a `ac`,
    TODO el formateo de `lib/format.ts` debe respetar la preferencia
    del usuario activo. Esto rompe la regla de "TZ `America/Bogota`" si
    no se hace con cuidado. **Recomendación**: NO incluir toggle de
    unidades en este sprint — solo tema, idioma, date format.

- **TDD**:
  - `tests/api-user-preferences.test.ts`.
  - `tests/components/settings/preferences-form.test.tsx`.

#### 5.2.3 Data Analysis (histórico)

- **Capas SDD §3 tocadas**:
  - `app/data-analysis/page.tsx` (Server Component).
  - `app/data-analysis/DataAnalysisClient.tsx` (Client Component).
  - `app/api/data-analysis/route.ts` — agregaciones.
  - `lib/djiag-data-analysis-aggregator.ts` — nueva lógica de rollups.
  - `components/data-analysis/BarChart.tsx`, `LineChart.tsx`,
    `MetricsGrid.tsx` (reusar el de Task History).

- **Tablas BD**:
  - Probablemente **ninguna nueva** — los datos ya están en
    `dji_flights` + `dji_fumigations`.
  - Considerar vista materializada `mv_data_analysis_rollup` si las
    queries son lentas con 7000+ flights.

- **Endpoints**:
  - `GET /api/data-analysis?from=&to=&metric=area| liters| hours| efficiency&groupBy=day|week|month`.
  - `GET /api/data-analysis/leaderboard?metric=&limit=10` (top-N parcelas).

- **Componentes UI**:
  - Reusar: `components/task-history/MetricsGrid.tsx` (extraer a
    `components/ui/` si se reusa).
  - Reusar: `components/ui/date-range-picker.tsx` (de Task History F4).
  - Crear: `BarChart`, `LineChart` (SVG puro, no recharts — alineado
    con la decisión de "sin deps externas nuevas" del Task History F4).

- **Riesgos**:
  - Performance con 7000+ flights: si se hace GROUP BY en cada request,
    puede ser lento. Materializar con refresh on-pipeline-run.

- **TDD**:
  - `tests/api-data-analysis.test.ts`.
  - `tests/lib/djiag-data-analysis-aggregator.test.ts`.
  - `tests/components/data-analysis/bar-chart.test.tsx`.

#### 5.2.4 Afm Drone (degradado)

- **Capas SDD §3 tocadas**:
  - `app/afm-drone/page.tsx` (Server Component).
  - `app/afm-drone/DroneStatusClient.tsx` (Client Component).
  - `app/api/afm-drone/[nickname]/route.ts` — vista agregada.
  - `lib/djiag-drone-status-aggregator.ts`.

- **Tablas BD**:
  - Nueva `drone_maintenance (id, drone_nickname, performed_at, note,
    flight_hours_at_maintenance, performed_by FK app_users)`.
  - Migración: `add_drone_maintenance.sql`.

- **Endpoints**:
  - `GET /api/afm-drone/[nickname]` — estado del dron (last flight,
    flight hours, next maintenance).
  - `POST /api/afm-drone/[nickname]/maintenance` — registrar mantenimiento.
  - `GET /api/afm-drone/[nickname]/maintenance` — historial.

- **Componentes UI**:
  - Crear: `BatteryGauge`, `MaintenanceTimeline`, `LastFlightCard`.

- **Riesgos**:
  - Si el frame pide telemetría live (batería, GPS), **no implementar
    sin integración oficial DJI**. Marcar como "Próximamente" en la UI.

- **TDD**:
  - `tests/api-afm-drone.test.ts`.
  - `tests/lib/djiag-drone-status-aggregator.test.ts`.

#### 5.2.5 Cloud Reconstruction (lista + metadata)

- **Capas SDD §3 tocadas**:
  - `app/cloud-reconstruction/page.tsx` (Server Component).
  - `app/cloud-reconstruction/CloudReconstructionClient.tsx` (Client).
  - `app/api/cloud-reconstruction/route.ts` — lista.
  - `lib/djiag-cloud-reconstruction-client.ts` — cliente nuevo (¿scraping
    de un endpoint DJI no usado hoy?).

- **Tablas BD**:
  - Nueva `cloud_reconstructions (id, name, parcel_id FK?, status,
    point_count, file_size_mb, format, coverage_area_ha, drone_used,
    created_at, thumbnail_url)`.
  - **Esta tabla NO existe en el scraper actual** — requiere investigar
    si DJI Agras expone reconstrucciones via la UI que scrapeamos, o si
    necesitamos API oficial.

- **Endpoints**:
  - `GET /api/cloud-reconstruction?parcel=&from=&to=`.
  - `GET /api/cloud-reconstruction/[id]` — detail con link al viewer DJI.

- **Componentes UI**:
  - Reusar: `components/ui/empty-state.tsx`, `components/ui/badge.tsx`.
  - Crear: `ReconstructionCard`, `ReconstructionDetailPanel`.

- **Riesgos**:
  - **El mayor riesgo es la fuente de datos**: hoy no scrapeamos
    reconstrucciones. Si DJI no las expone via la misma UI que ya
    scrapeamos, esto se bloquea. **Spike obligatorio antes**: 1 sesión
    para hacer captura manual del endpoint DJI y verificar formato JSON.

- **TDD**:
  - Bloqueado hasta resolver el spike. Una vez con datos, tests
    similares a Task History.

#### 5.2.6 Other Regions (single-tenant con selector)

- **Capas SDD §3 tocadas**:
  - `app/regions/page.tsx` (Server Component).
  - `app/regions/RegionsClient.tsx` (Client).
  - `app/api/regions/route.ts` — CRUD.
  - `api/repositories.ts` — agregar filtro opcional `region_id` en
    `getParcels`, `getFlightPoints`, `getMetrics`, etc.
  - `components/region-selector.tsx` (Client) — dropdown en el header.

- **Tablas BD**:
  - Nueva `regions (id, name, bbox GEOMETRY(Polygon, 4326), center_point
    GEOMETRY(Point, 4326), created_at, status)`.
  - Migración: `add_regions.sql` con GIST en `bbox` y `center_point`.
  - Migración: `add_region_id_to_dji_parcels.sql` con columna nullable
    (no rompe queries existentes).
  - Seed inicial: script `scripts/seed-regions-from-bboxes.js` que
    deriva regiones desde los bboxes de `dji_parcels` agrupados.

- **Endpoints**:
  - `GET /api/regions`.
  - `POST /api/regions` (admin).
  - `PATCH /api/regions/[id]` (admin).
  - Todas las APIs existentes aceptan `?region_id=` opcional.

- **Componentes UI**:
  - Reusar: `components/ui/section-card.tsx`.
  - Crear: `RegionSelector` (en el header, dropdown que filtra el mapa).
  - Crear: `RegionsTable` (admin only).

- **Riesgos**:
  - **Si el resultado del cuestionario es multi-tenant**, este plan NO
    aplica. Re-derivar.
  - Performance del filtro `region_id` en queries existentes: verificar
    que el índice GIST + `region_id` da EXPLAIN razonable.

- **TDD**:
  - `tests/api-regions.test.ts`.
  - `tests/components/region-selector.test.tsx`.
  - Contract test: filtrar por `region_id` en `/api/parcels` debe dar
    el subconjunto correcto.

### 5.3 Resumen de componentes UI a crear vs reusar

| Frame | Reusar de `components/ui/` | Nuevos |
|---|---|---|
| Device Management | section-card, badge, empty-state | device-grid, device-form, device-status-chip |
| Settings | section-card, badge | preferences-form |
| Data Analysis | metrics-grid (de Task History), date-range-picker | bar-chart, line-chart, leaderboard-table |
| Afm Drone | badge, section-card | battery-gauge, maintenance-timeline, last-flight-card |
| Cloud Reconstruction | empty-state, badge | reconstruction-card, reconstruction-detail-panel |
| Other Regions | section-card | region-selector, regions-table |

### 5.4 Tests a crear (resumen)

- `tests/api-devices.test.ts` (~8 tests)
- `tests/api-user-preferences.test.ts` (~5 tests)
- `tests/api-data-analysis.test.ts` (~10 tests)
- `tests/api-afm-drone.test.ts` (~8 tests)
- `tests/api-cloud-reconstruction.test.ts` (~6 tests, bloqueado por spike)
- `tests/api-regions.test.ts` (~6 tests)
- `tests/lib/djiag-data-analysis-aggregator.test.ts` (~8 tests)
- `tests/lib/djiag-drone-status-aggregator.test.ts` (~6 tests)
- 6 archivos de componentes (`tests/components/<feature>/...`)
- 1 contract test de aislamiento: `tests/contract-region-id-filter.test.tsx`

**Total estimado**: ~70 tests nuevos. La baseline actual (588/604 con
Docker apagado) pasaría a **~658/674** una vez hecho el sprint completo.

---

## 6. Próximos pasos enumerados

1. **Usuario (operador)**: exporta los 6 frames siguiendo §3.
   - Tiempo estimado: 30-45 min si usa plugin JSON; 1-2h si es manual.
2. **Usuario**: responde el cuestionario de §4.
   - Tiempo estimado: 15-20 min.
3. **Agente siguiente (cualquier sesión)**:
   - Lee este doc + los frames exportados.
   - Actualiza `figma-vs-bd.md` con las 6 secciones de auditoría
     (mismo patrón que Frame A y Frame B, una tabla de campos UI vs
     columna BD por cada frame).
   - Cierra el gap #13.
4. **Agente siguiente**:
   - Lee las respuestas del cuestionario.
   - Si la respuesta a Pregunta 1 es multi-tenant real: **abrir ADR
     nuevo** y discutir antes de implementar Other Regions.
   - Si single-tenant: implementar según §5.2.6.
5. **Agente siguiente**:
   - Spec de implementación: actualizar `docs/SPEC.md` (decisiones
     cerradas — reabrir el ADR correspondiente) o crear
     `docs/SPEC-v2.md` (si la reversión toca varias decisiones).
6. **Agente siguiente**:
   - TDD con el patrón de la `02_TDD_AeroAdmin_AFM.md`:
     test primero (rojo), código mínimo (verde), refactor.
   - Sprint por frame siguiendo el orden de §5.1.
7. **Agente siguiente**:
   - Correr contract test adversariales contra Task History después
     de implementar Data Analysis (comparten agregaciones — riesgo de
     regresión cruzada).
8. **Agente siguiente**:
   - Actualizar `docs/audit/BITACORA.md` con la entrada del sprint
     (formato estándar del archivo).

---

## 7. Anexo — convenciones usadas en este doc

- **Nombres de frames**: `kebab-case` para carpetas, nombre exacto Figma
  para archivos internos.
- **Tablas BD**: `snake_case` plural.
- **Endpoints**: `/api/<feature>` en singular cuando devuelve 1, plural
  cuando devuelve colección (convención actual del repo).
- **Componentes**: `PascalCase`, named export, en `components/<feature>/`.
- **Tests**: `tests/<feature>.test.ts` para lib/API, `tests/components/<feature>/`
  para componentes.

---

## 8. Referencias

- `docs/audit/figma-vs-bd.md` — audit actual, gap #13.
- `docs/audit/BITACORA.md` — bitácora histórica, roadmap macro.
- `docs/guia/01_SDD_AeroAdmin_AFM.md` — §1 alcance, §3 capas, §7 ADRs.
- `docs/guia/02_TDD_AeroAdmin_AFM.md` — flujo TDD, checklist por tipo de
  artefacto.
- `docs/guia/03_MEJORES_PRACTICAS_AGENTES.md` — §10 "preguntar/señalar,
  no improvisar".
- `docs/SPEC.md` — decisiones de producto cerradas (no reintroducir sin
  discutir).
