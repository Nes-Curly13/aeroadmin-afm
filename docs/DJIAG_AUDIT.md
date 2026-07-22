# DJIAG Client Audit — 2026-07-22

> Auditoría técnica del cliente GraphQL no oficial (`lib/djiag-*.js`) y su pipeline (`scripts/run-pipeline.js`).
> Recomienda profesionalizar el cliente existente — NO reemplazarlo (DJI no expone REST API oficial para Agras sin AirData Enterprise).
> Última actualización: 2026-07-22.

---

## TL;DR

**El cliente es sofisticado y está bien documentado.** No es un scraper HTML frágil: es un cliente Playwright que delega el firmado HMAC al browser de DJI, con un sistema de cursor injection via `page.route()` para esquivar bugs del frontend, storage state caching para evitar re-logins, y parsers puros testeables con fixtures.

**Lo que le falta es robustez operacional**: monitoring, circuit breaking, schema versioning. No es un problema de **calidad** del código (es alta) sino de **resiliencia operacional** (¿qué pasa cuando DJI cambia el schema a las 2am?).

**Deuda activa que vi en `SCRAPER_DEFECTS.md`** (94 KB, 16 secciones históricas, fixes parciales a junio-julio 2026). Los issues §2.1-§2.5 están mayormente resueltos. Quedan pendientes §3.x (no críticos pero degradan) y los nuevos que identifico abajo.

---

## 1. Estado actual

### Lo que el cliente hace bien ✅

| Fortaleza | Evidencia | Impacto |
|---|---|---|
| **Cliente Playwright vs HTTP directo** | `lib/djiag-korean-client.js` reusa el firmado HMAC del browser de DJI. Documenta explícitamente "Reimplementar el signer es trabajo ingrato y frágil". | Evita reverse-engineering del HMAC, que cambia con cada release |
| **Storage state caching** | `djiag_session.json` con TTL 7 días. Skipea el flow de redirects cross-subdomain en logins subsiguientes. | ~5-10s ahorrados por corrida. Y evita el bug §2.5 de auth frágil |
| **Cursor injection via `page.route()`** | `_installLandsCursorRoute()` reemplaza `after: \"0\"` hardcoded en el POST body. | Bypassea el bug de DJI donde el frontend solo carga la primera página |
| **Auto-cap en `fetchAllLandsPages`** | Si `totalCount` indica más fincas que `maxPages * pageSize`, eleva el cap automáticamente. | Protege del caso futuro donde el caller pase maxPages muy bajo |
| **Parsers puros (sin side effects)** | `djiag-*-fetcher.js` reciben JSON, devuelven objetos normalizados. | Tests con fixtures, sin credenciales DJI ni Playwright. Hay 9 archivos `djiag-*.test.ts` |
| **Asset downloader production-grade** | `djiag-asset-downloader.js`: retry con backoff + jitter, concurrencia limitada (`pLimit`), idempotente (skip si existe), AbortSignal.timeout, validación JSON. | Es el módulo más maduro. Cero deuda |
| **SQL idempotente (UPSERT)** | `ON CONFLICT (flight_id, source) DO UPDATE` con decisión de diseño explícita (2026-07-11): preserva `batch_id` del import original. | Pipeline es re-ejecutable sin duplicar filas |
| **Documentación honesta** | `SCRAPER_DEFECTS.md` 94 KB con 16 secciones, fechas, causas raíz, fixes. `DJI_SCRAPER.md` con 4 gotchas operacionales. | Reduce el "buscar el bug oculto" a minutos |
| **Pipeline orquestado** | `run-pipeline.js` con `--days`, `--skip-scrape`, `--resume`, `--start-from`, `--stop-at`, `--dry-run`. | 10 steps en uno, con range selection |

### Cobertura de tests

