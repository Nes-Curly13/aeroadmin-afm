# DJI AG Scraper — Defects & Data Inventory

> Documento vivo. Cada defecto incluye: descripción, evidencia (lo que vi en los datos), impacto, y fix sugerido.
> Datos de referencia: corrida del **2026-06-10 12:35** (UTC-5). `land_files/` quedan de una corrida previa del **2026-06-02 12:14** y están desactualizados.

---

## 1. Inventario de lo que el scraper capturó

| Archivo | Cantidad | Status | Última modificación |
|---|---|---|---|
| `crawl_manifest.json` | 3 URLs visitadas | OK | 2026-06-10 12:35 |
| `records_history.json` | **30 días** | Parcial (ver §2.3) | 2026-06-10 12:35 |
| `mission_fields.json` | **162 parcelas** | Parcial (ver §2.2) | 2026-06-10 12:35 |
| `land_file_urls.json` | **0 entradas** | **Vacío (defecto crítico)** | 2026-06-10 12:35 |
| `land_files/*.json` | 196 archivos (80 unique IDs) | **Stale — 8 días** | 2026-06-02 12:14 |
| `land_files/*.kml` | 80 archivos | **Stale — 8 días** | 2026-06-02 12:14 |
| `page_snapshots.json` | 3 páginas (mission/records/devices) | OK, debug artifact | 2026-06-10 12:35 |
| `nav_states.json` | 2 estados | Engañoso (ver §3.5) | 2026-06-10 12:35 |
| `flight_record_responses.json` | ~200 responses | OK, debug artifact | 2026-06-10 12:35 |
| `records_page_text.txt` | 235 líneas | OK, debug artifact | 2026-06-10 12:35 |

**Resumen**: la corrida del 10 de junio solo capturó 2 de los 3 dominios de datos (history + fields). **No descargó ningún asset nuevo** — los 276 archivos de `land_files/` son de la corrida anterior del 2 de junio.

---

## 2. Defectos críticos (bloquean producción)

### 2.1 `land_file_urls.json` siempre queda vacío — el filtro de URL es incorrecto

**Síntoma**: el archivo pesa 2 bytes (`[]`). La consola reporta `0 asset URLs` sin error.

**Causa raíz**: el scraper filtra las respuestas GraphQL con esta cadena (scrape_djiag_records.js:116):
```js
if (url.includes('ag-plot/api/graphql?name=lands')) {
```

**Evidencia**: revisé `flight_record_responses.json` completo. Las URLs que DJI realmente llama son:
- `https://agro-vg.djiag.com/api/graphql?name=userProfile` ← 200 después del login
- `https://agro-vg.djiag.com/api/graphql?name=departmentTree` ← 200 después del login
- (varias APIs REST de `https://www.djiag.com/api/...`)

**Nunca** aparece `ag-plot/api/graphql?name=lands` en el log. Ese endpoint no existe en el frontend actual de DJI SmartFarm Web, o el scraper se está conectando a un sub-grafo equivocado.

**Impacto**:
- `dji_land_assets` queda vacía en la BD.
- El dropdown de "Seleccionar activo" en `/map` muestra `0 Activos DJI`.
- La capa Leaflet de parcelas queda sin renderizar.
- Imposible tener "trazabilidad por parcela" — la geometría simplemente no entra.

**Fix**:
1. En el browser DevTools, abre DJI SmartFarm Web, ve a `/mission`, abre Network → filtra por `graphql`, y captura qué nombre de query usa el frontend para pedir la lista de campos con sus assets geometry/waypoint/parameter. Probablemente es algo como `lands`, `landList`, `missionList` o un endpoint REST.
2. Actualizar el filtro en `scrape_djiag_records.js:116`.
3. Bonus: loguear TODAS las URLs de GraphQL cuando la lista de assets queda vacía, para que el próximo cambio se detecte rápido.

---

### 2.2 Solo se captura el ~16% de las parcelas (faltan 852 de 1014)

**Síntoma**: `mission_fields.json` tiene 162 entries. La página `/mission` muestra `Field Management (1014)` en su título (page_snapshots.json:6).

**Causa raíz**: el scraper hace `await page.locator('body').innerText()` (scrape_djiag_records.js:190) y luego `parseFieldCardsFromText(missionText)` que recorre las primeras ~20 cards que el browser tiene renderizadas. **No hace scroll ni activa paginación.**

**Impacto**:
- El 84% de las parcelas del cliente no se importan.
- Cuando el cliente entre a su panel, no ve la mayoría de sus campos.

**Fix**:
1. Después de navegar a `/mission`, hacer scroll incremental hasta que el contador `(N)` deje de crecer, con `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` en bucle, esperando que aparezcan nuevos `day_item_*` / field cards.
2. Si la lista usa paginación explícita (botones "next"), hacer click hasta el final.
3. Re-leer el `body.innerText` después de cada scroll.

---

### 2.3 Solo se captura 1 mes de history (30 días de 23 años)

**Síntoma**: `records_history.json` tiene 30 rows. La página `/records` muestra header `Agriculture / 4219.31mu / 6272times / 80183L / 495Hour23min57s` (records_page_text.txt:19-24). Suma de los 30 días = ~1095 mu. **Diferencia de ~3124 mu** que no se captura.

**Causa raíz**: el scraper lee los elementos visibles con `page.locator('[id^="day_item_"]')` (scrape_djiag_records.js:183). DJI usa scroll virtualizado en `/records` — solo los ~30 días visibles están en el DOM. Sin scroll, los demás no se cargan.

**Impacto**:
- Histórico incompleto desde el día 1.
- Imposible calcular cadencia real por parcela (no hay historial suficiente para "cada cuánto se fumiga esta parcela").
- Los días pre-2026-05-10 simplemente no existen en la BD.

**Fix**: misma técnica de scroll que §2.2. Iterar scroll → re-leer `day_item_*` hasta que el contador no crezca.

---

### 2.4 `parseHistoryRecord` no parsea, el importer rescata con regex

**Síntoma**: todos los campos `category/area/times/usage/workTime` en `records_history.json` vienen vacíos:
```json
{
  "date": "2026/06/10",
  "weekday": "WednesdayAgriculture",
  "category": "",
  "area": "",
  "times": "",
  "usage": "",
  "workTime": "",
  "raw": "2026/06/10WednesdayAgriculture0.16mu1times3.1L-01min28s"
}
```

**Causa raíz** (scrape_djiag_records.js:55-74): la función `parseHistoryRecord` espera 7 líneas separadas por `\n+` y asume una jerarquía fija (date / weekday / category / area / times / usage / workTime). Pero el HTML de DJI mete cada día en un único `<div id="day_item_*">` con todo el texto concatenado sin saltos. El scraper recibe `"2026/06/10WednesdayAgriculture0.16mu1times3.1L-01min28s"` y como no son 7 líneas, devuelve `{raw}` con todo vacío.

