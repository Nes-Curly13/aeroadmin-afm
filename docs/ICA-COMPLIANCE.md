# Compliance ICA + Aerocivil (Sprint C — H2)

> **Por qué existe este documento**: el operador cañero opera bajo
> regulación colombiana de dos entidades (ICA y Aerocivil). Sin los
> 3 campos de compliance que este sprint agrega, una auditoría
> puede resultar en multa (ICA) o suspensión de operaciones
> (Aerocivil). Este documento explica el mínimo indispensable
> agregado, por qué las decisiones de diseño, y el gap regulatorio
> que queda fuera de scope.

## TL;DR

3 columnas nuevas en la BD:
- `dji_fumigations.product_registered_ica` — registro ICA del producto.
- `dji_fumigations.pilot_license` — licencia Aerocivil del piloto.
- `dji_drone_models.registration_number` — matrícula del dron (admin-only).

UI mínima: 2 inputs en el form de "Registrar fumigación". El operador
llena los 2 primeros; el admin (vía SQL) llena la matrícula del dron
una vez por dron.

## Por qué estos 3 campos

### ICA (Instituto Colombiano Agropecuario)

Regula el registro de **productos agroquímicos** (herbicidas,
fungicidas, insecticidas). Cada producto aplicado en campo debe
tener un número de registro ICA visible. Formato típico:
`ICA-1234-PN` (PN = Plaguicida Nacional).

Sin este campo: si ICA visita y pide "muéstrame los registros de
los productos que aplicaron en julio", el operador NO puede
demostrarlo. Multa potencial.

### Aerocivil (Aeronáutica Civil)

Regula **drones** (matrícula) y **pilotos** (licencia) que operen
con equipo aéreo en Colombia.

- **Matrícula del dron**: formato `HK-1234-UAV` para RPA (Remotely
  Piloted Aircraft). Es 1 por dron, no 1 por vuelo.
- **Licencia del piloto**: formato `PCA-12345` (Piloto Certificado
  de Aeronave) o `PC-1234567` (Piloto Comercial). Es 1 por piloto,
  puede ser la misma en muchos vuelos.

Sin estos campos: si Aerocivil pide "muéstrame la matrícula del
dron que fumigó X parcela y la licencia del piloto que lo operó",
el operador NO puede responder. Riesgo de suspensión.

## Decisiones de diseño

### Por qué texto libre y no dropdown / FK

- **ICA**: hay miles de productos registrados. Mantener una tabla
  sincronizada con el catálogo oficial del ICA sería otro proyecto
  entero (web scraping + jobs de refresh). Texto libre + regex
  suave es el patrón estándar para compliance metadata en este
  tipo de sistemas.
- **Aerocivil matrículas/licencias**: una por dron/piloto, no
  tiene sentido un catálogo compartido (cada operador tiene sus
  propios).
- Los ICA cambian con el tiempo (renovaciones), y los formatos
  pueden cambiar con resoluciones nuevas. Texto libre es más
  resiliente.

### Por qué CHECK constraints suaves (regex laxa)

- El formato exacto puede evolucionar (`HK-XXXX-UAV` hoy, otro
  mañana según resolución).
- Hay históricos con formatos legacy (ej: `PC12345` sin guión).
- La validación exacta puede hacerse en el frontend con helper
  text (placeholders y descripciones en el form).
- El server valida solo la **longitud** (defense in depth contra
  inputs gigantes). El formato final lo valida la BD con el CHECK.

### Por qué `dji_drone_models.registration_number` y no en `dji_fumigations`

- La matrícula del dron es 1 por dron, no 1 por fumigación.
  Modelamos como columna de la tabla de modelos (entidad "drone"),
  no como columna de cada evento.
- **Por H2 no editamos la UI del drone** — se actualiza por SQL
  cuando se agrega un dron nuevo. Panel admin queda para un
  sprint futuro.

### Por qué NULL permitido

- La mayoría de fumigaciones existentes NO tienen estos campos
  poblados. El operador los va completando progresivamente.
- Forzar NOT NULL con default vacío generaría data sucia que
  después hay que limpiar.

## Cómo auditar

