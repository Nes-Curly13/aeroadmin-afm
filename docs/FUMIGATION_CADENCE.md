# Investigación de cadencia de fumigación

> Documento de referencia. Define los defaults que el importer usa para
> `dji_fumigation_schedule` y la lógica de `next_due_date`. Las fuentes son
> authoritative; los valores aplicados son **conservadores** (más
> fumigaciones = más seguro biológicamente, ajustar si el cliente confirma
> cadencias distintas).

## Resumen ejecutivo

| Cultivo / tipo | Cadencia aplicada | Rango reportado en fuentes |
|---|---|---|
| Caña de azúcar — fase vegetativa (insecticida / MIPE) | **14 días** | 14–21 días (Cenicaña, ICA) |
| Caña de azúcar — fase establecimiento (herbicida) | **45 días** | 30–60 días (DJI, Cenicaña) |
| Caña de azúcar — madurante (glyphosate) | **una vez por ciclo, 35 días pre-cosecha** | 30–50 días (DJI case study) |
| Orchards (frutales) — fungicida / insecticida | **10 días** | 7–14 días (general IPM) |
| Default genérico (safety) | **14 días** | promedio operativo para Valle del Cauca |

> ⚠️ Estos son **defaults conservadores**. Una vez el cliente confirme
> sus cadencias reales por tipo de cultivo, se actualizan via
> `PATCH /api/fumigation-schedule/[parcelId]` o el script
> `scripts/seed-cadences.js`.

---

## Plagas y enfermedades principales

### Caña de azúcar (Saccharum officinarum) — Valle del Cauca

1. **Diatraea saccharalis / D. indigenella** (barrenador del tallo)
   - **#1 plaga de la caña en Colombia** (Cenicaña, ICA, Agrosavia)
   - Daño: larvae perforan el tallo, rompen los haces vasculares,
     reducen peso y contenido de sacarosa. Puede matar la planta si
     el ataque es severo.
   - Control integrado (MIPE): combinación de control biológico
     (liberación de parasitoides *Trichogramma exiguum* cada 7-10 días
     durante 2-3 meses) + control químico cuando la infestación
     supera el 30% de hojas atacadas.
   - Cadencia de fumigación química: **14–21 días** durante fase
     vegetativa (mes 3 al 9 del cultivo).

2. **Mahanarva fimbriolata** (cigarrinha de las raíces / salivazo)
   - Aumenta con cosecha mecanizada sin despalille (favorece
     humedad y cobertura vegetal).
   - Control químico: aplicaciones cada **21–30 días** durante la
     temporada de lluvias.

3. **Barrenador menor del tallo, roya café, mancha parda, Pokkah
   boeng** — controles preventivos según presencia.

### Orchards (frutales en general)

- **Antracnosis, mildiú, oídio, monilia, etc.** — patógenos fungosos que
  requieren frecuencia alta.
- Cadencia típica: **7–14 días** (preventivo) hasta **3–5 días** (curativo).

---

## Fuentes

### DJI Agriculture — Sugarcane Farming with DJI Agriculture Drone Solutions (oficial, 2024)
URL: https://ag.dji.com/case-studies/sugarcane-dji-agriculture-solution
Cita textual: "Sugarcane cultivation today faces several challenges.
Traditional methods often involve high costs, inefficient use of
chemicals like pesticides or ripeners, and safety risks for workers."

Aplicación de madurante (ripener) — parámetros DJI:
- Tasa: 30 L/ha
- Velocidad: 5.5–8 m/s
- Route spacing: 7–8 m
- Altura: 3–4 m

Aplicación de herbicida — parámetros DJI:
- Tasa: 30 L/ha, droplet 300–450 µm, velocidad 6 m/s
- Route spacing: 6.5–7 m
- "Herbicide has a high requirement of uniformity and anti-drift, so
  lower flight speed, lower route spacing and bigger droplet size are used."

Aplicación de insecticida/aphid/thrip — parámetros DJI:
- Tasa: 30 L/ha, droplet 200–350 µm, velocidad 5.5–8 m/s

Monitoreo NDVI post-aplicación:
- "Results were observed 16 and 37 days after spraying."

### Cenicaña — Manejo integrado de plagas de la caña de azúcar (2023)
URL: https://www.cenicana.org/wp-content/uploads/2023/12/CA-PAG-Manejo-integrado-integrado-de-plagas-12-12-2023.pdf
Cita: capítulo sobre barrenadores del tallo y sus parasitoides, liberación
de *Trichogramma* en programas de control biológico.

### ICA — Manejo fitosanitario del cultivo de la caña panelera
URL: https://www.ica.gov.co/getattachment/6a54658e-1723-488d-a7ab-2f4baad793cb/Manejo-fitosanitario-del-cultivo-de-la-cana-panele.pdf

