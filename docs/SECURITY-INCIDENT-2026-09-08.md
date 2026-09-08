# Security Incident: `.env.local.bak` con secretos expuesto en Git

**Fecha de detección**: 2026-09-08
**Severidad**: 🔴 P0 / Crítica
**Status**: Mitigación parcial hecha. Acciones destructivas pendientes (ver "Pendiente" abajo).

## TL;DR

El archivo `.env.local.bak` (275 bytes) fue commiteado al repo público
`Nes-Curly13/aeroadmin-afm` el **2026-07-27** (commit `8279c59`,
"Create .env.local.bak"). Contenía **4 secretos reales**:

| Variable | Tipo | Acción requerida |
|---|---|---|
| `DJIAG_EMAIL` | cuenta del operador (DJI SmartFarm) | Cambiar email en DJI si la cuenta es crítica |
| `DJIAG_PASSWORD` | password real | **Rotar inmediatamente** |
| `AUTH_SECRET` | NextAuth v5 — firma JWTs | **Rotar inmediatamente** (rompe todas las sesiones) |
| `BACKFILL_TOKEN` | token de backfill operations | **Rotar inmediatamente** + auditar uso |

La base de datos URL (`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/afm_flights`)
es local y no es un secreto.

## Por qué pasó

El `.gitignore` cubría `.env`, `.env.local` y `.env.*.local`, pero
**NO** cubría `.env.local.bak`. El pattern `*.local` no matchea
archivos con extensión `.bak` (no tienen `.local` antes de la
extensión). Alguien copió `.env.local` a `.env.local.bak` como
backup manual, lo agregó al repo, y nadie lo notó hasta hoy.

## Acciones tomadas (2026-09-08)

1. ✅ Backup del archivo en
   `C:\Users\agFab\AppData\Local\Temp\aeroadmin-secrets-2026-09-08\.env.local.bak.PRE-INCIDENT.txt`
2. ✅ `git rm .env.local.bak` — removido del working tree
3. ✅ `.gitignore` actualizado para cubrir `*.bak` y `*.local.bak`
4. ✅ Doc de incidente creado (este archivo)
5. ✅ Backup commit pusheado a `origin/master`

## Acciones pendientes (Urgentes)

### 1. Limpiar el historial de Git

El commit `8279c59` sigue en el historial. Hay que reescribir el
historial para que el archivo no aparezca en ningún commit anterior.

**Opción A — `git filter-branch` (built-in pero deprecated):**
```bash
cd C:\dev\DroneFlightAFM
# Eliminar el archivo de TODO el historial
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env.local.bak" \
  --prune-empty --tag-name-filter cat -- --all
# Limpiar refs/originals y garbage collect
rm -rf .git/refs/originals/
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

**Opción B — `git-filter-repo` (recomendado, instalar con pip):**
```bash
pip install git-filter-repo
cd C:\dev\DroneFlightAFM
git filter-repo --path .env.local.bak --invert-paths
```

**Opción C — BFG Repo-Cleaner** (https://rtyley.github.io/bfg-repo-cleaner/):
```bash
java -jar bfg.jar --delete-files .env.local.bak
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 2. Force-push (DESTRUCTIVO)

⚠️ **Advertencia**: el force-push reescribe la historia de master. Si
otros devs tienen clones con la historia vieja, tendrán problemas.
Comunicar al equipo antes.

```bash
cd C:\dev\DroneFlightAFM
# Después de filter-branch/filter-repo/bfg:
git push origin --force --all
git push origin --force --tags
```

### 3. Pedir a GitHub Support purgar el cache de forks

GitHub cachea blobs en forks y en el cache de objetos. Aún después
del force-push, el SHA del blob viejo puede estar accesible vía
`https://github.com/Nes-Curly13/aeroadmin-afm/blob/8279c59/.env.local.bak`.

Pedir purga via: https://support.github.com/contact
(elegir "Report security vulnerability" o "I need help with a security issue").

### 4. Rotar los secretos

