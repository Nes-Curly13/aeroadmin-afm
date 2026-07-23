# Backups de la base de datos (Sprint C — H3a)

> **Por qué existe este documento**: hasta Sprint C la BD de AeroAdmin
> AFM no tenía backup automatizado. El script `scripts/db-backup.js`
> cierra ese gap con un `pg_dump` semanal y rotación de 7 días.

## TL;DR

```bash
# Backup manual
npm run db:backup

# Listar dumps existentes
ls -lh backups/

# Restaurar (ejemplo: dump del 2026-07-23)
gunzip -c backups/dump-2026-07-23-0200.sql.gz | psql "$DATABASE_URL"
```

## Por qué

- La **metadata humana** de las parcelas (cultivo, siembra, propietario,
  notas del supervisor) vive en `dji_parcels` y NO se puede re-derivar
  de DJI. Si la BD se pierde sin backup, ese trabajo se pierde.
- `dji_fumigations` y `dji_flights` se pueden re-scrapear de DJI
  (aunque lleve ~30 min con el pipeline completo), pero el histórico
  de fumigaciones manuales (`source='manual'`) NO.
- Frecuencia **semanal** como compromiso entre RPO (≤7 días) y costo
  (cada dump gzip son ~5-50 MB; 7 archivos = <400 MB en disco).
- Rotación: borrar automáticamente los dumps con más de 7 días para
  que el directorio no crezca indefinidamente.

## Cómo correr manualmente

```bash
# 1. Asegurarse de tener .env.local con DATABASE_URL
#    (el script usa loadLocalEnv() — patrón canónico del repo)
cat .env.local | grep DATABASE_URL

# 2. Asegurarse de tener pg_dump en PATH
#    Windows: instalar Postgres client tools y agregar bin/ a PATH
#    Linux:   sudo apt-get install postgresql-client
#    macOS:   brew install libpq && export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# 3. Correr el backup
npm run db:backup
```

Output esperado:
```
[backup] OK: dump-2026-07-23-0200.sql.gz (4.2 MB gzip, 14.3 MB raw) -> backups\dump-2026-07-23-0200.sql.gz
[backup] rotated: nada que borrar (retención 7 días, 3 archivo(s) retenidos).
```

## Automatización — Windows Task Scheduler

El operador corre en Windows. Pasos para agendar el backup semanal:

1. **Abrir Task Scheduler** (`taskschd.msc` desde el menú inicio).
2. **Create Basic Task** (panel derecho).
3. **Nombre**: `AeroAdmin AFM DB Backup`.
   **Descripción**: `Backup semanal de la BD con rotación de 7 días.`
4. **Trigger**: `Weekly`, día lunes (o el día que elijas), hora `02:00`.
5. **Action**: `Start a program`.
   - **Program/script**: `C:\Program Files\nodejs\node.exe`
   - **Add arguments**: `scripts/db-backup.js`
   - **Start in**: `C:\dev\DroneFlightAFM` (ajustar si está en otro lado)
6. Marcar **"Run whether user is logged on or not"** (clave — el script
   no necesita UI, solo acceso a `node` + `pg_dump`).
7. Finish. Probarlo con **Run** desde la lista de tareas.

> **PATH con `pg_dump`**: el script necesita que `pg_dump` esté en PATH
> del SYSTEM account (no solo del usuario logueado). Si el PATH del
> system no incluye `C:\Program Files\PostgreSQL\<ver>\bin`, agregarlo
> en System Properties → Environment Variables, o setearlo en la
> configuración avanzada del task (no se puede en Basic Task — en
> ese caso crear la tarea con `Create Task...` y editar `Actions`).

## Automatización — Linux / macOS (cron)

```bash
# Crontab del usuario que tiene el repo
0 2 * * 0 cd /path/to/DroneFlightAFM && node scripts/db-backup.js >> /var/log/aeroadmin-backup.log 2>&1
```

Eso corre todos los domingos a las 02:00. El log va a
`/var/log/aeroadmin-backup.log` para que `logrotate` (u otro
monitoreo) lo recoja.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `DATABASE_URL` | — | Connection string de Supabase (requerido). El script también acepta `DATABASE_URL_DIRECT`. |
| `BACKUP_RETENTION_DAYS` | `7` | Días a mantener. Si se cambia a `14`, el script conserva 2 semanas de dumps. |