9 archivos `djiag-*.test.ts`:
- `djiag-asset-downloader.test.ts` — retry, backoff, concurrencia
- `djiag-flights-fetcher.test.ts` — parsePerFlightFile
- `djiag-fumigations-fetcher.test.ts` — parseAggrByDayResponse
- `djiag-lands-fetcher.test.ts` — parseLandsResponse, unidades MU
- `djiag-lands-to-parcels.test.ts` — WKT, UPSERT
- `djiag-spatial-aggregator.test.ts` — INNER JOIN vs LATERAL
- `djiag-storage.test.ts` — isStorageStateFresh
- `upsert-flights-from-djiag.test.ts`
- `upsert-lands-from-djiag.test.ts`

**Faltan**: tests de integración con Playwright real. Los parsers están cubiertos, pero el cliente (login, route injection, _captureResponse) no.

---

## 2. Top hallazgos (ordenados por impacto)

### H1. Sin health check ni monitoring — degradación silenciosa

**Impacto: ALTO.** Si el scraper falla por horas, nadie se entera hasta que el usuario abre el panel y ve data vieja.

**Evidencia:**
- `run-pipeline.js` es un script CLI con `process.exit(1)`. No hay nada que notifique el fallo.
- `djiag_exports/*.json` se sobrescriben en cada corrida. No hay un "last successful" timestamp persistente.
- El dashboard usa `dji_fumigations` y `dji_flights`, pero no hay forma de saber cuándo fue la última sync exitosa.

**Síntoma esperado:** El operador entra al panel, ve fumigaciones de hace 5 días, no sabe si (a) no fumigó o (b) el scraper está roto desde hace 5 días.

**Fix (XS):** Agregar endpoint `/api/admin/djiag-health` (protegido por rol `admin`) que retorne:
```json
{
  "lastRunAt": "2026-07-22T08:00:00Z",
  "lastRunStatus": "ok",
  "lastSuccessfulSyncAt": "2026-07-22T08:00:00Z",
  "flightsLastSync": 152,
  "fumigationsLastSync": 12,
  "landsLastSync": 1207,
  "hoursSinceLastSync": 4.2,
  "warnings": []
}
```

**Tracking**: escribir un `djiag_exports/_health.json` al final de `run-pipeline.js` con el resumen. El endpoint lo lee.

---

### H2. Sin circuit breaker — el cliente martilla cuando SmartFarm está caído

**Impacto: ALTO.** El cliente tiene login UI completo + storage state check + ensureOnFieldManagement. Si SmartFarm está caído, cada intento tarda ~30s y falla. Si el cron corre cada 1h, son 24 logins fallidos por día.

**Evidencia:**
- `DjiagKoreanClient.login()` (línea 168): no tiene retry limit ni backoff.
- `DjiagKoreanClient.launch()` (línea 87): si el storage state está corrupto, fallback a login UI. Pero si SmartFarm está caído, el login UI también falla, y vuelve a intentar en la próxima corrida.
- No hay circuit breaker, no hay "skip N corridas si falló N veces".

**Síntoma esperado:** DJI tiene un outage de 4h. En ese tiempo el cron corre 4 veces, cada una intenta login 1 vez + ~5 fetches, total ~20 login flows que fallan. Y el storage state se sobrescribe con respuestas parciales (cookies expiradas).

**Fix (S):** Circuit breaker en `DjiagKoreanClient`:
- Si 3 logins fallan consecutivos, abrir circuit por 5 minutos (configurable).
- Persistir state en `djiag_health.json` (mismo archivo que H1).
- En el próximo intento, si circuit está abierto, fallar rápido con error claro ("circuit open, retry in 4m32s").

---

### H3. Sin schema versioning — el parser falla con error genérico cuando DJI cambia una query

**Impacto: MEDIO-ALTO.** Cuando DJI cambia el shape de `?name=lands` (agrega/quita un campo, renombra, cambia tipo), el parser tira `"response.data.lands is missing"`. Es detectable, pero el error no te dice "campo X cambió de tipo" — solo "estructura rota".

**Evidencia:**
- `djiag-graphql-queries.js` define 2 queries como strings literales con whitespace sensible (HMAC).
- `djiag-lands-fetcher.js` `parseLandsResponse()` (línea 95): tira errores genéricos si la estructura no matchea. No hay "schema version detection".
- Comentario en línea 4: "el body exacto. NO incluir `\n` o indentación que cambien el content-md5".

