# Health Watchdog — Setup con ngrok (testing)

> Esta guía configura el GitHub Action `djiag-health-watchdog.yml` para
> que pueda llamar al endpoint `/api/admin/djiag-health` del sistema
> mientras corre **local** en tu máquina. **No es un deploy real** —
> es para validar que el watchdog funciona end-to-end antes de mover
> a Vercel / Railway / VPS.

---

## TL;DR (3 comandos)

```powershell
# 1. ngrok expone localhost:3000 a internet
ngrok http 3000
#  → copiá la URL Forwarding (ej: https://a1b2-...ngrok-free.app)

# 2. Configurá los 2 secrets en GitHub (UNA VEZ)
gh secret set HEALTH_URL   --repo Nes-Curly13/aeroadmin-afm --body "https://a1b2-...ngrok-free.app"
gh secret set HEALTH_TOKEN --repo Nes-Curly13/aeroadmin-afm --body "67e1f7030c31140bc8eaf08c04d3aa36a3221663e08cf8fd4d5f781594a8c7d4"

# 3. Dispará el workflow manual para probar
gh workflow run djiag-health-watchdog.yml --repo Nes-Curly13/aeroadmin-afm
```

Si todo está bien, en 30-60s el workflow corre y reporta éxito en
`https://github.com/Nes-Curly13/aeroadmin-afm/actions`.

---

## Pre-requisitos

1. **ngrok instalado y autenticado** (cuenta free)
   - Descarga: https://ngrok.com/download
   - Setup token: `ngrok config add-authtoken <tu-token>`
2. **App corriendo en `localhost:3000`**
   - `cd C:\dev\DroneFlightAFM; npm run dev`
3. **gh CLI autenticado con scope de repo**
   - `gh auth status` debe mostrar `✓ logged in`
   - Si no: `gh auth login --with-token < tu-pat-con-scope-repo>`

---

## Paso 1 — Exponer localhost con ngrok

En una terminal aparte (mientras `npm run dev` corre en otra):

```powershell
ngrok http 3000
```

Vas a ver algo como:

```
Session Status    online
Account           tu-usuario (Plan: Free)
Version           3.x.x
Region            South America (sa)
Latency           45ms
Web Interface     http://127.0.0.1:4040

Forwarding        https://a1b2c3d4-xxx-xxx-xxx.ngrok-free.app → http://localhost:3000
```

**Copiá la URL de `Forwarding`** (la `https://...`). Es tu `HEALTH_URL`.