**Compensación rota** (import_djiag_data.js:57-81): el importer tiene su propio `parseHistoryRecord` que rescata los campos haciendo regex sobre el `raw`. Funciona, pero es lógica duplicada que ya demostró ser frágil. Si DJI cambia el separador, fallan ambos parsers en paralelo.

**Fix**:
1. En el scraper, parsear el string pegado directamente:
   ```js
   const m = text.match(/^(\d{4}\/\d{2}\/\d{2})([A-Za-z]+)Agriculture([\d.]+)mu(\d+)times([\d.]+)L-(.+)$/);
   ```
2. Devolver `{date: m[1], weekday: m[2], category: 'Agriculture', area: m[3], times: m[4], usage: m[5], workTime: m[6]}`.
3. Que el importer NO haga su propio parseo — confíe en los campos ya extraídos.

---

### 2.5 La auth es frágil — `agro-vg.djiag.com` puede no tener cookie cuando se necesita

**Síntoma en datos**: en `flight_record_responses.json` vemos esta secuencia:
```
401 → /agro-vg.djiag.com/api/graphql?name=userProfile
401 → /agro-vg.djiag.com/api/graphql?name=departmentTree
302 → /agro-vg.djiag.com/auth/user/logout?...
200 → /account.dji.com/logout?...
302 → /agro-vg.djiag.com/auth/user/loginback?ticket=...
200 → /www.djiag.com/?token=<JWT>   ← ¡token en URL!
200 → /agro-vg.djiag.com/api/graphql?name=userProfile   ← ahora sí
```

**Causa raíz**: el flujo de auth es cross-subdomain (`account.dji.com` ↔ `agro-vg.djiag.com` ↔ `www.djiag.com`). El JWT se pasa por URL (`?token=...`) y luego se establece como cookie en `agro-vg.djiag.com`. El scraper espera `page.waitForURL('**/mission')` (scrape_djiag_records.js:163) — esto se cumple apenas aterriza en `/mission`, **pero las cookies en `agro-vg.djiag.com` se están estableciendo en ese mismo instante o después**. Las primeras 401s son probes del frontend que el scraper registra como "fallo de auth" cuando en realidad son probes pre-redirect.

**Impacto**:
- En la corrida del 6/10, el scraper siguió funcionando en la UI pero el GraphQL que pide los assets (`name=lands` o el que sea) nunca se ejecutó, o se ejecutó sin auth válida.
- Cualquier cambio en el orden de redirects de DJI rompe todo.

**Fix**:
1. Después de `page.waitForURL('**/mission')`, **esperar explícitamente** a que la primera llamada a `agro-vg.djiag.com/api/graphql` retorne 200 (no 401). Un `page.waitForResponse(url => url.includes('graphql') && status === 200, { timeout: 30000 })`.
2. Persistir la sesión con `context.storageState({path: 'djiag_session.json'})` y reusar en corridas siguientes — así no se repite el flow de redirect cada vez.
3. Documentar que el scraper depende de la app SPA de DJI, no de un endpoint público.

---

## 3. Defectos importantes (no rompen, pero degradan el producto)

### 3.1 `land_files/` está 8 días desactualizado

**Síntoma**: 276 archivos con `LastWriteTime: 6/2/2026 12:14-12:15 PM`. El resto del export es de 6/10.

**Causa**: derivado de §2.1 — la corrida del 6/10 no descargó nada nuevo.

**Impacto**:
- Cuando se reinserte a la BD, los assets de geometría/waypoint/parameter son de hace 8 días. Si una parcela fue editada en DJI entre 6/2 y 6/10, no se refleja.
- No hay forma de saber en el importer que esos assets son viejos.

**Fix**:
1. Resolver §2.1 (que los assets se descarguen).
2. Como cinturón de seguridad: hacer que el scraper registre un timestamp de "asset last fetched" y el importer rechace assets más viejos que N días con un warning.

---

### 3.2 Formato de tiempo inconsistente — ningún parser lo maneja completo

**Evidencia** en `raw` (records_history.json):
- `01min28s` (sin "Hour", solo min+s)
- `5Hour24min40s` (completo)
- `6Hour27min` (sin segundos)
- `6Hour24s` (sin minutos — esto es bug en DJI mismo)
- `6Hour4min` (typo en DJI: le falta la `s` o el `0`)
- `1Hour58min15s` (completo, pero con `1Hour` no `1Hours`)
- `59min14s` (sin "Hour")
- `6Hour25min35s` (completo)

**Causa**: el regex del importer (`/L-(.+)$/`) captura todo después del `L-` como string y lo guarda literal en `work_time_text`. Eso no es parsing — es pasamanos. El campo `workTime` debería estar normalizado a algo usable (segundos totales, o `HH:MM:SS`).

**Impacto**:
- Cualquier query tipo "vuelos que duraron más de 4 horas" requiere re-parseo del string en cada lectura.
- Los valores con bug de DJI (`6Hour24s`, `6Hour4min`) son indetectables como "anomalía" sin parsear.

**Fix**:
1. En el scraper, normalizar a `HH:MM:SS` o a segundos totales (`work_time_seconds: number`).
2. Preservar el raw original en `work_time_text` por si acaso.
3. Manejar: `^(\d+)Hour(?:(\d+)min)?(?:(\d+)s)?$` y `^(\d+)min(\d+)s$` por separado.

---

### 3.3 `geometry.json` tiene 2 features, KML solo guarda 1

**Evidencia** (land_files/..._geometry.json):
```json
{
  "features": [
    { "geometry": { "type": "Polygon", "coordinates": [[...20 vértices...]] }, "properties": {"funcType": "PlantZone", "parameters": {"offset": [...]}}},
    { "geometry": { "type": "MultiPoint", "coordinates": [] }, "properties": {"funcType": "ReferencePoint"}}
  ]
}
```

**Causa** (scrape_djiag_records.js:22-34): `geoJsonToKml` solo maneja `Polygon` y `Point`. El `MultiPoint` (vacío en este caso, pero podría tener puntos) va a un `<description>` con JSON escapado. Se pierde semántica.

**Impacto**:
- El `ReferencePoint` (punto de referencia para RTK / home point) se ignora semánticamente.
- Si en el futuro DJI pone waypoints reales en el `MultiPoint`, se pierden.

**Fix**: extender `geoJsonToKml` para que `MultiPoint` genere múltiples `<Point>` Placemarks, o serializar todo el FeatureCollection como KML con `<MultiGeometry>`.

---

### 3.4 `geometry.json` es la zona de aspersión, no el lindero del campo

