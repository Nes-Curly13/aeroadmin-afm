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
    await this.launch();
    if (!this.email || !this.password) {
      throw new Error('DjiagKoreanClient: set DJIAG_EMAIL and DJIAG_PASSWORD (or pass via options).');
    }
    await this.page.goto(`${DEFAULT_BASE}/login`, { waitUntil: 'domcontentloaded' });
    try { await this.page.getByRole('button', { name: 'Accept All Cookies' }).click({ timeout: 3000 }); } catch {}
    try { await this.page.locator('input[type="checkbox"]').first().check({ timeout: 3000 }); } catch {}
    try { await this.page.getByRole('button', { name: 'Log in with DJI account' }).click({ timeout: 3000 }); } catch {}
    await this.page.waitForLoadState('networkidle');
    await this.page.locator('input[name="username"]').fill(this.email);
    await this.page.locator('input[type="password"]').fill(this.password);
    await Promise.all([
      this.page.waitForURL('**/mission', { timeout: 60000 }),
      this.page.getByRole('button', { name: 'Log In' }).click()
    ]);
    this.loggedIn = true;
    // (S1 §2.5) esperar a que la auth se propague a graphql antes de persistir.
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
    await this.page.goto(`${DEFAULT_BASE}/mission`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);
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
  async _captureResponse({ urlPattern, triggerPageFn, minResponses = 1 }) {
    await this.login();
    // (2026-06-23 refactor: en vez de waitForResponse (que solo matchea
    //  la PRIMER response y se puede comer la incorrecta si hay varias
    //  graphql calls), bufferamos todas las responses que matchean el
    //  pattern y devolvemos la que tenga body JSON con `data` no vacío.)
    const patternMatch = typeof urlPattern === 'string'
      ? (u) => u.includes(urlPattern)
      : (u) => urlPattern.test(u);

    const buffered = [];
    const listener = async (r) => {
      if (r.status() !== 200) return;
      if (!patternMatch(r.url())) return;
      try {
        const body = await r.json();
        // Filtrar responses vacías (ej. OPTIONS preflight que devolvió 200)
        if (body && typeof body === 'object' && Object.keys(body).length > 0) {
          buffered.push({ url: r.url(), body });
        }
      } catch {}
    };
    this.page.on('response', listener);
    try {
      await triggerPageFn();
      // Esperar hasta tener `minResponses` responses bufferadas
      const deadline = Date.now() + this.timeoutMs;
      while (buffered.length < minResponses && Date.now() < deadline) {
        await this.page.waitForTimeout(200);
      }
      if (buffered.length === 0) {
        throw new Error(`_captureResponse: no matching response within ${this.timeoutMs}ms`);
      }
      // Preferir la response con `data.lands` (la que matchea parseLandsResponse).
      // Si no hay, la primera con `data` no vacío. Si ninguna, fallback.
      const withLands = buffered.find((b) => b.body.data?.lands);
      const withData = buffered.find((b) => b.body.data && Object.keys(b.body.data).length > 0);
      if (process.env.DEBUG_DJIAG) {
        console.error(`[capture-response] buffered ${buffered.length}:`,
          buffered.map((b) => ({ url: b.url.slice(0, 80), keys: Object.keys(b.body.data || {}), bodyPreview: JSON.stringify(b.body).slice(0, 300) })));
        console.error(`[capture-response] returning:`,
          (withLands ?? withData ?? buffered[0]).body);
      }
      return (withLands ?? withData ?? buffered[0]).body;
    } finally {
      this.page.off('response', listener);
    }
  }

  /**
   * Fetch de la primera página de lands. Devuelve el response crudo;
   * para paginar, usar `fetchAllLands()` o aplicar la lógica en el caller.
   */
  async fetchLandsPage() {
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
   * @param {object} [opts]
   * @param {number} [opts.maxPages=20] — safety cap por si DJI cambia la paginación
   * @returns {Promise<object[]>}
   */
  async fetchAllLandsPages(opts = {}) {
    const maxPages = opts.maxPages ?? 20;
    const pages = [];
    let cursor = '0';
    for (let i = 0; i < maxPages; i++) {
      const response = await this.fetchLandsPage();
      pages.push(response);
      const data = response?.data?.lands;
      if (!data || !data.pageInfo?.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
      if (!cursor) break;
      // Pequeño delay entre páginas para no rate-limitear
      await this.page.waitForTimeout(800);
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
