# AeroAdmin AFM

Sistema de administración y visualización de datos de vuelos de drone con capacidades GIS.

## Configuración
1. `npm install`
2. Crear `.env.local` desde `.env.example`
3. Iniciar PostGIS local con `npm run db:up`
4. Ejecutar `db/schema.sql` y opcionalmente `db/seed.sql` en PostgreSQL con PostGIS
5. `npm run dev`

## Base de datos local
- Servicio Docker: `postgres` de `docker-compose.yml`
- Base de datos por defecto: `afm_flights`
- Usuario: `postgres`
- Contraseña: `postgres`
- Conexión: `postgresql://postgres:postgres@localhost:5432/afm_flights`

## Importación DJI
- Ejecutar el scraper para generar los archivos locales en `djiag_exports/`
- Cargar la estructura DJI con `npm run db:init`
- El importador usa `records_history.json`, `land_file_urls.json` y los archivos descargados en `djiag_exports/land_files/`
- Las rutas geométricas se guardan como JSON crudo y, cuando aplica, como `geometry` PostGIS para su uso en el mapa

## Migración a Supabase
1. Crear proyecto Supabase con PostGIS habilitado
2. Usar `supabase/migrations/20260428153000_init_afm_flight_gis.sql`
3. Cargar `supabase/seed.sql` para datos de demo
4. Configurar `DATABASE_URL` con la conexión pooled de Supabase
5. Configurar `DATABASE_URL_DIRECT` para tareas de admin
6. Configurar `DATABASE_SSL=true`

## Verificaciones
- `npm test`
- `npm run build`

## Estado actual
- Dashboard y mapa implementados
- Rutas API para parcelas, vuelos y alertas implementadas
- Pruebas cubriendo reglas de alertas, validación de parámetros y respuestas de API
- Ambiente PostGIS local preparado para desarrollo y despliegue
- Archivos SQL de migración y seed preparados para Supabase

## Rutas
- `/` - Panel de Control
- `/map` - Mapa de Operaciones
- `/api/parcels` - API de Parcelas
- `/api/flights` - API de Vuelos
- `/api/alerts` - API de Alertas