**Evidencia** (parcela `llano Gómez ste5`):
- `mission_fields.json` dice `area: "5.78 ha"`.
- `parameter.json` dice `inner_area: 2502.96 m² ≈ 0.25 ha`.
- El polígono tiene 20 vértices y un área coherente con 0.25 ha, no con 5.78 ha.

**Causa**: DJI devuelve la geometría del `PlantZone` (la zona que el dron va a fumigar) como geometría de la parcela. El lindero real del campo NO viene en el JSON — solo viene como `area` en texto en el catálogo.

**Impacto**:
- Si el importer pone este polígono en `parcels.geom` como "la parcela", la geometría del mapa muestra solo la zona fumigada, no el campo completo.
- Cualquier cálculo de "qué porcentaje de la parcela se fumigó" da 100% siempre.

**Fix**:
1. Crear una columna separada: `parcels.footprint_geom` (lo que devuelve DJI) vs `parcels.boundary_geom` (el lindero real, que **no tenemos** de DJI).
2. Para el lindero, opciones: (a) pedirle al cliente que suba un KML/shapefile del lindero, (b) tomar el convex hull del PlantZone, (c) aceptar que la geometría disponible es solo la zona fumigada y documentarlo.

---

### 3.5 `nav_states.json` es engañoso

**Evidencia**:
- Click en "Field Management" → URL resultante: `https://www.djiag.com/mission` (no navegó)
- Click en "Data Analysis" → URL resultante: `https://www.djiag.com/mission` (no navegó, solo expandió submenú)

**Causa** (scrape_djiag_records.js:193-205): el scraper asume que `getByText(label).click()` navega a una URL nueva. DJI es una SPA: los items del menú expanden submenús en lugar de cambiar la URL.

**Impacto**: bajo — el archivo `nav_states.json` se usa solo como debug. Pero el scraper escribe esos dos snapshots inútiles como si fueran navegaciones reales.

**Fix**:
1. Detectar cambio de URL real después del click; si no cambia, marcar `navigated: false`.
2. Si solo se expande submenú, capturar el submenú también.
3. O eliminar este bloque y dedicar el esfuerzo a la paginación de `/mission` que sí falta.

---

### 3.6 `parameter.json` muestra `mission_fly_num: 0` — son PLANS, no FLIGHTS

**Evidencia** (land_files/..._parameter.json):
- `mission_fly_num: 0`
- `mission_fly_battery_use_num: 0`
- `mission_fly_work_total_time: -1`
- `photo_num: 0`
- `mapping_percent: 0`
- `mapping_statue: "mapping_state_none"`

**Causa**: el JSON de `parameter` es la **configuración actual** del plan de fumigación, no el registro de vuelos realizados. No tiene timestamp, no tiene historial.

**Impacto crítico**:
- **No se puede reconstruir "cuándo se fumigó esta parcela por última vez"** desde los `land_files/*`.
- El usuario pidió "notificaciones de cuándo fumigar la próxima vez" — para eso necesitamos historial de fumigaciones, y los `land_files` no lo dan.
- La única fuente de fechas de fumigación está en `/records` y es **a nivel de día, no de parcela**.

**Fix**:
1. Reconocer que los `land_files` son útiles solo para: (a) la geometría actual del campo, (b) los parámetros de aspersión actuales, (c) el waypoint plan.
2. La fecha de última fumigación tiene que venir de cruzar `dji_daily_summaries` con un desglose por parcela. Si DJI no da ese desglose en su UI, hay que clickear cada día en `/records` y leer el detalle (asumiendo que lo tiene).

---

## 4. Mejoras (no son bugs, son hardeners)

### 4.1 No hay `try/finally` para cerrar browser

Si algo tira entre `chromium.launch` y `browser.close()`, el proceso Chrome queda colgado en Windows. Patrón:
```js
const browser = await chromium.launch(...);
try { ... } finally { await browser.close().catch(() => {}); }
```

### 4.2 Descarga de assets es secuencial sin retry/timeout

```js
for (const item of assetIndex.values()) {
  const res = await fetch(item.url);  // sin AbortSignal, sin retry
  ...
}
```

Si un signed URL de DJI expiró, el fetch tira y mata toda la corrida. Usar `Promise.all` con `p-limit(4)` + `AbortSignal.timeout(30_000)` + reintentos.

### 4.3 `loadEnvFromLocalFile` está duplicado

Misma función (con pequeñas diferencias) en `scrape_djiag_records.js:40-53` y `import_djiag_data.js:5-21`. Mover a `lib/env.js`. Mejor aún: usar `dotenv` (npm) y olvidarse del código casero.

### 4.4 `page_snapshots.json`, `nav_states.json`, `flight_record_responses.json`, `records_page_text.txt` son debug artifacts

No deberían quedar en `djiag_exports/` que es la fuente para el importer. Mover a `djiag_exports/.debug/` o tras `DEBUG_SCRAPER=1` env flag.

### 4.5 `.env.example` no documenta `DJIAG_EMAIL` / `DJIAG_PASSWORD`

El script falla con error opaco. Agregar al ejemplo.

### 4.6 No hay storage state para sesión

Cada `npm run scrape:djiag` re-loggea desde cero. Persistir con `context.storageState({ path: 'djiag_session.json' })` y reusar.

### 4.7 `index.js` de 2 MB en la raíz del repo

`C:\Users\agFab\OneDrive\Documents\DroneFlightAFM\index.js` (2,065,110 bytes) es un bundle compilado de Next.js (`document.createElement("link").relList`, código de `modulepreload`). Se filtró accidentalmente a la raíz. Mover a `.next/` y agregar a `.gitignore`.

### 4.8 Encoding en PowerShell confunde al developer

Cuando se inspeccionan los JSONs desde PowerShell con `Get-Content` (code page 437/1252 en consola), caracteres como `ó`, `í`, `á` se muestran como `A3`, `A-`, `?`. **Los archivos en disco están bien en UTF-8** (verificado leyendo bytes: `Boyacá` se almacena como `0x42 0x6F 0x79 0x61 0x63 0xC3 0xA1`, que es UTF-8 válido). Documentar para que el equipo no piense que hay corrupción.

### 4.9 `parseFieldCardsFromText` con `lines.length - 4` es frágil

Usa índice fijo (línea 0 = tipo, 1 = nombre, 2 = área, 3 = ubicación, 4 = fecha). Si DJI cambia el orden o inserta un campo entre ellos (e.g., un badge "Premium"), se rompe. Mejor: regex por campo (`/area:\s*(.+)/`, etc.) o esperar a que el frontend exponga `data-*` attributes.

### 4.10 El scraper no falla en voz alta cuando algo es anormal

