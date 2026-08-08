// tests/lib-reports-parcel-csv.test.ts
//
// Test unitario de `buildParcelReportCsv` (feature/reports-level-1).
//
// Cubre:
//   - **BOM al inicio** (Excel UTF-8 detection).
//   - **Separador `;`** (Excel-CO, no rompe decimales).
//   - **4 secciones delimitadas** por filas "Sección;..." (Cabecera,
//     Parcela, Fumigaciones, Totales).
//   - **Tabla de fumigaciones**: una fila por evento, columnas
//     correctas, formato es-CO (coma decimal).
//   - **Totales**: cuenta, área, litros, promedio, cobertura.
//   - **Nulls**: campos null/undefined se renderizan como "" (no
//     "null" o "undefined").
//   - **Quoting RFC 4180**: strings con `;` o `\n` se escapan.
//   - **Status de cadencia** se mapea a label humano (Al día, etc.).
//   - **Ventana** (from/to) se incluye en Cabecera.

import { describe, expect, it } from "vitest";

import { buildParcelReportCsv } from "@/lib/reports/parcel-csv";
import type { ParcelReportData } from "@/lib/reports/fetch-parcel-report-data";

function makeFixture(): ParcelReportData {
  return {
    operatorName: "Operador de Prueba",
    operatorRegion: "Valle del Cauca, Colombia",
    generatedAt: "2026-08-08 15:00",
    parcel: {
      id: 42,
      external_id: "ext-abc-001",
      land_name: "Lote 12; con punto y coma",
      field_type: "Farmland",
      declared_area_ha: 30.5,
      spray_area_m2: 300_000,
      crop_type: "Caña de azúcar",
      planting_date: "2025-03-15",
      owner_name: "Don; Eulogio",
      supervisor_notes: "Notas\ncon salto de línea"
    },
    cadence: {
      recommended_cadence_days: 14,
      last_fumigation_date: "2026-08-05",
      next_due_date: "2026-08-19",
      status: "due_soon"
    },
    window: { from: "2026-07-09", to: "2026-08-08" },
    events: [
      {
        id: 1001,
        fumigation_date: "2026-08-05",
        product_used: "Glifosato 48%",
        dose_l_per_ha: 2.5,
        area_fumigated_ha: 12.345,
        duration_minutes: 45,
        drone_nickname: "Drone-01",
        pilot_name: "Juan Pérez",
        recorded_by: null,
        notes: null
      },
      {
        id: 1002,
        fumigation_date: "2026-07-20",
        product_used: null,
        dose_l_per_ha: null,
        area_fumigated_ha: null,
        duration_minutes: null,
        drone_nickname: null,
        pilot_name: null,
        recorded_by: "Operador X",
        notes: "Sin datos del DJI"
      }
    ],
    totals: {
      count: 2,
      totalAreaHa: 12.345,
      totalLiters: 30.8625,
      averageAreaHa: 6.1725,
      lastFumigationDate: "2026-08-05",
      capReached: false
    },
    coverage: {
      areaFumigableHa: 30,
      areaFumigadaHa: 12.345,
      coveragePct: 41.2
    },
    location: null
  };
}