**Síntoma esperado:** DJI agrega un nuevo field `landType_v2` a `?name=lands`. El parser funciona (los campos viejos siguen). DJI renombra `landType` a `landTypeCode` 6 meses después. El parser tira error y no hay forma de saber "qué campo cambió" sin ir a DevTools.

**Fix (S):**
1. Agregar `SCHEMA_VERSION = 1` exportado por cada fetcher. En el parser, después de validar, loguear `Schema v${SCHEMA_VERSION} OK` (en debug mode).
2. Para cada field del response, validar tipo esperado (`typeof node.totalArea === 'number'`, etc.). Si no matchea, error específico: "Field `totalArea` expected number, got string. Schema may have changed."
3. Considerar un `lib/djiag-schema-hash.js` que hashe la response y alerte si cambia.

---

### H4. Race condition en `_captureResponse` — listener se registra tarde

**Impacto: MEDIO.** El listener se registra DESPUÉS de `await this.login()`. Si el primer fetch dispara responses antes de que el listener esté activo, se pierden.

**Evidencia (línea 219 de `djiag-korean-client.js`):**
```js
async _captureResponse({ urlPattern, triggerPageFn, minResponses = 1 }) {
  await this.login();
  // ...
  this.page.on('response', listener);  // ← TARDÍO
  try {
    await triggerPageFn();  // ← Esto puede disparar responses antes del .on
```

El código tiene un comentario que reconoce el riesgo histórico: "waitForResponse (que solo matchea la PRIMER response y se puede comer la incorrecta si hay varias graphql calls), bufferamos todas las responses". Pero el fix es parcial — el listener se registra después de `login()`, no antes.

**Síntoma esperado:** ~1 de cada 20 corridas falla con "_captureResponse: no matching response within 30000ms" porque el primer fetch disparó antes de que el listener estuviera activo.

**Fix (S):** Mover `this.page.on('response', listener)` a `launch()`, antes de cualquier `triggerPageFn()`. Bufferizar responses siempre y filtrar por `urlPattern` en el listener. Limpiar el buffer entre capturas.

---

### H5. URLs de assets expiran en 12h — race entre fetch-lands y download-assets

**Impacto: MEDIO.** Los signed URLs de DJI para geometry/parameter/waypoint expiran en ~12h. Si el paso 8 (fetch-lands) y el paso 9 (download-assets) se separan por más de 12h, fallan.

**Evidencia:**
- `DJI_SCRAPER.md` línea 67: "signed URLs expiración ~12h".
- `run-pipeline.js` pasos 8-9 son consecutivos en el flujo normal, pero `--skip-scrape --skip-fetch-lands` los puede separar.
- `djiag-asset-downloader.js` `fetchWithRetry`: retry en 5xx/429, no en 403. Un 403 de URL expirada NO se reintenta, se loguea como fail y el asset queda missing.

**Síntoma esperado:** Corro pipeline el lunes, fetch-lands OK. Corro `--skip-scrape --days 30` el viernes (5 días después) para reprocesar. Download-assets falla con 403 porque las URLs expiraron.

**Fix (XS):** En `download-land-assets.js`, antes de empezar, checkear la edad de `djiag_exports/lands.json` (o equivalente). Si > 12h, warn explícito y ofrecer `--refetch-lands` o auto-refetch.

---

### H6. Backoff entre login failures falta — password mal → martillamos DJI

**Impacto: BAJO-MEDIO.** Si el password está mal o expiró, cada corrida intenta login UI completo, falla, y vuelve a intentar la próxima vez. Sin backoff.

**Evidencia:**
- `DjiagKoreanClient.login()` (línea 168): no tiene retry logic. Falla → throw → caller maneja.
- `fetch-lands-from-djiag.js` y otros: no tienen try/catch alrededor de `client.login()`. El error burbujea.

**Síntoma esperado:** Password expirado. Cron corre cada 1h, cada vez intenta login 1 vez, falla. 24 logins fallidos/día → DJI puede rate-limitar la IP → 401 persistente.

