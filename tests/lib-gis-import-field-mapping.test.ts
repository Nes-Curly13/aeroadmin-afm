// tests/lib-gis-import-field-mapping.test.ts
//
// El import GIS mapea atributos del shapefile a nuestras columnas
// (opción b). NO mapea fechas (vienen desactualizadas).

import { describe, expect, it } from "vitest";
import { mapParcelFields } from "@/lib/gis-import/field-mapping";

describe("mapParcelFields", () => {
  it("mapea el shapefile de suertes (HDASTE/HACIENDA/STE/VARIEDAD/AREA_HA)", () => {
    const m = mapParcelFields({
      HDASTE: "030070C",
      COD: "030",
      AREA_HA: 2.05,
      HACIENDA: "Delicias",
      VARIEDAD: "CC 01-678",
      STE: "70C",
      "F.SIEMBRA": "26/10/2019 12:00?AM",
      Sacarosa: 12.492
    });
    expect(m.external_id).toBe("030070C");
    expect(m.farm_name).toBe("Delicias");
    expect(m.luck_name).toBe("70C");
    expect(m.variety).toBe("CC 01-678");
    expect(m.declared_area_ha).toBe(2.05);
    // Nombre humano combinado
    expect(m.land_name).toBe("Delicias · 70C");
  });

  it("NO mapea fechas (F.SIEMBRA / F.COSECHA quedan fuera)", () => {
    const m = mapParcelFields({
      HACIENDA: "X",
      STE: "1",
      "F.SIEMBRA": "01/01/2020",
      "F.COSECHA": "01/01/2025"
    });
    expect(m).not.toHaveProperty("planting_date");
    expect(Object.keys(m)).not.toContain("F.SIEMBRA");
  });

  it("acepta números como string para el área", () => {
    expect(mapParcelFields({ AREA_HA: "12,5" }).declared_area_ha).toBe(12.5);
  });

  it("es case-insensitive y tolera espacios", () => {
    const m = mapParcelFields({ hacienda: "La Cabaña", ste: "5A", variedad: "CC" });
    expect(m.farm_name).toBe("La Cabaña");
    expect(m.luck_name).toBe("5A");
    expect(m.variety).toBe("CC");
    expect(m.land_name).toBe("La Cabaña · 5A");
  });

  it("sin campos reconocidos → todo null", () => {
    const m = mapParcelFields({ foo: "bar", baz: 1 });
    expect(m.land_name).toBeNull();
    expect(m.external_id).toBeNull();
    expect(m.declared_area_ha).toBeNull();
  });

  it("land_name cae a HDASTE si no hay hacienda/suerte", () => {
    expect(mapParcelFields({ HDASTE: "1630003" }).land_name).toBe("1630003");
  });
});
