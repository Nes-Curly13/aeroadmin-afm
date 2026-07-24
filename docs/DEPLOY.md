# Deploy a Vercel + Supabase

> Guía de deploy production-ready para `AeroAdmin AFM` (Sprint E).
> Stack: **Vercel** (Next.js 16 serverless) + **Supabase** (Postgres
> managed) + **GitHub Actions** (watchdog + scheduled refresh).

---

## Pre-requisitos

1. **Cuenta Vercel** (plan Pro recomendado — necesita `memory: 3008`
   para el route de PDF; el plan Hobby está limitado a 1024 MB).
2. **Proyecto Supabase** creado (tier Free alcanza para empezar,
   Pro para producción).
3. **Dominio público** para el webhook DJI AG (Vercel te da uno
   `*.vercel.app` automático, opcional custom domain).
4. **Repo GitHub** `Nes-Curly13/aeroadmin-afm` con acceso de admin.

---

## Step 1 — Crear proyecto Supabase + correr migrations

1. Ir a [supabase.com/dashboard](https://supabase.com/dashboard) →
   **New project**.
2. Región: elegir **US East (Virginia)** — matchea con la región
   `iad1` de Vercel para minimizar latencia.
3. Guardar la **database password** que te genera Supabase (la
   necesitás para la `DATABASE_URL`).
4. Una vez creado, ir a **Settings → Database → Connection string →
   Transaction pooler (port 6543)**. Copiar el connection string —
   es la `DATABASE_URL` que va a Vercel.
5. Localmente, correr las migrations apuntando a Supabase:
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
   $env:DATABASE_SSL = "true"
   npm run db:migrate
   ```
   Esto aplica todas las migrations en `supabase/migrations/`,
   incluyendo `20260724000000_add_djiag_health_table.sql` (Sprint E).

---

## Step 2 — Seed admin user

```powershell
$env:AUTH_SEED_EMAIL = "admin@tu-dominio.com"
$env:AUTH_SEED_PASSWORD = "<password-fuerte>"
npm run auth:seed
```

> **Importante**: cambiar el password después del primer login.
> El seed crea 1 usuario admin con role `admin` (logueable vía
> NextAuth credentials provider).

---

## Step 3 — Crear proyecto Vercel + conectar repo

1. Ir a [vercel.com/new](https://vercel.com/new) → **Import Git
   Repository** → seleccionar `Nes-Curly13/aeroadmin-afm`.
2. **Framework Preset**: Next.js (auto-detectado).
3. **Build & Output settings**: dejar las defaults — el `vercel.json`
   del repo ya override `buildCommand` (`next build`) y
   `installCommand` (`npm ci`).
4. **Root Directory**: dejar en blanco (monorepo no, single app).

---

## Step 4 — Configurar env vars en Vercel

Ir a **Settings → Environment Variables** y agregar las siguientes.
Apretar "Add" para cada una — seleccionar scope **Production** (y
opcionalmente Preview si querés testear en PRs).

| Variable | Requerida | Ejemplo | Notas |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres` | Transaction pooler de Supabase (port 6543). |
| `DATABASE_SSL` | ✅ | `true` | Supabase requiere SSL. |
| `AUTH_SECRET` | ✅ | (output de `openssl rand -base64 32`) | NextAuth v5. Mismo secret para todos los deploys (los JWTs se invalidan si cambia). |
| `AUTH_URL` | ✅ | `https://aeroadmin-afm.vercel.app` | URL canónica del deploy. |
| `AUTH_TRUST_HOST` | ✅ | `true` | Obligatorio en Vercel (sino NextAuth rechaza los headers `X-Forwarded-Host`). |
| `OPERATOR_NAME` | ✅ | `AeroAdmin Cañero` | Aparece en el header del PDF y CSV. |
| `OPERATOR_REGION` | ✅ | `Valle del Cauca, Colombia` | Idem. |
| `NEXT_PUBLIC_OPERATOR_NAME` | ✅ | (mismo que `OPERATOR_NAME`) | Versión client-side (para el CSV fumigaciones). |
| `NEXT_PUBLIC_OPERATOR_REGION` | ✅ | (mismo que `OPERATOR_REGION`) | Idem. |
| `HEALTH_TOKEN` | ⚠️ recomendado | (output de `openssl rand -hex 32`) | Bypass del endpoint `/api/admin/djiag-health` para el GitHub Action watchdog. Mismo valor en Vercel Y en GitHub Secrets. |
| `DJIAG_EMAIL` | ⚠️ solo si usás scraper | `tu-email@dji.com` | Creds del scraper DJI AG. No requerido si solo usás la UI. |
| `DJIAG_PASSWORD` | ⚠️ solo si usás scraper | `<password>` | Idem. |

> **No commitear** los valores reales a git. Vercel los guarda
> encriptados en su dashboard.

---

## Step 5 — Primer deploy

1. Click **Deploy**. Vercel clona el repo, corre `npm ci` y
   `next build`. El primer deploy tarda ~3-5 min (instala
   `@sparticuz/chromium` que es ~50MB).
2. Una vez completado, Vercel te da una URL tipo
   `https://aeroadmin-afm-<hash>.vercel.app`. Ir a **Settings →
   Domains** para renombrar a `aeroadmin-afm.vercel.app` o custom.

---

## Step 6 — Smoke test

1. **Login**: ir a `https://<tu-dominio>/login`, entrar con el
   admin user del Step 2.
2. **Dashboard**: verificar que carguen las fumigaciones (si las
   importaste antes a Supabase).
3. **PDF**: ir a una parcela → click "Generar PDF". El primer
   request tarda ~15s (cold start del chromium de
   `@sparticuz/chromium`). El segundo request es <2s (browser
   reusado). Si falla, revisar logs de Vercel.
4. **Health**: `curl https://<tu-dominio>/api/admin/djiag-health`
   con `Authorization: Bearer <HEALTH_TOKEN>`. Debe devolver JSON
   con `status` y `lastRunAt`. Si devuelve `status: "unknown"`,
   la tabla `djiag_health` no tiene data todavía — correr el
   pipeline una vez para popularla.

---

## Step 7 — Configurar GitHub Secrets

Ir a **Settings → Secrets and variables → Actions** del repo:

| Secret | Valor |
|---|---|
| `HEALTH_URL` | `https://<tu-dominio>` (sin trailing slash) |
| `HEALTH_TOKEN` | (mismo valor que en Vercel) |

Estos secrets los consume el workflow
`.github/workflows/djiag-health-watchdog.yml` que corre cada 6h y
falla el build si el health está stale o broken.

> **Tip**: testeá el watchdog manualmente después del setup:
> ```bash
> gh workflow run djiag-health-watchdog.yml
> ```
> Y verificá que el run pase en 30-60s.

---

## Troubleshooting

- **PDF no genera**: revisá los logs de Vercel (Runtime Logs).
  Buscar `chromium` o `@sparticuz`. Si hay `Executable doesn't
  exist`, la region de Vercel puede no tener `/tmp` escribible —
  abrí un issue.
- **Health siempre 'unknown'**: la tabla `djiag_health` no tiene
  data. Correr el pipeline local apuntando a Supabase:
  ```bash
  DATABASE_URL=... npm run pipeline:djiag
  ```
- **Login falla con "Configuration"**: falta `AUTH_SECRET` o
  `AUTH_TRUST_HOST=true` en las env vars de Vercel.
- **Supabase connection timeout**: usaste el connection string
  "direct" (port 5432) en vez del pooler (port 6543). Serverless
  functions NO pueden mantener conexiones persistentes — siempre
  usar el pooler.

---

## Referencias

- [vercel.json schema](https://vercel.com/docs/projects/project-configuration)
- [@sparticuz/chromium](https://github.com/Sparticuz/chromium) (Sprint E Task 1)
- [Supabase transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)
- [NextAuth v5 on Vercel](https://authjs.dev/getting-started/deployment#vercel)
- `docs/HEALTH-WATCHDOG.md` — setup del GitHub Action watchdog
