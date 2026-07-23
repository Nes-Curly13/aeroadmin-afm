# Health watchdog del scraper DJI AG (Sprint C — H3b)

> **Por qué existe este documento**: hasta Sprint C, si el scraper
> DJI AG se rompía (login fallido, rate limit, crash de Playwright,
> etc.), nadie se enteraba por días. El archivo `djiag_exports/_health.json`
> quedaba con `lastSuccessfulSyncAt` viejo y el panel admin mostraba
> data stale sin levantar una alerta visible. El script
> `scripts/health-watchdog.js` cierra ese gap llamando al endpoint
> `/api/admin/djiag-health` cada 6 horas vía GitHub Actions.

## TL;DR

```bash
# Local
npm run health:watchdog

# Ver el último estado (sin auth, lo que el script "ve")
curl https://<deploy>.vercel.app/api/admin/djiag-health
```

El script devuelve:
- `exit 0` + `OK: last update hace 2h (<24h)` → healthy
- `exit 1` + `STALE: last update hace 48h (>= 24h)` → falló el workflow
- `exit 1` + `PARTIAL/FAILED: ...` → falló el workflow
- `exit 1` + `ERROR: HTTP 401` → HEALTH_TOKEN mal configurado
- `exit 2` + `ERROR: ni HEALTH_TOKEN ni HEALTH_AUTH_COOKIE están configuradas` → setup incompleto

## Por qué

- El scraper DJI AG corre como un pipeline local (`scripts/run-pipeline.js`)
  y escribe `djiag_exports/_health.json` al final de cada corrida.
  Ese archivo es leído por el endpoint `/api/admin/djiag-health`
  (que la UI admin consume).
- Sin watchdog, un scraper roto por 3+ días se descubre solo cuando
  el operador abre el dashboard y ve data stale — pero el PO/Sprint
  A detectó que muchos días nadie lo chequea.
- Solución: cron cada 6h que falla el workflow si el estado es
  `stale`/`partial`/`failed`. El operador recibe la notificación
  configurada en GitHub (o por Slack/Discord/email — ver abajo).

## Cómo correr local

```bash
# 1. .env.local con HEALTH_URL + HEALTH_TOKEN (o HEALTH_AUTH_COOKIE)
cat .env.local
# HEALTH_URL=http://localhost:3000
# HEALTH_TOKEN=dev-only-token  # debe coincidir con el server

# 2. Asegurarse de que el server también tenga HEALTH_TOKEN (en .env.local del server)
#    sino el endpoint rechaza con 401.

# 3. Correr
npm run health:watchdog
```

Output esperado (healthy):
```
[watchdog] OK: last update hace 3h (<24h)
```
Exit code 0.

Output esperado (stale):
```
[watchdog] STALE: last update hace 48h (>= 24h)
```
Exit code 1.

## Cómo activar el GitHub Action

El workflow `.github/workflows/djiag-health-watchdog.yml` ya está en
master. Para activarlo hay que **agregar 2 secrets al repo**:

1. `Settings → Secrets and variables → Actions → New repository secret`
2. **HEALTH_URL**: la URL pública del deploy, ej.
   `https://aeroadmin-afm.vercel.app`
3. **HEALTH_TOKEN**: un string aleatorio. Para generarlo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

> **Crítico**: el `HEALTH_TOKEN` del repo (GH secret) tiene que
> coincidir con el `HEALTH_TOKEN` configurado en el deploy (Vercel
> env var). Si no coinciden, el endpoint responde 401 y el workflow
> falla con `ERROR: HTTP 401 (auth inválida)`.

### Configurar el `HEALTH_TOKEN` en el deploy (Vercel)

1. Vercel dashboard → proyecto `aeroadmin-afm` → Settings →
   Environment Variables.
2. Agregar `HEALTH_TOKEN` = mismo valor que en GitHub Secrets.
3. **Redeploy** para que tome el env var (Vercel no inyecta env vars
   nuevas a deploys ya en producción).
4. Verificar manualmente:
   ```bash
   curl -H "Authorization: Bearer <token>" https://<deploy>/api/admin/djiag-health
   ```
   Debe responder 200 con JSON (no 401).

### Verificar que el workflow corre

1. `Actions` tab → seleccionar `djiag-health-watchdog`.
2. `Run workflow` (botón arriba derecha) → `Run workflow`.
3. Esperar ~30s. El step "Run health watchdog" debe terminar verde
   (status='ok' → exit 0) o rojo (status='stale' → exit 1).
4. Si el step "Verify required secrets" falla, falta agregar los
   secrets — el mensaje de error indica cuál.

## Threshold configurable

Por default el threshold es **24 horas** (alineado con
`STALE_THRESHOLD_HOURS` en `lib/djiag-health.ts`).

- **Variable de entorno** `HEALTH_STALE_HOURS`: number, default `24`.
  Configurable como `vars.HEALTH_STALE_HOURS` en GitHub (no secret —
  es público al workflow, no necesita ser secreto).
- **Aplicable al endpoint y al watchdog**: el endpoint calcula
  `status='stale'` cuando `hoursSinceLastSync > 24`. Cambiar el
  threshold requiere modificar `STALE_THRESHOLD_HOURS` en
  `lib/djiag-health.ts` (es constante en el código, no env var).
- Si en el futuro se necesita un threshold distinto por ambiente
  (staging 1h, prod 24h), moverlo a env var es un cambio
  chico (un PR de 5 min).

