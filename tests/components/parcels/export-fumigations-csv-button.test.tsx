// tests/components/parcels/export-fumigations-csv-button.test.tsx
//
// Tests para el botón "Exportar CSV" en /parcels/[id].
// Audit Q3 #10 (ui-ux-2026-07 §5.2): el operador fumigador del Valle
// del Cauca quiere llevarse un reporte de las fumigaciones de la parcela
// al campo (sin internet). El botón genera un CSV con formato
// Excel-amigable (separador ";", BOM, slug+fecha en el filename).
//
// Sprint B — F1.11: el CSV ahora incluye header de metadata (operador,
// fecha de generación, parcela) y totales al final cuando se pasa el
// prop `csvMeta`. Sin `csvMeta` (compat con callers viejos), el CSV
// mantiene la shape original (solo tabla).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  ExportFumigationsCsvButton,
  buildFumigationsCsv
} from "@/components/parcels/export-fumigations-csv-button";
import type { DjiFumigationEvent } from "@/lib/types";

function makeEvent(over: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 1,
    parcel_id: 7,
    fumigation_date: "2026-07-15",
    product_used: "Glifosato 1L/ha",
    dose_l_per_ha: 1.0,
    area_fumigated_m2: 10_000,
    drone_code_used: 201,
    duration_minutes: 25,
    notes: "Aplicación normal",
    human_notes: null,
    recorded_by: "Juan Pérez",
    recorded_at: "2026-07-15T15:30:00Z",
    source: "manual",
    ...over
  };
}

