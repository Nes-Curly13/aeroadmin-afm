# Mantenimiento del operador — "¿Qué hacer cuando...?"

> Guía de situaciones comunes. Cada caso: **síntoma → acción → a quién escalar**.

## 1. Cambio de dron (ej. T50 → T40)
- **Síntoma**: los vuelos nuevos aparecen con otro modelo o "Sin asignar".
- **Acción**: no hay que hacer nada en el panel; el dron se identifica por su
  nombre en DJI. Al registrar manual, elegí el modelo en "Dron usado".
- **Escalar**: al admin solo si el modelo aparece mal.

## 2. Se agrega una finca nueva
- **Acción (admin)**: creá la parcela ([07](manual-operador/07-admin.md)) con su
  Cliente y Hacienda; o importá el archivo SIG.
- **Escalar**: nada, lo hacés vos.

## 3. DJI cambió / el scraper dejó de funcionar
- **Síntoma**: no aparecen vuelos nuevos; el panel "Salud del pipeline" (admin)
  marca error o "desactualizado".
- **Acción**: avisá al administrador. Es un problema técnico del scraping.
- **Escalar**: al admin (dev).

## 4. Agregar un producto fitosanitario nuevo
- **Acción**: al registrar la fumigación, escribí el nombre del producto en el
  campo; se agrega al catálogo automáticamente.
- **Escalar**: nada.

## 5. Dar de baja un operador
- **Acción (admin)**: se hace desde el sistema de usuarios (no en el panel).
- **Escalar**: al admin (dev).

## 6. Los reportes se ponen lentos
- **Síntoma**: las páginas tardan cada vez más.
- **Acción**: acotá siempre el rango de fechas; no pidas "todo".
- **Escalar**: al admin si persiste.
