/**
 * tests/lib-excel-applications-parser.test.ts
 *
 * Test unitario del parser del Excel. Sprint feature/excel-applications-import
 * (Nivel 1).
 *
 * El parser vive en lib/excel-applications-parser.js (CJS) para que el
 * script CLI lo importe. Los tests importan el .js con @ts-check + un
 * .d.ts con los tipos.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as os from "node:os";
import { parseExcelApplications, type ExcelApplicationRow } from "@/lib/excel-applications-parser";

function makeXlsx(
  sheets: Record<string, { headers: string[]; rows: Array<Array<unknown>> }>
): string {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, { headers, rows }] of Object.entries(sheets)) {
    const data: Array<Array<unknown>> = [[], headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const filePath = `${os.tmpdir()}/test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`;
  XLSX.writeFile(wb, filePath);
  return filePath;
}

const sameDay = (a: Date | null, b: Date | null) =>
  a != null && b != null &&
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

describe("parseExcelApplications — happy path", () => {
  it("parsea hoja 2025 con 23 columnas y 3 filas", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: [
          "FECHA ", "AÑO", "MES", "DRONE", "PILOTO", "TRANSPORTE", "Columna1",
          "HACIENDA", "TIPO APLICACIÓN", "SUERTE", "ALTURA", "VELOCIDAD",
          "AREA APLICADA", "AREA OT", "ANCHO FRANJA", "DOSIS", "ZONA",
          "CLIENTE ", "Nº DE  FACTURA", "FECHA DE FACTURACION ",
          "CANCELADA", "VALOR DE LA FACTURA ", "HORAS PLANTA "
        ],
        rows: [
          [
            new Date(2025, 0, 9), 2025, "ENERO", "T-40", "BREINER PELAEZ", "BKO448", null,
            "PAPAYAL", "PRE EMERGENTE", "1-12A-12B-38-21C", 3, 15, 19.58, 19.58, 6, 20,
            "CENTRO", "AGROJABA", "FVE2052", new Date(2025, 0, 16), "SI", 1723040, null
          ],
          [
            new Date(2025, 0, 10), 2025, "ENERO", "T-40", "BREINER PELAEZ", "BKO448", null,
            "LA LINDA", "PRE EMERGENTE", "2", 3, 15, 5.35, 5.35, 6, 20,
            "CENTRO", "AGROJABA", "FVE2052", new Date(2025, 0, 16), "SI", 473440, null
          ],
          [
            new Date(2024, 11, 31), 2024, "DICIEMBRE", "T-40", "BREINER PELAEZ", "BKO448", null,
            "SANTA INES", "FUNGICIDA", "1", 3, 15, 16.5, 16.5, 6, 15,
            "NORTE", "AGROJABA", "FVE 2051", new Date(2025, 0, 16), "SI", null, null
          ]
        ]
      }
    });

    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(3);

      expect(sameDay(result[0].fecha, new Date(Date.UTC(2025, 0, 9)))).toBe(true);
      expect(sameDay(result[0].fecha_facturacion, new Date(Date.UTC(2025, 0, 16)))).toBe(true);
      expect(result[0].hacienda).toBe("PAPAYAL");
      expect(result[0].suerte).toBe("1-12A-12B-38-21C");
      expect(result[0].piloto).toBe("BREINER PELAEZ");
      expect(result[0].drone).toBe("T-40");
      expect(result[0].transporte).toBe("BKO448");
      expect(result[0].tipo_aplicacion).toBe("PRE EMERGENTE");
      expect(result[0].altura_m).toBe(3);
      expect(result[0].velocidad_m_s).toBe(15);
      expect(result[0].area_aplicada).toBe(19.58);
      expect(result[0].area_ot).toBe(19.58);
      expect(result[0].ancho_franja_m).toBe(6);
      expect(result[0].dosis_l_ha).toBe(20);
      expect(result[0].zona).toBe("CENTRO");
      expect(result[0].cliente).toBe("AGROJABA");
      expect(result[0].numero_factura).toBe("FVE2052");
      expect(result[0].valor_factura_cop).toBe(1723040);
      expect(result[0].cancelada).toBe("SI");
      expect(result[0].unidad_area).toBe("ha");
      expect(result[0].source.sheet).toBe("2025");
      expect(result[0].source.row_idx).toBe(1);

      expect(result[1].hacienda).toBe("LA LINDA");
      expect(result[1].area_aplicada).toBe(5.35);

      expect(result[2].tipo_aplicacion).toBe("FUNGICIDA");
      expect(result[2].zona).toBe("NORTE");
      expect(result[2].valor_factura_cop).toBe(null);
      expect(result[2].numero_factura).toBe("FVE 2051");
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });

  it("parsea hoja 2026 con 17 columnas (sin factura, con VOLUMEN)", () => {
    const xlsxPath = makeXlsx({
      "2026": {
        headers: [
          "FECHA ", "MES", "DRONE", "PILOTO", "TRANSPORTE", "HACIENDA",
          "TIPO APLICACIÓN", "SUERTE", "ALTURA", "VELOCIDAD", "AREA APLICADA",
          "ANCHO FRANJA", "VOLUMEN TOTAL", "DOSIS", "LOCALIZACIÓN ", "CLIENTE "
        ],
        rows: [
          [
            new Date(2026, 0, 6), "Enero", "DJI T 40", "BREINER PELAEZ", "BKO448",
            "El VÍNCULO", "BIOESTIMULANTE", "1-2-3-4-5-6-7", 3.5, 28, 29, 8.41, 725, 25,
            "EL VÍNCULO", "IBARGUEN ASPRILLA Y COMPAÑÍA S.EN.C"
          ]
        ]
      }
    });

    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(1);
      expect(result[0].hacienda).toBe("El VÍNCULO");
      expect(result[0].volumen_l).toBe(725);
      expect(result[0].dosis_l_ha).toBe(25);
      expect(result[0].area_aplicada).toBe(29);
      expect(result[0].numero_factura).toBe(null);
      expect(result[0].valor_factura_cop).toBe(null);
      expect(result[0].zona).toBe("EL VÍNCULO");
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });
});

describe("parseExcelApplications — tolerancia", () => {
  it("ignora headers que no matchean (Columna1, AÑO, MES)", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "AÑO", "MES", "DRONE", "PILOTO", "HACIENDA", "SUERTE"],
        rows: [[new Date(2025, 5, 1), 2025, "JUNIO", "T-40", "PILOTO X", "HACIENDA Y", "SUERTE Z"]]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(1);
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });

  it("tolera nombres de headers con espacios extra y acentos", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA  ", "DRONE", "PILOTO", "HACIENDA", "SUERTE", "DOSIS", "AREA APLICADA "],
        rows: [[new Date(2025, 0, 1), "T-40", "PILOTO", "HACIENDA", "SUERTE", 25, 10.5]]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(1);
      expect(result[0].drone).toBe("T-40");
      expect(result[0].dosis_l_ha).toBe(25);
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });

  it("ignora filas completamente vacias", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "DRONE", "HACIENDA"],
        rows: [
          [new Date(2025, 0, 1), "T-40", "HACIENDA 1"],
          [null, null, null],
          [new Date(2025, 0, 2), "T-40", "HACIENDA 2"]
        ]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(2);
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });
});

describe("parseExcelApplications — deteccion de unidad de area", () => {
  it("auto-detecta ha cuando valores son chicos (< 100)", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "AREA APLICADA", "HACIENDA", "DRONE"],
        rows: [
          [new Date(2025, 0, 1), 5.5, "H1", "D1"],
          [new Date(2025, 0, 2), 19.58, "H2", "D1"],
          [new Date(2025, 0, 3), 30.0, "H3", "D1"]
        ]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result.every(r => r.unidad_area === "ha")).toBe(true);
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });

  it("auto-detecta m2 cuando algun valor es >= 1000", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "AREA APLICADA", "HACIENDA", "DRONE"],
        rows: [
          [new Date(2025, 0, 1), 5000, "H1", "D1"],
          [new Date(2025, 0, 2), 19580, "H2", "D1"]
        ]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result.every(r => r.unidad_area === "m2")).toBe(true);
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });

  it("respeta areaUnit forzado por el operador", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "AREA APLICADA", "HACIENDA", "DRONE"],
        rows: [[new Date(2025, 0, 1), 5000, "H1", "D1"]]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath, { areaUnit: "ha" });
      expect(result[0].unidad_area).toBe("ha");
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });
});

describe("parseExcelApplications — solo hojas de anos", () => {
  it("ignora hojas que no son anos", () => {
    const xlsxPath = makeXlsx({
      "2025": {
        headers: ["FECHA", "DRONE", "HACIENDA"],
        rows: [[new Date(2025, 0, 1), "T-40", "H1"]]
      },
      "Hoja2": {
        headers: ["FECHA", "DRONE", "HACIENDA"],
        rows: [[new Date(2025, 0, 1), "T-40", "H1"]]
      },
      "RESUMEN DAÑOS": {
        headers: ["FECHA", "DRONE", "HACIENDA"],
        rows: [[new Date(2025, 0, 1), "T-40", "H1"]]
      }
    });
    try {
      const result: ExcelApplicationRow[] = parseExcelApplications(xlsxPath);
      expect(result).toHaveLength(1);
      expect(result[0].source.sheet).toBe("2025");
    } finally {
      fs.unlinkSync(xlsxPath);
    }
  });
});