**DJI SmartFarm**:
- Ir a https://www.dji.com o app DJI SmartFarm Web
- Login con la cuenta del operador
- Cambiar password
- Si la cuenta es de un tercero (no del operador), también cambiar email

**AUTH_SECRET (NextAuth v5)**:
```bash
# Generar nuevo secret
openssl rand -base64 32
# Actualizar en Vercel dashboard:
#   - Production env
#   - Preview env
#   (cualquier otra donde esté configurado)
# IMPORTANTE: esto invalida TODAS las sesiones existentes.
# Los usuarios (admin, e2e) tendrán que hacer login de nuevo.
```

**BACKFILL_TOKEN**:
- Buscar dónde se genera (probablemente en scripts/backfill-*.js)
- Regenerar con `openssl rand -hex 32`
- Actualizar en Vercel + cualquier CI
- Auditar logs de uso: ¿se usó el token expuesto en los últimos
  6 semanas? Si sí, las requests con ese token fueron autorizadas
  como si fueran del operador legítimo.

### 5. Verificar que `.env*` esté cubierto

```bash
git check-ignore -v .env.local.bak
# Debe devolver algo como: .gitignore:XX:*.bak	.env.local.bak
git check-ignore -v .env.production
# Debe estar cubierto
```

### 6. Auditar el repo por otros secretos

```bash
# Buscar patrones comunes de secrets en el historial
git log --all -p | grep -iE "(SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE_KEY).*=" | head -50
# Buscar archivos con extension sensible
git ls-files | grep -iE "\.(pem|key|p12|pfx|crt|cer)$"
# Revisar archivos de docs que puedan tener placeholders que se
# llenaron con secretos reales
cat docs/DJI_CREDENTIALS.md.template
```

## Plan de respuesta por prioridad

| # | Acción | Quién | Urgencia |
|---|---|---|---|
| 1 | Rotar DJIAG_PASSWORD en DJI SmartFarm | Operador / agFab | 🔴 Hoy |
| 2 | Rotar AUTH_SECRET + redeploy Vercel | agFab | 🔴 Hoy |
| 3 | Rotar BACKFILL_TOKEN + auditar uso | agFab | 🔴 Hoy |
| 4 | Limpiar historial Git (filter-repo/bfg) | agFab | 🟠 Mañana |
| 5 | Force-push a origin | agFab | 🟠 Mañana (después de comunicar) |
| 6 | Pedir purga a GitHub Support | agFab | 🟠 Esta semana |
| 7 | Agregar pre-commit hook (husky + detect-secrets) | agFab | 🟡 Post-incidente |

## Prevención (post-incidente)

1. **Pre-commit hook** con `detect-secrets` o `gitleaks`:
   ```bash
   npm install --save-dev @commitlint/cli husky detect-secrets
   npx husky add .husky/pre-commit "npx detect-secrets-hook"
   ```
2. **GitHub secret scanning** ya está habilitado en el repo (verificar
   en Settings → Code security). Si se sube un secreto, GitHub avisa.
3. **`.env*` pattern más amplio** en `.gitignore`:
   ```
   .env*
   !.env.example
   ```
4. **Documentar** en AGENTS.md que `.env.local` nunca debe copiarse
   a `.env.local.bak` (usar `.env.local.example` o un backup encriptado
   fuera del repo).

## Lecciones aprendidas

- **`*.local` no matchea `*.local.bak`** — el pattern es por extensión,
  no por substring. Un `.gitignore` con `.env*` (sin punto) es más
  seguro que enumerar variantes.
- **Los backups manuales de archivos de secrets son un riesgo** —
  mejor tener un secret manager (1Password, Vault, AWS Secrets Manager)
  o un backup encriptado fuera del repo.
- **Code review debe incluir `git ls-files` check** para archivos
  sensibles que no deberían estar trackeados.

## Referencias

- GitHub: https://github.com/Nes-Curly13/aeroadmin-afm/security
- Commit original: `8279c59` "Create .env.local.bak"
- PR de remoción: ver PR post-merge (búsqueda por "fix(security): P0 - eliminar .env.local.bak")
