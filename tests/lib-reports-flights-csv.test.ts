// tests/lib-reports-flights-csv.test.ts
//
// Test unitario del CSV serializer `buildFlightsReportCsv` (feature TBD,
// 2026-08-30). Cubre el shape wide (42 columnas), el BOM, el separador
// `;`, decimales con coma, quoting RFC 4180, y el manejo de nulls.
//
// El data layer (`fetch-flights-report-data.ts`) tiene su cobertura
// via tests de integracion contra Supabase en CI. Acá testeamos solo
// la transformación de datos a string CSV.

import { describe, expect, it } from "vitest";
import { buildFlightsReportCsv } from "@/lib/reports/flights-csv";
import type { FlightsExportRow, FlightsReportData } from "@/lib/reports/fetch-flights-report-data";

function makeRow(overrides: Partial<FlightsExportRow> = {}): FlightsExportRow {
  return {
    flight_id: 669687291,
    parcel_id: 3104,
    parcel_name: "STE 24 -25santarosa",
    parcel_external_id: "1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75",
    client_name: "AFM Topografía",
    farm_name: "Hacienda Santa Rosa",
    municipality: "Candelaria",
    start_at: "2026-01-28T13:26:12.000Z",
    end_at: "2026-01-28T13:26:57.000Z",
    duration_seconds: 45,
    duration_min: 0.75,
    duration_human: "00:00:45",
    area_m2: 673.0,
    area_ha: 0.0673,
    spray_usage_ml: 2584,
    spray_usage_l: 2.584,
    drone_serial: "R8383153744",
    drone_nickname: "AFM T50-1",
    drone_model: "T50",
    drone_model_code: 201,
    drone_registration: "HK-2024-UAV-01",
    pilot_name: "breiner pelaez",
    is_default_team: false,
    is_orphan: false,
    district: "Candelaria",
    location: "Candelaria, Valle del Cauca, Colombia",
    lng: -76.2686002,
    lat: 3.4696465,
    mode: "spray",
    manual_mode: false,
    work_speed_m_s: 5.5,
    spray_width_m: 8.0,
    radar_height_m: 4.5,
    fumigations_count: 1,
    fumigations_total_area_m2: 673.0,
    fumigations_total_volume_l: 2.584,
    source: "djiag",
    captured_at: "2026-08-30T13:49:45.358Z",
    notes_summary: "Raw DJI response JSON truncado...",
    ...overrides
  };
}

function makeData(overrides: Partial<FlightsReportData> = {}): FlightsReportData {
  return {
    window: { from: "2026-01-01", to: "2026-01-31" },
    generatedAt: "2026-08-30T13:49:45.358Z",
    operatorName: "AFM Topografía",
    operatorRegion: "Valle del Cauca, Colombia",
    filters: {
      droneId: null,
      pilot: null,
      parcelId: null,
      includeOrphans: true,
      includeDefaultTeam: true
    },
    totals: {
      nFlights: 1,
      nWithParcel: 1,
      nOrphans: 0,
      nDefaultTeam: 0
    },
    flights: [makeRow()],
    capReached: false,
    cap: 50000,
    ...overrides
  };
}

