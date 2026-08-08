// tests/lib-reports-farms-csv.test.ts
//
// Test unitario del CSV serializer de farms report (nivel 2, 2026-08-08).
//
// Cubre:
//   - BOM al inicio
//   - 5 secciones: Cabecera, Última fumigación, Totales, Por parcela, Fumigaciones
//   - Formato es-CO (coma decimal)
//   - Manejo de lastFumigation = null
//   - Filtro de hacienda en Cabecera
//   - Sin fumigaciones en el rango → secciones vacías manejadas

import { describe, expect, it } from "vitest";
import { buildFarmsReportCsv } from "@/lib/reports/farms-csv";
import type { FarmsReportData } from "@/lib/reports/fetch-farms-report-data";

function makeFixture(): FarmsReportData {
  return {
    operatorName: "Operador de Prueba",
    operatorRegion: "Valle del Cauca, Colombia",
    generatedAt: "2026-08-08T20:00:00.000Z",
    window: { from: "2026-07-09", to: "2026-08-08" },
    farmName: "EL LIMAR",
    lastFumigation: {
      id: 9999,
      fumigation_date: "2026-08-05",
      parcel_id: 3107,
      parcel_name: "EL LIMAR STE2",
      farm_name: "EL LIMAR",
      pilot_name: "Juan Pérez",
      drone_nickname: "Drone-01",
      area_fumigated_ha: 5.32,
      dose_l_per_ha: 2.5,
      product_used: "Glifosato 48%"
    },
    fumigations: [
      {
        id: 9999,
        fumigation_date: "2026-08-05",
        parcel_id: 3107,
        parcel_name: "EL LIMAR STE2",
        farm_name: "EL LIMAR",
        land_name: "EL LIMAR STE2",
        pilot_name: "Juan Pérez",
        drone_nickname: "Drone-01",
        area_fumigated_ha: 5.32,
        dose_l_per_ha: 2.5,
        product_used: "Glifosato 48%",
        recorded_by: null,
        notes: null
      },
      {
        id: 9998,
        fumigation_date: "2026-07-20",
        parcel_id: 3107,
        parcel_name: "EL LIMAR STE2",
        farm_name: "EL LIMAR",
        land_name: "EL LIMAR STE2",
        pilot_name: null,
        drone_nickname: null,
        area_fumigated_ha: null,
        dose_l_per_ha: null,
        product_used: null,
        recorded_by: "Operador X",
        notes: "Sin datos del DJI"
      }
    ],
    capReached: false,
    parcels: [
      {
        parcel_id: 3107,
        parcel_name: "EL LIMAR STE2",
        farm_name: "EL LIMAR",
        n_fumigations: 2,
        total_area_ha: 5.32,
        total_liters: 13.3,
        last_fumigation_date: "2026-08-05"
      }
    ],
    totals: {
      nFumigations: 2,
      totalAreaHa: 5.32,
      totalLiters: 13.3,
      nParcels: 1
    }
  };
}

describe("buildFarmsReportCsv", () => {
  it("empieza con BOM U+FEFF", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("incluye las 5 secciones esperadas", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    const lines = csv
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, ""))
      .filter((l) => l.startsWith("Sección;"));
    expect(lines).toEqual([
      "Sección;Cabecera",
      "Sección;Última fumigación del rango",
      "Sección;Totales",
      "Sección;Por parcela (1)",
      "Sección;Fumigaciones (2)"
    ]);
  });

  it("la sección Cabecera incluye operador, región, ventana y filtro hacienda", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv).toMatch(/Operador;Operador de Prueba/);
    expect(csv).toMatch(/Región;Valle del Cauca, Colombia/);
    expect(csv).toMatch(/Ventana desde;2026-07-09/);
    expect(csv).toMatch(/Ventana hasta;2026-08-08/);
    expect(csv).toMatch(/Filtro hacienda;EL LIMAR/);
  });

  it("la sección Última fumigación muestra los datos correctos", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv).toMatch(/Fecha;2026-08-05/);
    expect(csv).toMatch(/Piloto;Juan Pérez/);
    expect(csv).toMatch(/Dron;Drone-01/);
    expect(csv).toMatch(/Producto;Glifosato 48%/);
  });

  it("la sección Totales tiene los agregados correctos", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv).toMatch(/Fumigaciones en el rango;2/);
    expect(csv).toMatch(/Área fumigada total \(ha\);5,32/);
    expect(csv).toMatch(/Volumen aplicado total \(L\);13,30/);
    expect(csv).toMatch(/Parcelas activas;1/);
  });

  it("la sección Por parcela lista 1 fila por parcela", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv).toMatch(/Parcela;Hacienda;Fumigaciones;Área total \(ha\);Litros totales \(L\);Última fumigación/);
    expect(csv).toMatch(/EL LIMAR STE2;EL LIMAR;2;5,32;13,30;2026-08-05/);
  });

  it("la sección Fumigaciones lista todas las fumigaciones", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    expect(csv).toMatch(/Fecha;Parcela;Hacienda;Piloto;Dron;Área \(ha\);Volumen \(L\);Producto;Registrador;Notas/);
    expect(csv).toMatch(/2026-08-05;EL LIMAR STE2;EL LIMAR;Juan Pérez;Drone-01;5,32;13,30;Glifosato 48%/);
  });

  it("renderiza decimales con coma (es-CO)", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    // 2.5 L/ha × 5.32 ha = 13.30 L → "13,30"
    expect(csv).toMatch(/13,30/);
  });

  it("renderiza nulls como string vacío (no 'null' ni 'undefined')", () => {
    const csv = buildFarmsReportCsv(makeFixture());
    const lines = csv.split("\n");
    const emptyRow = lines.find((l) => l.startsWith("2026-07-20"));
    expect(emptyRow).toBeDefined();
    expect(emptyRow!.toLowerCase()).not.toContain("null");
    expect(emptyRow!.toLowerCase()).not.toContain("undefined");
  });

  it("marca 'Filtro hacienda;Todas' cuando farmName es null (vista general)", () => {
    const data = makeFixture();
    data.farmName = null;
    const csv = buildFarmsReportCsv(data);
    expect(csv).toMatch(/Filtro hacienda;Todas/);
  });

  it("muestra 'Sin fumigaciones' cuando lastFumigation es null", () => {
    const data = makeFixture();
    data.lastFumigation = null;
    data.fumigations = [];
    data.parcels = [];
    data.totals = { nFumigations: 0, totalAreaHa: 0, totalLiters: 0, nParcels: 0 };
    const csv = buildFarmsReportCsv(data);
    expect(csv).toMatch(/Resultado;Sin fumigaciones registradas en el rango/);
    expect(csv).toMatch(/Fumigaciones en el rango;0/);
  });
});
