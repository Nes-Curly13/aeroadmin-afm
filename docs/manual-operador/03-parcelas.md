# 3. Parcelas

El inventario de todas las suertes/lotes. Entrás desde el menú lateral, **"Parcelas"**.

## Buscar una parcela
1. En el cuadro de búsqueda, escribí cualquier dato: nombre del lote, ID,
   cliente, hacienda, municipio o variedad.
2. La tabla se filtra a medida que escribís.

## Leer la tabla
Cada fila muestra:
- **Parcela**: nombre de la suerte.
- **Cliente / Hacienda**: a quién pertenece.
- **Área**: hectáreas.
- **Cadencia**: cada cuántos días se fumiga (14 días típico).
- **Última**: fecha de la última fumigación.
- **Próxima**: fecha en que toca la siguiente.
- **Eventos**: cantidad de fumigaciones / vuelos.
- **Estado**: semáforo de la cadencia (al día / por vencer / vencida).

Click en una fila abre la **ficha de la parcela**.

## Ficha de la parcela
- **Centro**: mapa con la geometría y los vuelos.
- **Ciclo productivo**: la fase actual del cultivo (establecimiento,
  crecimiento, maduración, cosecha) y sus eventos (siembra, corte, etc.).
- **Manejo fitosanitario**: qué aplicaciones requiere la fase actual y su estado
  (aplicada / pendiente / vencida).
- **Registrar fumigación manual**: formulario para cargar una aplicación a mano.
- **Historial** y **cambios de cadencia**.

## Si sos admin
- Botones **PDF** y **CSV** para descargar el reporte de la parcela.
- Botón **Editar metadata** (cliente, hacienda, municipio, variedad).
- Si la parcela no tiene ciclo activo, podés **iniciar un ciclo** o **registrar
  un corte** (ver [Administración](07-admin.md)).

## Si esto no funciona
- ¿No encontrás una parcela? Probá con el nombre del cliente o el municipio.
- Si el área dice "—", la parcela no tiene geometría cargada; avisá al admin.