describe("buildFlightsReportCsv", () => {
  it("empieza con BOM UTF-8 (Excel lo necesita para ñ y tildes)", () => {
    const csv = buildFlightsReportCsv(makeData());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa separador ';' y termina cada fila con \\n", () => {
    const csv = buildFlightsReportCsv(makeData());
    // La 1ra línea tiene BOM (0xFEFF) que NO cuenta como separador.
    // Verificamos que el separador de columnas es `;` contando cuántos
    // `;` hay en la línea de datos del flight — debe ser exactamente
    // N-1 donde N es el número de columnas de la tabla Vuelos (39).
    const lines = csv.split("\n");
    const vuelosHeaderIdx = lines.findIndex((l) => l.startsWith("Sección;Vuelos"));
    const dataLine = lines[vuelosHeaderIdx + 2];
    // 39 columnas → 38 separadores `;` mínimo
    const semiCount = (dataLine.match(/;/g) || []).length;
    expect(semiCount).toBeGreaterThanOrEqual(38);
    // No debe haber `\t` (usamos `;`, no tab)
    expect(dataLine).not.toContain("\t");
  });

  it("incluye 2 secciones: Cabecera y Vuelos", () => {
    const csv = buildFlightsReportCsv(makeData());
    // El BOM está pegado al inicio de la primera línea, así que
    // usamos un match que no requiera startsWith.
    expect(csv).toMatch(/Sección;Cabecera/);
    expect(csv).toMatch(/Sección;Vuelos \(1\)/);
  });

  it("la Cabecera muestra ventana, totales y filtros aplicados", () => {
    const csv = buildFlightsReportCsv(
      makeData({
        filters: {
          droneId: 201,
          pilot: "breiner",
          parcelId: 3104,
          includeOrphans: false,
          includeDefaultTeam: false
        }
      })
    );
    expect(csv).toMatch(/Ventana desde;2026-01-01/);
    expect(csv).toMatch(/Ventana hasta;2026-01-31/);
    expect(csv).toMatch(/Filtro drone;#201/);
    expect(csv).toMatch(/Filtro piloto;ILIKE '%breiner%'/);
    expect(csv).toMatch(/Filtro parcela;#3104/);
    expect(csv).toMatch(/Incluir orphan;No/);
    expect(csv).toMatch(/Incluir default team;No/);
  });

  it("la Cabecera avisa si se alcanzó el cap", () => {
    const csv = buildFlightsReportCsv(makeData({ capReached: true, cap: 50000 }));
    expect(csv).toMatch(/⚠ Cap alcanzado/);
  });

  it("la tabla Vuelos tiene 39 columnas (header + 1 fila de datos)", () => {
    const csv = buildFlightsReportCsv(makeData());
    // Header empieza con "Sección;Vuelos (1)\n", después la línea de
    // header de columnas, después la fila de datos.
    const lines = csv.split("\n");
    const vuelosHeaderIdx = lines.findIndex((l) => l.startsWith("Sección;Vuelos"));
    expect(vuelosHeaderIdx).toBeGreaterThan(-1);
    const headerLine = lines[vuelosHeaderIdx + 1];
    const cols = headerLine.split(";");
    expect(cols.length).toBe(39);
  });

  it("la fila de datos tiene el mismo número de columnas que el header", () => {
    const csv = buildFlightsReportCsv(makeData());
    const lines = csv.split("\n");
    const vuelosHeaderIdx = lines.findIndex((l) => l.startsWith("Sección;Vuelos"));
    const headerLine = lines[vuelosHeaderIdx + 1];
    const dataLine = lines[vuelosHeaderIdx + 2];
    expect(dataLine.split(";").length).toBe(headerLine.split(";").length);
  });

  it("decimales se serializan con coma (es-CO / Excel Colombia)", () => {
    const csv = buildFlightsReportCsv(makeData());
    // area_m2 = 673.00 → "673,00"
    expect(csv).toMatch(/673,00/);
    // lng -76.2686002 → "-76,2686002"
    expect(csv).toMatch(/-76,2686002/);
  });

  it("duración humana se formatea como HH:MM:SS", () => {
    const csv = buildFlightsReportCsv(
      makeData({
        flights: [
          makeRow({
            duration_seconds: 3661,
            duration_min: 61.016666666666666,
            duration_human: "01:01:01"
          })
        ]
      })
    );
    expect(csv).toMatch(/01:01:01/);
  });

  it("quoting RFC 4180 cuando hay ';' o '\"' o '\\n'", () => {
    const csv = buildFlightsReportCsv(
      makeData({
        flights: [
          makeRow({
            // location con caracteres que disparan quoting
            location: 'Candelaria; Valle "del Cauca"',
            notes_summary: "Linea 1\nLinea 2"
          })
        ]
      })
    );
    // El location va quoted y los " escapados como ""
    expect(csv).toMatch(/"Candelaria; Valle ""del Cauca"""/);
    // El notes_summary va quoted con el newline dentro (raw, no escapa
    // newlines en CSV, los deja literal — RFC 4180)
    expect(csv).toMatch(/"Linea 1\nLinea 2"/);
  });

  it("nulls se serializan como string vacío (no 'null')", () => {
    const csv = buildFlightsReportCsv(
      makeData({
        flights: [
          makeRow({
            parcel_id: null,
            parcel_name: null,
            client_name: null,
            farm_name: null,
            area_m2: null,
            spray_usage_ml: null,
            pilot_name: null
          })
        ]
      })
    );
    // El row del flight NO debe tener la palabra "null" en las celdas
    const lines = csv.split("\n");
    const vuelosHeaderIdx = lines.findIndex((l) => l.startsWith("Sección;Vuelos"));
    const dataLine = lines[vuelosHeaderIdx + 2];
    const cells = dataLine.split(";");
    for (const c of cells) {
      expect(c).not.toBe("null");
    }
  });

  it("booleans is_default_team e is_orphan se serializan como 'true'/'false'", () => {
    const csv = buildFlightsReportCsv(
      makeData({
        flights: [
          makeRow({ is_default_team: true, is_orphan: true }),
          makeRow({ is_default_team: false, is_orphan: false })
        ]
      })
    );
    expect(csv).toMatch(/;true;true;/);
    expect(csv).toMatch(/;false;false;/);
  });

  it("funciona con 0 flights (lista vacía)", () => {
    const csv = buildFlightsReportCsv(makeData({ flights: [], totals: { nFlights: 0, nWithParcel: 0, nOrphans: 0, nDefaultTeam: 0 } }));
    expect(csv).toMatch(/Vuelos \(0\)/);
    // Sigue con la línea de header pero sin filas de datos
    expect(csv).toContain("flight_id");
  });
});
