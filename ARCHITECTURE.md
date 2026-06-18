# Architecture

- `app/`: dashboard, map view, and API route handlers
- `components/`: UI shell, cards, and Leaflet map
- `api/`: shared data-access functions used by pages and routes
- `lib/`: database client, alert logic, formatting, and shared types
- `db/`: PostGIS schema and seed data
- `supabase/`: migration-ready SQL for hosted Postgres rollout
- `tests/`: alert logic, request parsing, and API route coverage

The frontend consumes shared server queries and renders parcel, flight, and alert layers directly from GeoJSON.

Database access stays on server-side `pg`. Local Docker uses the same PostGIS model as Supabase, so migration is a connection and SQL rollout change, not an application rewrite.

## Progress Snapshot
- Core MVP flows are implemented end to end
- API filters now validate integer query params before hitting repositories
- Build and automated tests are part of the verification path
- Runtime is prepared for pooled `DATABASE_URL` plus direct admin `DATABASE_URL_DIRECT`
