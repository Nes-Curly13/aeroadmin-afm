// tests/lib/csv.test.ts
//
// Tests para `lib/csv.ts` — helper puro para generación de CSV
// en el cliente (export de fumigaciones desde /parcels/[id]).
//
// Contrato:
//   - toCsv: separador ";", BOM al inicio, RFC 4180 quoting, trailing \n
//   - slugFilename: lowercase, acentos→ASCII, no-alfanum→"-", colapza "-",
//                   trimea "-", sufija fecha YYYY-MM-DD.
//
// Audit ui-ux-2026-07 §5.2: el operador fumigador del Valle del Cauca
// pide reportes de fumigación por parcela. Estos helpers dan formato
// Excel-amigable (separador ";" por conflicto con decimales `,` en locale
// es-CO, BOM para que Excel detecte UTF-8 y respete las tildes).

import { describe, expect, it } from "vitest";

import { slugFilename, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("devuelve solo el header (con BOM y trailing newline) cuando rows está vacío", () => {
    const csv = toCsv<{ name: string }>(
      [],
      [{ key: "name", label: "Nombre" }]
    );
    // BOM + header + \n
    expect(csv).toBe("\uFEFFNombre\n");
  });

  it("serializa strings y números en el orden de headers", () => {
    const csv = toCsv<{ a: string; b: number; c: string }>(
      [{ a: "uno", b: 2, c: "tres" }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" }
      ]
    );
    // BOM + headers + fila con ; como separador + \n
    expect(csv).toBe("\uFEFFA;B;C\nuno;2;tres\n");
  });

  it("quota campos que contienen ';'", () => {
    const csv = toCsv<{ note: string }>(
      [{ note: "uno;dos" }],
      [{ key: "note", label: "Nota" }]
    );
    expect(csv).toBe("\uFEFFNota\n\"uno;dos\"\n");
  });

  it("escapea '\"' como '\"\"' y quota el campo", () => {
    const csv = toCsv<{ note: string }>(
      [{ note: 'con "comillas"' }],
      [{ key: "note", label: "Nota" }]
    );
    expect(csv).toBe("\uFEFFNota\n\"con \"\"comillas\"\"\"\n");
  });

  it("quota campos que contienen '\\n'", () => {
    const csv = toCsv<{ note: string }>(
      [{ note: "línea 1\nlínea 2" }],
      [{ key: "note", label: "Nota" }]
    );
    // El \n interno se preserva dentro de las comillas (RFC 4180).
    expect(csv).toBe("\uFEFFNota\n\"línea 1\nlínea 2\"\n");
  });

  it("usa ';' como separador (no ',')", () => {
    const csv = toCsv<{ a: string; b: string }>(
      [{ a: "x", b: "y" }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" }
      ]
    );
    // La segunda fila debe tener ";" entre x e y
    const lines = csv.split("\n");
    expect(lines[1]).toBe("x;y");
  });

  it("los labels del header aparecen tal cual en la primera fila", () => {
    const csv = toCsv<{ k: string }>(
      [{ k: "v" }],
      [{ key: "k", label: "Mi Columna Personalizada" }]
    );
    const lines = csv.split("\n");
    // Sin BOM en esta comparación
    expect(lines[0].replace(/^\uFEFF/, "")).toBe("Mi Columna Personalizada");
  });

  it("incluye BOM (\\uFEFF) al inicio del output", () => {
    const csv = toCsv<{ a: string }>(
      [{ a: "1" }],
      [{ key: "a", label: "A" }]
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("termina con un único trailing newline", () => {
    const csv = toCsv<{ a: string }>(
      [{ a: "1" }, { a: "2" }],
      [{ key: "a", label: "A" }]
    );
    // Header + 2 filas + 1 \n final
    expect(csv.endsWith("\n")).toBe(true);
    // No debe haber \n\n al final
    expect(csv.endsWith("\n\n")).toBe(false);
  });

  it("serializa null como string vacío", () => {
    const csv = toCsv<{ a: string | null }>(
      [{ a: null }],
      [{ key: "a", label: "A" }]
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe("");
  });

  it("serializa undefined como string vacío", () => {
    const csv = toCsv<{ a: string | undefined }>(
      [{ a: undefined }],
      [{ key: "a", label: "A" }]
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe("");
  });

  it("respeta el orden de headers aunque la key venga después en el objeto", () => {
    const csv = toCsv<{ z: string; a: string; m: string }>(
      [{ z: "Z", a: "A", m: "M" }],
      [
        { key: "a", label: "A" },
        { key: "m", label: "M" },
        { key: "z", label: "Z" }
      ]
    );
    const lines = csv.split("\n");
    expect(lines[0].replace(/^\uFEFF/, "")).toBe("A;M;Z");
    expect(lines[1]).toBe("A;M;Z");
  });
});

/**
 * Helper para los tests de `slugFilename`: stub de `Date` con `now()` y
 * constructor por defecto fijados al timestamp dado. Usamos mediodía UTC
 * para evitar drift de TZ en el `getDate()` local que usa `slugFilename`
 * (la fecha del filename es la del clock local del navegador del operador,
 * Bogotá UTC-5; mediodía UTC es seguro en cualquier TZ al este de -12).
 */
function withFixedDate<T>(isoUtcNoon: string, fn: () => T): T {
  const realDate = global.Date;
  const fixed = new realDate(isoUtcNoon);
  class MockDate extends realDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      // @ts-expect-error -- spread variadic para soportar `new MockDate()` sin args
      super(...(args.length === 0 ? [fixed.getTime()] : args));
    }
    static now() {
      return fixed.getTime();
    }
  }
  // @ts-expect-error -- reemplazamos Date global para este test
  global.Date = MockDate;
  try {
    return fn();
  } finally {
    global.Date = realDate;
  }
}

describe("slugFilename", () => {
  it("lowercase + sufijo de fecha YYYY-MM-DD", () => {
    const name = withFixedDate("2026-07-19T12:00:00Z", () => slugFilename("Reporte R1", "csv"));
    expect(name).toBe("reporte-r1-2026-07-19.csv");
  });

  it("convierte acentos a ASCII", () => {
    withFixedDate("2026-01-15T12:00:00Z", () => {
      expect(slugFilename("Parcela Cañera", "csv")).toBe("parcela-canera-2026-01-15.csv");
      expect(slugFilename("Ñoño Elías", "csv")).toBe("nono-elias-2026-01-15.csv");
    });
  });

  it("reemplaza espacios por '-'", () => {
    withFixedDate("2026-01-15T12:00:00Z", () => {
      expect(slugFilename("Mi Parcela Bonita", "csv")).toBe("mi-parcela-bonita-2026-01-15.csv");
    });
  });

  it("reemplaza caracteres especiales no alfanuméricos por '-'", () => {
    withFixedDate("2026-01-15T12:00:00Z", () => {
      expect(slugFilename("Hola/Mundo!", "csv")).toBe("hola-mundo-2026-01-15.csv");
      expect(slugFilename("Año 2026 (Q3)", "csv")).toBe("ano-2026-q3-2026-01-15.csv");
    });
  });

  it("colapsa múltiples '-' en uno solo y trimea los extremos", () => {
    withFixedDate("2026-01-15T12:00:00Z", () => {
      expect(slugFilename("  Hola   Mundo  ", "csv")).toBe("hola-mundo-2026-01-15.csv");
      expect(slugFilename("a!!b??c", "csv")).toBe("a-b-c-2026-01-15.csv");
    });
  });
});