```sql
-- Fumigaciones sin ICA del producto (riesgo auditoría ICA)
SELECT COUNT(*)
  FROM dji_fumigations
 WHERE product_registered_ica IS NULL
   AND deleted_at IS NULL;

-- Fumigaciones sin licencia del piloto (riesgo Aerocivil)
SELECT COUNT(*)
  FROM dji_fumigations
 WHERE pilot_license IS NULL
   AND deleted_at IS NULL;

-- Drones sin matrícula (riesgo Aerocivil)
SELECT code, model_name, registration_number
  FROM dji_drone_models
 WHERE registration_number IS NULL;
```

## Cómo actualizar manualmente la matrícula de un dron

```sql
UPDATE dji_drone_models
   SET registration_number = 'HK-1234-UAV'
 WHERE code = 201;  -- Agras T40
```

(El `code` es el identificador del modelo en la tabla. En la UI
aparece como "Agras T40" — buscar por `model_name` si no se
conoce el `code`.)

## Cómo auditar la compliance (vista rápida)

```sql
-- Cobertura de compliance por parcela
SELECT
  p.id,
  p.land_name,
  COUNT(f.id) AS total_fumigations,
  COUNT(f.product_registered_ica) AS with_ica,
  COUNT(f.pilot_license) AS with_pilot_license
FROM dji_parcels p
LEFT JOIN dji_fumigations f
  ON f.parcel_id = p.id AND f.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.land_name
ORDER BY p.land_name;
```

Esto da una vista de qué tan completa está la compliance por
parcela — útil para priorizar el operativo.

## Disclaimer — gap regulatorio completo

Estos 3 campos son **el mínimo indispensable** para una auditoría
básica. El gap regulatorio completo incluye (fuera de scope de
este sprint):

- **Libro de operaciones** del dron (bitácora de vuelos, mantenimientos, etc.).
- **Bitácora de mantenimiento** del dron (firmware updates, calibraciones, repairs).
- **Plan de aplicación firmado por agrónomo** (no solo el ICA del producto, sino
  el plan completo: dosis justificadas, condiciones meteorológicas, etc.).
- **Reporte de condiciones meteorológicas** al momento de la fumigación.
- **Notificación previa** a ICA/Aerocivil/autoridades locales sobre fumigaciones en X área.
- **Capacitación documentada** del personal fumigador.
- **Inventario de productos** con stock, lotes, fechas de vencimiento.

Esto es scope de otro sprint (P-financial + regulatory). El PO puede
usar este documento como input para la conversación con el cliente
sobre el roadmap regulatorio.

## Relación con el resto del sistema

- **H1 (soft delete)**: la auditoría debe respetar el `deleted_at`.
  Las fumigaciones soft-deleted no cuentan para compliance (el
  operador las borró, no son fumigaciones reales).
- **H3a/H3b (backups + watchdog)**: independientes. Estos cuidan
  la infra; H2 cuida el contenido regulatorio.
- **XS1 (djiag-health)**: independiente.
- **API route `/api/fumigations`**: ya actualizada para aceptar
  los 2 nuevos campos. Si el formato no pasa el CHECK de la BD,
  el handler devuelve 400 con el nombre del constraint.

## Archivos modificados / creados

- `supabase/migrations/20260723000000_add_ica_metadata.sql` — migration UP/DOWN.
- `lib/types.ts` — `DjiFumigationEvent` con los 2 nuevos campos.
- `app/api/fumigations/route.ts` — body acepta los 2 nuevos campos, mapea
  CHECK violations a 400 con mensaje claro.
- `api/repositories.ts` — `createFumigationEvent` acepta y persiste los 2
  nuevos campos. `getFumigationEventsByParcel` los devuelve.
- `components/parcels/parcel-fumigations.tsx` — 2 nuevos inputs en el form,
  muestra los valores en la lista de eventos.
- `tests/api-fumigations-ica-metadata.test.ts` — 16 tests del endpoint.
- `tests/components/parcels/parcel-fumigations-ica.test.tsx` — 6 tests del
  componente (inputs, submit, render condicional).
- `tests/components/parcels/parcel-fumigations.test.tsx` — actualizados 2
  eventos mock para incluir los nuevos campos (regresión de tipos).
- `tests/components/parcels/export-fumigations-csv-button.test.tsx` —
  actualizado el factory de eventos para incluir los nuevos campos.
