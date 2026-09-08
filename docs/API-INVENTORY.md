# AeroAdmin AFM — API Inventory

> **Snapshot 2026-09-08**, master `3414c05`.
> **Source of truth**: `app/api/**/route.ts` (32 route handlers).
> **Base URL**: `/api` (Next.js App Router).

---

## Conventions

- **Auth**: NextAuth v5 (beta.31). Cookie `afm.session`. Middleware `proxy.ts` + `authConfig.callbacks.authorized`.
- **Validation**: zod 4.5.4 (Sprint Quality Gauntlet #1, PRs #56-#58). Request bodies con `zodSchema.safeParse()`.
- **Response shape**: JSON. Errors: `{ error: string, issues?: [{ path, message }] }` con HTTP 4xx/5xx.
- **Idempotency**: `UPSERT` con `ON CONFLICT` en BD. Bulk operations con `affected[]` + `skippedIds[]`.
- **Audit**: mutaciones llaman `recordFumigation*` de `lib/fumigation-audit.ts` (fire-and-forget, ver AUD-001).
- **Soft-delete**: fumigaciones usan `deleted_at IS NULL` en read. Restore disponible vía endpoint dedicado.
- **TZ**: `America/Bogota` para fechas del operador. `now()` en SQL es timestamptz.

## 1. Auth (NextAuth)

| Path | Methods | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth v5. CSRF en `GET /api/auth/csrf`. Callback credentials en `POST /api/auth/callback/credentials`. |

## 2. Parcels

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/parcels` | GET, POST | admin/supervisor | Lista + create. GET filtra por `?search=&client=&status=`. |
| `/api/admin/parcels/search` | GET | público* | Search para pickers (`?q=&limit=`). Cache 60s. |
| `/api/admin/parcels/[id]` | (via /fumigaciones) | — | (no route directo, usar /api/admin/parcels/[id]/metadata) |
| `/api/admin/parcels/[id]/metadata` | PATCH | admin | Update supervisor metadata (crop_type, planting_date, owner_*, notes) |
| `/api/admin/parcels/[id]/geometry` | PATCH | admin | Update geometry (postGIS polygon) |
| `/api/admin/parcels/[id]/report.csv` | GET | admin | CSV report wide (39 cols, max 50k rows) |
| `/api/admin/parcels/[id]/report.pdf` | GET | admin | PDF report (Chromium, puede fallar) |
| `/api/admin/parcels/import/preview` | POST | admin | Preview de import GIS (KML/SHP/GPKG) — dry-run |
| `/api/admin/parcels/import/commit` | POST | admin | Commit del import (después de preview) |
| `/api/admin/parcels/applications/import` | POST | admin | Import applications batch (legacy) |

## 3. Fumigaciones

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/fumigations` | GET, POST | admin/supervisor | Lista + create manual. POST valida con zod. |
| `/api/admin/fumigations/[id]` | GET, PATCH, DELETE | admin | Detail (GET filtra soft-deleted), edit (PATCH inmutables: parcel_id, source, recorded_by, flight_ids, recorded_at), soft-delete. |
| `/api/admin/fumigations/[id]/restore` | POST | admin | Restore de soft-deleted |
| `/api/admin/fumigations/[id]/invoices` | GET, POST | admin | Lista + create facturas |
| `/api/admin/fumigations/[id]/invoices/[invoiceId]` | PATCH, DELETE | admin | Update / cancel invoice (cancelled_at, cancelled_by) |
| `/api/admin/fumigations/[id]/report.csv` | GET | admin | CSV wide (39 cols) |
| `/api/admin/fumigaciones/[id]/report.pdf` | GET | admin | PDF report |
| `/api/admin/fumigations/bulk-delete` | POST | admin | Bulk soft-delete (cap 200 ids, idempotente) |
| `/api/admin/fumigations/bulk-category` | POST | admin | Bulk re-categorize (valida FK a fumigation_categories) |

## 4. Catálogos (admin)

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/clients` | GET, POST | admin | Lista + create clients |
| `/api/admin/farms` | GET, POST | admin | Lista + create farms (FK client_id) |
| `/api/admin/cycles` | GET, POST | admin | Cycles CRUD |
| `/api/admin/cycles/backfill` | POST | admin | Backfill híbrido de cycles (idempotente, NO correr 2 veces) |
| `/api/admin/djiag-health` | GET | admin | Health check del scraper DJI (last_success, last_failure, circuit) |
| `/api/admin/dji-vehicles` | GET, POST | admin | Vehicle catalog (placa, descripción) |
| `/api/admin/products` | GET, POST | admin | Product catalog (catalogado de fumigación) |
| `/api/admin/applications/import` | POST | admin | Import applications (legacy) |

## 5. Reports (admin)

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/reports/farms/report.csv` | GET | admin | Farms report CSV (8.7k flights, cap 50k) |
| `/api/admin/reports/farms/report.pdf` | GET | admin | Farms report PDF |
| `/api/admin/reports/flights/export.csv` | GET | admin | Wide flights export CSV (39 cols) |

## 6. Data quality (público*)

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/data-quality/invariants` | GET | admin | 5 patrones de data quality (parcela sin cliente, sin finca, sin ciclo, fumigación en ciclo cerrado, etc) |

## 7. DJI (read-only, data feed)

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/dji-flights/search` | GET | admin | Search DJI flights para wizard fumigación (`?parcelId=&dateFrom=&dateTo=&limit=`) |

## 8. Internal (no auth, local only)

| Path | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/internal/print-map/[id]` | GET | **internal only** | Print-friendly map view (sin sidebar) para window.open() |

## 9. Data shape (resumen)

### `DjiParcel` (V0 shape, en `lib/types.ts`)
```ts
{
  id: string;              // external_id (no el PK numérico!)
  dji_land_id: string;
  name: string;
  farm_name: string;
  client_name: string;
  municipality: string;
  area_ha: number;
  variety: string;
  drone_model_id: 0 | 72 | 201 | 210;
  centroid_lng: number;
  centroid_lat: number;
  geom: GeoJSON.Polygon;
  created_at: string;
  // + normalized fields: crop_type, planting_date, owner_*, supervisor_notes,
  //   client_id, farm_id, data_validity, last_validated_at, validated_by_email
  //   recommended_cadence_days, last_fumigation_date, days_since_last_fumigation
  //   cycle_phase
}
```

### `DjiFumigationEvent`
```ts
{
  id: number;
  parcel_id: number;
  parcels: string[] | null;          // multi-parcela (S9.5)
  flight_ids: number[] | null;
  fumigation_date: string;            // YYYY-MM-DD
  product_used: string | null;
  product_id: number | null;         // FK catalog
  dose_l_per_ha: number | null;      // 95% null (DJI no expone)
  area_fumigated_m2: number | null;
  duration_minutes: number | null;
  drone_code_used: number | null;
  vehicle_plate: string | null;      // workaround jsonb
  product_registered_ica: string | null;  // ICA-1234-PN
  pilot_license: string | null;          // PCA-12345
  human_notes: string | null;
  notes: string | null;               // jsonb
  category_id: number | null;
  application_type_id: number | null;
  category: FumigationCategory | null;     // hydrated
  application_type: ApplicationType | null; // hydrated
  invoices: FumigationInvoice[] | null;
  recorded_by: string | null;
  recorded_at: string;
  source: 'manual' | 'djiscraper' | 'import';
  deleted_at: string | null;          // soft-delete
  deleted_by: string | null;
  // V0 derived:
  lng: number | null;
  lat: number | null;
  n_matched_flights: number | null;
}
```

### `FumigationAuditEvent`
```ts
{
  id: number;
  fumigation_id: number;
  action: 'created' | 'edited' | 'deleted' | 'restored';
  actor_email: string;
  changes: Record<string, unknown>;  // JSONB: { fields?, diff?, snapshot?, restored_from? }
  created_at: string;
}
```

## 10. Errores comunes

- `400 Bad Request`: zod validation failed. Body: `{ error: string, issues: [{ path: string[], message: string }] }`
- `401 Unauthorized`: sesión inválida / no auth.
- `403 Forbidden`: rol insuficiente (ej. supervisor intentando DELETE).
- `404 Not Found`: id no existe o soft-deleted.
- `409 Conflict`: unique constraint (ej. product name duplicate).
- `500 Internal Server Error`: unexpected. Logged to stderr.

## 11. Rate limits / caps

- `bulk-delete` y `bulk-category`: cap 200 ids.
- `parcels/import/preview`: cap 5MB file.
- CSV exports: cap 50k rows.
- `dji-flights/search`: cap 500 results (default 50).

---

**Para implementar cambios**: leer primero `lib/api-schemas.ts` (zod schemas consolidados), luego `app/api/admin/fumigations/route.ts` como referencia de patrón (zod + audit + soft-delete).
