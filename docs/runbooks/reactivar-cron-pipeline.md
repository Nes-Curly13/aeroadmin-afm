# Runbook — Reactivar cron del pipeline DJI

> **Origen**: bloque C del Sprint S8 MVP, ejecutado originalmente el 2026-08-01.
> **Última actualización**: 2026-08-29 (drift fix: 28 días stale, 1 workflow
> adicional con pre-requisitos de código, secretos corregidos).
> **Mantenedor**: @agFab.

Este runbook re-activa los cron jobs de los workflows de GitHub Actions
que mantienen el pipeline DJI fresco. Cubre **2 de los 3** workflows
deshabilitados. El tercero (`quality-gauntlet-weekly`) tiene pre-requisitos
de código y se documenta aparte en [§7](#7-quality-gauntlet-semanal--pendiente).

---

## Estado actual (al 2026-08-29)

- ❌ `djiag-health-watchdog.yml` — **schedule deshabilitado** (falta `HEALTH_URL` + `HEALTH_TOKEN` en GitHub + `HEALTH_TOKEN` en Vercel)
- ❌ `refresh-fumigations.yml` — **schedule deshabilitado** (falta `DATABASE_URL` en GitHub)
- ❌ `quality-gauntlet-weekly.yml` — **schedule + jobs deshabilitados** (pre-requisitos de código, ver §7)
- ❌ Pipeline DJI no corre desde **2026-08-01** (28 días stale)
- ✅ Scripts existen y son ejecutables: `scripts/health-watchdog.js`, `scripts/refresh-fumigations.js`
- ✅ `.env.local` ya tiene `DATABASE_URL` y `BACKFILL_TOKEN`
- ✅ Endpoint `/api/admin/djiag-health` deployado y soporta bypass con `HEALTH_TOKEN`

---

## Pre-flight

Antes de tocar nada, validar:

- [ ] Acceso de admin al repo `Nes-Curly13/aeroadmin-afm` (verificar con `gh auth status`).
- [ ] Acceso al dashboard de Vercel del proyecto `aeroadmin-afm`.
- [ ] `.env.local` existe y tiene `DATABASE_URL` apuntando a Supabase (puerto 6543 pooled, NO localhost).
- [ ] Branch actual: `master` (los workflows se commitean a master y GitHub los lee directo).
- [ ] Hay ~30 min disponibles para los pasos 1–5 (no es unattended).

---

## 1. Generar / recolectar los secrets

### 1.1 `HEALTH_TOKEN` (NUEVO — no existe en .env.local)

Generar un token random de 32 bytes hex. **En Node (más portable que PowerShell, no deprecated):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salida esperada (64 chars hex):
```
a1b2c3d4e5f6... (64 chars)
```

> **Guardar este valor en 1Password/Bitwarden** — lo necesitamos idéntico en
> Vercel y GitHub Secrets. Si difieren en un char, el endpoint responde 401.

### 1.2 `DATABASE_URL` (reusar de .env.local)

Ya está en `.env.local` (línea 1, formato Supabase puerto 6543). Reusar el
mismo valor en GitHub Secrets. **No commitearlo al repo** — solo copiarlo
del `.env.local` directo al secret de GitHub.

Formato esperado:
```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

### 1.3 `BACKFILL_TOKEN` (NO requerido para estos 3 workflows)

`BACKFILL_TOKEN` existe en `.env.local` pero **no lo usa ninguno de los
3 workflows** que estamos reactivando. Se usa solo si corrés
`scripts/backfill-fumigations-from-flights.js` a mano. **Ignorar este
secret para esta reactivación.** Si en el futuro agregás un endpoint
`/api/admin/backfill` con auth, lo agregás como env var aparte.

---

## 2. Configurar env vars en Vercel

Vercel usa las env vars para el **runtime del server** (el endpoint
`/api/admin/djiag-health` valida el `HEALTH_TOKEN` server-side).

### 2.1 Abrir el dashboard

1. https://vercel.com/dashboard
2. Proyecto `aeroadmin-afm` → **Settings** → **Environment Variables**

### 2.2 Agregar estas variables

| Variable         | Valor                              | Environments        |
|------------------|------------------------------------|---------------------|
| `DATABASE_URL`   | (el de `.env.local`, reusar)       | Production, Preview |
| `HEALTH_TOKEN`   | (el que generaste en §1.1)         | Production, Preview |

> **Tip**: si ya tenés un set de env vars de otro deploy, no dupliques;
> editá las existentes.

### 2.3 Redeploy para que tome los nuevos secrets

Vercel no inyecta env vars nuevas a deploys ya en producción. Hay que forzar redeploy:

```bash
# Desde la raíz del repo
npx vercel --prod --force
```

O desde el dashboard: **Deployments** → click en el último → menú ⋯ → **Redeploy**.

Verificar que el redeploy terminó antes de seguir (3-5 min, monitorear
el build de `@sparticuz/chromium` que es lento).

---

## 3. Configurar secrets en GitHub

GitHub Actions los lee en runtime vía `${{ secrets.HEALTH_TOKEN }}`.

### 3.1 Abrir settings del repo

1. https://github.com/Nes-Curly13/aeroadmin-afm
2. **Settings** → **Secrets and variables** → **Actions**

### 3.2 Agregar estos 3 secrets

| Secret          | Valor                            | Workflow que lo usa              |
|-----------------|----------------------------------|----------------------------------|
| `HEALTH_URL`    | `https://aeroadmin-afm.vercel.app` (sin trailing slash) | `djiag-health-watchdog.yml` |
| `HEALTH_TOKEN`  | (el de §1.1)                     | `djiag-health-watchdog.yml`      |
| `DATABASE_URL`  | (el de §1.2)                     | `refresh-fumigations.yml`        |

### 3.3 (Opcional) Variables no-secretas

**Tab "Variables"** al lado de "Secrets":

| Variable             | Valor | Workflow que la usa            |
|----------------------|-------|--------------------------------|
| `HEALTH_STALE_HOURS` | `24`  | `djiag-health-watchdog.yml` (umbral de stale) |
| `DATABASE_SSL`       | `true`| `refresh-fumigations.yml`      |

Las **variables** (no secrets) son visibles en logs de Actions — no poner
nada sensible ahí. Ambas tienen defaults razonables en el código si no
las ponés (24h y true respectivamente).

---

## 4. Reactivar los schedules (los 2 workflows OK)

Una vez configurados los secrets, restaurar el `on.schedule` en los 2
workflows que vamos a reactivar. **NO tocar `quality-gauntlet-weekly.yml`**
— ver §7.

### 4.1 `djiag-health-watchdog.yml`

Editar `.github/workflows/djiag-health-watchdog.yml`, línea 32. Reemplazar:

```yaml
on:
  # Manual only. Ver comentario arriba. Restaurar `schedule:` cuando
  # se configuren los secrets.
  workflow_dispatch:
```

Por:

```yaml
on:
  schedule:
    - cron: "0 */6 * * *"  # cada 6 horas
  workflow_dispatch:  # mantener para trigger manual / diagnóstico
```

### 4.2 `refresh-fumigations.yml`

Editar `.github/workflows/refresh-fumigations.yml`, línea 31. Reemplazar:

```yaml
on:
  # Manual only. Ver comentario arriba. Restaurar el bloque con
  # `schedule: - cron: "0 6 * * 1"` cuando se configuren los secrets.
  workflow_dispatch:
```

Por:

```yaml
on:
  schedule:
    - cron: "0 6 * * 1"  # cada lunes 06:00 UTC
  workflow_dispatch:  # mantener para trigger manual post-backfill
```

### 4.3 `quality-gauntlet-weekly.yml` (NO TOCAR)

Ver §7 — tiene pre-requisitos de código, no se puede reactivar solo
cambiando el schedule.

### 4.4 Commit + push

```bash
git add .github/workflows/djiag-health-watchdog.yml
git add .github/workflows/refresh-fumigations.yml
git commit -m "chore(ci): restaurar schedules de watchdog + refresh-fumigations

- djiag-health-watchdog: cron '0 */6 * * *' (cada 6h)
- refresh-fumigations: cron '0 6 * * 1' (lunes 06:00 UTC)

Secrets requeridos ya configurados en GitHub (HEALTH_URL, HEALTH_TOKEN,
DATABASE_URL) y Vercel (HEALTH_TOKEN). Ver docs/runbooks/reactivar-cron-pipeline.md.

quality-gauntlet-weekly queda con if: false hasta resolver pre-requisitos
de código (knip, lib/djiag-circuit-breaker.js:245, Stryker). Ver §7 del
runbook."
git push origin master
```

---

## 5. Verificación post-activación

### 5.1 Test manual del watchdog (no esperar 6h)

1. GitHub → **Actions** → **djiag-health-watchdog** → **Run workflow** (botón arriba derecha)
2. Esperar ~1 min
3. Verificar que el run termina en ✅ (exit 0 = healthy) o 🔴 (exit 1 = stale/failed)

**Interpretación de los runs:**

| Exit | Log muestra | Significado | Acción |
|------|-------------|-------------|--------|
| 0    | `OK: last update hace 2h (<24h)` | healthy | nada — todo bien |
| 0    | `WARN: sin datos` | `_health.json` ausente (primera corrida o post-deploy) | nada — se normaliza cuando el pipeline corra |
| 1    | `STALE: last update hace 48h` | última sync > 24h | correr `npm run pipeline:djiag` a mano |
| 1    | `PARTIAL: ...` | última corrida tuvo steps fallidos | ver logs del pipeline |
| 1    | `FAILED: ...` | última corrida falló | ver `docs/DJI_SCRAPER.md` |
| 1    | `ERROR: HTTP 401` | `HEALTH_TOKEN` distinto en Vercel vs GitHub | regenerar y re-setear (ver §9) |
| 2    | `ERROR: HEALTH_TOKEN no configurado` | falta el secret en GitHub | volver a §3 |

### 5.2 Test manual del refresh (no esperar al lunes)

1. GitHub → **Actions** → **refresh-fumigations** → **Run workflow**
2. Esperar ~2-3 min
3. Verificar que el job `refresh` termina en ✅

**El script va a (ver `scripts/refresh-fumigations.js` para detalle):**
- Refrescar `mv_fumigations_monthly` (materialized view) si existe
- Recalcular `last_fumigation_date` y `next_due_date` en `dji_fumigation_schedule` por parcela
- NO re-scrapear DJI (eso es el pipeline completo, otro flow)

### 5.3 Verificar que el health endpoint responde en prod

```bash
curl -H "Authorization: Bearer <HEALTH_TOKEN>" \
  https://aeroadmin-afm.vercel.app/api/admin/djiag-health | jq
```

Output esperado (ejemplo, los datos reales varían):
```json
{
  "status": "ok",
  "lastRunAt": "2026-08-29T15:30:00Z",
  "hoursSinceLastSync": 3,
  "lastRunStatus": "ok"
}
```

Si `status: "unknown"`: la tabla `djiag_health` no tiene data (pipeline nunca corrió
contra este deploy, o el scraper local no tiene acceso al deploy de Vercel — son
distintos, el archivo `djiag_exports/_health.json` se escribe local, el deploy
de Vercel lee de la tabla `djiag_health` en Supabase). Correr el pipeline una vez:
```bash
DATABASE_URL=<el de .env.local> npm run pipeline:djiag
```

### 5.4 Esperar el primer cron real

- **watchdog**: primer cron real a las XX:00 UTC (donde XX es múltiplo de 6).
- **refresh-fumigations**: próximo lunes a las 06:00 UTC.

Monitorear GitHub Actions el lunes siguiente para confirmar que el cron
real (no el manual) corre verde.

---

## 6. Cleanup post-verificación (opcional, después de 1-2 semanas)

Una vez que los 2 crons corran bien sin fallar:

- [ ] **NO** borrar `scripts/refresh-fumigations.js` — el runbook original decía que era "duplicado de lib TS" pero NO tiene contraparte en `lib/`. Es el script que ejecuta el workflow.
- [ ] Considerar migrar el watchdog a server-side (un endpoint `/api/admin/djiag-health/ping` que Vercel Cron llame en vez de GitHub Actions). Hoy corre cada 6h, cuesta 1 minuto de runner; si sumás más checks puede tener sentido.
- [ ] Documentar en `AGENTS.md` la sección de "operational health" para que el operador sepa qué hacer si ve el banner rojo en el admin panel.
- [ ] Cerrar el bloque C del Sprint S8 (si aplica).

---

## 7. Quality Gauntlet semanal — PENDIENTE

`quality-gauntlet-weekly.yml` **no se reactiva en este runbook**. Tiene
3 pre-requisitos de código, todos de scope propio:

### Pre-requisito 1 — Limpiar 106 archivos no usados (knip)

`npx knip` reporta 106 archivos que el repo no usa. Opciones:
- **(a) Limpiarlos** — borrar los archivos (preferible si son dead code real).
- **(b) Excluirlos con justificación en `knip.json`** — crear el config y documentar cada exclusión. Más rápido, pero acumula tech debt.

**Acción**: PR aparte dedicado, no mezclar con este runbook.

### Pre-requisito 2 — Resolver threshold en `lib/djiag-circuit-breaker.js:245:3`

El umbral de falla del circuit breaker está mal configurado y hace que
el job `quality-metrics` falle en cada corrida. Hay que revisar la
línea 245 de ese archivo y ajustar el `DEFAULT_FAILURE_THRESHOLD`
(o el nombre equivalente) al valor correcto documentado en
`docs/DJIAG_AUDIT.md`.

**Acción**: PR aparte, 30-60 min de investigación + fix + test.

### Pre-requisito 3 — Instalar StrykerJS (mutation testing)

El job `mutation-testing` requiere:
- `@stryker-mutator/core` y `@stryker-mutator/vitest-runner` como devDependencies
- `stryker.config.mjs` en la raíz del repo
- Umbrales por archivo definidos (no solo el global de vitest)

**Acción**: PR aparte. Es un sprint entero de mutation testing setup. No scope de este runbook.

### Cuando estén los 3 pre-requisitos

1. Sacar el `if: false` de los 2 jobs en `quality-gauntlet-weekly.yml`.
2. Restaurar el bloque `on.schedule: - cron: "0 11 * * 1"` (lunes 11:00 UTC, ya documentado en el header del workflow).
3. Crear un nuevo runbook o agregar sección acá.

---

## 8. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Cron 401 Unauthorized | `HEALTH_TOKEN` mal copiado o distinto en Vercel vs GitHub | Regenerar (`§1.1`), copiar exacto a ambos lados, redeploy Vercel |
| Cron "HEALTH_URL secret is not configured" | Falta el secret en GitHub Actions | Agregar (`§3.2`) |
| Cron "HEALTH_TOKEN secret is not configured" | Falta el secret en GitHub Actions | Agregar (`§3.2`) |
| Cron "DATABASE_URL is not configured" | Falta el secret en GitHub Actions | Agregar (`§3.2`) |
| Cron "Cannot connect to Supabase" | `DATABASE_URL` es el de Docker (localhost) en vez del pooler | Reusar el de `.env.local` que tiene `pooler.supabase.com:6543` |
| Cron verde pero `djiag_health` sigue stale en prod | El workflow corre pero no actualiza la BD | Verificar que `scripts/refresh-fumigations.js` se ejecuta correctamente, ver log |
| `Cannot find module` al correr el script | `npm ci` no se ejecutó (workflow) o `node_modules` incompleto (local) | Borrar `node_modules` y correr `npm ci` de nuevo |
| `ECONNREFUSED 127.0.0.1:5432` | `DATABASE_URL` apunta a localhost (probablemente default) | Usar el de `.env.local` o el pooler de Supabase (puerto 6543) |
| `status: "unknown"` en el endpoint | Pipeline nunca corrió contra este deploy, o el archivo `_health.json` es local (no se commitea) | Correr el pipeline una vez: `npm run pipeline:djiag` con el `DATABASE_URL` de prod |

---

## 9. Tareas de seguimiento

Después de la activación:

- [ ] **Crear un cron self-reminder** para verificar el watchdog cada 6h durante 1 semana (no es estrictamente necesario porque el watchdog ya alerta, pero sirve de safety net).
- [ ] **Si funciona**, pasar el watchdog a server-side (un endpoint `/api/admin/djiag-health/ping` que Vercel Cron llame en vez de GitHub Actions).
- [ ] **Documentar en `docs/HEALTH-WATCHDOG.md`** el estado "activo".
- [ ] **Cerrar el bloque C del Sprint S8** (si aplica).
- [ ] **Crear issues / TODOs** para los 3 pre-requisitos de quality-gauntlet (§7).

---

## 10. Changelog del runbook

| Fecha       | Cambio |
|-------------|--------|
| 2026-08-01  | Creación original (Sprint S8, 22 días stale). Cubre 2 workflows. |
| 2026-08-29  | Drift fix: 28 días stale (no 22), saca referencia a `scripts/djiag-from-make/*` (carpeta borrada), saca "borrar `scripts/refresh-fumigations.js`" (no es duplicado), corrige comando de generación de HEALTH_TOKEN (RNGCryptoServiceProvider está deprecated en .NET 6+ → uso `node crypto.randomBytes`), agrega §7 con los 3 pre-requisitos de quality-gauntlet explícitos, agrega §6 cleanup sin la línea incorrecta. Mantenedor: @agFab. |
