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

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_BASE = 'https://www.djiag.com';
const KOREAN_HOST = 'kr-ag2-api.dji.com';

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

class DjiagKoreanClient {
  /**
   * @param {object} [options]
   * @param {boolean} [options.headless=true]
   * @param {string}  [options.locale='zh-CN']   — setea el browser locale
   * @param {string}  [options.email]            — default: process.env.DJIAG_EMAIL
   * @param {string}  [options.password]         — default: process.env.DJIAG_PASSWORD
   * @param {number}  [options.timeoutMs=30000]  — timeouts para waits
   */
  constructor(options = {}) {
    loadEnvFromLocalFile();
    this.headless = options.headless ?? true;
    this.locale = options.locale ?? 'zh-CN';
    this.email = options.email ?? process.env.DJIAG_EMAIL;
    this.password = options.password ?? process.env.DJIAG_PASSWORD;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.loggedIn = false;
  }

  async launch() {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      locale: this.locale,
      extraHTTPHeaders: {
        // Crítico: este header hace que DJI rutee al backend coreano.
        // Sin él, los requests van al regional (`agro-vg.djiag.com`)
        // y el query de lands viene vacío.
        'accept-language': 'zh-CN,zh'
      }
    });
    this.page = await this.context.newPage();
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
  }

  /**
   * Garantiza que la vista activa sea "Field Management" (no "Task History"),
   * que es la que dispara los queries de lands/landsCluster. Idempotente.
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
  DEFAULT_BASE
};
