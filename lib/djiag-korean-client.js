// Cliente Playwright para DJI AG — endpoint coreano (`kr-ag2-api.dji.com`).
//
// Por qué Playwright y no fetch directo:
//   - Los requests al endpoint coreano van firmados con HMAC sobre el body
//     (`signature`, `content-md5`, `x-ag-date` headers). El secret es
//     dinámico y se calcula client-side por el código de DJI.
//   - Reimplementar el signer es trabajo ingrato y frágil (cambia con cada
//     release de DJI). Más simple: dejar que el browser de DJI firme los
//     requests, y nosotros solo capturamos las responses.
//   - El browser ya tiene la sesión (cookies, JWT) — no hay que manejar
//     refresh tokens.
//
// Estrategia:
//   1. Login normal (UI), reutilizable desde el scraper.
//   2. Para cada fetch, navegamos a la página que dispara el request
//      objetivo (ej. /mission + click en "Field Management" para lands).
//   3. Capturamos la response con `page.waitForResponse`.
//   4. Devolvemos el JSON al caller.
//
// Limitaciones:
//   - La "trampa" del routing: si el browser no tiene `accept-language: zh-CN`,
//     DJI rutea al endpoint regional (`agro-vg.djiag.com`) y los queries
//     llegan vacíos. Por eso seteamos `locale: 'zh-CN'` y los headers extra.
//   - Single page instance: si múltiples fetches concurrentes, el orden
//     de responses puede mezclarse. Para la mayoría de casos (secuencial)
//     funciona bien; para concurrencia habría que usar `context.newPage()`
//     por request.
//
// Storage state (S1 §2.5 del roadmap):
//   - Después del primer login exitoso, persistimos el contexto del browser
//     (cookies + storage) en `djiag_session.json`.
//   - En logins subsiguientes, si el archivo existe y no es muy viejo
//     (< `storageStateMaxAgeMs`, default 7 días), lo cargamos y saltamos
//     el login UI completo.
//   - Esto evita el ciclo redirect cross-subdomain
//     `account.dji.com → agro-vg.djiag.com → www.djiag.com` en cada corrida.
//   - Si el storage state está expirado o inválido, el login normal corre
//     y se reescribe el archivo.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { scrollUntilStagnant } = require('./playwright-scroll');
// XS3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H6). Helper puro de backoff
// exponencial con jitter. Usado por login() para no martillar la UI de
// DJI ante rate-limit transitorio. Ver lib/djiag-backoff.js.
const { withBackoff } = require('./djiag-backoff');
// S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2). Circuit breaker para no
// martillar la UI de DJI si SmartFarm Web esta caido. Persiste su state
// en djiag_exports/_health.json. Ver lib/djiag-circuit-breaker.js.
const { CircuitBreaker } = require('./djiag-circuit-breaker');

const DEFAULT_BASE = 'https://www.djiag.com';
const KOREAN_HOST = 'kr-ag2-api.dji.com';
const DEFAULT_STORAGE_STATE_PATH = path.join(process.cwd(), 'djiag_session.json');
const DEFAULT_STORAGE_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Carga variables de .env.local sin pisar las que ya estén en process.env.
 * Específico para este cliente — los importers tienen su propio loader.
 */
function loadEnvFromLocalFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

/**
 * Devuelve true si el storage state existe y no está expirado.
 * No valida el contenido — Playwright fallará si está corrupto.
 * Implementado en lib/djiag-storage.js (sin asteriscos en JSDoc, para
 * que vite/esbuild lo parsee sin drama al importarlo desde tests).
 */
const { isStorageStateFresh } = require('./djiag-storage');