describe("ExportFumigationsCsvButton", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let blob: Blob | null;
  let lastDownloadName: string | null;

  beforeEach(() => {
    blob = null;
    lastDownloadName = null;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    // Capturamos `download` y evitamos el click real sobre el anchor.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      lastDownloadName = this.download;
      return undefined;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("renderiza un botón con el texto 'Exportar CSV'", () => {
    render(
      <ExportFumigationsCsvButton
        events={[]}
        parcelName="Porvenir STE 3"
      />
    );
    const btn = screen.getByRole("button", { name: /exportar csv/i });
    expect(btn).toBeInTheDocument();
  });

  it("al click genera un download con filename slug+fecha", async () => {
    // Fijamos today a 2026-07-19 para que el filename sea determinístico.
    const realDate = global.Date;
    const fixed = new realDate("2026-07-19T12:00:00Z");
    class MockDate extends realDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        // @ts-expect-error
        super(...(args.length === 0 ? [fixed.getTime()] : args));
      }
      static now() {
        return fixed.getTime();
      }
    }
    // @ts-expect-error
    global.Date = MockDate;
    try {
      render(
        <ExportFumigationsCsvButton
          events={[makeEvent()]}
          parcelName="Porvenir STE 3"
        />
      );
      const btn = screen.getByRole("button", { name: /exportar csv/i });
      fireEvent.click(btn);
    } finally {
      global.Date = realDate;
    }
    expect(lastDownloadName).toBe("porvenir-ste-3-2026-07-19.csv");
  });

  // ============================================================
  // Sprint B — F1.11: CSV con metadata (csvMeta)
  // ============================================================

  describe("con csvMeta (Sprint B — F1.11)", () => {
    const csvMeta = {
      operatorName: "AeroAdmin Cañero",
      generatedAt: "2026-07-23",
      parcelLabel: "42 - Porvenir STE 3"
    };

    it("incluye BOM (\\uFEFF) al inicio y usa ';' como separador", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[makeEvent()]}
          parcelName="Porvenir STE 3"
          csvMeta={csvMeta}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      expect(blob).not.toBeNull();
      const buffer = await (blob as unknown as Blob).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0xef);
      expect(bytes[1]).toBe(0xbb);
      expect(bytes[2]).toBe(0xbf);
    });

    it("las 3 primeras filas son metadata (operador, fecha, parcela)", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[makeEvent()]}
          parcelName="Porvenir STE 3"
          csvMeta={csvMeta}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      // Después del BOM (que `text()` consume), las primeras filas son
      // la metadata, luego el header de columnas, luego los eventos.
      expect(lines[0].replace(/^\uFEFF/, "")).toBe(
        "Operador: AeroAdmin Cañero;;;;;;;"
      );
      expect(lines[1]).toBe("Fecha de generación: 2026-07-23;;;;;;;");
      expect(lines[2]).toBe("Parcela: 42 - Porvenir STE 3;;;;;;;");
      // El header de la tabla de eventos viene en lines[3].
      expect(lines[3]).toBe(
        "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
      );
      // Y el primer evento en lines[4].
      expect(lines[4]).toContain("2026-07-15");
    });

    it("las celdas vacías de las filas de metadata se alinean con las columnas", async () => {
      // 8 columnas → 7 celdas vacías después del label.
      const csv = buildFumigationsCsv({
        events: [makeEvent()],
        parcelDroneName: "T40",
        meta: csvMeta
      });
      const text = csv.replace(/^\uFEFF/, "");
      const lines = text.split("\n");
      // Cada línea de metadata tiene exactamente 8 celdas (1 con texto + 7 vacías).
      for (let i = 0; i < 3; i++) {
        const cells = lines[i].split(";");
        expect(cells).toHaveLength(8);
        expect(cells[0]).toContain(":");
        for (let j = 1; j < 8; j++) {
          expect(cells[j]).toBe("");
        }
      }
    });

    it("incluye sección de totales al final con los valores correctos", async () => {
      const events = [
        makeEvent({
          id: 1,
          fumigation_date: "2026-07-10",
          area_fumigated_m2: 10_000, // 1 ha
          dose_l_per_ha: 1.0,         // 1.0 L × 1 ha = 1.0 L
          duration_minutes: 25
        }),
        makeEvent({
          id: 2,
          fumigation_date: "2026-07-15",
          area_fumigated_m2: 20_000, // 2 ha
          dose_l_per_ha: 0.8,         // 0.8 × 2 = 1.6 L
          duration_minutes: 30
        }),
        makeEvent({
          id: 3,
          fumigation_date: "2026-07-20",
          area_fumigated_m2: null, // sin área (caso edge)
          dose_l_per_ha: null,
          duration_minutes: 15
        })
      ];
      render(
        <ExportFumigationsCsvButton
          events={events}
          parcelName="Porvenir STE 3"
          csvMeta={csvMeta}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      // Última línea no vacía: la "Última fumigación".
      // Buscamos las filas de totales con regex (no asumimos índice
      // exacto — puede haber cambios menores en el shape).
      const allText = lines.join("\n");
      // Total área: 1 + 2 = 3.00 ha
      expect(allText).toMatch(/Total área fumigada \(mes\): 3\.00 ha;;;;;;;/);
      // Total fumigaciones: 3
      expect(allText).toMatch(/Total fumigaciones \(mes\): 3;;;;;;;/);
      // Promedio: 3.00 / 3 = 1.00 ha
      expect(allText).toMatch(/Promedio área por fumigación: 1\.00 ha;;;;;;;/);
      // Última fumigación: 2026-07-20 (la mayor fecha)
      expect(allText).toMatch(/Última fumigación: 2026-07-20;;;;;;;/);
    });

    it("con events vacío, los totales muestran 0 y sin última fumigación", async () => {
      const csv = buildFumigationsCsv({
        events: [],
        parcelDroneName: "T40",
        meta: csvMeta
      });
      const text = csv.replace(/^\uFEFF/, "");
      expect(text).toContain("Total fumigaciones (mes): 0;;;;;;;");
      expect(text).toContain("Total área fumigada (mes): 0.00 ha;;;;;;;");
      expect(text).toContain("Promedio área por fumigación: 0.00 ha;;;;;;;");
      expect(text).toContain("Última fumigación: —;;;;;;;");
    });

    it("con events vacío, igual incluye header de metadata + header de columnas", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[]}
          parcelName="Parcela A"
          csvMeta={csvMeta}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      // 3 metadata + 1 header + 1 (fila vacía del evento) + 1 separador
      // + 4 totales + trailing = 10 lines (lines[9] = "")
      expect(lines[0].replace(/^\uFEFF/, "")).toContain("Operador:");
      expect(lines[1]).toContain("Fecha de generación:");
      expect(lines[2]).toContain("Parcela:");
      expect(lines[3]).toBe(
        "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
      );
      // La tabla está vacía — lines[4] es fila vacía (sin eventos).
      expect(lines[4]).toBe("");
    });
  });

  // ============================================================
  // Sprint B — F1.11: CSV sin csvMeta (compat con callers viejos)
  // ============================================================

  describe("sin csvMeta (shape original, compat)", () => {
    it("el CSV contiene solo el header + eventos, sin metadata ni totales", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[]}
          parcelName="Parcela A"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      expect(lines[0].replace(/^\uFEFF/, "")).toBe(
        "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
      );
      expect(lines.length).toBe(2);
      expect(lines[1]).toBe("");
    });

    it("el header de columnas se mantiene igual", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[makeEvent()]}
          parcelName="Parcela A"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      // Header de columnas en lines[0] (sin metadata arriba).
      expect(lines[0].replace(/^\uFEFF/, "")).toBe(
        "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
      );
      // Primera fila de evento en lines[1].
      expect(lines[1]).toContain("2026-07-15");
      expect(lines[1]).toContain("Juan Pérez");
    });

    it("usa parcelDroneName como columna 'Dron' cuando se provee", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[makeEvent()]}
          parcelDroneName="Agras T40 / T50"
          parcelName="Parcela A"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      expect(lines[1]).toContain("Agras T40 / T50");
    });

    it("omite la nota si es un blob JSON de provenance (no es nota humana)", async () => {
      render(
        <ExportFumigationsCsvButton
          events={[
            makeEvent({
              notes: '{"backfilled_from":"dji_flights","primary_drone_nickname":"AFM T50-1"}'
            })
          ]}
          parcelName="Parcela A"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      // La columna Notas (última) debe estar vacía porque el blob fue
      // detectado como provenance.
      const cells = lines[1].split(";");
      expect(cells[cells.length - 1]).toBe("");
      expect(text).not.toContain("backfilled_from");
    });

    it("incluye todas las fumigaciones con sus valores", async () => {
      const events = [
        makeEvent({
          id: 1,
          fumigation_date: "2026-07-15",
          recorded_by: "Juan Pérez",
          duration_minutes: 25,
          area_fumigated_m2: 10_000,
          dose_l_per_ha: 1.0,
          product_used: "Glifosato 1L/ha",
          notes: "Aplicación normal"
        }),
        makeEvent({
          id: 2,
          fumigation_date: "2026-07-20",
          recorded_by: "María López",
          duration_minutes: 30,
          area_fumigated_m2: 20_000,
          dose_l_per_ha: 0.8,
          product_used: "Herbicida X",
          notes: "Llovizna leve"
        })
      ];
      render(
        <ExportFumigationsCsvButton
          events={events}
          parcelName="Parcela Cañera"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
      const text = await (blob as unknown as Blob).text();
      const lines = text.split("\n");
      expect(lines[0].replace(/^\uFEFF/, "")).toBe(
        "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
      );
      // Fila 1
      expect(lines[1]).toContain("2026-07-15");
      expect(lines[1]).toContain("Juan Pérez");
      expect(lines[1]).toContain("25");
      expect(lines[1]).toContain("Glifosato 1L/ha");
      expect(lines[1]).toContain("Aplicación normal");
      // Fila 2
      expect(lines[2]).toContain("2026-07-20");
      expect(lines[2]).toContain("María López");
      expect(lines[2]).toContain("30");
      expect(lines[2]).toContain("Herbicida X");
      expect(lines[2]).toContain("Llovizna leve");
    });
  });
});