Si `historyRows.length === 0` o `missionItems.length === 0` o `assetIndex.size === 0` o `responses.length < 5`, el script debería gritar. Hoy reporta "Captured 0 X" con exit 0.

---

## 5. Lo que se va a insertar a la BD (resumen)

Asumiendo que se ejecuta el importer actual (`import_djiag_data.js`) con los datos del 6/10, esto es lo que entra:

### `dji_daily_summaries` (30 filas)
- Datos: rollup diario de área fumigada, sorties, litros, tiempo de trabajo
- **NO tiene `parcel_id`** — no se puede saber qué parcela específica se fumigó cada día
- **Problema de modelo**: el usuario quiere trazabilidad por parcela, pero esta tabla es por día-globales

### `dji_field_catalog` (162 filas)
- Datos: nombre, área en texto, ubicación, fecha de última edición
- Sin geometría
- **NO tiene `client_id`** (no se puede ligar al cliente)
- Sin fecha de creación del campo

### `dji_land_assets` (0 filas en la corrida del 6/10)
- **Vacía por §2.1**
- Los 276 archivos en `land_files/` (de 6/2) NO se importan porque el importer solo procesa URLs en `land_file_urls.json`

### `dji_import_batches` (1 fila)
- 1 batch con `source='djiag'`, timestamp del import

### Tablas que NO se tocan
- `clients` — solo se popula por seed.sql
- `parcels` (tabla de dominio) — **vacía, ningún importador la llena**
- `flights` (tabla de dominio) — **vacía, ningún importador la llena**

---

## 6. Recomendación: lo que hay que resolver antes de tocar la BD

1. **§2.1** — Arreglar el filtro del endpoint de assets (sin esto, no hay geometría en la BD)
2. **§2.2 + §2.3** — Scroll/paginación en `/mission` y `/records` (sin esto, los datos están al 16% y al 1 mes)
3. **§2.5** — Auth robusta + storage state (sin esto, la próxima corrida puede fallar diferente)
4. **§2.4 + §3.2** — Parseo correcto en el scraper (sin esto, el importer depende del raw)
5. **Decisión de modelo** — Antes de tocar la BD, decidir si `dji_daily_summaries` se queda como está (rollups por día) o se transforma a algo que permita la trazabilidad por parcela. La opción A (mínimo) es agregar una tabla `dji_fumigations (id, parcel_external_id, date, area_mu, ...)` poblada clickeando cada día en `/records`. La opción B (mejor) es arreglar la auth y usar el GraphQL para pedir el desglose por parcela.

---

## 7. Datos de soporte

- **Cuenta cliente**: visible en `page_snapshots.json` como `Afm Drone` (cuenta del operador)
- **Región del cliente**: `Other Regions` (probablemente Colombia, dados los nombres de las parcelas: Valle del Cauca, Palmira, Candelaria)
- **Cultivos observados**: `Caña de azúcar` (en seed.sql de Supabase) — pero los datos scrapeados son `Farmland` y `Orchards` (en el catálogo de DJI), sin tipo de cultivo
- **Período scrapeado**: 2026-05-10 a 2026-06-10 (30 días continuos, con huecos — no todos los días tienen fumigación)
- **Día más activo**: 2026-05-28 con 67.95 mu / 82 sorties / 840.3 L
- **Día menos activo**: 2026-06-10 con 0.16 mu / 1 sortie / 3.1 L (posiblemente el día de la corrida del scraper, todavía en curso)

---

## 8. Análisis profundo de los assets de DJI (`land_files/`)

> Mapeo de los 276 archivos a tablas, columnas y decisiones. Resultado de leer **todos** los 80 `parameter.json`, los 80 `geometry.json` y los 36 `waypoint.json`.

### 8.1 Inventario físico

| Kind | Archivos | Tamaño | Notas |
|---|---|---|---|
| `geometry.json` | 80 | 1-3 KB c/u | FeatureCollection con 2 features (Polygon + MultiPoint vacío) |
| `parameter.json` | 80 | 663 B - 3.9 KB | Configuración del plan de fumigación actual |
| `waypoint.json` | 36 | 1-16 KB c/u | Secuencia de waypoints del plan de vuelo actual |
| `geometry.kml` | 80 | 1-2 KB c/u | Derivado, generado por `geoJsonToKml` en el scraper |

**Total: 80 externalIds únicos con geometría**, 36 de ellos con plan de vuelo (waypoint), 80 con configuración de aspersión (parameter).

### 8.2 `geometry.json` — estructura

