-- 2026-09-19 — atributos crudos del shapefile Suertes_MYZ.
-- El shape trae datos agronomicos valiosos que no mapeamos a columnas
-- tipadas (por ahora): fecha de siembra/cosecha, edad, sacarosa, ult.
-- TCH, nro de cortes (NC), distancia de siembra, topografia, zona
-- agroecologica, tenencia, region, espacio.
--
-- Decision: guardar el objeto crudo en `jsonb` (en vez de 12 columnas
-- nuevas) para no inflar el schema mientras el operador decide que
-- campos formalizar. La UI lee keys especificas.
ALTER TABLE dji_parcels ADD COLUMN IF NOT EXISTS shape_attrs jsonb;

COMMENT ON COLUMN dji_parcels.shape_attrs IS
  'Atributos crudos del shapefile Suertes_MYZ (HDASTE, COD, TAB, AREA_HA, Topografia, Region, HACIENDA, VARIEDAD, STE, DISTANCIA, F.SIEMBRA, F.COSECHA, ULT.TCH, Z.AGRO, TENENCIA, ESPACIO, NC, Edad, Sacarosa).';