class DjiagKoreanClient {
  /**
   * @param {object} [options]
   * @param {boolean} [options.headless=true]
   * @param {string}  [options.locale='zh-CN']   — setea el browser locale
   * @param {string}  [options.email]            — default: process.env.DJIAG_EMAIL
   * @param {string}  [options.password]         — default: process.env.DJIAG_PASSWORD
   * @param {number}  [options.timeoutMs=30000]  — timeouts para waits
   * @param {string}  [options.storageStatePath] — ruta del archivo de storage state
   * @param {number}  [options.storageStateMaxAgeMs=7d] — máx edad para reusar
   * @param {boolean} [options.useStorageState=true]   — usar cache de sesión
   * @param {CircuitBreaker} [options.circuitBreaker] — breaker inyectable (S1). Si no, se crea lazy.
   */
  constructor(options = {}) {
    loadEnvFromLocalFile();
    this.headless = options.headless ?? true;
    this.locale = options.locale ?? 'zh-CN';
    this.email = options.email ?? process.env.DJIAG_EMAIL;
    this.password = options.password ?? process.env.DJIAG_PASSWORD;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.storageStatePath = options.storageStatePath ?? DEFAULT_STORAGE_STATE_PATH;
    this.storageStateMaxAgeMs = options.storageStateMaxAgeMs ?? DEFAULT_STORAGE_STATE_MAX_AGE_MS;
    this.useStorageState = options.useStorageState ?? true;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.loggedIn = false;
    // (2026-07-02) Estado para el route() interceptor que inyecta el cursor
    // en la query de `graphql?name=lands`. Ver _installLandsCursorRoute().
    // Default '0' preserva el comportamiento histórico (fetchLandsPage sin args).
    this._currentLandsCursor = '0';
    this._cursorRouteInstalled = false;
    // S3 (audit 2026-07-22, H4). Buffer global de responses. Se llena
    // desde launch() por el listener instalado en _installResponseBuffer()
    // y se filtra/consume desde _captureResponse().
    this._responseBuffer = [];
    this._responseListenerInstalled = false;
    // S1 (audit 2026-07-22, H2). Circuit breaker inyectable. Si no se pasa
    // en options, se crea lazy en _ensureCircuitBreaker() con defaults.
    this.circuitBreaker = options.circuitBreaker ?? null;
  }

  /**
   * S1 (audit 2026-07-22, H2). Lazy init del circuit breaker con defaults
   * (3 failures -> open, 5min reset, persistencia en djiag_exports/_health.json).
   * Si ya existe (inyectado o creado previamente), no hace nada.
   */
  _ensureCircuitBreaker() {
    if (this.circuitBreaker) return;
    const healthPath = path.join(process.cwd(), 'djiag_exports', '_health.json');
    this.circuitBreaker = new CircuitBreaker({ healthFilePath: healthPath });
  }