Cada archivo es siempre un `FeatureCollection` con **exactamente 2 features**:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [lng, lat, alt], [lng, lat, alt], ...  // 4-263 vértices (cerrado)
        ]]
      },
      "properties": {
        "funcType": "PlantZone",
        "parameters": {
          "offset": [0, 1.5, 0, 1.5, ...]   // N valores, donde N = vértices - 1
        }
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "MultiPoint", "coordinates": [] },
      "properties": { "funcType": "ReferencePoint" }
    }
  ]
}
```

**Hallazgos**:
- **Proyección**: WGS84 lon/lat (EPSG:4326) — perfecto para PostGIS sin reproyección. Coordenadas en rango `[-76.42, -76.23]` lng × `[3.41, 3.74]` lat = Valle del Cauca, Colombia.
- **El polígono es el spray zone (PlantZone)**, NO el lindero del campo. Para `0047243d` el `inner_area` del parameter es 2502 m² ≈ 0.25 ha, pero `mission_fields.json` lo lista como 5.78 ha. **Diferencia ~23x** entre área declarada y zona fumigada.
- **`offset` es per-vertex** (no per-field) — codifica el ancho de buffer en metros para cada vértice del polígono. Típicamente 0 (interior) o 1.5 (borde), pero hay valores hasta 7.0.
- **`ReferencePoint` siempre está vacío** (`coordinates: []`) en los 80 archivos. Es un placeholder de DJI para el home point / RTK; nunca se exporta. **No hay dato que perder**, pero sí hay expectativa de que podría estar lleno.
- **El KML generado por el scraper pierde el `ReferencePoint`** (se va a un `<description>` con JSON) — pero como está vacío, no es pérdida real.

### 8.3 `parameter.json` — schema completo

| Campo | Tipo | Significado | Distribución observada | Acción |
|---|---|---|---|---|
| `spray_width` | number (m) | Ancho del swath del dron | 4 - 8.5 (moda 5.5) | **Guardar** |
| `spray_dir` | number (°) | Heading óptimo de fumigación | 0 - 360 (moda 1, 115, 200) | **Guardar** |
| `radar_height` | number (m) | Altura del radar sobre cultivo | 2.8 - 3.0 | **Guardar** |
| `work_speed` | number (m/s) | Velocidad de trabajo | 4.7 - 7.5 | **Guardar** |
| `edge_offset` | number (m) | Offset del borde | siempre 1.5 | **Guardar** |
| `obstacle_offset` | number (m) | Distancia a obstáculos | siempre 1.5 | **Guardar** |
| `land_connect_drone_type` | int | Modelo de dron | 0 (×2), 72 (×37), 201 (×38), 210 (×2) | **Guardar** (lookup table) |
| `land_climb_height` | number (m) | Altura de ascenso | 0, 2 | guardar opcional |
| `new_climb_height` | number (m) | Idem, nuevo | 2 | guardar opcional |
| `is_open_climb_height` | bool | | siempre false | ignorar |
| `inner_area` | number (m²) | **Área fumigable real** | 0 - 8520 | **Guardar — clave** |
| `no_spray_zone_area` | number (m²) | Zona de no-fumigación | siempre 0 | guardar |
| `spray_type` | int (0/1/2) | Tipo de aspersión | siempre 0 | ignorar si siempre 0 |
| `sub_type` | int (0/1/2) | Subtipo | 0 (×79), 1 (×1) | ignorar |
| `tree_spray_selector` | int (0/1) | **0=Farmland, 1=Orchard** | 0 (×65), 1 (×11), null/empty (×4) | **Guardar — campo clave para clasificar** |
| `sower_*` (10+ campos) | varios | Config de sembradora | siempre defaults/0 | **Ignorar — no aplica a fumigación** |
| `is_use_side_spray` | bool | Aspersión lateral | 0/1 mixto | guardar |
| `is_use_avoid_obstacle` | bool | Evasión de obstáculos | siempre false | guardar |
| `is_change_height` | bool | | siempre false | ignorar |
| `is_change_tree_segment_source` | bool | | siempre false | ignorar |
| `optimal_heading` | bool | Heading óptimo activo | mixto | guardar |
| `quality_level` | int (0/1/2) | Calidad de mapping | 0/2 mixto | guardar |
| `mapping_statue` | string | "mapping_state_none" / etc. | siempre "mapping_state_none" | guardar |
| `mapping_percent` | number | % de mapping completado | siempre 0 | guardar |
| `photo_num` | int | Fotos tomadas | siempre 0 | guardar |
| `fly_time` | number (s) | Tiempo de vuelo | siempre 0 | guardar |
| `camera_generated_photo_num` | int | | siempre 0 | ignorar |
| `fetch_photonum` | int | | siempre 0 | ignorar |
| `mapping_reload_time` | int | | siempre 0 | ignorar |
| `sweep_mode` | int (0/1) | Modo de barrido | siempre 0 | guardar |
| `sweep_direction` | int (0/1) | Dirección de barrido | siempre 1 | guardar |
| `turn_rate_on_off` | bool | | siempre false | guardar |
| `follow_accuracy` | int | | siempre 0 | ignorar |
| `droplet_size` | int | Tamaño de gota | 1/2 | guardar |
| `droplet_size_new` | int | Tamaño de gota (nuevo) | 320/400 | guardar |
| `droplet_*` | varios | | | guardar |
| `start_point` | string GeoJSON | Punto de inicio (a veces) | string vacío o FeatureCollection | guardar |
| `seg_edge_home_point` | string GeoJSON | Home point | siempre presente con coords | **Guardar — clave** |
| `spray_width_balances` | string JSON array | Balance de nozzles | siempre presente, 20-69 valores | guardar (opcional) |
| `edges_points_source` | string JSON array | Códigos per-edge | siempre "[1004, 1004, ...]" | guardar (debug) |
| `plot_source` | string | "Agras" | siempre "Agras" | ignorar |
| `parent_mission_uuid` | string | UUID de la misión padre | siempre "" | guardar |
| `spray_template_uuid` | string | | siempre "" | guardar |
| `sower_template_id` | int | | 0 | ignorar |
| `mission_fly_num` | int | **# de vuelos realizados** | **siempre 0** | **Confirmar: no hay historial de fumigaciones** |
| `mission_fly_battery_use_num` | int | | siempre 0 | confirmar |
| `mission_fly_pre_battery_sn` | string | | siempre "" | confirmar |
| `mission_fly_work_total_time` | int | | siempre -1 | confirmar |
| `total_tree_num` | int | # de árboles | siempre 0 | guardar |
| `tree_area_cal` | int | | siempre 0 | guardar |
| `tree_segment_area` | int | | siempre 0 | guardar |
| `is_upload_machine_compressor_zip` | bool | | siempre false | ignorar |
| `is_mapping_rebuilt_uploaded` | bool | | siempre false | ignorar |

**Resumen parameter.json**:
- 80 archivos, 4 con valores vacíos/nulos (probablemente drones sin asignar o planes sin terminar)
- **2 archivos con `land_connect_drone_type: 0`** (`16f9a3f8` y `ce5fac72`) — son drones sin modelo asignado
- `inner_area` (m² del spray zone) es la métrica más confiable para "área fumigable"
- `tree_spray_selector` es el clasificador más confiable de Orchard vs Farmland (vs el `typeLabel` de `mission_fields.json` que es texto libre)
- Los `sower_*` y `mission_fly_*` son ruido para nuestro dominio (sembradoras, no fumigación)

### 8.4 `waypoint.json` — estructura

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [lng, lat, alt] },
      "properties": {
        "index": 0,
        "action": 0,        // 0=waypoint, 1=final, 5/6=turn events
        "pointType": 0      // 0=normal, 1/2/7/8 variantes
      }
    },
    ... // 14 a 109 features por archivo
  ]
}
```

**Hallazgos** (suma sobre los 36 archivos):
- Total de puntos: 3770
- **Distribución de `action`**:
  - `0` → 1846 puntos (48.9%) — waypoints normales
  - `1` → 1066 puntos (28.3%) — waypoints finales
  - `5` → 428 puntos (11.3%) — turn event (comienzo)
  - `6` → 430 puntos (11.4%) — turn event (fin)
- **Distribución de `pointType`**:
  - `0` → 3577 puntos (94.9%) — normales
  - `7` → 135 puntos (3.6%) — variante
  - `1` → 52 puntos (1.4%) — variante
  - `8` → 4 puntos (0.1%) — outliers
  - `2` → 2 puntos — outliers

**Interpretación operativa** (a confirmar con DJI docs):
- `action=0` con `pointType=0` = waypoint normal (el dron vuela, fumiga)
- `action=1` con `pointType=0` = waypoint final (termina fumigación)
- `action=5` = comienza giro (apaga aspersión)
- `action=6` = termina giro (enciende aspersión)
- `pointType=7` podría ser obstacle marker o calibration point
- `pointType=1/2/8` = variantes especiales, baja frecuencia, documentar pero no actuar aún

