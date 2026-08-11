/**
 * Fitness functions de arquitectura para AeroAdmin AFM.
 *
 * Cada regla aquí codifica una decisión ya tomada en el SDD (sección 3 y 7)
 * y en docs/ARCHITECTURE.md. Si una regla rompe con la realidad del repo,
 * PRIMERO arreglás la violación, después tocás esta config — no al revés.
 *
 * Instalación: npm install --save-dev dependency-cruiser (ya instalado)
 * Uso local:  npm run arch:check
 * Ver §2 de docs/QUALITY_GAUNTLET.md para la justificación de cada regla.
 *
 * Estado actual (2026-07-28, sprint de adopción):
 *   - 1 regla en `error` (única que rompe CI desde el día 1: pg directo).
 *   - 4 reglas en `warn` (aspiracionales; subir a `error` cuando los warnings
 *     queden en 0 — ver docs/QUALITY_GAUNTLET.md §2).
 *   - 1 regla en `info` (huérfanos — solo para auditoría manual).
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // =====================================================================
    // REGLA 1 (ERROR, desde día 1): pg NUNCA se importa directo desde
    // app/** ni components/**. La capa de data access es api/repositories.ts
    // + api/queries.ts + lib/db.ts.
    //
    // Esta es la única regla que no tiene excepciones: si la rompés,
    // el cliente recibe el bundle con pg adentro y revienta el browser.
    // =====================================================================
    {
      name: 'no-pg-from-app-or-components',
      comment:
        'pg NUNCA se importa directo desde app/ ni components/. La capa de ' +
        'data access es api/repositories.ts + api/queries.ts + lib/db.ts. ' +
        'Si se rompe, el cliente recibe pg en el bundle y revienta el browser.',
      severity: 'error',
      from: { path: '^(app|components)/' },
      to: { path: '^node_modules/pg$' },
    },

    // =====================================================================
    // REGLA 2 (WARN, aspiracional): components/** no importa data access
    // excepto por props. Si lo hace, debería recibir los datos por props
    // desde un Server Component o route handler.
    //
    // Aspiración: subir a `error` cuando los 2 warnings actuales (que son
    // falsos positivos de `import type`) estén limpios. Ver ADOPTION.md.
    // =====================================================================
    {
      name: 'components-must-not-touch-db',
      comment:
        'components/** no importa la capa de data access. Si un componente ' +
        'necesita datos, vienen por props. NOTA 2026-07-28: las 2 violaciones ' +
        'actuales son `import type` (falsos positivos de depcruise con ' +
        'tsPreCompilationDeps:false); revisar antes de subir a error.',
      severity: 'warn',
      from: { path: '^components/' },
      to: { path: '^(lib/db\\.ts$|api/repositories\\.ts$|api/queries\\.ts$)' },
    },

    // =====================================================================
    // REGLA 2b (WARN, F4 fix 2026-08-11): app/** pages (NO app/api/**)
    // no importan `getDb` directo de `lib/db`. Deben ir por
    // `api/repositories.ts` (o `api/queries.ts`). Las routes en
    // `app/api/**/route.ts` están excluidas — pueden tener queries
    // ad-hoc que no encajan en el repo. Si el patrón crece, refactor
    // a `api/repositories.ts`.
    //
    // Aspiración: subir a `error` cuando los 0 warnings actuales
    // (post-F4) se mantengan. Si aparece uno, es un drift.
    // =====================================================================
    {
      name: 'app-pages-must-go-through-repositories',
      comment:
        'app/** pages (excepto app/api/**) no importan `getDb` de ' +
        '`lib/db` directo — van por `api/repositories.ts` o ' +
        '`api/queries.ts`. Las routes en app/api/**/route.ts están ' +
        'exceptuadas (queries ad-hoc que no entran en el repo).',
      severity: 'warn',
      from: { path: '^app/(?!api/)[^/]+/page\\.tsx?$' },
      to: { path: '^lib/db\\.ts$' },
    },

    // =====================================================================
    // REGLA 3 (WARN, aspiracional): el cliente Playwright y los fetchers
    // HTTP de DJIAG no se importan desde app/**. Esos archivos son
    // infraestructura de scraping, no de UI.
    //
    // Alcance actual: lib/djiag-korean-client.* y lib/djiag-*-fetcher.*.
    // NO incluimos djiag-spatial-aggregator, djiag-health, ni
    // djiag-from-make/* — esos son lógica pura / agregación / wrappers
    // que SÍ pueden ser usados desde app/api/**/route.ts.
    //
    // Aspiración: subir a `error` cuando las 5 violaciones actuales
    // (TaskHistoryClient + pages) estén migradas a wrappers en api/.
    // =====================================================================
    {
      name: 'djiag-scraper-not-imported-from-app',
      comment:
        'El cliente Playwright (lib/djiag-korean-client) y los fetchers ' +
        'HTTP (lib/djiag-*-fetcher) son infraestructura de scraping y no ' +
        'deben invocarse desde app/**. Deben pasar por un script del ' +
        'pipeline o por un wrapper en api/. Las funciones puras como ' +
        'djiag-spatial-aggregator, djiag-health y djiag-from-make/* SÍ ' +
        'pueden usarse desde route handlers.',
      severity: 'warn',
      from: { path: '^app/' },
      to: {
        path: '^lib/(djiag-korean-client|djiag-.*-fetcher)(\\.(js|d\\.ts))?$',
      },
    },

    // =====================================================================
    // REGLA 4 (ERROR, desde día 1): lib/** no importa next/* — debe
    // ser framework-agnostic. Esto mantiene lib/ testeable sin levantar
    // Next.js.
    // =====================================================================
    {
      name: 'lib-must-stay-framework-agnostic',
      comment:
        'lib/** es lógica de negocio pura y debe ser testeable sin Next.js. ' +
        'Si algo en lib/ necesita next/*, probablemente pertenece a app/ ' +
        'o a un helper distinto.',
      severity: 'error',
      from: { path: '^lib/' },
      to: { path: '^node_modules/next' },
    },

    // =====================================================================
    // REGLA 5 (WARN): dependencias circulares dificultan testing aislado.
    // Las 3 actuales están en lib/auth/** — vale la pena resolverlas
    // extrayendo tipos a un archivo aparte.
    // =====================================================================
    {
      name: 'no-circular',
      comment:
        'Dependencias circulares dificultan el testing aislado y el ' +
        'razonamiento sobre el código. Resolvelas con extracción de tipos ' +
        'a un archivo aparte o inversión de dependencias.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },

    // =====================================================================
    // REGLA 6 (INFO): archivos huérfanos. Severidad info, no bloqueante.
    // Sirve para auditoría manual — los .d.ts son declaraciones para los
    // .js, son esperables.
    // =====================================================================
    {
      name: 'no-orphans',
      comment:
        'Archivos sin ninguna referencia entrante ni saliente relevante ' +
        'suelen ser código muerto dejado por un refactor incompleto. ' +
        'Severidad info — revisá manualmente antes de borrar.',
      severity: 'info',
      from: {
        orphan: true,
        pathNot: [
          '\\.(test|spec)\\.(ts|tsx|js)$',
          '^scripts/',
          '^tests/',
          '^db/',
          '^supabase/',
          // .d.ts son declaraciones para los .js (algunos fetchers están
          // en .js por dependencias de playwright-core); no son código
          // ejecutable, son declaraciones de tipos. No los marcamos
          // como huérfanos.
          '\\.d\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // false (default) hace que depcruise use el análisis estático de
    // TypeScript estándar, que descarta `import type {...}` correctamente.
    // Si lo subimos a true, los `import type` se cuentan como imports
    // reales y aparecen falsos positivos.
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    exclude: {
      path: 'node_modules|^\\.next|^coverage|^reports|^test-results|^backups|^djiag_exports',
    },
  },
};