### CINCAE — Guía para el reconocimiento y manejo de insectos plagas y roedores
URL: https://cincae.org/wp-content/uploads/2021/08/GUIA-DE-INSECTOS-PLAGAS-DE-LA-CANA-DE-AZUCAR.pdf
Cita textual: "La mayor incidencia de esta plaga ocurre en siembras tardías
(próximo a la época lluviosa), caña planta y cuando no se ha hecho un
buen control de las malezas."

### Agrosavia — Manejo integrado de las plagas de la caña de azúcar
URL: https://repository.agrosavia.co/bitstreams/7cfcdc58-8cfa-4826-afe6-48b6bb0bac2d/download
Cita: "Bajo condiciones de alta infestación (i.e. mas del 30% de las
hojas atacadas, durante 2 o más meses sin control), la producción de
azúcar medida a la cosecha en [disminuye]."

### SASRI / Agrihawk (Sudáfrica) — NDVI ripener spraying trial
Citado en el case study de DJI:
- "DJI agricultural drone provided more efficient and uniform coverage
  than the fixed-wing aircraft"
- 15 smallholder farmers, 11 locations, 0.21–1.78 t/ha yield increase

### South African context (Van Heerden et al. 2015; 2019; 2021)
Citado por DJI: extensive trials showing economic benefits of chemical
ripening with DJI drones.

---

## Defaults aplicados (con justificación)

```js
// scripts/seed-cadences.js (extracto)
const DEFAULTS = {
  Caña: { crop_type: "Caña de azúcar", recommended_cadence_days: 14 },
  Orchard: { crop_type: "Frutales", recommended_cadence_days: 10 }
};
```

### Justificación de los valores

**Caña = 14 días** (vs 14-21 reportado):
- Extremo conservador: si el cliente cree que es cada 21, podemos
  aflojar; si cree que es cada 7, el sistema le avisa antes.
- Cenicaña recomienda MIPE con *Trichogramma* cada 7-10 días + químico
  cada 14-21 días. Usamos 14 como cadencia de fumigación química.
- Compatible con la rotación operativa de un piloto de dron: permite
  cubrir todas las parcelas en 1-2 semanas con 1 dron.

**Orchard = 10 días** (vs 7-14 reportado):
- Hongos en Colombia (antracnosis, monilia) necesitan alta frecuencia
  en temporada de lluvias.
- 10 días es compatible con cadencias semanales bisagra.

### Reglas de cálculo (lib/fumigation-cadence.ts)

```ts
export function computeNextDueDate(
  lastFumigation: Date | null,
  cadenceDays: number
): Date | null {
  if (!lastFumigation) return null;
  const next = new Date(lastFumigation);
  next.setDate(next.getDate() + cadenceDays);
  return next;
}

export function getFumigationStatus(
  lastFumigation: Date | null,
  cadenceDays: number,
  now: Date = new Date()
): "no_history" | "ok" | "due_soon" | "overdue" {
  if (!lastFumigation) return "no_history";
  const next = computeNextDueDate(lastFumigation, cadenceDays);
  if (!next) return "no_history";
  const diffDays = Math.floor((now.getTime() - next.getTime()) / 86_400_000);
  if (diffDays >= 7) return "overdue";      // 1+ semana vencida
  if (diffDays >= 0) return "due_soon";     // vence hoy o esta semana
  return "ok";
}
```

---

## Lo que NO sabemos (gaps)

1. **Cultivos específicos del cliente** — los `dji_field_catalog` solo
   dicen "Farmland" / "Orchards". No sabemos si todas las farmlands
   son caña o hay otro cultivo. Necesitamos input del cliente:
   - ¿Todas las Farmland son caña de azúcar?
   - ¿Las Orchards son citrícos, mango, aguacate?

2. **Temporada vs año redondo** — el Valle del Cauca tiene temporada
   seca (junio-sept) y húmeda (octubre-mayo). Las cadencias pueden
   variar por época. Por ahora asumimos cadencia constante.

3. **Productos específicos** — DJI no expone en el JSON qué producto
   se usó. Solo tenemos `droplet_size`. La tabla `dji_fumigations`
   deja un campo `products_used` libre para que el operador lo llene
   al registrar manualmente.

4. **Diatrea vs salivazo vs hongos** — necesitaríamos saber la plaga
   objetivo para refinar la cadencia. Por ahora usamos un promedio.

5. **Datos históricos de fumigaciones del cliente** — DJI no expone
   histórico por parcela. Solo tenemos el PLAN actual por parcela
   (parameter.json) y los rollups DIARIOS agregados (daily_summaries).
   Por eso `dji_fumigations` está diseñada para entrada MANUAL del
   operador y no para auto-poblar.

---

## Roadmap de refinamiento

Cuando el cliente confirme:
1. Cultivo real por parcela (no solo "Farmland")
2. Plagas objetivo por parcela
3. Cadencias operativas reales
4. Productos comerciales usados

Actualizar el `seed-cadences.js` con sus valores y re-ejecutar.
