# Scripts CLI

Scripts Node.js que el operador corre desde la línea de comandos para
mantenimiento de datos y operación del sistema. No se exponen como API.

## Variables de entorno

Todos los scripts que tocan la BD leen `DATABASE_URL` (con fallback a
`DATABASE_URL_DIRECT`) desde `.env.local` en la raíz del proyecto.
Algunos también respetan `DATABASE_SSL=true` para Supabase.

## Refresco automático de fumigaciones (cron semanal)

> **Cierra el hallazgo audit ui-ux-2026-07 §9**: data stale 24-48h porque
> la BD solo se actualizaba con el backfill manual.

### `npm run refresh:fumigations` (alias: `node scripts/refresh-fumigations.js`)

Refresca los datos derivados de fumigaciones **sin re-scrapear DJI**.
Hace 2 cosas, en este orden, dentro de una transacción:

1. **Backfill de fumigaciones** (`backfill-fumigations-from-flights.js`):
   re-agrupa `dji_flights` por `(parcel_id, fecha local Colombia)` y
   re-inserta en `dji_fumigations` con `source='import'`. Borra las
   filas previas de este origen (idempotente).
2. **Update del schedule** (`update-fumigation-schedule.js`):
   re-calcula `dji_fumigation_schedule.last_fumigation_date` y
   `next_due_date` desde los datos frescos de `dji_fumigations`.

**Idempotente**: correr N veces = mismo resultado.

**Exit codes**: 0 = OK, 1 = error de DB.

**Output esperado**:
```
[refresh-fumigations] starting refresh...
[refresh-fumigations] done: 130 fumigations updated, 87 schedule rows, took 4231ms
```

### GitHub Action: `.github/workflows/refresh-fumigations.yml`

Corre automáticamente **todos los lunes a las 06:00 UTC** (= 01:00
America/Bogota). También triggerable a mano desde la tab "Actions"
(workflow_dispatch).

Para que funcione en producción, el repo debe tener configurado el
secret `DATABASE_URL` (o `DATABASE_URL_DIRECT`) en
*Settings → Secrets and variables → Actions*. Si no está, el workflow
falla explícitamente con un mensaje claro (no falla silencioso).

```bash
# Setup del secret (una vez)
gh secret set DATABASE_URL --repo <owner>/aeroadmin-afm
# Pegar el connection string de Supabase cuando lo pida.
# Formato: postgresql://postgres:PASSWORD@db.host.supabase.co:5432/postgres
```

### Cuándo correr el script a mano

- Después de un backfill manual grande de vuelos (`upsert-flights-from-djiag.js`)
  para que el panel vea los nuevos vuelos sin esperar al lunes.
- Después de un fix de datos que haya tocado `dji_flights` directamente.
- Después de un import manual de fumigaciones.

## Otros scripts relevantes

| Script | Qué hace |
|---|---|
| `npm run db:migrate` | Aplica migrations SQL pendientes (idempotente) |
| `npm run db:import:lands` | Importa parcelas desde DJI (pasos 8-9 del pipeline) |
| `npm run db:import:fumigations` | Importa fumigaciones agregadas desde DJI |
| `node scripts/backfill-fumigations-from-flights.js` | Solo el paso 1 del refresh (sin schedule) |
| `node scripts/update-fumigation-schedule.js` | Solo el paso 2 del refresh (sin backfill) |
| `node scripts/spatial-join-flights-parcels.js` | Llena `dji_flights.parcel_id` por proximity |
| `npm run pipeline:djiag` | Pipeline completo: scrape + spatial join + backfill + update |

## Cuándo NO usar `refresh:fumigations`

Si **no** corriste el scraper DJI recientemente, `dji_flights` no tiene
data nueva y este script no agrega nada — solo re-procesa lo que ya
está en la BD. En ese caso, primero corré el scraper:

```bash
npm run pipeline:djiag
# o, si solo querés los vuelos y no las fumigaciones agregadas:
npm run scrape:djiag
node scripts/upsert-flights-from-djiag.js
node scripts/spatial-join-flights-parcels.js
npm run refresh:fumigations
```
