// tests/components/parcels/export-fumigations-csv-button.test.tsx
//
// Tests para el botón "Exportar CSV" en /parcels/[id].
// Audit Q3 #10 (ui-ux-2026-07 §5.2): el operador fumigador del Valle
// del Cauca quiere llevarse un reporte de las fumigaciones de la parcela
// al campo (sin internet). El botón genera un CSV con formato
// Excel-amigable (separador ";", BOM, slug+fecha en el filename).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ExportFumigationsCsvButton } from "@/components/parcels/export-fumigations-csv-button";
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

  it("el CSV generado incluye BOM (\\uFEFF) al inicio y usa ';' como separador", async () => {
    render(
      <ExportFumigationsCsvButton
        events={[makeEvent()]}
        parcelName="Parcela A"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    expect(blob).not.toBeNull();
    // El BOM se UTF-8-encoda como bytes 0xEF 0xBB 0xBF. `Blob.text()`
    // consume el BOM al decodificar, así que leemos los bytes crudos.
    const buffer = await (blob as unknown as Blob).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    // Después del BOM, la primera fila es el header.
    const text = await (blob as unknown as Blob).text();
    const lines = text.split("\n");
    const header = lines[0]; // text() ya consumió el BOM, sin replace
    expect(header).toBe("Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas");
  });

  it("el CSV incluye todas las fumigaciones con sus valores", async () => {
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-15",
        recorded_by: "Juan Pérez",
        duration_minutes: 25,
        area_fumigated_m2: 10_000, // 1 ha
        dose_l_per_ha: 1.0,         // 1.0 L * 1 ha = 1.0 L
        product_used: "Glifosato 1L/ha",
        notes: "Aplicación normal"
      }),
      makeEvent({
        id: 2,
        fumigation_date: "2026-07-20",
        recorded_by: "María López",
        duration_minutes: 30,
        area_fumigated_m2: 20_000, // 2 ha
        dose_l_per_ha: 0.8,         // 0.8 * 2 = 1.6 L
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
    // Header + 2 filas + \n final
    const lines = text.split("\n");
    expect(lines[0].replace(/^\uFEFF/, "")).toBe(
      "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
    );
    // Fila 1: 2026-07-15; <droneModel>; Juan Pérez; 1; 25; 1; Glifosato 1L/ha; Aplicación normal
    // (el drone sale del parcel.drone_model_name, en este test pasamos parcelDroneName=undefined → "")
    // Como el prop parcelDroneName es opcional y no lo pasamos, queda vacío.
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
    // Y NO debe contener la metadata cruda del backfill.
    expect(text).not.toContain("backfilled_from");
  });

  it("con events vacío, el CSV contiene solo el header", async () => {
    render(
      <ExportFumigationsCsvButton
        events={[]}
        parcelName="Parcela A"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    const text = await (blob as unknown as Blob).text();
    const lines = text.split("\n");
    // header + línea vacía (de la fila vacía) + \n
    expect(lines[0].replace(/^\uFEFF/, "")).toBe(
      "Fecha;Dron;Piloto;Área (ha);Duración (min);Volumen (L);Producto;Notas"
    );
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
  });
});