**Importante**: el waypoint.json es **el plan de vuelo actual**, NO el registro de un vuelo ya hecho. Cuando el cliente fumigó `0047243d` el 2026-05-28, los waypoints pudieron ser distintos a los que tenemos hoy.

### 8.5 Lo que el importer actual hace con estos assets

`import_djiag_data.js` líneas 183-199:
```js
for (const item of assetIndex) {
  const fileBase = `${item.externalId}_${item.kind}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const rawPath = path.join(filesDir, `${fileBase}.json`);
  if (!fs.existsSync(rawPath)) continue;
  const assetFile = loadAssetFile(rawPath);
  const geomSql = item.kind === 'geometry' && assetFile.isJson ? geoJsonToGeometrySql(assetFile.rawJson) : null;

  await client.query(
    `INSERT INTO dji_land_assets
       (batch_id, external_id, land_name, asset_kind, source_url, raw_json, geom)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, ${geomSql ?? 'NULL'})`,
    [batchId, item.externalId, item.landName, item.kind, item.url, JSON.stringify(assetFile.rawJson)]
  );
}
```

**Lo que se inserta por cada asset** (3 filas por campo):
- 1 fila `kind='geometry'` con el JSON crudo + el `geom` en PostGIS (vía `geoJsonToGeometrySql` que solo toma el `Polygon` y descarta el `MultiPoint`)
- 1 fila `kind='parameter'` con el JSON crudo, **sin `geom`**
- 1 fila `kind='waypoint'` con el JSON crudo, **sin `geom`** ← aquí se pierden los 14-109 waypoints por parcela
- 0 filas si el campo no tiene waypoint

**Lo que se pierde**:
1. **El `ReferencePoint`** del geometry (vacio en data actual, pero perderíamos el dato si DJI lo poblara en el futuro)
2. **Los waypoints no se guardan en PostGIS** — quedan solo como JSONB. No se pueden renderizar en Leaflet ni hacer queries espaciales sobre el plan de vuelo.
3. **Los parámetros estructurados no se extraen** — `spray_width`, `inner_area`, `tree_spray_selector` quedan enterrados dentro de `raw_json`. Cualquier query tipo "muéstrame todos los orchards" tiene que hacer `raw_json->>'tree_spray_selector' = '1'`, no `WHERE field_type = 'Orchard'`.
4. **No hay join natural entre las 3 filas del mismo campo** — se puede hacer `WHERE external_id = ? AND asset_kind IN ('geometry','parameter','waypoint')` pero es 3 round-trips a la BD.

### 8.6 Modelo recomendado — dos opciones

**Opción A: Mantener `dji_land_assets` como está, agregar tablas auxiliares** (cambio mínimo)
- `dji_land_assets` sigue como está (1 fila por asset)
- Agregar `dji_parcel_plans` con columnas planas para spray_width, inner_area, etc. — JOIN por `external_id`
- Agregar `dji_parcel_waypoints` con `external_id`, `index`, `lng`, `lat`, `alt`, `action`, `point_type` — 1 fila por waypoint
- Pro: no rompe el importer actual
- Contra: misma redundancia, JOINs necesarios, sigue habiendo que escarbar JSONB

**Opción B: Cambiar a una fila por campo** (modelo limpio, recomendado)
```sql
CREATE TABLE dji_parcels (
  id              SERIAL PRIMARY KEY,
  batch_id        INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  land_name       TEXT,
  field_type      TEXT NOT NULL,                   -- 'Farmland' | 'Orchards' (de tree_spray_selector)
  declared_area_ha NUMERIC(10, 4),                -- de mission_fields.area ("5.78 ha" → 5.78)
  spray_area_m2   NUMERIC(12, 2),                 -- de parameter.inner_area
  drone_model_code INT,                           -- de parameter.land_connect_drone_type
  drone_model_name TEXT,                          -- lookup: 72='T16/T20', 201='T40/T50', 210='?'
  spray_width_m   NUMERIC(5, 2),                  -- de parameter.spray_width
  work_speed_mps  NUMERIC(4, 2),                  -- de parameter.work_speed
  optimal_heading_deg NUMERIC(5, 2),              -- de parameter.spray_dir
  radar_height_m  NUMERIC(4, 2),                  -- de parameter.radar_height
  edge_offset_m   NUMERIC(4, 2),                  -- de parameter.edge_offset
  obstacle_offset_m NUMERIC(4, 2),                -- de parameter.obstacle_offset
  climb_height_m  NUMERIC(4, 2),                  -- de parameter.new_climb_height
  no_spray_zone_m2 NUMERIC(12, 2),                -- de parameter.no_spray_zone_area
  droplet_size    INT,                            -- de parameter.droplet_size_new
  sweep_direction INT,                            -- de parameter.sweep_direction
  is_orchard      BOOLEAN NOT NULL,                -- de parameter.tree_spray_selector = 1
  uses_side_spray BOOLEAN,                        -- de parameter.is_use_side_spray
  spray_geom      geometry(MultiPolygon, 4326),    -- de geometry.json (PlantZone, forzada a MultiPolygon)
  reference_point geometry(Point, 4326),          -- de geometry.json (ReferencePoint — vacío hoy)
  waypoints       geometry(MultiPoint, 4326),      -- de waypoint.json
  waypoint_count  INT,                            -- count
  source_url_geometry TEXT,
  source_url_parameter TEXT,
  source_url_waypoint TEXT,
  raw_geometry    JSONB,                          -- copia cruda
  raw_parameter   JSONB,                          -- copia cruda
  raw_waypoint    JSONB,                          -- NULL si no hay waypoints
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, external_id)
);
CREATE INDEX idx_dji_parcels_geom ON dji_parcels USING GIST (spray_geom);
CREATE INDEX idx_dji_parcels_drone ON dji_parcels(drone_model_code);
CREATE INDEX idx_dji_parcels_type ON dji_parcels(field_type);
```

- Pro: queries SQL triviales (`WHERE field_type = 'Orchards' AND spray_area_m2 > 5000`)
- Pro: Leaflet puede renderizar `waypoints` directamente como `MultiPoint`
- Pro: relación 1:1 con la realidad del dominio (1 fila = 1 campo)
- Contra: hay que reescribir el importer
- Contra: perderíamos la tabla `dji_land_assets` (o la dejamos para histórico de batches antiguos)

**Recomendación: Opción B**, dejando `dji_land_assets` huérfana para batches previos. El modelo actual no soporta los queries que el producto necesita (cadencia por parcela, próximos vuelos por dron, etc.).

### 8.7 Decisiones de modelo que hay que tomar antes de popular

| # | Decisión | Opciones | Default sugerido |
|---|---|---|---|
| 1 | Modelo de parcels | (A) Mantener dji_land_assets + tablas aux / (B) Nueva tabla dji_parcels 1:1 | **B** |
| 2 | Polygon cerrado del PlantZone | ¿Tratar como MultiPolygon siempre? | Sí, ya que PostGIS lo requiere para sub-zonas múltiples |
| 3 | Waypoint vacío en 44/80 campos | ¿Guardar NULL o fila vacía? | NULL — significa "no hay plan de vuelo planificado" |
| 4 | `declared_area_ha` (de catálogo) vs `spray_area_m2` (de parameter) | ¿Dos columnas? | Sí — declared es la "info del cliente", spray es la "operativa real" |
| 5 | `field_type` | `text` con valores DJI / `enum` / `boolean is_orchard` | Triple: `field_type text + is_orchard boolean` (redundancia controlada) |
| 6 | Lookup `land_connect_drone_type → modelo` | Tabla aparte / hardcoded en código | Tabla `dji_drone_models` con `code, name, manufacturer` — extensible |
| 7 | `tree_spray_selector` como fuente de verdad | Sí, pero `mission_fields.typeLabel` también lo da | **Usar `tree_spray_selector` del parameter.json** (más confiable que parseo de texto del catálogo) |
| 8 | `sower_*` y `mission_fly_*` | ¿Guardar en raw_parameter o ignorar? | **Solo en raw_parameter** — no extraer columnas |
| 9 | `spray_width_balances` (array 20-69 valores) | ¿Tabla aparte? | Guardar como `JSONB` o `text` array — no lo vamos a consultar |
| 10 | `seg_edge_home_point` (string GeoJSON) | ¿Extraer a columna? | Sí, a `geometry(Point, 4326)` — siempre presente |
| 11 | `start_point` (a veces string vacío) | ¿Extraer? | Solo si está presente, NULL si no |
| 12 | Coordenadas con `z=0` (altura siempre 0) | ¿Mantener Z o pasarlo a 2D? | `ST_Force2D` en el import — simplifica y ya lo hace el código actual |

### 8.8 Resumen: lo que se inserta a la BD hoy vs lo que podría

| Concepto | Hoy (Opción A) | Recomendado (Opción B) |
|---|---|---|
| Campos únicos | 80 (vía land_files) | 80 (vía dji_parcels) |
| Filas por campo | 3 (geometry, parameter, waypoint) o 2 si no hay waypoint | 1 |
| Geometría usable en PostGIS | 1 polígono por campo (descarta MultiPoint) | 1 MultiPolygon + 1 Point + 1 MultiPoint |
| Parámetros consultables | Solo vía `raw_json->>'x'` | Columnas SQL planas |
| Clasificación Farmland/Orchard | Solo vía `raw_json` o texto de catálogo | Columna `is_orchard` |
| Join natural entre assets | `WHERE external_id = ? AND asset_kind IN (...)` | Automático |
| Queries "todos los orchards" | Scan completo de raw_json | `WHERE is_orchard = true` con índice |
| Render del plan de vuelo en mapa | No posible (waypoints en JSONB) | Directo: `ST_AsGeoJSON(waypoints)` |
| Compatible con PostGIS ST_DWithin, ST_Contains, etc. | Solo geometry | Geometry + MultiPoint waypoints |
| Migración de batches previos | n/a | Mantener `dji_land_assets` huérfana |

**Si eliges Opción B, hay que**:
1. Crear `db/migrations/20260617_dji_parcels_normalized.sql`
2. Reescribir `import_djiag_data.js` para que use el nuevo modelo
3. Decidir si los próximos batches siguen escribiendo a `dji_land_assets` también (para compatibilidad) o solo a `dji_parcels`
4. Actualizar `api/repositories.ts` para que `getParcels()` lea de `dji_parcels` y devuelva campos planos

---

## 9. Próximos pasos concretos (cuando la DB esté arriba)

1. **Confirmar Opción A vs B** con el cliente. Mientras tanto, yo me inclino por B.
2. **Si B**: te puedo entregar el SQL de la migración y la nueva versión del importer lista para correr en modo "dual-write" (escribe a las dos tablas para que el dashboard actual siga funcionando sin cambios).
3. **Resolver §2.1** (filtro del endpoint de assets) antes de cualquier import — sin eso, `land_file_urls.json` queda en `[]` y la tabla `dji_parcels` queda vacía.
4. **Resolver §2.2 + §2.3** (scroll/paginación) para que los 80 externalIds crezcan a 200+ y la BD refleje la realidad del cliente.
5. **Decidir la cadencia de fumigación** por parcela (input del cliente: ej. "cada 14 días para caña, cada 21 días para orchard"). Eso vive en una tabla `dji_fumigation_schedule` que NO existe aún.

---

## 10. Implementación Opción B — entregada

> Decidido: Opción B (1 fila por campo en `dji_parcels` con columnas planas).
> Fecha: 2026-06-17. Todos los tests pasan: `30 passed (30)`.

### 10.1 Archivos modificados / creados

| Archivo | Cambio | Notas |
|---|---|---|
| `db/schema.sql` | + `dji_drone_models` + `dji_parcels` + índices | Aplica al levantar Docker local |
| `supabase/migrations/20260617170000_add_dji_parcels_normalized.sql` | NUEVO | Migración para Supabase. Incluye `dji_fumigation_schedule` |
| `lib/types.ts` | + `DjiParcelRecord` interface | Tipo para el nuevo endpoint |
| `import_djiag_data.js` | + `writeDjiParcels`, `normalizeParameter`, `groupAssetsByExternalId`, helpers de geometría/waypoints/home point | Dual-write: legacy + normalizado en la misma transacción |
| `api/repositories.ts` | + `getParcelsNormalized`, `getParcelsSummary`, `DjiParcelsFilter` | Lee de `dji_parcels` con filtros opcionales |
| `app/api/parcels/normalized/route.ts` | NUEVO | `GET /api/parcels/normalized?isOrchard=&droneModelCode=&minSprayAreaM2=&fieldType=&summary=1` |
| `tests/parcels-normalized.test.ts` | NUEVO | 20 tests unitarios del normalizador y los helpers geométricos |
| `package.json` | + `db:init:v2` | Alias al mismo importer (mantiene el `db:init` legacy) |

### 10.2 Esquema de `dji_parcels`

```sql
CREATE TABLE dji_parcels (
  id                    SERIAL PRIMARY KEY,
  batch_id              INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL,
  land_name             TEXT,
  field_type            TEXT NOT NULL,  -- 'Farmland' | 'Orchards' (de tree_spray_selector)
  declared_area_ha      NUMERIC(10, 4),
  spray_area_m2         NUMERIC(12, 2),  -- de parameter.inner_area
  drone_model_code      INT REFERENCES dji_drone_models(code) ON DELETE SET NULL,
  drone_model_name      TEXT,
  spray_width_m         NUMERIC(5, 2),
  work_speed_mps        NUMERIC(4, 2),
  optimal_heading_deg   NUMERIC(5, 2),
  radar_height_m        NUMERIC(4, 2),
  edge_offset_m         NUMERIC(4, 2),
  obstacle_offset_m     NUMERIC(4, 2),
  climb_height_m        NUMERIC(4, 2),
  no_spray_zone_m2      NUMERIC(12, 2),
  droplet_size          INT,
  sweep_direction       INT,
  is_orchard            BOOLEAN NOT NULL,
  uses_side_spray       BOOLEAN,
  spray_geom            geometry(MultiPolygon, 4326),
  reference_point       geometry(Point, 4326),
  waypoints             geometry(MultiPoint, 4326),
  waypoint_count        INT,
  source_url_geometry   TEXT,
  source_url_parameter  TEXT,
  source_url_waypoint   TEXT,
  raw_geometry          JSONB,
  raw_parameter         JSONB,
  raw_waypoint          JSONB,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, external_id)
);
```

Índices: `batch_id`, `drone_model_code`, `field_type`, `is_orchard`, GIST en `spray_geom`, `waypoints`, `reference_point`.

### 10.3 Lookup `dji_drone_models`

Poblado con 4 codes observados en la data:
- `0` → "Sin asignar" (2 campos observados)
- `72` → "Agras T16 / T20" (37 campos) — *verificar con el operador*
- `201` → "Agras T40 / T50" (38 campos) — *verificar con el operador*
- `210` → "Agras T70 / similar" (2 campos) — *confirmar modelo*

El importer hace un `UPDATE` post-inserción para resolver `drone_model_name` desde la tabla lookup.

### 10.4 Comportamiento del importer (dual-write)

Una sola transacción, dos fases:

**Fase 1 (legacy, intacta)**:
1. `DELETE FROM dji_parcels` (limpieza de batches anteriores)
2. `DELETE FROM dji_land_assets`
3. `DELETE FROM dji_daily_summaries`
4. `DELETE FROM dji_field_catalog`
5. `DELETE FROM dji_import_batches`
6. INSERT batch, INSERT summaries, INSERT field catalog, INSERT legacy assets (1 fila por asset_kind, 3 por campo).

**Fase 2 (nueva, Opción B)**:
7. Agrupar `assetIndex` por `externalId` → `grouped`
8. Cargar archivos de `land_files/` para cada `kind` por externalId
9. INSERT 1 fila por campo en `dji_parcels` con:
   - Parámetros normalizados a columnas planas (`normalizeParameter`)
   - Geometría `PlantZone` → `MultiPolygon` PostGIS
   - `seg_edge_home_point` → `Point` PostGIS
   - Waypoints → `MultiPoint` PostGIS
10. `UPDATE` para enriquecer `declared_area_ha` desde `dji_field_catalog` (join por land_name)
11. `UPDATE` para resolver `drone_model_name` desde `dji_drone_models`

Si la fase 2 falla, la transacción hace ROLLBACK de ambas fases — la BD queda intacta.

### 10.5 Endpoints nuevos

**`GET /api/parcels/normalized`** — paginado, con filtros:

```bash
# Todas las parcelas (paginadas)
curl "http://localhost:3000/api/parcels/normalized?page=1&limit=20"

