// tests/lib-reports-fumigation-pdf-template.test.ts
//
// Test unitario del template HTML del PDF de fumigación
// `buildFumigationPdfHtml` (feature/fumigacion-detail-v2 / sub-4).
//
// Cubre:
//   - HTML self-contained con <!doctype html> y <html lang="es">
//   - Incluye el id de fumigación en el h1
//   - Escape de HTML en user inputs (land_name con <script>)
//   - Badge con color por source (manual/djiscraper/import)
//   - Tabla de vuelos si hay flights; "es normal" si es manual sin flights
//   - Footer con timestamp ISO
//   - Sección Compliance muestra "—" si no hay ICA/license
//   - Muestra nulls como "—" (no "null" ni "undefined")
//   - Formato de fecha legible y números en ha (m² → ha / 10000)

import { describe, expect, it } from "vitest";

import { buildFumigationPdfHtml } from "@/lib/reports/fumigation-pdf-template";
import type { FumigationReportData } from "@/lib/reports/fumigation-csv";
import type { DjiFumigationEvent } from "@/lib/types";
import type { FumigationFlightRow } from "@/api/repositories";

function makeFumigation(overrides: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 1234,
    parcel_id: 42,
    fumigation_date: "2026-08-13",
    product_used: "Glifosato 48%",
    // Sprint S9 — FK opcional al catálogo products.
    product_id: null,
    dose_l_per_ha: 2.5,
    area_fumigated_m2: 12_345,
    drone_code_used: 201,
    duration_minutes: 45,
    notes: null,
    human_notes: "Lluvia matinal, se fumigó con viento sur",
    recorded_by: "supervisor@afm.local",
    product_registered_ica: "ICA-1234-PN",
    pilot_license: "PCA-12345",
    recorded_at: "2026-08-13T15:00:00.000Z",
    source: "manual",
    category_id: 1,
    ...overrides
  };
}

function makeFixture(overrides: Partial<FumigationReportData> = {}): FumigationReportData {
  return {
    fumigation: makeFumigation(),
    parcel: {
      id: 42,
      land_name: "Lote 12",
      external_id: "ext-abc-001"
    },
    drone: {
      code: 201,
      name: "Agras T40",
      tank_l: 40
    },
    category: {
      id: 1,
      slug: "herbicida",
      label: "Herbicida",
      color: "amber"
    },
    flights: [],
    ...overrides
  };
}

