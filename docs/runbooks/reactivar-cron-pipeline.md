# Guía paso a paso: Reactivar cron del pipeline DJI

> **Bloque C del Sprint S8 MVP** — necesitamos 3 secrets configurados en GitHub
> y 2 en Vercel para que el pipeline DJI corra automático.

## Estado actual

- ❌ `djiag-health-watchdog.yml` — **schedule deshabilitado** (falta `HEALTH_URL` + `HEALTH_TOKEN`)
- ❌ `refresh-fumigations.yml` — **schedule deshabilitado** (falta `DATABASE_URL`)
- ❌ Pipeline DJI no corre desde **2026-08-01** (22 días stale)
- ✅ Scripts existen: `scripts/refresh-fumigations.js`, `scripts/health-watchdog.js`, `scripts/djiag-from-make/*`
- ✅ `.env.local` ya tiene los valores de develop

---

## Paso 1 — Generar los secrets que faltan

### 1.1 HEALTH_TOKEN (Vercel + GitHub, mismo valor en ambos)

En PowerShell, generar un token random de 32 bytes hex:
```powershell
[System.Convert]::ToHexString((New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes(32)).ToLower()
```

O con node:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Guardar este valor** — lo vamos a usar tanto en Vercel como en GitHub. Anotalo en un lugar seguro (1Password / Bitwarden / lo que uses).

### 1.2 BACKFILL_TOKEN (opcional, solo si querés re-backfillear fumigaciones históricas)

Ya existe uno en `.env.local` (línea 6):
```
BACKFILL_TOKEN=c65241ecc42c417c9080b4b64148146f7565cc70597e05f7897a926bf8e2e02b
```

**Reusar el mismo** en Vercel + GitHub.

### 1.3 DATABASE_URL (ya existe, reusar)

Ya está en `.env.local` (línea 1):
```
DATABASE_URL=postgresql://postgres.daqvmldoyzoymlrmruyl:AFM-1DB2026@aws-1-us-west-2.pooler.supabase.com:6543/postgres
```

**Reusar el mismo** en GitHub.

---

## Paso 2 — Configurar secrets en Vercel

Vercel usa las env vars para el **runtime del server** (donde corre el watchdog server-side, si existe).

### 2.1 Abrir Vercel dashboard

1. Ir a https://vercel.com/dashboard
2. Seleccionar el proyecto `aeroadmin-afm`
3. Click **Settings** → **Environment Variables**

### 2.2 Agregar (o actualizar) estas variables

| Variable | Valor | Environments |
|---|---|---|
| `DATABASE_URL` | (el de .env.local) | Production, Preview |
| `BACKFILL_TOKEN` | (el de .env.local) | Production, Preview |
| `HEALTH_TOKEN` | (el que generaste en 1.1) | Production, Preview |

> **Tip**: el `HEALTH_TOKEN` se puede generar desde el CLI:
> ```bash
> npx vercel env add HEALTH_TOKEN production
> # (pegar el valor)
> ```

### 2.3 Redeploy para que tome los nuevos secrets

```bash
# Forzar un redeploy con los nuevos secrets
npx vercel --prod --force
```

O desde el dashboard: **Deployments** → click en el último → **Redeploy**.

---

## Paso 3 — Configurar secrets en GitHub

GitHub Actions los usa para los workflows `.github/workflows/*.yml`.

### 3.1 Abrir settings del repo

1. Ir a https://github.com/Nes-Curly13/aeroadmin-afm
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### 3.2 Agregar estos 3 secrets

| Secret | Valor | Workflow que lo usa |
|---|---|---|
| `HEALTH_URL` | `https://aeroadmin-afm.vercel.app` (sin trailing slash) | `djiag-health-watchdog.yml` |
| `HEALTH_TOKEN` | (el de 1.1) | `djiag-health-watchdog.yml` |
| `DATABASE_URL` | (el de .env.local) | `refresh-fumigations.yml` |