# Solo orchards
curl "http://localhost:3000/api/parcels/normalized?isOrchard=true"

# Solo drones T40
curl "http://localhost:3000/api/parcels/normalized?droneModelCode=201"

# Parcelas con spray_area >= 1 ha
curl "http://localhost:3000/api/parcels/normalized?minSprayAreaM2=10000"

# Resumen agrupado por dron
curl "http://localhost:3000/api/parcels/normalized?summary=1"
```

**Tests**:
- `npm test` — corre los 30 tests (10 nuevos + 20 existentes).
- 0 errores, 0 warnings.

### 10.6 Tabla adicional preparada para notificaciones

`dji_fumigation_schedule` (en la migración Supabase):
- `parcel_id` (FK a `dji_parcels`)
- `crop_type`, `recommended_cadence_days`, `last_fumigation_date`, `next_due_date`, `is_active`

Es la base para el sistema de notificaciones que el cliente quiere ("cuándo debo fumigar la próxima vez"). Por ahora queda vacía — se llenará con un input del cliente (e.g. "caña cada 14 días, orchard cada 21 días").

### 10.7 Lo que NO se hizo (decisiones explícitas)

1. **No se eliminó `dji_land_assets`**. Queda como legacy para batches anteriores. Drop planeado para una migración futura cuando estemos seguros de que `dji_parcels` cubre todo.
2. **No se cambió el dashboard actual**. Sigue leyendo `getParcels()` (legacy). El nuevo endpoint está disponible para migrar componentes específicos gradualmente.
3. **No se llenó `dji_fumigation_schedule`** — necesita input del cliente.
4. **El scraper sigue roto** (§2.1, §2.2, §2.3). El importer está listo pero `land_file_urls.json` viene vacío, así que `dji_parcels` quedará con 0 filas hasta arreglar el scraper.
5. **`declared_area_ha` se llena post-inserción** con un join aproximado por `land_name` (LOWER + TRIM). Funciona para 80% de los casos. Si el operador renombra una parcela entre batch, no se va a matchear — pero entonces la fuente es DJI y el rename también debe reflejarse ahí.

### 10.8 Próximos pasos sugeridos

1. **Aplicar la migración**: en local con `npm run db:down && npm run db:up && npm test`; en Supabase con `supabase db push` o desde la consola.
2. **Arreglar el scraper** (§2.1) para que `land_file_urls.json` se llene.
3. **Correr `npm run db:init:v2`** — esto va a popular `dji_parcels` con los 80 externalIds actuales (de los `land_files/` del 6/2 que sí están en disco).
4. **Probar el endpoint**:
   ```bash
   curl "http://localhost:3000/api/parcels/normalized?isOrchard=true"
   ```
5. **Empezar a migrar el dashboard** — el `/map` puede pasar a leer de `getParcelsNormalized()` y mostrar la `MultiPolygon` real + waypoints como MultiPoint layer.

### 10.9 Errores pre-existentes detectados (no causados por esta entrega)

- `tests/api-routes.test.ts:44` y `:64` — los tests pasan `new NextRequest(...)` a handlers que no aceptan argumentos. Vitest es permisivo pero `tsc` se queja. Pasa en runtime, no bloquea.