describe("buildFumigationPdfHtml", () => {
  it("genera un HTML self-contained con <!doctype html> y <html lang=\"es\">", () => {
    const html = buildFumigationPdfHtml(makeFixture());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html lang="es">/);
  });

  it("incluye el id de fumigación en el h1", () => {
    const html = buildFumigationPdfHtml(makeFixture());
    expect(html).toMatch(/<h1>Fumigación #1234<\/h1>/);
  });

  it("incluye charset utf-8 en el <meta>", () => {
    const html = buildFumigationPdfHtml(makeFixture());
    expect(html).toMatch(/<meta charset="utf-8"\s*\/>/);
  });

  it("incluye el land_name de la parcela en el subtítulo del header", () => {
    const html = buildFumigationPdfHtml(
      makeFixture({
        parcel: { id: 42, land_name: "Lote 12", external_id: "ext-abc-001" }
      })
    );
    expect(html).toMatch(/Lote 12/);
  });

  it("cae a 'Parcela #ID' si no hay parcel asociado", () => {
    const html = buildFumigationPdfHtml(
      makeFixture({
        parcel: null,
        fumigation: makeFumigation({ parcel_id: 999 })
      })
    );
    expect(html).toMatch(/Parcela #999/);
  });

  describe("escape de HTML en user inputs", () => {
    it("escapa <script> en land_name (no rompe el HTML)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          parcel: {
            id: 42,
            land_name: "<script>alert('xss')</script>",
            external_id: "ext-abc-001"
          }
        })
    );
    // El <script> debe aparecer escapado, no como tag real.
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    // Y NO debe haber un tag <script> sin escapar dentro del body
    // (fuera del <style>). Verificamos contando tags.
    const scriptTagCount = (html.match(/<script>/g) ?? []).length;
    // El style inline está permitido. Solo nos importa que el valor
    // malicioso no genere un tag ejecutable.
    expect(html).not.toMatch(/<script>alert\('xss'\)<\/script>/);
    // El &lt;script&gt; sí cuenta como 0 <script> reales adicionales.
    // (Los matches de `<script>` arriba serían los del usuario.)
    void scriptTagCount;
  });

  it("escapa comillas dobles en user input (atributo HTML seguro)", () => {
    const html = buildFumigationPdfHtml(
      makeFixture({
        fumigation: makeFumigation({
          product_used: 'Producto "X" fuerte'
        })
      })
    );
    expect(html).toContain("Producto &quot;X&quot; fuerte");
  });

  it("escapa & en user input", () => {
    const html = buildFumigationPdfHtml(
      makeFixture({
        fumigation: makeFumigation({
          product_used: "Tom & Jerry"
        })
      })
    );
    expect(html).toContain("Tom &amp; Jerry");
  });
  });

  describe("badge de source", () => {
    it("muestra 'Manual' con color verde-azulado (#16847e) cuando source=manual", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({ fumigation: makeFumigation({ source: "manual" }) })
      );
      expect(html).toMatch(/<span class="badge"[^>]*>Manual<\/span>/);
      expect(html).toMatch(/#16847e/);
    });

    it("muestra 'DJI (scrape)' con color verde (#3f8f5d) cuando source=djiscraper", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({ fumigation: makeFumigation({ source: "djiscraper" }) })
      );
      expect(html).toMatch(/<span class="badge"[^>]*>DJI \(scrape\)<\/span>/);
      expect(html).toMatch(/#3f8f5d/);
    });

    it("muestra 'Import GIS' con color mostaza (#a37200) cuando source=import", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({ fumigation: makeFumigation({ source: "import" }) })
      );
      expect(html).toMatch(/<span class="badge"[^>]*>Import GIS<\/span>/);
      expect(html).toMatch(/#a37200/);
    });
  });

  describe("sección Aplicación", () => {
    it("muestra el nombre del producto y la dosis en L/ha", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            product_used: "Glifosato 48%",
            dose_l_per_ha: 2.5
          })
        })
      );
      expect(html).toMatch(/Glifosato 48%/);
      expect(html).toMatch(/2,50 L\/ha/);
    });

    it("convierte area_fumigated_m2 a hectáreas (/10000)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ area_fumigated_m2: 12_345 })
        })
      );
      // 12345 / 10000 = 1.2345 ha → "1,23 ha"
      expect(html).toMatch(/1,23 ha/);
    });

    it("muestra '—' cuando dose_l_per_ha es null", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ dose_l_per_ha: null })
        })
      );
      // El campo Dosis debe mostrar el em-dash.
      expect(html).toMatch(/<dt>Dosis<\/dt><dd>—<\/dd>/);
    });

    it("muestra '—' cuando area_fumigated_m2 es null", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ area_fumigated_m2: null })
        })
      );
      expect(html).toMatch(/<dt>Área fumigada<\/dt><dd>—<\/dd>/);
    });

    it("muestra '—' cuando duration_minutes es null", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ duration_minutes: null })
        })
      );
      expect(html).toMatch(/<dt>Duración<\/dt><dd>—<\/dd>/);
    });

    it("muestra el dron con formato 'name (tank_l L)'", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({ drone: { code: 201, name: "Agras T40", tank_l: 40 } })
      );
      expect(html).toMatch(/Agras T40 \(40 L\)/);
    });

    it("muestra 'Sin asignar' cuando drone es null", () => {
      const html = buildFumigationPdfHtml(makeFixture({ drone: null }));
      expect(html).toMatch(/<dt>Dron<\/dt><dd>Sin asignar<\/dd>/);
    });

    it("muestra el operador (recorded_by)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ recorded_by: "supervisor@afm.local" })
        })
      );
      expect(html).toMatch(/<dt>Operador<\/dt><dd>supervisor@afm\.local<\/dd>/);
    });
  });

  describe("sección Compliance", () => {
    it("muestra el ICA y la licencia del piloto cuando existen", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            product_registered_ica: "ICA-1234-PN",
            pilot_license: "PCA-12345"
          })
        })
      );
      expect(html).toMatch(/ICA-1234-PN/);
      expect(html).toMatch(/PCA-12345/);
    });

    it("muestra '—' cuando no hay ICA ni licencia", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            product_registered_ica: null,
            pilot_license: null
          })
        })
      );
      // Tanto ICA como licencia caen a "—"
      const icaPattern = /<dt>Registro ICA del producto<\/dt><dd>—<\/dd>/;
      const licensePattern = /<dt>Licencia del piloto \(Aerocivil\)<\/dt><dd>—<\/dd>/;
      expect(html).toMatch(icaPattern);
      expect(html).toMatch(licensePattern);
    });

    it("muestra string vacío del ICA como '—' (cadena vacía → em-dash)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            product_registered_ica: "",
            pilot_license: ""
          })
        })
      );
      // El template usa `escapeHtml(value) || "—"` → string vacío cae a "—"
      const icaPattern = /<dt>Registro ICA del producto<\/dt><dd>—<\/dd>/;
      const licensePattern = /<dt>Licencia del piloto \(Aerocivil\)<\/dt><dd>—<\/dd>/;
      expect(html).toMatch(icaPattern);
      expect(html).toMatch(licensePattern);
    });
  });

  describe("sección Parcela", () => {
    it("muestra el id, land_name y external_id cuando parcel existe", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          parcel: {
            id: 42,
            land_name: "Lote 12",
            external_id: "ext-abc-001"
          }
        })
      );
      expect(html).toMatch(/<dt>ID de parcela<\/dt><dd>#42<\/dd>/);
      expect(html).toMatch(/<dt>Nombre del lote<\/dt><dd>Lote 12<\/dd>/);
      expect(html).toMatch(/<dt>External ID<\/dt><dd>ext-abc-001<\/dd>/);
    });

    it("muestra '—' si land_name o external_id son null", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          parcel: {
            id: 42,
            land_name: null,
            external_id: "ext-abc-001"
          }
        })
      );
      expect(html).toMatch(/<dt>Nombre del lote<\/dt><dd>—<\/dd>/);
      // External ID tiene valor → no debe ser "—"
      expect(html).toMatch(/<dt>External ID<\/dt><dd>ext-abc-001<\/dd>/);
    });
  });

  describe("sección Vuelos", () => {
    it("muestra la tabla de vuelos cuando hay flights", () => {
      const flights: FumigationFlightRow[] = [
        {
          flight_id: 100,
          start_at: "2026-08-13T14:00:00.000Z",
          pilot_name: "Juan Pérez",
          drone_nickname: "Drone-01",
          area_m2: 5000,
          spray_usage_ml: 12_500,
          duration_min: 22.5,
          lng: -76.5,
          lat: 3.4
        }
      ];
      const html = buildFumigationPdfHtml(makeFixture({ flights }));
      expect(html).toMatch(/<h2>Vuelos asociados \(1\)<\/h2>/);
      expect(html).toMatch(/<table>/);
      expect(html).toMatch(/<th>Flight ID<\/th>/);
      expect(html).toMatch(/<th class="num">Área \(ha\)<\/th>/);
      expect(html).toMatch(/#100/);
      expect(html).toMatch(/Juan Pérez/);
      expect(html).toMatch(/Drone-01/);
    });

    it("convierte area_m2 a ha (/10000) en la tabla", () => {
      const flights: FumigationFlightRow[] = [
        {
          flight_id: 100,
          start_at: "2026-08-13T14:00:00.000Z",
          pilot_name: null,
          drone_nickname: null,
          area_m2: 50_000, // 5.00 ha
          spray_usage_ml: 10_000, // 10.00 L
          duration_min: 30,
          lng: null,
          lat: null
        }
      ];
      const html = buildFumigationPdfHtml(makeFixture({ flights }));
      // 50000 m² / 10000 = 5.00 ha
      expect(html).toMatch(/<td class="num">5,00<\/td>/);
      // 10000 mL / 1000 = 10.00 L
      expect(html).toMatch(/<td class="num">10,00<\/td>/);
    });

    it("muestra mensaje 'Fumigación manual — sin vuelos asociados (es normal)' cuando source=manual y no hay flights", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          flights: [],
          fumigation: makeFumigation({ source: "manual" })
        })
      );
      expect(html).toMatch(/<h2>Vuelos asociados<\/h2>/);
      expect(html).toMatch(/Fumigación manual — sin vuelos asociados \(es normal\)/);
    });

    it("muestra mensaje 'No hay vuelos asociados' cuando source!=manual y no hay flights", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          flights: [],
          fumigation: makeFumigation({ source: "djiscraper" })
        })
      );
      expect(html).toMatch(/No hay vuelos asociados en dji_flights/);
    });

    it("muestra '—' en celdas de la tabla cuando pilot_name / drone_nickname son null", () => {
      const flights: FumigationFlightRow[] = [
        {
          flight_id: 100,
          start_at: "2026-08-13T14:00:00.000Z",
          pilot_name: null,
          drone_nickname: null,
          area_m2: 5000,
          spray_usage_ml: null,
          duration_min: null,
          lng: null,
          lat: null
        }
      ];
      const html = buildFumigationPdfHtml(makeFixture({ flights }));
      // piloto y dron null → "—"
      const cells = html.match(/<td>—<\/td>/g) ?? [];
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sección Notas operativas", () => {
    it("muestra human_notes dentro de un .notes block cuando existe", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            human_notes: "Lluvia matinal, se fumigó con viento sur"
          })
        })
      );
      expect(html).toMatch(/<h2>Notas operativas<\/h2>/);
      expect(html).toMatch(/<div class="notes">Lluvia matinal[^<]*<\/div>/);
    });

    it("preserva saltos de línea en human_notes (white-space: pre-wrap)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({
            human_notes: "Línea 1\nLínea 2"
          })
        })
      );
      // El CSS tiene white-space: pre-wrap y escapeHtml no elimina \n.
      expect(html).toContain("Línea 1\nLínea 2");
    });

    it("muestra 'Sin notas del operador' cuando human_notes es null", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          fumigation: makeFumigation({ human_notes: null })
        })
      );
      expect(html).toMatch(/<p class="empty">Sin notas del operador\.<\/p>/);
    });
  });

  describe("footer con timestamp ISO", () => {
    it("incluye un footer con timestamp generado al momento de la llamada", () => {
      const before = Date.now();
      const html = buildFumigationPdfHtml(makeFixture());
      const after = Date.now();
      // El footer usa `new Date().toISOString()`. Extraemos el primer
      // ISO timestamp (YYYY-MM-DDTHH:MM:SS.sssZ) y validamos que esté
      // entre `before` y `after`.
      const match = html.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      expect(match).not.toBeNull();
      const ts = match![1];
      const ms = new Date(ts).getTime();
      expect(ms).toBeGreaterThanOrEqual(before);
      expect(ms).toBeLessThanOrEqual(after);
    });

    it("el footer menciona 'AFM Geovisor'", () => {
      const html = buildFumigationPdfHtml(makeFixture());
      expect(html).toMatch(/AFM Geovisor/);
    });

    it("el footer menciona el source label ('Manual', 'DJI (scrape)', etc.)", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({ fumigation: makeFumigation({ source: "manual" }) })
      );
      expect(html).toMatch(/Fuente: Manual/);
    });
  });

  describe("categoría curada", () => {
    it("muestra el label de la categoría si existe", () => {
      const html = buildFumigationPdfHtml(
        makeFixture({
          category: {
            id: 3,
            slug: "fungicida",
            label: "Fungicida",
            color: "purple"
          }
        })
      );
      expect(html).toMatch(/<strong>Tipo:<\/strong> Fungicida/);
    });

    it("no muestra la línea de categoría si category es null", () => {
      const html = buildFumigationPdfHtml(makeFixture({ category: null }));
      expect(html).not.toMatch(/<strong>Tipo:<\/strong>/);
    });
  });

  it("el HTML final NO contiene literales 'null' ni 'undefined' en celdas visibles", () => {
    // Construimos un fixture con TODOS los nulls posibles.
    const html = buildFumigationPdfHtml(
      makeFixture({
        fumigation: makeFumigation({
          product_used: null,
          dose_l_per_ha: null,
          area_fumigated_m2: null,
          duration_minutes: null,
          product_registered_ica: null,
          pilot_license: null,
          human_notes: null,
          notes: null,
          category_id: null
        }),
        drone: null,
        category: null,
        parcel: {
          id: 42,
          land_name: null,
          external_id: "ext-abc-001"
        },
        flights: []
      })
    );
    expect(html.toLowerCase()).not.toContain("null");
    expect(html.toLowerCase()).not.toContain("undefined");
  });

  it("incluye el style block para print (color-adjust: exact)", () => {
    const html = buildFumigationPdfHtml(makeFixture());
    // print-color-adjust es crítico para que los badges vean su color
    // en el PDF impreso.
    expect(html).toMatch(/print-color-adjust:\s*exact/);
    expect(html).toMatch(/-webkit-print-color-adjust:\s*exact/);
  });
});