### 3.3 (Opcional) Variable `HEALTH_STALE_HOURS`

1. Click **Variables** tab (al lado de Secrets)
2. Click **New repository variable**
3. Nombre: `HEALTH_STALE_HOURS`, valor: `24` (umbral para marcar como stale)

---

## Paso 4 — Reactivar los schedules

Una vez configurados los secrets, editar los 2 workflows y restaurar el `on:` con el schedule:

### 4.1 `djiag-health-watchdog.yml`

Cambiar la sección `on:` para que vuelva a correr cada 6h:

```yaml
on:
  schedule:
    - cron: "0 */6 * * *"  # cada 6 horas
  workflow_dispatch:  # mantener para trigger manual
```

### 4.2 `refresh-fumigations.yml`

```yaml
on:
  schedule:
    - cron: "0 6 * * 1"  # cada lunes 06:00 UTC
  workflow_dispatch:  # mantener para trigger manual
```

### 4.3 Commit + push

```bash
git add .github/workflows/
git commit -m "chore(ci): restaurar schedules con secrets ya configurados"
git push
```

---

## Paso 5 — Verificar que funciona

### 5.1 Test manual del watchdog

1. GitHub → **Actions** → **djiag-health-watchdog** → **Run workflow** (botón "Run workflow")
2. Esperar ~1 min
3. Verificar que el run termina en ✅ (exit 0)
4. Si falla, ver el log — usualmente es 401 (token mismatch) o "secret not configured"

### 5.2 Test manual del refresh

1. GitHub → **Actions** → **refresh-fumigations** → **Run workflow**
2. Esperar ~2-3 min
3. Verificar ✅
4. El script va a:
   - Refrescar `dji_fumigations` desde `dji_flights`
   - Refrescar `mv_fumigations_monthly`
   - Actualizar `djiag_health` (last_run_at)

### 5.3 Verificar que `djiag_health` se actualiza en prod

```bash
curl -H "Authorization: Bearer <HEALTH_TOKEN>" \
  https://aeroadmin-afm.vercel.app/api/admin/djiag-health | jq
```

El campo `lastRunAt` debería ser reciente (< 1 hora).

---

## Paso 6 — Cleanup (opcional, post-verificación)

Una vez que los crons corran bien por 1-2 semanas sin fallar:

1. **Borrar el file `scripts/refresh-fumigations.js`** (es duplicado de la lib TS)
2. **Migrar el watchdog a server-side** (hoy está en GitHub Actions, mejor tener un endpoint en Vercel que verifique health)
3. **Documentar en `AGENTS.md`** la sección de "operational health" para que el operador sepa qué hacer si ve stale

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Cron 401 Unauthorized | HEALTH_TOKEN mal copiado o diferente en Vercel vs GitHub | Regenerar, copiar exacto |
| Cron "secret not configured" | Falta el secret en GitHub Actions | Agregar (Paso 3) |
| Cron "DATABASE_URL is not configured" | DATABASE_URL no está en GitHub Secrets | Agregar (Paso 3) |
| Cron verde pero `djiag_health` sigue stale en prod | El workflow corre pero no actualiza la BD | Verificar que `scripts/refresh-fumigations.js` se ejecuta correctamente, ver log |
| "Cannot connect to Supabase" | DATABASE_URL es el de Docker (localhost) en vez de Supabase | Reusar el de .env.local que tiene `pooler.supabase.com:6543` |

---

## Tareas de seguimiento

Después de la activación:
- [ ] Crear un cron self-reminder para verificar el watchdog cada 6h durante 1 semana
- [ ] Si funciona, pasar el watchdog a server-side (un endpoint `/api/admin/djiag-health/ping` que Vercel Cron llame)
- [ ] Documentar en `docs/HEALTH-WATCHDOG.md` el estado "activo"
- [ ] Cerrar Bloque C del Sprint S8
