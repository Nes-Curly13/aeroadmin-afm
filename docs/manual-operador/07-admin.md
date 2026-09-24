# 7. Administración (solo admin)

Entrás desde el menú lateral, **"Administración"**. Es el centro de mantenimiento.

## Crear una parcela nueva
1. En Administración, tocá **"Nueva parcela"** (o el botón en Parcelas).
2. En el mapa, dibujá el polígono del lote.
3. Completá las secciones: **Identificación**, **Tenencia y ubicación**
   (Cliente / Hacienda), y **Cultivo**.
4. Tocá **"Crear parcela"**.

## Importar parcelas desde un archivo SIG
1. En Administración, tocá **"Importar parcelas"**.
2. Subí el archivo (KML, ZIP con shapefile, o GeoPackage).
3. Revisá la **vista previa** y editá los nombres si hace falta.
4. Tocá **"Crear N parcelas"**.

Sirve para cargar muchas parcelas de una vez desde un archivo del GIS.

## Catálogos (clientes, fincas, productos, vehículos)
- Los **clientes** y **fincas** se cargan desde la ficha de parcela (o al crear una).
- Los **productos** y **vehículos** se crean desde los selectores al registrar
  una fumigación (escribí el nombre/placa y se agrega al catálogo).

## Ciclo del cultivo: siembra y corte
En la ficha de una parcela, en la tarjeta **"Manejo fitosanitario"**:
- **Iniciar nuevo ciclo**: poné la fecha de siembra o renovación. Con eso el
  sistema calcula la **fase** de la parcela.
- **Registrar corte**: poné la fecha de corte; el ciclo se cierra. Después podés
  iniciar el siguiente (soca).

Sin la fecha de siembra, el sistema no sabe la fase ni qué aplicación toca.

## Reglas fitosanitarias
En Administración, tocá **"Reglas fitosanitarias"**. Ahí están las
**aplicaciones recomendadas por fase** (herbicida pre-emergente, fertilizante,
control de Diatraea, madurante, etc.) con su ventana de días y cadencia.

- Podés **ajustar** los valores (ventana, cadencia, si es obligatoria) y guardar.
- **"Restaurar recomendados"** vuelve a los valores sugeridos.
- La planificación del inicio y la tarjeta "Manejo fitosanitario" se recalculan
  automáticamente.

## Si esto no funciona
- Si al dibujar el polígono el botón no avanza, revisá que el polígono esté cerrado.
- Si el importador rechaza el archivo, revisá el tamaño (el mensaje indica el máximo).