## Restaurar un dump

```bash
# Descomprimir y restaurar en la BD de Supabase
gunzip -c backups/dump-2026-07-23-0200.sql.gz | psql "$DATABASE_URL"

# O con la URL hardcodeada (cuidado con la shell history)
gunzip -c backups/dump-2026-07-23-0200.sql.gz | \
  psql "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"
```

El dump usa `--clean --if-exists`, así que las tablas existentes se
borrarán y se re-crearán desde el dump. **No es un restore incremental**;
es un "full restore" (la BD queda exactamente como estaba al momento
del backup).

> **Cuidado con la BD de producción**: hacer un restore sobre la BD
> viva borra todo lo que se haya escrito entre el backup y el momento
> del restore. Para ambientes de staging se puede usar una BD separada
> (`supabase clone` o un proyecto nuevo + cambiar `DATABASE_URL`).

## Política de retención / offsite

- **Local**: el script retiene 7 días en `backups/`. Es la primera línea
  de defensa (operador puede haber borrado un row por error y necesitar
  un restore de "hace 3 días").
- **Offsite**: **fuera de scope de este sprint** (documentado en
  `docs/review/SYNTHESIS.md` como follow-up P-financial). Recomendaciones
  para una próxima iteración:
  - **S3 / Supabase storage**: subir cada dump a un bucket con lifecycle
    policy de 30 días.
  - **Copia a disco externo semanal**: simple, sin dependencias cloud.
  - **Snapshots de Supabase**: si el plan lo incluye, complementa pg_dump
    con un snapshot diario.
- **No commiteamos los dumps**: `backups/` está en `.gitignore` por
  dos razones: (1) son binarios grandes que revientan git, (2) pueden
  contener data sensible del cliente. Para moverlos a otro lado,
  copiar manualmente con `cp` o `rclone`.

## Troubleshooting

### `[backup] ERROR: pg_dump no está en PATH`

Instalar Postgres client tools:

- **Windows**: https://www.postgresql.org/download/windows/ — agregar
  `C:\Program Files\PostgreSQL\<ver>\bin` a PATH del sistema.
- **Linux (Debian/Ubuntu)**: `sudo apt-get install postgresql-client`.
- **macOS**: `brew install libpq` y agregar
  `/opt/homebrew/opt/libpq/bin` a PATH.

Verificar después con `pg_dump --version` (debe imprimir versión sin
error).

### `[backup] ERROR: DATABASE_URL no está configurada`

El script busca `DATABASE_URL` (o `DATABASE_URL_DIRECT`) en
`process.env`. Si está en `.env.local`, se carga automáticamente. Si
corre desde el Task Scheduler con otro `Start in`, ajustar el path o
setear la variable de entorno del SYSTEM.

### El dump queda chico (<<1 MB) o vacío

- Verificar que la BD no esté realmente vacía: `psql "$DATABASE_URL" -c "SELECT count(*) FROM dji_parcels;"`.
- Si la BD tiene data y el dump es chico, podría ser que el rol no
  tiene acceso a todas las tablas. En Supabase, el `postgres` user
  tiene acceso completo, otros roles pueden no tenerlo.

### `pg_dump: error: connection to server ... failed`

- Verificar connectivity: `psql "$DATABASE_URL" -c "select 1"`.
- Si la BD está en Supabase, verificar que la IP del runner esté en
  la allowlist (Supabase bloquea por default IPs externas en planes
  con esa opción habilitada). Workaround: usar la `DATABASE_URL` del
  pooler (puerto 6543) en vez de la directa (5432).

## Relación con el resto del sistema

- **H3b (health watchdog)**: independiente. El watchdog vigila que el
  pipeline de scraping corra; este script respalda la BD. Se complementan.
- **H1 (soft delete)**: los dumps preservan la columna `deleted_at`,
  así que un restore "recupera" parcelas que se habían borrado. Esto es
  aceptable porque soft delete es reversible.
- **H2 (ICA / Aerocivil)**: los dumps preservan las nuevas columnas
  sin necesidad de cambios en el script.
