# DJI area units — MU, ha, m², acres

DJI AG uses a mix of metric and traditional Chinese units depending on
the field. The ingestion pipeline has to convert them all to m² for
PostGIS.

## The unit matrix

| DJI field              | Unit  | Stored as          | Notes |
|---|---|---|---|
| `land.totalArea`       | MU    | `dji_parcels.total_area_mu` (numeric) | Chinese MU. 1 MU ≈ 666.67 m². |
| `land.workArea`        | MU    | `dji_parcels.work_area_mu` | Same conversion. |
| `land.totalObstacleArea` | MU  | `dji_parcels.total_obstacle_area_mu` | |
| `flight.new_work_area` | m²    | `dji_flights.area_m2` (numeric) | Already metric. No conversion. |
| `flight.spray_usage`   | mL    | `dji_flights.spray_volume_ml` | Already metric. |
| `aggr.work_area`       | m²    | `dji_fumigations.area_fumigated_m2` | Already metric. |
| `aggr.spray_usage`     | mL    | `dji_fumigations.total_spray_ml` | Already metric. |
| legacy `parameter.json` | m²   | `dji_parcels.spray_geom_area_m2` (from earlier import) | |

**Key gotcha:** lands come in MU, flights come in m². The pipeline keeps
both columns on `dji_parcels` (MU original + computed HA conversion) so
the UI can show whichever the operator prefers.

## Conversions

```js
// 1 MU = 1/15 ha (Chinese standard, "市亩")
const MU_PER_HA = 15;
const M2_PER_MU = 10_000 / MU_PER_HA;  // ≈ 666.6667 m²
const HA_PER_MU = 1 / MU_PER_HA;       // ≈ 0.0667 ha

function muToM2(mu)  { return mu * M2_PER_MU; }
function muToHa(mu)  { return mu * HA_PER_MU; }
function m2ToHa(m2)  { return m2 / 10_000; }
function haToM2(ha)  { return ha * 10_000; }
function m2ToMu(m2)  { return m2 / M2_PER_MU; }
```

These constants live in:
- `lib/djiag-lands-fetcher.js` (the parser that produces
  `NormalizedLand` from DJI's response)
- `lib/djiag-lands-to-parcels.js` (the converter that writes to SQL
  params)

If you change one, change the other. There's no central constant module
yet — TODO if DJI ever adds more units.

## Dose calculations

`dose_l_per_ha` = spray volume / area. Pipeline uses:

```sql
ROUND(((SUM(f.spray_usage_ml) / 1000.0) / (SUM(f.area_m2) / 10000.0))::numeric, 2)
```

That's `(mL / 1000) / (m² / 10000)` = `L / ha`. Spot-check: 10000 mL on
10000 m² = 1.0 L/ha. ✓

## Why DJI uses MU

DJI AG is built for the Chinese agricultural market (DJI is a Shenzhen
company). MU (市亩, "shì mǔ") is the traditional Chinese unit, still in
official use alongside hectares. The Colombian operator we work with
sees MU in the DJI dashboard and acres/m²/hectáreas elsewhere — easy
to confuse.

## When MU vs ha matters

- **Parcels under 1 ha** — MU is the natural unit. A 12 MU parcel is
  0.8 ha.
- **Display to operator** — they think in hectares (Spanish agricultural
  convention) or m². Show ha in the dashboard, store MU in the column
  for fidelity to the source.
- **Spray dose** — always L/ha, never L/MU. The conversion makes dose
  numbers 15× smaller in MU than in ha.

## Sources

- [Chinese units of measurement — Wikipedia](https://en.wikipedia.org/wiki/Chinese_units_of_measurement#Area)
- DJI AG dashboard (kr-ag2-api.dji.com, `?name=lands` GraphQL response,
  totalArea / workArea fields)
- Pipeline fixtures: `tests/fixtures/lands-response-page1.json`,
  `tests/fixtures/lands-response-page2.json`