**Fix (XS):** Agregar retry con backoff exponencial al login (3 intentos, 1.5s/3s/6s — mismo patrón que el pagination retry documentado en DJI_SCRAPER.md).

---

### H7. Sin métricas de corrida — no sabemos cuánto tarda cada step ni cuántos fallan

**Impacto: BAJO.** El `--dry-run` solo printa los comandos. No hay stats de corridas reales.

**Evidencia:**
- `run-pipeline.js` step 6: "backfill per-parcel fumigations" — si esto toca 50,000 flights y 1,200 parcelas, ¿cuánto tarda? No hay forma de saber sin un `--metrics` flag.
- `djiag-asset-downloader.js` retorna stats agregados (downloaded/skipped/failed/bytes) pero no se loguean en el pipeline.

**Fix (XS):** Agregar `--metrics-json <path>` al pipeline. Cada step que retorna stats los escribe a ese archivo. Permite parsear en CI o dashboard.

---

### H8. Queries GraphQL hardcoded con whitespace-sensitive HMAC — editar es peligroso

**Impacto: BAJO.** Las queries en `djiag-graphql-queries.js` son strings literales donde el whitespace afecta el HMAC. Editarlas con un formateador que re-indente rompe el firmado.

**Evidencia:**
- `djiag-graphql-queries.js` líneas 49-118: queries con indentación inconsistente (mezcla 2-space, 4-space, alignment de `:`).
- Comentario: "el signature se calcula sobre el body exacto. NO incluir `\n` o indentación que cambien el content-md5".

**Síntoma esperado:** Un dev formatea el archivo con Prettier → 401 de DJI en todas las requests porque el HMAC cambió.

**Fix (XS):** Considerar mover las queries a archivos `.gql` o `.graphql` separados con `.gitattributes` o comentario al inicio "NO FORMATEAR — HMAC sensitive". Alternativamente, generar el string final en runtime con `JSON.stringify` para garantizar consistencia.

---

## 3. Lo que está documentado en `SCRAPER_DEFECTS.md` pero no resuelto

Issues históricos (§2.1-§2.5) — la mayoría resueltos según el README y la memoria del agente. Lo que queda abierto o parcialmente resuelto:

| Issue | Estado | Notas |
|---|---|---|
| §2.1 land_file_urls.json vacío | ✅ Resuelto | `land_files/` ahora se llena (test del 6/10 exitoso) |
| §2.2 Solo 16% parcelas | ✅ Resuelto | Scroll virtualizado implementado en `ensureOnFieldManagement()` |
| §2.3 Solo 30 días history | 🟡 Parcial | Scroll implementado pero histórico de 23 años requiere muchos fetches |
| §2.4 parseHistoryRecord frágil | ✅ Resuelto | Regex en importer rescata data del raw |
| §2.5 Auth frágil | ✅ Resuelto | Storage state + _waitForAuthenticatedGraphql() |
| §3.1 land_files 8 días desactualizado | 🟡 Idem §2.1 | Depende de fix §2.1 |
| §3.2 Formato tiempo inconsistente | 🟡 Parcial | `work_time_text` se guarda literal, no normalizado |
| §3.3 KML pierde MultiPoint | 🟡 Abierto | `geoJsonToKml` no maneja MultiPoint |
| §3.4 geometry ≠ lindero | 🔴 Abierto | `geometry.json` es la zona fumigada, no el lindero del campo. Sin lindero real de DJI. |
| §3.5 nav_states inútil | 🟡 Abierto | Bug menor, no se usa en runtime |

**§3.4 es el issue abierto más relevante:** la geometría que entra a la BD no es el lindero del campo sino la zona fumigada. Cualquier visualización de "campo completo" está mal. Esto requiere pedirle al cliente un KML/shapefile del lindero, o tomar el convex hull del PlantZone.

---

## 4. Plan de acción priorizado (XS / S / M)

### XS — Quick wins (< 1h cada uno)