> ⚠️ **Plan Free**: la URL cambia cada vez que reiniciás ngrok. Si querés
> URL estable, [reservá un dominio](https://dashboard.ngrok.com/cloud-edge/domains)
> (gratis, 1 por cuenta) y usá:
> ```powershell
> ngrok http 3000 --domain=tu-subdominio.ngrok-free.app
> ```
> En ese caso la URL es siempre la misma y el secret no necesita re-actualizarse.

---

## Paso 2 — Configurar los 2 secrets en GitHub

Tu `gh` actual (`drozox`) solo tiene `pull` en el repo. Necesitás
**otro `gh` con scope de admin o PAT** con permisos de escribir secrets.

**Opción A — Web de GitHub** (la más fácil, sin permisos de CLI):
1. Andá a https://github.com/Nes-Curly13/aeroadmin-afm/settings/secrets/actions
2. Click **New repository secret**
3. Agregá los 2:
   - `HEALTH_URL` = tu URL de ngrok (ej: `https://a1b2c3d4-xxx.ngrok-free.app`)
   - `HEALTH_TOKEN` = `67e1f7030c31140bc8eaf08c04d3aa36a3221663e08cf8fd4d5f781594a8c7d4`

**Opción B — gh CLI con tu PAT de admin** (si tenés uno):
```powershell
$env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
gh secret set HEALTH_URL   --repo Nes-Curly13/aeroadmin-afm --body "https://a1b2c3d4-xxx.ngrok-free.app"
gh secret set HEALTH_TOKEN --repo Nes-Curly13/aeroadmin-afm --body "67e1f7030c31140bc8eaf08c04d3aa36a3221663e08cf8fd4d5f781594a8c7d4"
```

> El `HEALTH_TOKEN` ya está generado (32 bytes hex = 64 chars). Si querés
> rotarlo, generá uno nuevo con:
> ```powershell
> -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
> ```
> Y actualizá también la env var `HEALTH_TOKEN` en `npm run dev` antes de
> probar (ver Paso 3).

---

## Paso 3 — Configurar el server local con HEALTH_TOKEN

El endpoint `/api/admin/djiag-health` solo acepta el bypass de
`HEALTH_TOKEN` si el **server** tiene esa env var configurada.

En tu `.env.local` (o `.env`):

```bash
# Si ya tenés NEXT_PUBLIC_OPERATOR_NAME para Sprint B PDF, agregá esta:
HEALTH_TOKEN=67e1f7030c31140bc8eaf08c04d3aa36a3221663e08cf8fd4d5f781594a8c7d4
```

**Reiniciá `npm run dev`** para que tome la nueva env var.

> ⚠️ Si `HEALTH_TOKEN` no está en el server, el bypass no se activa y
> el endpoint sigue pidiendo sesión NextAuth. El workflow va a recibir
> 401 y va a fallar.

---

## Paso 4 — Disparar el workflow manual

```powershell
gh workflow run djiag-health-watchdog.yml --repo Nes-Curly13/aeroadmin-afm
```

O desde la web:
1. https://github.com/Nes-Curly13/aeroadmin-afm/actions/workflows/djiag-health-watchdog.yml
2. Click **Run workflow** → **Run workflow**

Vas a ver el run aparecer en la lista. Click para ver los logs.

**Salida esperada** (caso healthy):
```
== health-watchdog starting ==
[watchdog] HEALTH_URL=https://a1b2c3d4-xxx.ngrok-free.app
[watchdog] HEALTH_STALE_HOURS=24
[watchdog] OK: status=fresh, last_update=2h ago
== exit 0 ==
```

**Salida esperada** (caso stale, lo que querés detectar):
```
[watchdog] STALE: status=stale, last_update=30h ago (>24h threshold)
== exit 1 ==
```

---

## Paso 5 — Verificar el bypass del endpoint

Probalo local antes de tirar el workflow:

```powershell
# Caso A: con token (debería devolver 200)
curl -H "Authorization: Bearer 67e1f7030c31140bc8eaf08c04d3aa36a3221663e08cf8fd4d5f781594a8c7d4" `
     https://a1b2c3d4-xxx.ngrok-free.app/api/admin/djiag-health
# → {"status":"fresh","last_update":"...","warnings":[]}

# Caso B: sin token (debería devolver 401, no 200)
curl https://a1b2c3d4-xxx.ngrok-free.app/api/admin/djiag-health
# → {"error":"No autenticado."}
```

Si caso A devuelve 200 con el JSON y caso B devuelve 401, el bypass
funciona y el workflow va a poder llamar al endpoint.

---

## Troubleshooting

### `HEALTH_URL not set` en los logs
El secret `HEALTH_URL` no está configurado en GitHub. Andá a
Settings → Secrets y agregalo.

### 401 desde el endpoint (workflow falla)
El `HEALTH_TOKEN` del server no coincide con el de GitHub, o el
server no se reinició después de agregar la env var.
- Verificá que `HEALTH_TOKEN` esté en `.env.local` del server
- Reiniciá `npm run dev`
- El `HEALTH_TOKEN` debe ser EXACTAMENTE el mismo string en los 2 lados

### 502 / connection refused
ngrok no está corriendo, o la URL cambió. Reiniciá ngrok y actualizá
el secret `HEALTH_URL` con la nueva URL.

### ngrok free warning "Visit Site Button"
Eso es para browsers humanos — el GH Action no lo ve. Ignorá.

### ngrok URL cambia cada vez (free tier)
Sin dominio reservado, sí cambia. Tenés 2 opciones:
- **Re-actualizar el secret** cada vez que reiniciás ngrok (manual pero funciona)
- **Reservar un dominio** gratis: `ngrok http 3000 --domain=tu-subdominio.ngrok-free.app`

---

## Próximo paso: deploy real

ngrok es para **testing** del workflow. Para producción:

| Opción | Costo | Setup |
|---|---|---|
| **Vercel** | Gratis hobby | `vercel --prod` o conectar repo desde web. URL tipo `https://aeroadmin-afm.vercel.app` |
| **Railway** | $5/mes hobby | `railway up` o conectar repo |
| **VPS propio** | Variable | nginx + pm2 + certbot + dominio propio |

Una vez deployado, actualizá el secret `HEALTH_URL` con la URL real y
el watchdog va a funcionar 24/7 sin depender de tu máquina.
