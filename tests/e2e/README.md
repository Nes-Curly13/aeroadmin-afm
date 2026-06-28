# E2E Tests (Playwright) — Sprint M1

Sprint M1 (2026-06-28) introduce Playwright E2E para validar los flujos
principales del operador contra un Next dev server real.

## Prereqs

1. **Browsers instalados** (Chromium + Firefox):
   ```bash
   npx playwright install chromium firefox
   ```
   (Los binarios están en `%LOCALAPPDATA%/ms-playwright/` en Windows.)

2. **BD con `app_users` migrateada**:
   ```bash
   node scripts/apply-pending-migrations.js
   ```

3. **Usuario E2E seeded** — el globalSetup lo hace solo:
   - email: `e2e@aeroadmin.local` (default)
   - password: `E2ETest12345!` (default)
   - role: `admin`

## Run

```bash
# Asegurate que no hay dev server corriendo en :3001 (el port default).
npm run e2e              # todas las specs
npm run e2e:auth         # solo auth-and-dashboard.spec
npm run e2e:map          # solo map-and-history.spec

# Headed mode (debugging):
PLAYWRIGHT_HEADED=1 npx playwright test --headed

# Solo Chromium (default projects):
npx playwright test --project=chromium
```

## Override variables de entorno

```bash
BASE_URL=http://localhost:3000 \
E2E_USER_EMAIL=admin@myorg.com \
E2E_USER_PASSWORD=Secreto123! \
npm run e2e
```

## Que cubre

- **auth-and-dashboard.spec** (6 tests):
  - Redirect / sin auth
  - Login con credenciales malas -> mensaje de error
  - Login como admin -> dashboard
  - KPIs no muestran `[object Object]` o `NaN`
  - Logout via clearCookies -> redirect
  - /admin/* no crashea para admin (status <500)

- **map-and-history.spec** (7 tests):
  - /map y /history cargan despues de login
  - Stat cards visibles (Parcelas, Area fumigable, etc.)
  - Toggle 'Vuelos (DJI AG)' (M6)
  - Legend con item 'Vuelo'
  - History tiene headers de tabla

## No cubre (por diseño)

- Scraper DJI (requiere credenciales reales + browser headless pesado).
- Bulk imports (`import_djiag_data.js`).
- Visual regressions (no Playwright screenshot comparison).
- Mobile layouts (los proyectos se prueban solo en desktop).