  async launch() {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: this.headless });

    // (S1 §2.5) Si hay storage state fresco, reusar. Si no, crear context vacío.
    const contextOptions = {
      acceptDownloads: true,
      locale: this.locale,
      extraHTTPHeaders: {
        // Crítico: este header hace que DJI rutee al backend coreano.
        // Sin él, los requests van al regional (`agro-vg.djiag.com`)
        // y el query de lands viene vacío.
        'accept-language': 'zh-CN,zh'
      }
    };

    const shouldReuseState = this.useStorageState &&
      isStorageStateFresh(this.storageStatePath, this.storageStateMaxAgeMs);

    if (shouldReuseState) {
      try {
        this.context = await this.browser.newContext({
          ...contextOptions,
          storageState: this.storageStatePath
        });
        // Si el state cargó OK, considerar logged-in (sin verificar todavía).
        this.loggedIn = true;
        if (process.env.DEBUG_DJIAG) {
          console.error(`[launch] reusando storage state: ${this.storageStatePath}`);
        }
      } catch (err) {
        // State corrupto → fallback a login normal
        if (process.env.DEBUG_DJIAG) {
          console.error(`[launch] storage state inválido, fallback a login UI: ${err.message}`);
        }
        this.context = await this.browser.newContext(contextOptions);
      }
    } else {
      this.context = await this.browser.newContext(contextOptions);
    }
    this.page = await this.context.newPage();
    this._installLandsCursorRoute();
    // S3 (audit 2026-07-22, H4). El listener de responses se instala
    // UNA VEZ en launch(), antes de cualquier navegación. Esto elimina
    // la race condition donde el primer fetch disparaba responses
    // antes de que el listener estuviera activo (perdíamos responses
    // validas). Ver _installResponseBuffer() y _captureResponse().
    this._installResponseBuffer();
  }

  /**
   * (2026-07-02) Instala un `page.route()` que intercepta el POST a
   * `graphql?name=lands` y reemplaza `after: \"<digits>\"` por el cursor
   * actualmente deseado (`this._currentLandsCursor`). Necesario porque la
   * query de DJI hardcodea `after: "0"` en el body, lo que hacía que
   * `fetchLandsPage()` siempre devolviera la página 1 sin importar cuántas
   * veces se llamara.
   *
   * Solo intercepta `name=lands` (NO `name=landsCluster`, ni `userProfile`,
   * ni `departmentTree`) — son queries distintas con cursors distintos.
   *
   * Idempotente: si ya está instalado, no hace nada.
   */
  async _installLandsCursorRoute() {
    if (this._cursorRouteInstalled) return;
    this._cursorRouteInstalled = true;
    await this.page.route('**/graphql*', async (route) => {
      try {
        const req = route.request();
        const url = req.url();
        const method = req.method();
        // Filtrar: solo el POST a lands (no landsCluster, no userProfile, etc.)
        if (
          method !== 'POST' ||
          !url.includes('graphql?name=lands') ||
          url.includes('landsCluster')
        ) {
          return route.continue();
        }
        const originalBody = req.postData() || '';
        const cursor = this._currentLandsCursor ?? '0';
        // El body es JSON con strings escapadas — subcadena literal: after: \"<n>\"
        const modifiedBody = originalBody.replace(
          /after:\s*\\"(\d+)\\"/g,
          `after: \\"${cursor}\\"`
        );
        await route.continue({ postData: modifiedBody });
      } catch (err) {
        // Si algo falla, pasar el request sin modificar — el caller verá
        // la página 1 (comportamiento histórico) en vez de un crash.
        await route.continue();
      }
    });
  }

  /**
   * S3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H4). Instala el listener
   * global de responses en el page. UNA VEZ por launch, ANTES de
   * cualquier navegación. Esto elimina la race condition histórica
   * donde _captureResponse() registraba el listener DESPUÉS de
   * `await this.login()`, y si el primer fetch disparaba responses
   * antes de que el listener estuviera activo, se perdían.
   *
   * Bufferiza TODAS las responses 200 con body JSON no vacío en
   * `this._responseBuffer`. _captureResponse() filtra el buffer por
   * urlPattern en vez de registrar listener nuevo cada vez.
   *
   * Cap de 1000 items para no leakear memoria en sesiones largas
   * (DJI hace polling activo en background, podria acumular miles de
   * responses irrelevantes).
   *
   * Idempotente: si ya está instalado, no hace nada.
   */
  _installResponseBuffer() {
    if (this._responseListenerInstalled) return;
    this._responseListenerInstalled = true;
    this._responseBuffer = [];
    this.page.on('response', async (r) => {
      if (r.status() !== 200) return;
      try {
        const body = await r.json();
        // Filtrar responses vacías (ej. OPTIONS preflight que devolvió 200)
        if (body && typeof body === 'object' && Object.keys(body).length > 0) {
          this._responseBuffer.push({ url: r.url(), body });
          // Cap: dropear oldest si excede 1000
          if (this._responseBuffer.length > 1000) {
            this._responseBuffer.splice(0, this._responseBuffer.length - 1000);
          }
        }
      } catch {
        // Body no es JSON, ignorar
      }
    });
  }

  /**
   * Persiste el contexto actual en disco. Llamar después de un login
   * exitoso para que la próxima corrida no repita el flow de redirects.
   */
  async saveStorageState() {
    if (!this.context) return;
    try {
      const state = await this.context.storageState();
      fs.writeFileSync(this.storageStatePath, JSON.stringify(state, null, 2), 'utf8');
      if (process.env.DEBUG_DJIAG) {
        console.error(`[storage-state] saved → ${this.storageStatePath} (${state.cookies?.length ?? 0} cookies, ${state.origins?.length ?? 0} origins)`);
      }
    } catch (err) {
      // No fallar el flujo principal por no poder persistir el state.
      console.warn(`[storage-state] no se pudo guardar: ${err.message}`);
    }
  }

  /**
   * Espera explícita a la PRIMER query GraphQL que retorne 200 post-login.
   * El bug original era que page.waitForURL con la URL de /mission se cumplía
   * apenas aterrizaba en esa ruta, pero las cookies en agro-vg.djiag.com se
   * establecían en ese mismo instante o después. Resultado: las primeras
   * 401/302 eran probes del frontend que parecían "fallo de auth".
   * Esta wait bloquea hasta tener evidencia real de que la auth está
   * propagada (un graphql 200).
   */
  async _waitForAuthenticatedGraphql() {
    if (!this.page) return;
    try {
      await this.page.waitForResponse(
        (response) => {
          const url = response.url();
          return url.includes('/graphql') && response.status() === 200;
        },
        { timeout: 15_000 }
      );
    } catch {
      // Si expira el timeout, no es necesariamente un error — DJI puede no
      // disparar graphql inmediatamente. Continuar y dejar que el caller
      // detecte el problema cuando intente capturar la response.
    }
  }

  async login() {
    if (this.loggedIn) return;
    // S1 (audit 2026-07-22, H2). Verificar el circuit breaker ANTES de
    // intentar. Si esta 'open', throw fail-fast con countdown claro
    // (e.g. "Circuit open, retry in 4m32s"). Esto evita martillar la
    // UI de DJI si SmartFarm Web esta caido.
    this._ensureCircuitBreaker();
    this.circuitBreaker.guard();
    await this.launch();
    if (!this.email || !this.password) {
      throw new Error('DjiagKoreanClient: set DJIAG_EMAIL and DJIAG_PASSWORD (or pass via options).');
    }
    // XS3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H6). Envolver el flow
    // de login con backoff exponencial (3 intentos, 1.5s/3s/6s + jitter)
    // para tolerar rate-limit transitorio de DJI. NO reintenta el error
    // de config (DJIAG_EMAIL/PASSWORD missing) — eso es de programacion.
    try {
      await withBackoff(
        () => this._attemptLogin(),
        {
          maxAttempts: 3,
          baseDelayMs: 1500,
          maxDelayMs: 30_000,
          jitter: 0.25,
          // Si el caller setea una shouldRetry custom en options, usarla.
          // Default del helper: reintenta network/timeout, NO config.
          onRetry: process.env.DEBUG_DJIAG
            ? (info) => console.error(`[login-backoff] retry ${info.attempt}/3 after ${info.delayMs}ms (err=${info.err?.message?.slice(0, 80)})`)
            : undefined
        }
      );
      this.loggedIn = true;
      // S1: registrar exito en el circuit breaker. Si veniamos de
      // half-open, transiciona a closed. Si estabamos en closed,
      // resetea el failureCount.
      this.circuitBreaker.recordSuccess();
    } catch (err) {
      // S1: registrar failure. Si llegamos al threshold (3), el circuit
      // se abre y la proxima corrida va a fallar rapido con countdown.
      this.circuitBreaker.recordFailure();
      throw err;
    }
  }

  /**
   * (XS3 / 2026-07-22) Intento individual del flow de login UI. Extraido
   * de login() para poder envolverlo con withBackoff sin re-marcar
   * `loggedIn` prematuramente. Si un intento falla a mitad del flow,
   * el siguiente retry re-arranca desde el goto a /login (la pagina
   * ya esta en un estado consistente porque la UI es stateless entre
   * navegaciones).
   */
  async _attemptLogin() {
    await this.page.goto(`${DEFAULT_BASE}/login`, { waitUntil: 'domcontentloaded' });
    try { await this.page.getByRole('button', { name: 'Accept All Cookies' }).click({ timeout: 3000 }); } catch {}
    try { await this.page.locator('input[type="checkbox"]').first().check({ timeout: 3000 }); } catch {}
    try { await this.page.getByRole('button', { name: 'Log in with DJI account' }).click({ timeout: 3000 }); } catch {}
    await this.page.waitForLoadState('networkidle');
    await this.page.locator('input[name="username"]').fill(this.email);
    await this.page.locator('input[type="password"]').fill(this.password);
    await Promise.all([
      this.page.waitForURL('**/mission', { timeout: 60_000 }),
      this.page.getByRole('button', { name: 'Log In' }).click()
    ]);
    // (S1 §2.5) esperar a que la auth se propague a graphql antes de persistir.
    // Si esto falla, el retry re-arranca desde /login.
    await this._waitForAuthenticatedGraphql();
    await this.saveStorageState();
  }

  /**
   * Garantiza que la vista activa sea "Field Management" (no "Task History"),
   * que es la que dispara los queries de lands/landsCluster. Idempotente.
   *
   * (S1 §2.2) Tras navegar a Field Management, intenta cargar TODAS las
   * fincas haciendo scroll virtualizado. Sin esto, el query `?name=lands`
   * solo trae las ~20 primeras que el virtual scroller tiene en el DOM.
   * El selector se pasa por env `DJIAG_FIELD_SELECTOR` para no hardcodear
   * algo que DJI puede cambiar; default conservador busca cualquier
   * `[data-field-uuid]` o `[class*="fieldCard"]`.
   */
  async ensureOnFieldManagement() {
    // (2026-07-03) Cambio `networkidle` → `domcontentloaded` porque DJI hace
    // polling activo (websocket / setInterval en el frontend) que nunca
    // "calma" la red. `networkidle` se queda esperando 30s y muere.
    // `domcontentloaded` + un wait explícito es más predecible.
    await this.page.goto(`${DEFAULT_BASE}/mission`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(3000);
    try {
      const fm = this.page.locator('aside li[title="Field Management"]').first();
      if ((await fm.count()) > 0) {
        await fm.click({ timeout: 5000 });
        await this.page.waitForTimeout(3000);
      }
    } catch {
      // Si no está el menu, probablemente ya estamos en Field Management
      // (sabemos que /mission → esa vista por data-menu-id). No fallar.
    }

    // Scroll para cargar todas las fincas del virtual scroller.
    // El selector default busca heurísticamente; si DJI cambia el DOM
    // y esto rompe, override con env DJIAG_FIELD_SELECTOR='[data-otro]'.
    const fieldSelector = process.env.DJIAG_FIELD_SELECTOR ||
      '[data-field-uuid], [class*="fieldCard"], [class*="fieldItem"]';
    try {
      const scroll = await scrollUntilStagnant(this.page, {
        countSelector: fieldSelector,
        maxCycles: 60,
        settleMs: 2000,
        waitBetweenScrollsMs: 500
      });
      if (process.env.DEBUG_DJIAG) {
        console.error(`[ensureOnFieldManagement] scroll: ${scroll.totalCount} cards en ${scroll.cycles} ciclos`);
      }
    } catch (err) {
      // Si el selector no matchea nada (DJI cambió el DOM), no fallar —
      // el caller va a recibir 0 fincas y sabrá que hay que actualizar
      // el selector.
      if (process.env.DEBUG_DJIAG) {
        console.error(`[ensureOnFieldManagement] scroll no encontró items con selector '${fieldSelector}': ${err.message}`);
      }
    }
  }

  /**
   * Captura la response JSON de un endpoint específico. Dispara el request
   * navegando a la página que lo invoca y espera la response.
   *
   * @param {object} opts
   * @param {string} opts.urlPattern — string o RegExp para matchear la URL
   * @param {() => Promise<void>} opts.triggerPageFn — navegación/clicks para disparar el request
   * @returns {Promise<object>} JSON body de la response
   */
  /**
   * Captura la response JSON de un endpoint específico. Dispara el request
   * navegando a la página que lo invoca y espera la response.
   *
   * S3 (audit 2026-07-22, H4) refactor:
   *   - Antes: el listener `page.on('response', ...)` se registraba
   *     DESPUÉS de `await this.login()`, lo que podia perder responses
   *     si el primer fetch disparaba antes de que el listener estuviera
   *     activo. Bug histórico que causaba ~1 de cada 20 corridas
   *     fallidas con "_captureResponse: no matching response within 30000ms".
   *   - Ahora: el listener se instala UNA VEZ en launch() (via
   *     _installResponseBuffer) y se llena `this._responseBuffer`
   *     con TODAS las responses 200 + body JSON no vacío. Acá
   *     filtramos el buffer por urlPattern en vez de registrar
   *     listener nuevo.
   *
   * Mecánica:
   *   1. await login() (puede triggerear responses que se acumulan
   *      en el buffer antes del snapshot).
   *   2. snapshot = buffer.length (marca "todo lo de antes es viejo").
   *   3. await triggerPageFn() — triggerea nuevas responses.
   *   4. Esperar hasta tener `minResponses` matching NUEVAS (post-snapshot).
   *   5. Preferir la que tenga data.lands, fallback a data, fallback a first.
   *   6. En finally: clear el buffer entero (evitar leak entre fetches).
   *
   * @param {object} opts
   * @param {string} opts.urlPattern — string o RegExp para matchear la URL
   * @param {() => Promise<void>} opts.triggerPageFn — navegación/clicks para disparar el request
   * @returns {Promise<object>} JSON body de la response
   */
  async _captureResponse({ urlPattern, triggerPageFn, minResponses = 1 }) {
    await this.login();
    const patternMatch = typeof urlPattern === 'string'
      ? (u) => u.includes(urlPattern)
      : (u) => urlPattern.test(u);

    // Snapshot del buffer ANTES de triggerear. Las responses que
    // lleguen DESPUES de este punto son de nuestro trigger.
    const snapshotLen = this._responseBuffer.length;

    try {
      await triggerPageFn();
      // Esperar hasta tener `minResponses` responses matching NUEVAS
      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() < deadline) {
        const newMatching = this._responseBuffer
          .slice(snapshotLen)
          .filter((b) => patternMatch(b.url));
        if (newMatching.length >= minResponses) break;
        await this.page.waitForTimeout(200);
      }
      const newMatching = this._responseBuffer
        .slice(snapshotLen)
        .filter((b) => patternMatch(b.url));
      if (newMatching.length === 0) {
        throw new Error(`_captureResponse: no matching response within ${this.timeoutMs}ms`);
      }
      // Preferir la response con `data.lands` (la que matchea parseLandsResponse).
      // Si no hay, la primera con `data` no vacío. Si ninguna, fallback.
      const withLands = newMatching.find((b) => b.body.data?.lands);
      const withData = newMatching.find((b) => b.body.data && Object.keys(b.body.data).length > 0);
      if (process.env.DEBUG_DJIAG) {
        console.error(`[capture-response] new ${newMatching.length} (snapshot@${snapshotLen}, total=${this._responseBuffer.length}):`, newMatching.map((b) => ({ url: b.url.slice(0, 80), keys: Object.keys(b.body.data || {}), bodyPreview: JSON.stringify(b.body).slice(0, 300) })));
        console.error(`[capture-response] returning:`, (withLands ?? withData ?? newMatching[0]).body);
      }
      return (withLands ?? withData ?? newMatching[0]).body;
    } finally {
      // Limpiar el buffer entero al final de cada captura para no
      // leakear memoria entre fetches. El listener sigue activo y
      // va a re-llenar el buffer en la proxima navegacion.
      this._responseBuffer.length = 0;
    }
  }

  /**
   * Fetch de la primera página (o la página apuntada por `cursor`) de lands.
   * Devuelve el response crudo; para paginar, usar `fetchAllLandsPages()`.
   *
   * (2026-07-02) Acepta `{ cursor }` para inyectar el cursor deseado en el
   * POST body vía `page.route()` (instalado en `launch()`). Sin args,
   * `cursor` default = '0' (página 1) — comportamiento histórico.
   *
   * @param {object} [opts]
   * @param {string} [opts.cursor='0'] — cursor de paginación (endCursor de la página anterior)
   * @returns {Promise<object>}
   */
  async fetchLandsPage(opts = {}) {
    const cursor = opts.cursor ?? '0';
    this._currentLandsCursor = String(cursor);
    return await this._captureResponse({
      // Match exacto al endpoint de lands (?name=lands). No matchea
      // userProfile/departmentTree que también son graphql.
      urlPattern: 'graphql?name=lands',
      triggerPageFn: async () => this.ensureOnFieldManagement(),
      // Forzar al menos 2 matching responses (lands suele ser la 2da — la
      // 1ra puede ser un empty 200 de un preflight o algo similar).
      minResponses: 2,
    });
  }

  /**
   * Fetch de todas las fincas, paginando con cursor. Devuelve array de
   * responses crudas (cada una con su `data.lands`). El caller debe
   * normalizar con `parseLandsResponse()` de `lib/djiag-lands-fetcher`.
   *
   * (2026-07-02) BUG HISTÓRICO FIX: el cursor se trackea y se pasa a cada
   * llamada de `fetchLandsPage()`. Antes, `fetchLandsPage()` siempre
   * devolvía la página 1 (cursor='0' hardcoded en el POST body). El bug
   * estaba enmascarado por la virtualización del scroll infinito cuando
   * DJI tenía pageSize=200; cuando cambió a pageSize=20 + DOM distinto,
   * el scroll no disparaba más queries y el paginator se rompía.
   *
   * (2026-07-03) Auto-cap por totalCount: después de la primera response,
   * si `data.lands.totalCount` indica más fincas que las que caben en
   * `maxPages * pageSize`, ajustamos `maxPages` para arriba. Evita perder
   * fincas si DJI crece (hoy 1205 fincas → ~7 páginas; si crece a 5000
   * → ~25 páginas; con maxPages=100 default estaríamos OK, pero esto
   * protege del caso futuro donde el caller pase maxPages muy bajo).
   *
   * @param {object} [opts]
   * @param {number} [opts.maxPages=100] — safety cap (se auto-eleva si totalCount lo pide)
   * @param {number} [opts.pageSize=200] — pageSize hardcoded en la query GraphQL (`first: 200`)
   * @param {string} [opts.cursor='0']  — cursor inicial (útil para resume)
   * @returns {Promise<object[]>}
   */
  async fetchAllLandsPages(opts = {}) {
    const userMaxPages = opts.maxPages ?? 100;
    const pageSize = opts.pageSize ?? 200;
    let effectiveMaxPages = userMaxPages;
    let cursor = opts.cursor ?? '0';
    const pages = [];
    for (let i = 0; i < effectiveMaxPages; i++) {
      const response = await this.fetchLandsPage({ cursor });
      pages.push(response);
      const data = response?.data?.lands;
      if (!data || !data.pageInfo?.hasNextPage) break;

      // Auto-elevar maxPages en la primera iteración si totalCount lo pide.
      // Buffer de +2 páginas para tolerar races o fincas agregadas durante
      // el fetch (DJI puede agregar mientras scrapeamos).
      if (i === 0 && typeof data.totalCount === 'number' && data.totalCount > 0) {
        const needed = Math.ceil(data.totalCount / pageSize) + 2;
        if (needed > effectiveMaxPages) {
          if (process.env.DEBUG_DJIAG) {
            console.error(`[fetchAllLandsPages] auto-cap: totalCount=${data.totalCount}, elevando maxPages ${userMaxPages} → ${needed}`);
          }
          effectiveMaxPages = needed;
        }
      }

      const nextCursor = data.pageInfo.endCursor;
      if (!nextCursor) break;
      cursor = nextCursor;
      // Pequeño delay entre páginas para no rate-limitear
      await this.page.waitForTimeout(800);
    }
    if (pages.length >= effectiveMaxPages) {
      // Última página iterada y todavía no paró → probablemente hay más
      // fincas que las que alcanzamos a fetchear. Advertir.
      const lastData = pages[pages.length - 1]?.data?.lands;
      if (lastData?.pageInfo?.hasNextPage) {
        console.warn(`[fetchAllLandsPages] maxPages=${effectiveMaxPages} alcanzado pero DJI reporta hasNextPage=true. Quedan fincas sin traer.`);
      }
    }
    return pages;
  }

  async fetchLandsCluster() {
    return await this._captureResponse({
      urlPattern: 'name=landsCluster',
      triggerPageFn: async () => this.ensureOnFieldManagement()
    });
  }

  async close() {
    if (this.browser) {
      // Persistir state una última vez por si hubo refresh durante la sesión.
      await this.saveStorageState();
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      this.loggedIn = false;
    }
  }
}

module.exports = {
  DjiagKoreanClient,
  loadEnvFromLocalFile,
  KOREAN_HOST,
  DEFAULT_BASE,
  DEFAULT_STORAGE_STATE_PATH,
  DEFAULT_STORAGE_STATE_MAX_AGE_MS
};
