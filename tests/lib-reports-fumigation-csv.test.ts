// tests/lib-reports-fumigation-csv.test.ts
//
// Test unitario del CSV serializer `buildFumigationCsv`
// (feature/fumigacion-detail-v2 / sub-4).
//
// Cubre:
//   - BOM al inicio (Excel UTF-8 detection)
//   - 5 secciones: Cabecera, Parcela, Aplicación, Compliance, Vuelos
//   - Separador `;` + decimales con coma (es-CO)
//   - Quoting RFC 4180 cuando hay `;` o `"` o `\n`
//   - Sección Vuelos condicional (aparece si flights.length > 0)
//   - "Sin clasificar" cuando category es null
//   - Maneja nulls como string vacío
//   - Filas sin header (fila vacía entre secciones)

import { describe, expect, it } from "vitest";

import { buildFumigationCsv } from "@/lib/reports/fumigation-csv";
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

describe("buildFumigationCsv", () => {
  it("empieza con BOM U+FEFF para Excel UTF-8", () => {
    const csv = buildFumigationCsv(makeFixture());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa separador ';' entre columnas", () => {
    const csv = buildFumigationCsv(makeFixture());
    // La primera fila de Cabecera tiene "Sección;Cabecera"
    const sectionRow = csv
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, ""))
      .find((l) => l.startsWith("Sección;"));
    expect(sectionRow).toBeDefined();
    expect(sectionRow).toBe("Sección;Cabecera");
  });

  it("incluye las secciones esperadas en orden", () => {
    const csv = buildFumigationCsv(makeFixture());
    const sections = csv
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, ""))
      .filter((l) => l.startsWith("Sección;"));
    // 6 secciones: Cabecera, Parcela, Aplicación, Compliance,
    // Vuelos asociados, Notas operativas. (Con flights.length === 0,
    // la sección Vuelos dice "Vuelos asociados" sin la cuenta. La
    // sección "Metadata técnica" solo aparece si hay notes técnicas
    // distintas a human_notes.)
    expect(sections).toEqual([
      "Sección;Cabecera",
      "Sección;Parcela",
      "Sección;Aplicación",
      "Sección;Compliance",
      "Sección;Vuelos asociados",
      "Sección;Notas operativas"
    ]);
  });

  it("la sección Vuelos muestra '(sin vuelos asociados)' cuando flights está vacío", () => {
    const csv = buildFumigationCsv(makeFixture({ flights: [] }));
    // La fila justo después del header de Vuelos debe indicar "sin vuelos"
    expect(csv).toMatch(/\(sin vuelos asociados\)/);
  });

  it("la sección Vuelos muestra la cuenta y la tabla cuando hay flights", () => {
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
      },
      {
        flight_id: 101,
        start_at: "2026-08-13T14:30:00.000Z",
        pilot_name: "Juan Pérez",
        drone_nickname: "Drone-01",
        area_m2: 7345,
        spray_usage_ml: 18_000,
        duration_min: 30.0,
        lng: -76.5,
        lat: 3.4
      }
    ];
    const csv = buildFumigationCsv(makeFixture({ flights }));
    // Header de la sección con la cuenta
    expect(csv).toMatch(/Sección;Vuelos asociados \(2\)/);
    // Header de la tabla
    expect(csv).toMatch(/Flight ID;Inicio;Piloto;Dron;Área \(m²\);Duración \(min\);Volumen \(L\)/);
    // Filas de vuelos (flight_id, fecha, piloto, dron, area, duracion, volumen)
    // de-DE: 5000 → "5.000,00", 12500 mL → 12,50 L
    expect(csv).toMatch(/100;2026-08-13T14:00:00\.000Z;Juan Pérez;Drone-01;5\.000,00;22,5;12,50/);
    expect(csv).toMatch(/101;2026-08-13T14:30:00\.000Z;Juan Pérez;Drone-01;7\.345,00;30,0;18,00/);
  });

  it("renderiza 'Sin clasificar' cuando category es null", () => {
    const csv = buildFumigationCsv(makeFixture({ category: null }));
    expect(csv).toMatch(/Tipo \(categoría\);Sin clasificar/);
  });

  it("renderiza el nombre y label correctos cuando category tiene datos", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        category: {
          id: 3,
          slug: "fungicida",
          label: "Fungicida",
          color: "purple"
        }
      })
    );
    expect(csv).toMatch(/Tipo \(categoría\);Fungicida/);
  });

  it("renderiza el dron con formato 'name (tank_l L)'", () => {
    const csv = buildFumigationCsv(
      makeFixture({ drone: { code: 201, name: "Agras T40", tank_l: 40 } })
    );
    expect(csv).toMatch(/Dron usado;Agras T40 \(40 L\)/);
  });

  it("renderiza 'Sin asignar' cuando drone es null", () => {
    const csv = buildFumigationCsv(makeFixture({ drone: null }));
    expect(csv).toMatch(/Dron usado;Sin asignar/);
  });

  it("renderiza decimales con coma (es-CO) y miles con punto (de-DE)", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({ dose_l_per_ha: 2.5, area_fumigated_m2: 12_345 })
      })
    );
    // 2.5 → "2,50"
    expect(csv).toMatch(/Dosis \(L\/ha\);2,50/);
    // 12345 → "12.345,00" (de-DE: . para miles, , para decimales)
    expect(csv).toMatch(/Área fumigada \(m²\);12\.345,00/);
  });

  it("renderiza nulls como string vacío (no 'null' ni 'undefined')", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          product_used: null,
          dose_l_per_ha: null,
          area_fumigated_m2: null,
          duration_minutes: null,
          product_registered_ica: null,
          pilot_license: null
        })
      })
    );
    // Todos los nulls deben renderizarse como celdas vacías
    // (dos puntos y coma consecutivos).
    const lines = csv
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, ""));
    const complianceSection = lines.find((l) => l.startsWith("Sección;Compliance"));
    expect(complianceSection).toBe("Sección;Compliance");
    const icaLine = lines.find((l) => l.startsWith("Registro ICA del producto"));
    const licenseLine = lines.find((l) => l.startsWith("Licencia del piloto"));
    expect(icaLine).toBe("Registro ICA del producto;");
    expect(licenseLine).toBe("Licencia del piloto;");
    // El CSV entero no debe contener "null" ni "undefined" literales.
    expect(csv.toLowerCase()).not.toContain("null");
    expect(csv.toLowerCase()).not.toContain("undefined");
  });

  it("escapa strings con ';' usando quoting RFC 4180", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        parcel: {
          id: 42,
          land_name: "Lote 12; con punto y coma",
          external_id: "ext-abc-001"
        }
      })
    );
    // El land_name con `;` debe estar entre comillas.
    expect(csv).toMatch(/"Lote 12; con punto y coma"/);
  });

  it("escapa strings con '\"' duplicando el quote (RFC 4180)", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          product_used: 'Producto "X" fuerte'
        })
      })
    );
    // El quote interno se duplica, y el value queda entre comillas.
    expect(csv).toMatch(/"Producto ""X"" fuerte"/);
  });

  it("escapa strings con '\\n' usando quoting RFC 4180", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          product_used: "Producto\ncon salto de línea"
        })
      })
    );
    // El newline debe estar DENTRO de un quoted field.
    expect(csv).toMatch(/"Producto\ncon salto de línea"/);
  });

  it("incluye el id de fumigación en la sección Cabecera", () => {
    const csv = buildFumigationCsv(makeFixture());
    expect(csv).toMatch(/ID fumigación;1234/);
    expect(csv).toMatch(/Fecha de fumigación;2026-08-13/);
    expect(csv).toMatch(/Fuente;manual/);
  });

  it("la sección Parcela usa datos de la parcela si está disponible", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        parcel: { id: 99, land_name: "Otro lote", external_id: "ext-zzz-9" }
      })
    );
    expect(csv).toMatch(/Parcela ID;99/);
    expect(csv).toMatch(/Nombre del lote;Otro lote/);
    expect(csv).toMatch(/External ID;ext-zzz-9/);
  });

  it("la sección Parcela cae a parcel_id del fumigation si parcel es null", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        parcel: null,
        fumigation: makeFumigation({ parcel_id: 777 })
      })
    );
    expect(csv).toMatch(/Parcela ID;777/);
  });

  it("sección Notas operativas incluye human_notes cuando existe", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          human_notes: "Lluvia matinal, se fumigó con viento sur"
        })
      })
    );
    expect(csv).toMatch(/Sección;Notas operativas/);
    expect(csv).toMatch(/Lluvia matinal, se fumigó con viento sur/);
  });

  it("sección Metadata técnica aparece si notes != human_notes (backfill técnico)", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          notes: "importado de dji scraper v2 - batch 2026-08-10",
          human_notes: "Nota del operador"
        })
      })
    );
    expect(csv).toMatch(/Sección;Metadata técnica \(import\)/);
    expect(csv).toMatch(/importado de dji scraper v2 - batch 2026-08-10/);
  });

  it("no incluye sección Metadata técnica si notes === human_notes", () => {
    const csv = buildFumigationCsv(
      makeFixture({
        fumigation: makeFumigation({
          notes: "mismo valor",
          human_notes: "mismo valor"
        })
      })
    );
    expect(csv).not.toMatch(/Sección;Metadata técnica/);
  });

  it("calcula Volumen en L dividiendo spray_usage_ml por 1000 (mL → L)", () => {
    const flights: FumigationFlightRow[] = [
      {
        flight_id: 100,
        start_at: "2026-08-13T14:00:00.000Z",
        pilot_name: null,
        drone_nickname: null,
        area_m2: 5000,
        spray_usage_ml: 25_000, // 25 L
        duration_min: 22.5,
        lng: null,
        lat: null
      }
    ];
    const csv = buildFumigationCsv(makeFixture({ flights }));
    // 25000 mL / 1000 = 25 L → "25,00" (de-DE con 2 decimales)
    expect(csv).toMatch(/100;2026-08-13T14:00:00\.000Z;;;5\.000,00;22,5;25,00/);
  });

  it("renderiza Volumen en L como vacío si spray_usage_ml es null", () => {
    const flights: FumigationFlightRow[] = [
      {
        flight_id: 100,
        start_at: "2026-08-13T14:00:00.000Z",
        pilot_name: null,
        drone_nickname: null,
        area_m2: 5000,
        spray_usage_ml: null,
        duration_min: 22.5,
        lng: null,
        lat: null
      }
    ];
    const csv = buildFumigationCsv(makeFixture({ flights }));
    // Última columna vacía (spray_usage_ml es null). El "\n" final
    // cierra la fila, no es parte de la celda.
    expect(csv).toMatch(/100;2026-08-13T14:00:00\.000Z;;;5\.000,00;22,5;\n/);
  });

  it("incluye filas vacías (separadores) entre secciones", () => {
    const csv = buildFumigationCsv(makeFixture());
    const lines = csv.split("\n").map((l) => l.replace(/^\uFEFF/, ""));
    const sectionIndices = lines
      .map((l, i) => (l.startsWith("Sección;") ? i : -1))
      .filter((i) => i >= 0);
    // Cada sección (menos la última) está precedida por una línea
    // vacía. La línea justo ANTES del header de la próxima sección
    // debe ser "".
    for (let i = 0; i < sectionIndices.length - 1; i++) {
      const next = sectionIndices[i + 1];
      // La línea inmediatamente anterior al header de la próxima sección.
      const beforeNext = lines[next - 1];
      expect(beforeNext).toBe("");
    }
  });
});