## Cómo recibir notificaciones

El workflow **NO incluye** notificaciones automáticas — eso es
intencional (Sprint C es corto, no hay integración con servicios
externos todavía). La forma más rápida de enterarse es subscribirse
a "failed workflow runs":

1. `Settings → Notifications` (personal) o `Watch → Custom` (repos que sigues).
2. Marcar "Send notifications for failed workflows only" o similar.

### Integración con Slack/Discord/email (3 opciones, **NO implementadas**)

**Opción A — Slack** (recomendado para equipos chicos):
1. Crear incoming webhook en Slack (canal `#alerts-aeroadmin`).
2. Agregar step al final del workflow `djiag-health-watchdog.yml`:
   ```yaml
   - name: Notify Slack on failure
     if: failure()
     uses: slackapi/slack-github-action@v1
     with:
       payload: |
         {"text": ":warning: AeroAdmin AFM djiag-health-watchdog FAILED on ${{ github.ref_name }}: ${{ github.run_id }}"}
     env:
       SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
   ```
3. Agregar `SLACK_WEBHOOK_URL` como secret.

**Opción B — Discord** (similar a Slack):
1. Crear webhook en Discord.
2. Usar la action `appleboy/discord-action@master` con el mismo
   `if: failure()`.

**Opción C — Email** (más simple, sin servicios externos):
1. GitHub envía emails automáticos a quienes estén suscritos al
   repo. `Settings → Notifications` por usuario.
2. Costo cero, latency ~5 min.

> **Scope**: documentado en `docs/review/SYNTHESIS.md` como
> follow-up P-financial. El PR que lo implemente es de 30-60 min
> cada uno (es copy-paste de los snippets de arriba).

## Troubleshooting

### `ERROR: ni HEALTH_TOKEN ni HEALTH_AUTH_COOKIE están configuradas` (exit 2)

El script no sabe cómo autenticarse. Solución:
- **Dev local**: agregar `HEALTH_TOKEN=<valor>` a `.env.local`.
- **CI/GH Actions**: el workflow debe tener el secret `HEALTH_TOKEN`
  configurado. Sin ese secret, el step "Verify required secrets"
  ya falla antes — el error debería aparecer ahí.

### `ERROR: HTTP 401 (auth inválida)`

El server rechazó el token. Causas comunes:
- `HEALTH_TOKEN` en el deploy (Vercel) y en GH secret NO coinciden.
  Re-generar uno, setear en los dos lados, redeploy.
- `HEALTH_TOKEN` no está configurada en el deploy. El endpoint, sin
  server-token, rechaza el bearer con 401 (no hay forma de "adivinarlo").
  Agregar la env var y redeploy.

### `ERROR: timeout (>10s) llamando al endpoint`

- El deploy está cold (Vercel serverless cold start). Primer hit
  puede tardar 10-15s. Reintentar.
- El deploy está caído. Verificar manualmente con `curl`.
- El firewall del runner de GH Actions bloquea el dominio. Verificar
  que `HEALTH_URL` no esté en una allowlist restrictiva.

### `STALE: last update hace 48h (>= 24h)` pero el scraper corre bien

Posibles causas:
- El pipeline corrió pero `lastSuccessfulSyncAt` no se actualizó.
  Verificar `scripts/run-pipeline.js` — el bug suele ser un
  `try/catch` que swallowea errores antes de escribir el JSON.
- El archivo `djiag_exports/_health.json` no se commiteó/sincronizó.
  Si el deploy NO tiene acceso al archivo del runner (lo más probable
  en Vercel), el endpoint siempre ve `status='unknown'` o datos
  viejos del último deploy.
- El threshold es muy agresivo. Subir `HEALTH_STALE_HOURS` a 48h
  si el pipeline corre día por medio.

### `PARTIAL: última corrida tuvo steps fallidos`

Algunos steps del pipeline fallaron pero otros pasaron. Ver los
logs del último run del pipeline (correo `run-pipeline.js` a mano
para ver el detalle, o agregar un step al workflow que ejecute el
pipeline y suba los logs).

### `FAILED: última corrida del pipeline falló`

El pipeline completo falló. Revisar:
- Credenciales DJI expiradas (`docs/DJI_CREDENTIALS.md`).
- Rate limit de DJI AG (esperar y reintentar).
- Cambios en el schema de la API de DJI (revisar `lib/djiag-*`).

## Relación con el resto del sistema

- **H3a (pg_dump backup)**: independiente. El watchdog vigila el
  pipeline de scraping; el backup respalda la BD. Se complementan.
- **XS1 (djiag-health endpoint)**: el watchdog consume ese endpoint.
  El bypass por `HEALTH_TOKEN` agregado en Sprint C es transparente
  para los callers existentes (la UI sigue usando sesión admin).
- **refresh-fumigations.yml** (workflow semanal): complementario.
  Ese refresca fumigaciones; el watchdog vigila el scraper. No
  entran en conflicto.

## Archivos modificados / creados

- `scripts/health-watchdog.js` — script CLI.
- `package.json` — script `health:watchdog`.
- `.github/workflows/djiag-health-watchdog.yml` — GH Action.
- `app/api/admin/djiag-health/route.ts` — agregado bypass `HEALTH_TOKEN`.
- `tests/scripts-health-watchdog.test.ts` — tests del script.
- `tests/api-admin-djiag-health.test.ts` — tests del nuevo path
  (bypass) del endpoint, agregado a los tests existentes.