| # | Tarea | Esfuerzo | Reduce |
|---|---|---|---|
| XS1 | Agregar `/api/admin/djiag-health` endpoint con `lastRunAt`, `lastSuccessfulSyncAt`, `hoursSinceLastSync` (escribir `_health.json` al final de run-pipeline.js) | 1h | H1 |
| XS2 | Agregar `--metrics-json <path>` al pipeline con stats de cada step | 30m | H7 |
| XS3 | Backoff exponencial en `DjiagKoreanClient.login()` (3 intentos, 1.5s/3s/6s) | 30m | H6 |
| XS4 | En `download-land-assets.js`, check de edad de `lands.json` antes de empezar, warn si > 12h | 15m | H5 |
| XS5 | README/note en `djiag-graphql-queries.js`: "NO FORMATEAR — HMAC sensitive" | 5m | H8 |
| XS6 | Tests de validación de tipos de campos en `parseLandsResponse` y `parseAggrByDayResponse` (no solo presencia) | 1h | H3 (parcial) |

**Total XS: ~3.5h, doable en 1 sprint mini o un día tranquilo.**

### S — Fixes de resiliencia (2-4h cada uno)

| # | Tarea | Esfuerzo | Reduce |
|---|---|---|---|
| S1 | Circuit breaker en `DjiagKoreanClient` (3 fails → open 5 min, persistir en `_health.json`) | 3h | H2 |
| S2 | Schema versioning + field-type validation en parsers (`SCHEMA_VERSION = 1` por fetcher, mensajes de error específicos) | 4h | H3 |
| S3 | Refactor `_captureResponse` para registrar listener en `launch()` y bufferizar siempre | 2h | H4 |
| S4 | Auto-refetch de lands si download-assets encuentra URLs expiradas (>50% de failures por 403) | 3h | H5 (auto-fix) |

**Total S: ~12h, 1.5-2 sprints.**

### M — Re-arquitectura (1-2 días cada uno)

| # | Tarea | Esfuerzo | Reduce |
|---|---|---|---|
| M1 | Multi-page client: usar `context.newPage()` por request. Permite fetches concurrentes. | 1 día | Limitación documentada del cliente |
| M2 | Supervisor worker en background que detecta cambios de schema automáticamente y notifica (Sentry, log, o email) | 2 días | H3 (auto-detect) |
| M3 | Resolver §3.4 (geometría fumigada ≠ lindero): pedir KML al cliente + columna `boundary_geom` separada de `spray_geom` | 1 día | §3.4 |

**Total M: ~4 días, vale hacerlo después de tener XS+S en producción.**

---

## 5. Lo que NO voy a hacer (out of scope)

- ❌ **Reemplazar el cliente con AirData Enterprise** — descartado, el cliente no paga.
- ❌ **Migrar a DJI Cloud API (Pilot 2 / Dock)** — no aplica a Agras, solo enterprise.
- ❌ **Reescribir el cliente en TypeScript** — el código JS está bien testeado, no vale la pena el riesgo de migración.
- ❌ **Implementar un supervisor service (M2) sin antes tener Sentry/observability básica** — primero XS+S, después M.

---

## 6. Recomendación inmediata

**Empezar por XS1 + XS2 + XS3 + XS4 (1 día de trabajo).** Es el "minimum viable resilience": health endpoint + métricas + retry básico + check de URLs expiradas. Cubre los 4 hallazgos de mayor impacto (H1, H5, H6, H7) con esfuerzo bajo.

**Después S1 (circuit breaker) + S3 (race condition fix).** Cubre H2 y H4, los dos issues de resiliencia operacional más urgentes.

**S2 (schema versioning) puede esperar** — solo se justifica si el scraper falla con errores crípticos al menos 2-3 veces por mes. Hoy, con la doc + las queries simples, no es prioritario.

**M1, M2, M3 son "nice to have"** — vale hacerlos cuando el resto esté sólido, no antes.

---

## 7. Changelog interno

- **2026-07-22** — Audit inicial por Mavis. Recomienda XS1-XS6 + S1-S4 (no M todavía).
