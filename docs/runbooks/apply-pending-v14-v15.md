# Runbook — Aplicar pendientes v1.1 + v1.4 a prod

**Fecha**: 2026-07-21
**Estado**: 3 migrations sin aplicar en prod + 1 secret de GitHub sin setear.

Cuando vos (dueño) lo apliques, este runbook se actualiza o se borra.

---

## 1. Pre-flight checklist

Antes de tocar prod, validar:

- [ ] `git log --oneline -8` muestra los 4 commits de v1.5 arriba (master `e5e11c4`).
- [ ] CI del push está en verde (run 29864091765 ✅).
- [ ] El repositorio remoto es `Nes-Curly13/aeroadmin-afm` (correcto, no otro).
- [ ] Tenés la `DATABASE_URL` de Supabase a mano (Supabase dashboard → Project → Settings → Database → Connection string → Transaction o Session, según lo que use el panel).

**NO** commitear cambios durante la ventana de mantenimiento. Las 3 migrations son idempotentes (re-corridas no rompen), pero por las dudas.

---

## 2. Aplicar 3 migrations en orden

Las 3 migrations son aditivas, no rompen nada existente. Orden lexicográfico
por convención de `apply-pending-migrations.js`:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `20260720000000_add_soft_delete.sql` | Agrega `deleted_at TIMESTAMPTZ NULL` + 2 índices parciales a `dji_fumigations` y `dji_parcels`. v1.1, seguridad. |
| 2 | `20260721000000_add_app_users_role.sql` | Refactor del CHECK de `app_users.role`: backfill `viewer → supervisor`, CHECK `role IN ('admin', 'supervisor')`, default `'admin'`. v1.4 Track A. |
| 3 | `20260721010000_add_fumigation_human_notes.sql` | Agrega `dji_fumigations.human_notes TEXT` con CHECK `length ≤ 2000`. v1.4 Track C. |

**Comando único (aplica las 3 en orden, skip las que ya estén)**:

```bash
cd C:\dev\DroneFlightAFM
# Si tu .env.local tiene la URL de PROD (no la de localhost), úsala directo.
# Si no, exportala temporalmente:
#   $env:DATABASE_URL = "postgresql://postgres.xxx:password@aws-0-xx.pooler.supabase.com:6543/postgres"
node scripts/apply-pending-migrations.js
```

**Salida esperada**:

```
  [skip] <migrations viejas ya aplicadas>
  ...
  [apply] 20260720000000_add_soft_delete.sql (N bytes)...
    OK
  [apply] 20260721000000_add_app_users_role.sql (N bytes)...
    OK
  [apply] 20260721010000_add_fumigation_human_notes.sql (N bytes)...
    OK

[apply-migrations] done: 3 aplicadas, N skipped, 0 errors
```

**Si falla alguna**: el script hace `ROLLBACK` y aborta. NO SIGUE con las
siguientes. Pegame el error y vemos.

---

## 3. Setear secret `DATABASE_URL` en GitHub

Necesario para que el **cron semanal** (`refresh-fumigations.yml`,
todos los lunes 06:00 UTC) pueda correr.

**Comando**:

```bash
gh secret set DATABASE_URL --repo Nes-Curly13/aeroadmin-afm
# Te va a pedir el valor por stdin. Pegá la connection string y Enter.
```

O vía web: repo → Settings → Secrets and variables → Actions → "New repository secret" → name=`DATABASE_URL`, value=tu connection string.

**Para Supabase**, el formato típico es:
```
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

Si la conexión directa no funciona (a veces Supabase bloquea por IP),
usá el pooler transaction mode (puerto 6543) o session mode (puerto 5432).

---

## 4. Verificación post-deploy

```sql
-- En el SQL editor de Supabase:

-- 1) Las 3 migrations figuran en el registro:
SELECT name, applied_at FROM dji_migrations
ORDER BY applied_at DESC LIMIT 5;
-- Esperado: 3 filas nuevas (las 3 de v1.1+v1.4).

-- 2) Schema de las tablas correctas:
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'dji_fumigations' AND column_name IN ('deleted_at', 'human_notes'))
    OR (table_name = 'dji_parcels' AND column_name = 'deleted_at')
    OR (table_name = 'app_users' AND column_name = 'role'));
-- Esperado: 4 filas con data_type correcto.

-- 3) Backfill de role:
SELECT role, COUNT(*) FROM app_users GROUP BY role;
-- Esperado: solo 'admin' y 'supervisor', NUNCA 'viewer'.

-- 4) El CHECK constraint quedó:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'app_users_role_check';
-- Esperado: CHECK ((role = ANY (ARRAY['admin'::text, 'supervisor'::text])))
```

**Smoke test del panel**:

1. Login con un usuario admin. El sidebar debe mostrar "Dispositivos".
2. Login con un usuario supervisor. El sidebar NO debe mostrar "Dispositivos".
3. Ir a `/parcels/<id>`, registrar una fumigación con `human_notes` largo (ej. 250 chars). Debe aceptar y guardarlo.
4. El lunes siguiente a las 06:00 UTC, revisar Actions → "refresh-fumigations" run. Debe estar verde.

---

## 5. Si algo falla

**Migration falla con "relation does not exist"**: probablemente la BD está en
un estado intermedio de una migration previa. Pegame el error completo, no
intentes re-correr a ciegas.

**Secret no aparece en Actions**: la próxima vez que corra el workflow ya
debería estar disponible. Si no, `gh secret list --repo Nes-Curly13/aeroadmin-afm`
para confirmar que está listado.

**Login falla después del backfill `viewer → supervisor`**: el JWT viejo
(del usuario que era `viewer`) sigue diciendo `viewer` en `session.user.role`.
La próxima vez que ese usuario haga login, el JWT se regenera con el nuevo
role. NO requiere migración adicional.

---

## Cambios incluidos en este batch

### v1.1 (2026-07-20)
- `dji_fumigations.deleted_at TIMESTAMPTZ NULL` + índice parcial
- `dji_parcels.deleted_at TIMESTAMPTZ NULL` + índice parcial
- **NO** se modificaron queries existentes para usar `WHERE deleted_at IS NULL`
  (eso queda para un sprint dedicado, scope separado).

### v1.4 Track A (2026-07-21)
- `app_users.role`:
  - backfill: `viewer → supervisor`
  - CHECK: `role IN ('admin', 'supervisor')`
  - default: `'admin'` (backwards-compat con seeds existentes)
  - índice parcial: `idx_app_users_role` (solo supervisores)

### v1.4 Track C (2026-07-21)
- `dji_fumigations.human_notes TEXT` con CHECK `length ≤ 2000`
- Acepta NULL (fumigaciones del backfill sin nota humana siguen siendo válidas).

### Código (sin migration, pero depende de las 3 anteriores)
- `lib/auth/role.ts` requiere `app_users.role` con valores del nuevo CHECK.
- `app/api/fumigations/route.ts` (POST) acepta `human_notes` en el body.
- `app/devices/page.tsx` usa `normalizeRole` que mapea `viewer → supervisor`.
- `components/app-shell.tsx` usa `getViewerRole` que consulta el JWT (no la BD).
- Cron semanal `refresh-fumigations.yml` corre `scripts/refresh-fumigations.js`
  (reusa `backfill-fumigations-from-flights.js` + `update-fumigation-schedule.js`).
