# DJI AG scraper — operational notes

Two scrapers (`scrape_djiag_records.js` v2, `scrape_djiag_perflight.js` v3)
capture DJI AG data into `djiag_exports/` for the ingestion pipeline. This
doc is the institutional memory for the four gotchas that bit us hard
during the 2026-06 build-out.

## TL;DR

```bash
# One-shot full pipeline (30-day window):
npm run pipeline:djiag -- --days 30

# Resume an interrupted per-flight scrape:
node scrape_djiag_perflight.js --days 30 --resume

# Dry-run the pipeline (print commands, don't execute):
npm run pipeline:djiag:dry
```

## Gotcha 1 — the zh-CN locale trap

DJI's frontend routes to **one of two backends** based on the browser's
`Accept-Language`:

- `accept-language: zh-CN,zh` → `kr-ag2-api.dji.com` (Korean core) — has
  the full GraphQL surface (`?name=lands`, `?name=landsCluster`, aggr_by_day,
  flight_records).
- `accept-language: en-US` (default) → `agro-vg.djiag.com` (regional) —
  limited surface, the `?name=lands` query returns empty.

Both scrapers set `locale: 'zh-CN'` and `accept-language: zh-CN,zh` on
the Playwright context. **If you remove this, the lands query comes back
empty** and the scraper silently completes with 0 results.

```js
const context = await browser.newContext({
  locale: 'zh-CN',
  extraHTTPHeaders: { 'accept-language': 'zh-CN,zh' },
});
```

## Gotcha 2 — fetch() from page.evaluate fails with 408

The signature scheme (HMAC over body, `signature`, `content-md5`,
`x-ag-date` headers) is implemented by DJI's Axios interceptor in
`assets/sign.*.wasm`. **Calling `fetch()` directly from `page.evaluate`
does NOT go through the interceptor → 408 请求时间无效 ("request time
invalid").**

Workaround: drive the page UI (click "Next Page" on `/records/list`,
click "Field Management" in the sidebar) and capture the responses via
`page.on('response')`.

If you see 408 errors, you're calling fetch from the wrong layer.

## Gotcha 3 — pagination: single-page only

DJI's `.ant-pagination-jump-next` (title="Next 5 Pages") jumps 5 pages
but **only the landing page data is loaded**. The 4 in-between pages are
silent misses.

Use `.ant-pagination-next` (title="Next Page") for single-page iter. For
~7050 flights that's 235 clicks × 700ms ≈ 3 minutes. Slower than jump-5
but **correct**.

## Gotcha 4 — per-flight-serial vs chassis serial

The `serial_number` field on `flight_records` is **per-flight-session**,
NOT the drone chassis serial. Same drone flying 100 sorties has 100
different `serial_number` values (DJI uses it as a session ID).

**For grouping/deduping by drone, use `drone_nickname`** (human name like
"AFM T40 1", "AFM T50-2", "AFMDrone").

The actual chassis serial is `hardware_id` on the detail endpoint
(`/flight_records/{id}`) — which is NOT in the per-flight list response.

## Resumability (per-flight scraper)

`scrape_djiag_perflight.js` writes `djiag_exports/perflight_records.json`
**incrementally** after every successful page capture. If the process
dies (Ctrl-C, OOM, network drop), the file on disk always reflects the
last page captured.

To resume:

```bash
node scrape_djiag_perflight.js --days 30 --resume
```

The scraper reads the existing file (only resumes if `days` matches),
skips already-captured pages, and continues from where it stopped.

## Reliability

Each "Next Page" click is wrapped in a retry with exponential backoff
(3 attempts, 1.5s / 3s / 6s). The `Next Page` button is scrolled into
view before clicking (Ant Design pagination lives at the bottom of the
table — outside the viewport fails). 5 consecutive hard failures abort
the run.

## Auth

JWT in `localStorage.x-auth-token` (decoded payload: `{ sub, iss: "auth.djiag.com", iat, exp }`, exp = iat + 365 days). The korean client (`lib/djiag-korean-client.js`) handles login + cookie persistence; you just call `client.login()`.

Credentials live in `.env.local`:
```
DJIAG_EMAIL=...
DJIAG_PASSWORD=...
```

**Never commit `.env.local`** — it's in `.gitignore` for this reason.

## Files

| File | Purpose |
|---|---|
| `scrape_djiag_records.js` | v2 — captures aggr_by_day + overview + GraphQL discovery |
| `scrape_djiag_perflight.js` | v3 — captures per-flight records (single-page iter) |
| `lib/djiag-korean-client.js` | Playwright login + locale trap handling |
| `lib/djiag-graphql-queries.js` | raw query strings (whitespace-sensitive for HMAC) |
| `lib/djiag-graphql-types.d.ts` | TS interfaces for the response shapes |
| `lib/djiag-*-fetcher.js` | pure parsers (testable with JSON fixtures) |
| `scripts/run-pipeline.js` | end-to-end wrapper, chains scrape → upsert → spatial-join → backfill |
| `djiag_exports/` | gitignored — per-run captures |

## Output shapes

### `djiag_exports/fumigations.json`
```json
{
  "data": {
    "aggr_info": [
      { "create_timestamp": 1781884800, "work_area": 4668, "work_times": 4, "work_time": 1180800, "spray_usage": 54571 }
    ]
  }
}
```

### `djiag_exports/perflight_records.json`
```json
{
  "flights": [...],
  "total_count": 7059,
  "total_pages": 142,
  "captured_at": "2026-06-23T...",
  "days": 30,
  "pageSize": 50,
  "pages_captured": 235
}
```

Per-flight fields include `id, flyer_name, team_name, serial_number,
nickname, new_work_area, spray_usage, lng, lat, location, district,
start_timestamp, end_timestamp, work_time_seconds, mode_name,
manual_mode, work_speed, spray_width, radar_height, create_date,
plot_name (null)`.

`plot_name` is **always null** — parcel resolution requires the separate
lands GraphQL query + spatial join (handled by the pipeline).