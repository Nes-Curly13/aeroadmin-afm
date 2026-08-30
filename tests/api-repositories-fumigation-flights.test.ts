/**
 * tests/api-repositories-fumigation-flights.test.ts
 *
 * Test unitario de `getFumigationFlights` (Sprint S9 fix, 2026-08-30).
 *
 * Verifica:
 *   - Query con flight_ids vacios devuelve [] sin tocar la BD.
 *   - Query NO referencia la columna inexistente `duration_min` —
 *     la columna real es `duration_seconds` y la conversion a minutos
 *     la hace la BD con `duration_seconds / 60.0`.
 *   - Query proyecta `parcel_id` (s9.0 — para mostrar la suerte
 *     cubierta por cada vuelo en `/fumigacion/[id]`).
 *   - Query ordena por `start_at ASC` (timeline cronologico).
 *
 * Bug pre-S9: `duration_min` no existia en la tabla, el query fallaba
 * y el catch en dev devolvia `[]` silenciosamente, ocultando los 14
 * vuelos asociados en fumigaciones multi-parcela. El PDF y CSV reports
 * (`fumigation-pdf-template.ts:163`, `fumigation-csv.ts:176`) sufrian
 * el mismo bug latente.
 *
 * Mockeamos `getDb` con un result fijo y capturamos la SQL generada.
 */

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }),
  };
});

// Importamos despues del mock para que `getDb` este monkey-patched.
import { getFumigationFlights } from "@/api/repositories";

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getFumigationFlights", () => {
  it("devuelve [] sin tocar la BD si flightIds es null/undefined/empty", async () => {
    expect(await getFumigationFlights(null)).toEqual([]);
    expect(await getFumigationFlights(undefined)).toEqual([]);
    expect(await getFumigationFlights([])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("usa duration_seconds (NO la inexistente duration_min) y proyecta duration_min en minutos", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          flight_id: 531384005,
          start_at: "2026-01-28T13:46:26.000Z",
          pilot_name: "Test",
          drone_nickname: "Drone-01",
          area_m2: "1234.56",
          spray_usage_ml: 1500,
          // El cast numeric/60.0 viene de la BD; pg lo devuelve como string.
          duration_min: "20.55",
          lng: -76.5,
          lat: 3.4,
          parcel_id: 3104,
        },
      ],
    });

    await getFumigationFlights([531384005]);

    // La query es el primer argumento string, el segundo es el array de flight_ids.
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([[531384005]]);

    // El bug del pre-S9 era referenciar `duration_min` como COLUMNA
    // (sin alias AS). Aceptamos que aparezca como alias
    // `AS duration_min` o en comentarios. La verificacion es:
    // la columna fuente debe ser `duration_seconds`.
    expect(sql).toMatch(/duration_seconds\s*\/\s*60\.0/);
    expect(sql).toMatch(/AS\s+duration_min/i);

    // Anti-regression: la columna `duration_min` no debe aparecer
    // sola (sin AS delante) en ninguna linea no-comentada.
    const codeLines = sql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--"));
    for (const line of codeLines) {
      // Quitamos los `AS duration_min` (alias) y los strings entre comillas,
      // y verificamos que `duration_min` no aparezca como columna cruda.
      const stripped = line.replace(/AS\s+duration_min/gi, "ALIAS");
      expect(stripped).not.toMatch(/\bduration_min\b/);
    }
  });

  it("proyecta parcel_id y ordena por start_at ASC (timeline cronologico)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getFumigationFlights([1, 2, 3]);

    const [sql] = mockQuery.mock.calls[0] as [string, unknown];
    expect(sql).toMatch(/\bparcel_id\b/);
    expect(sql).toMatch(/ORDER BY start_at ASC/i);
  });

  it("convierte un error de la BD en [] cuando NO estamos en produccion (dev/test)", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      mockQuery.mockRejectedValue(new Error("column duration_min does not exist"));
      const result = await getFumigationFlights([1, 2, 3]);
      expect(result).toEqual([]);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