describe("buildParcelReportCsv", () => {
  it("empieza con BOM U+FEFF para Excel UTF-8", () => {
    const csv = buildParcelReportCsv(makeFixture());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa separador ';' (no ',')", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // La primera línea de Fumigaciones tiene el header CSV — verificamos
    // que use `;` entre columnas y NO tenga coma en el separador.
    const headerLine = csv
      .split("\n")
      .find((l) => l.includes("Fecha") && l.includes("Dron"));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain(";");
    // El header de eventos: "Fecha;Dron;Piloto/Registrador;..."
    expect(headerLine).toBe(
      "Fecha;Dron;Piloto/Registrador;Área fumigada (ha);Duración (min);Volumen (L);Producto;Notas"
    );
  });

  it("incluye 4 secciones delimitadas por filas 'Sección'", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // El BOM al inicio del file está pegado a la primera línea. Lo
    // removemos de cada línea antes de filtrar para que las
    // comparaciones no se contaminen con el carácter invisible.
    const sections = csv
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, ""))
      .filter((l) => l.includes("Sección;"));
    expect(sections).toEqual([
      "Sección;Cabecera",
      "Sección;Parcela",
      "Sección;Fumigaciones (2)",
      "Sección;Totales"
    ]);
  });

  it("incluye la ventana en la sección Cabecera", () => {
    const csv = buildParcelReportCsv(makeFixture());
    expect(csv).toMatch(/Ventana desde;2026-07-09/);
    expect(csv).toMatch(/Ventana hasta;2026-08-08/);
    expect(csv).toMatch(/Operador;Operador de Prueba/);
  });

  it("mapea el status de cadencia a label humano", () => {
    const csv = buildParcelReportCsv(makeFixture());
    expect(csv).toMatch(/Estado de cadencia;Por vencer/);
  });

  it("renderiza las fumigaciones con decimales en formato es-CO (coma)", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // 12.345 ha → "12,35" (redondeado a 2 decimales por fmtDec)
    expect(csv).toMatch(/12,35/);
    // 2.5 L/ha × 12.345 ha = 30.86 L → "30,86"
    expect(csv).toMatch(/30,86/);
  });

  it("usa la 'recorded_by' como fallback de piloto cuando pilot_name es null", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // Evento 1002 tiene pilot_name=null y recorded_by="Operador X"
    expect(csv).toMatch(/2026-07-20;;Operador X/);
  });

  it("renderiza nulls como string vacío (no 'null' ni 'undefined')", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // producto y notas del evento 1002 son null → celdas vacías
    const lines = csv.split("\n");
    const eventRow = lines.find((l) => l.startsWith("2026-07-20"));
    expect(eventRow).toBeDefined();
    // La línea no debe contener "null" ni "undefined"
    expect(eventRow!.toLowerCase()).not.toContain("null");
    expect(eventRow!.toLowerCase()).not.toContain("undefined");
  });

  it("escapa strings con ';' usando quoting RFC 4180", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // "Lote 12; con punto y coma" debe estar entre comillas (contiene ;)
    expect(csv).toMatch(/"Lote 12; con punto y coma"/);
    // "Don; Eulogio" (owner) — contiene ;
    expect(csv).toMatch(/"Don; Eulogio"/);
  });

  it("escapa strings con '\\n' usando quoting RFC 4180", () => {
    const csv = buildParcelReportCsv(makeFixture());
    // "Notas\ncon salto de línea" → la celda va entre comillas y el
    // newline queda dentro del quoted field.
    expect(csv).toMatch(/"Notas\ncon salto de línea"/);
  });

  it("incluye totales correctos", () => {
    const csv = buildParcelReportCsv(makeFixture());
    expect(csv).toMatch(/Fumigaciones en el rango;2/);
    expect(csv).toMatch(/Área fumigada total \(ha\);12,35/);
    expect(csv).toMatch(/Volumen aplicado total \(L\);30,86/);
    // promedio = 12.345 / 2 = 6.1725 → "6,17"
    expect(csv).toMatch(/Área promedio por fumigación \(ha\);6,17/);
    expect(csv).toMatch(/Última fumigación del rango;2026-08-05/);
  });

  it("incluye cobertura del mes con porcentaje", () => {
    const csv = buildParcelReportCsv(makeFixture());
    expect(csv).toMatch(/Cobertura del mes — área fumigable \(ha\);30,00/);
    expect(csv).toMatch(/Cobertura del mes — área fumigada \(ha\);12,35/);
    expect(csv).toMatch(/Cobertura del mes — porcentaje \(%\);41,2/);
  });

  it("marca el cap cuando la lista supera MAX_EVENTS_IN_PDF", () => {
    // Para el CSV no usamos el cap (queremos TODAS las filas), pero
    // la sección Fumigaciones debe indicar el cap si aplica.
    const fixture = makeFixture();
    fixture.totals.capReached = true;
    // Simulamos que events.length < count.
    fixture.events = fixture.events.slice(0, 1);
    const csv = buildParcelReportCsv(fixture);
    // El header de la sección Fumigaciones debe indicar el cap.
    expect(csv).toMatch(/Sección;Fumigaciones \(2, mostrando primeras 1\)/);
  });
});
